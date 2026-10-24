import {
  dailyUsage, worstCaseWorkload,
  type CostTable, type DailyUsage, type Linear, type WorkloadLine,
} from './capacityModel';

/**
 * P16e capacity gate: the daily workload table (plan R10), the gate thresholds (plan R11) and the two-year storage projection
 * (plan R12), all pure functions of the checked-in cost table and storage footprints. `capacityGate.test.ts` evaluates them and
 * checks the result against `docs/ops/p16-capacity-gate.json`.
 *
 * Workload assumption (CheerC, 2026-10-24): the real traffic is under 100 people a day and hard to push past 200, so the design
 * ceiling is 200 business commands a day (100 typical); the earlier 500-command envelope is not used. Everything below that is not
 * a measured cost is an ASSUMPTION about how the app is used, stated where it is made; P18 replaces them with CheerC's real
 * numbers. What is measured and read from the code: the cost of each operation (`p16-capacity-costs.json`) and that every
 * command of the orders page ends with a refresh from its receipt (`CloudOrdersPage.refreshAfterCommand`, P16f2 S4: the student, the
 * day and the transaction it changed; a full reload only when the receipt does not follow the page's snapshot).
 *
 * Read verdict (plan P16f §7, Gate 1 r2): the typical day (100 commands) passes below 25,000 reads counted the conservative way (every
 * authorization lookup billed); the design ceiling (200) passes the same way, or, when the conservative count is under 27,500 (less
 * than 10 % over), when the deduped count (the official billing, a document read once per request) is under 25,000. The result
 * says which method passed. Over that is FAIL.
 */

export const THRESHOLDS = {
  /** Spark gives 50,000 reads and 20,000 writes a day; the gate keeps 50 % of headroom (spec §10). */
  reads: 25_000,
  /** At the design ceiling the deduped count decides when the conservative one is under this (10 % over `reads`); see the header. */
  readsConservativeBand: 27_500,
  writes: 10_000,
  deletes: 0,
  /** The storage limit is 1 GiB: pass below 512 MiB, "needs a retention spec before 85 %" up to 0.85 GiB, fail from there. */
  storagePassBytes: 512 * 1024 * 1024,
  storageFailBytes: Math.round(0.85 * 1024 * 1024 * 1024),
  commandBytes: 64 * 1024,
} as const;

/** The days of the anomaly scan's window (`LEDGER_WINDOW_DAYS` in cloudDayCloseRepository.ts; `capacityGate.test.ts` checks they agree). */
export const LEDGER_WINDOW_DAYS = 62;

/**
 * The first window of days the vendors page reads to find the latest earlier menu (`INITIAL_SOURCE_WINDOW_DAYS` in
 * cloudDayVendorRepository.ts; `capacityGate.test.ts` checks they agree). Every business day gets a menu, so the latest one is
 * found in it; the fixture's closed days have none, which is why the fitted cost grows with them, one read each, up to this window
 * and no further (an older menu would be a gap of more than a month without one).
 */
export const MENU_SCAN_WINDOW_DAYS = 32;

export interface Assumptions {
  label: string;
  /** Business commands a day (the design ceiling, or the typical day). */
  commands: number;
  /** Hours a day the operator holds the lease (the heartbeat renews it every 120 seconds, P16f2 S7). */
  openHours: number;
  /** Pages open on the same UID (each has a lease listener and reads the ledger when it starts). */
  pages: number;
  /** Students on the roster (the app reads it whole, 500 at most). */
  roster: number;
  /** Students with a transaction on a day (the accounts that a report of that day reads the history of); half the commands at most. */
  activePerDay: number;
  vendors: number;
  /** Closed business days in the history (two years). */
  closedDays: number;
  /** Past days that are open, never closed. */
  unclosedDays: number;
  /** Lease changes a day that write an access event (acquire, release, takeover). */
  leaseEvents: number;
  /** Days the storage projection covers. */
  days: number;
}

/** The design ceiling: 200 commands a day on a roster of 200, two years of history. */
export const DESIGN: Assumptions = {
  label: 'design ceiling', commands: 200, openHours: 10, pages: 2, roster: 200, activePerDay: 100, vendors: 20, closedDays: 730, unclosedDays: 3, leaseEvents: 4, days: 730,
};
/** The typical day: 100 commands. */
export const TYPICAL: Assumptions = { ...DESIGN, label: 'typical day', commands: 100, activePerDay: 50 };
/** A small shop: 100 commands a day on a roster of 100 (one reading of "under 100 people a day"). */
export const SMALL_SHOP: Assumptions = { ...DESIGN, label: 'small shop (100 commands, roster of 100)', commands: 100, roster: 100, activePerDay: 50 };
/** The roster at its code limit (500): the same ceiling of commands, the largest roster the app reads. */
export const FULL_ROSTER: Assumptions = { ...DESIGN, label: 'design ceiling, roster of 500', roster: 500 };

/**
 * The commands of one day. The day opening and closing commands (7) do not depend on traffic; the rest are the commands of the
 * orders page, in the proportions of plan R10 scaled to 200 a day: 117 orders, 56 payments, 8 cash movements, 4 refunds and
 * 8 corrections (3 corrected, 2 voided, 1 keep-deposit cancellation, 1 refund cancellation, 1 undo).
 */
const DAY_COMMANDS = ['EnsureDay', 'SetDayMenu', 'SetOpeningCash', 'CloseDay', 'RecordBackup', 'RecordExport', 'RecordPrint'] as const;
const PAGE_COMMANDS: Array<[string, number]> = [
  ['CreateOrder', 117], ['CreatePayment', 56], ['CreateCashMovement', 8], ['CreateRefund', 4],
  ['CorrectTransaction', 3], ['VoidTransaction', 2], ['CancelKeepDeposit', 1], ['CancelRefund', 1], ['Undo', 1],
];
const PAGE_COMMAND_TOTAL = PAGE_COMMANDS.reduce((sum, [, count]) => sum + count, 0);
/** The commands of the orders page that create a transaction document. */
const TRANSACTION_KINDS = ['CreateOrder', 'CreatePayment', 'CreateCashMovement', 'CreateRefund'];

export interface DayShape {
  /** Orders-page commands (each ends with a reload of the orders snapshot). */
  pageCommands: number;
  /** Transactions created in a day. */
  transactions: number;
  /** Commands that are not transactions (corrections and the day's other commands). */
  otherCommands: number;
  /** Transactions on the page at a random moment of the day: half of the day's. */
  transactionsOnPage: number;
}

export function dayShape(a: Assumptions): DayShape {
  const pageCommands = Math.max(0, a.commands - DAY_COMMANDS.length);
  const share = (kinds: string[]) => PAGE_COMMANDS.filter(([kind]) => kinds.includes(kind)).reduce((sum, [, count]) => sum + count, 0) / PAGE_COMMAND_TOTAL;
  const transactions = pageCommands * share(TRANSACTION_KINDS);
  return { pageCommands, transactions, otherCommands: a.commands - transactions, transactionsOnPage: transactions / 2 };
}

/** The commands of a day as workload lines. */
function commandLines(a: Assumptions): WorkloadLine[] {
  const { pageCommands } = dayShape(a);
  return [
    ...DAY_COMMANDS.map(kind => ({ operation: `command.${kind}`, perDay: 1 })),
    ...PAGE_COMMANDS.map(([kind, count]) => ({ operation: `command.${kind}`, perDay: (pageCommands * count) / PAGE_COMMAND_TOTAL })),
  ];
}

/**
 * Page loads a day (P16f2 S9: the usage the plan states, replacing the guesses of #555). ASSUMPTIONS (opens per day are a guess of
 * how a shop uses the app; what each page reads is measured):
 * - orders page: 6 opens, and after every command of the page a refresh from the command's receipt (`load.ordersRefresh`, S4);
 * - ledger scan (S3: the last 62 days and the days still open): when each page starts (cold: nothing is cached yet), after opening or
 *   closing a day (2) and when the anomalies page is opened (1); a closed day of the window is at most 62;
 * - day pages: the vendors page is opened 4 times and reloads after each of its 3 commands (it reads the first 32-day window for the
 *   latest menu, not the history), the day-close page 3 times, the students page 4 times;
 * - reports: 6 of today, 1 of a week, one of a month every 5 days (0.2 a day), after a summary at the page start (2 opens, S13: day
 *   heads only); the range audit is read on demand (S10): a CSV or print takes the report on the screen (S12: no re-read) and
 *   reads the audit of the range, 2 a day. Each access-events read goes with a report. A report reads the transactions of the range
 *   and the roster, no account history (P16f1), and for each closed day of its range the day, its versions and entries;
 * - audits: 3 of a day and 2 of a student (newest page of 100) on demand;
 * - account queries (10 at the ceiling of 200 commands, 5 on a typical day): the account history (with the days of the range, S11)
 *   and the student's range audit, which read the student's transactions and commands from the range start to today: the range is
 *   the 31 days at most that the page allows, so a month of that student's traffic; the account page is opened twice a day (a
 *   summary of one day and the roster, S11);
 * - the incremental backup export of the day's commands, once.
 */
function loadLines(a: Assumptions): WorkloadLine[] {
  const shape = dayShape(a);
  const lines: WorkloadLine[] = [];
  const load = (operation: string, perDay: number, units?: Record<string, number>) => {
    if (perDay > 0) lines.push({ operation, perDay, ...(units ? { units } : {}) });
  };
  const txPerStudentDay = shape.transactions / a.roster;
  const commandsPerStudentDay = a.commands / a.roster;
  // the history of one student: its transactions (at most MAX_ACCOUNT_TRANSACTIONS) and its commands
  const studentTransactions = Math.round(Math.min(100_000, txPerStudentDay * a.days));
  const studentCommands = Math.round(commandsPerStudentDay * a.days);
  // what one student has from the start of an account query's range (31 days at most) to today
  const RANGE_DAYS = 31;
  const studentRangeTransactions = Math.round(txPerStudentDay * RANGE_DAYS);
  const studentRangeCommands = Math.round(commandsPerStudentDay * RANGE_DAYS);
  // the closed days that the anomaly scan reads: the window of 62 days at most (cloudDayCloseRepository LEDGER_WINDOW_DAYS)
  const scannedClosedDays = Math.min(a.closedDays, LEDGER_WINDOW_DAYS);
  // the days that the vendors page reads to find the latest menu: the first window, because every business day has one
  const menuScanDays = Math.min(a.closedDays, MENU_SCAN_WINDOW_DAYS);
  /**
   * The units of a report over `days` days. The report reads the transactions of the range and the roster; the accounts of the
   * range and their histories are still units of the fitted `load.report` (the cost of a few reads of the range per account,
   * and `studentTransaction`, the history beyond the range, which the report no longer reads: its fitted cost is 0).
   */
  const reportUnits = (days: number) => {
    const rangeTransactions = shape.transactions * days;
    const accounts = Math.min(a.roster, a.activePerDay * days, rangeTransactions);
    return {
      student: a.roster,
      rangeAccount: accounts,
      dayTransaction: rangeTransactions - accounts,
      studentTransaction: Math.max(0, accounts * studentTransactions - rangeTransactions),
    };
  };
  const accessEventsPerDay = a.leaseEvents;

  load('load.orders', 6, { student: a.roster, dayTransaction: shape.transactionsOnPage, openDay: a.unclosedDays });
  load('load.ordersRefresh', shape.pageCommands);
  // the first scan of a page that has just started reads every closed day's settlement of the window; the later ones only what changed
  load('load.ledgerScanCold', a.pages, { closedDay: scannedClosedDays, openDay: a.unclosedDays });
  load('load.ledgerScan', 3, { closedDay: scannedClosedDays, openDay: a.unclosedDays });
  load('load.dayVendors', 4 + 3, { vendor: a.vendors, closedDay: menuScanDays, openDay: a.unclosedDays });
  load('load.dayCloseOverview', 3, { openDay: a.unclosedDays });
  load('load.dayCloseState', 3, { settlementVersion: 2 });
  load('load.students', 4, { student: a.roster });

  // reports: the summary at the page start (a month of day heads), then one query per range
  load('load.summary', 2, { closedDay: 31, settlementVersion: 0 });
  const reportQueries: Array<[number, number]> = [[1, 6], [7, 1], [30, 0.2]];
  for (const [days, perDay] of reportQueries) load('load.report', perDay, reportUnits(days));
  // the closed days of the ranges that a report reads (today's is open): their versions, post-close entries and back-fill markers
  load('load.reportClosedDay', reportQueries.reduce((sum, [days, perDay]) => sum + perDay * (days - 1), 0));
  load('load.accessEvents', reportQueries.reduce((sum, [, perDay]) => sum + perDay, 0), { accessEvent: accessEventsPerDay * 7 });
  // CSV and print: the report on the screen is reused, the audit of the range (today's) is read when asked for
  load('load.auditRange', 2, { student: a.roster, vendor: a.vendors, dayTransaction: shape.transactions, dayCommand: shape.otherCommands });

  // account queries: 10 at the ceiling of 200 commands and 5 on a typical day
  const accountQueries = a.commands / 20;
  const accountPageOpens = 2;
  load('load.summary', accountPageOpens, { closedDay: 1, settlementVersion: 0 });
  load('load.students', accountPageOpens, { student: a.roster });
  load('load.accountHistory', accountQueries, {
    student: a.roster, dayTransaction: shape.transactions, studentTransaction: studentTransactions, studentRangeTransaction: studentRangeTransactions,
  });
  load('load.auditRangeStudent', accountQueries, { studentTransaction: studentRangeCommands });

  load('load.auditDay', 3, { dayTransaction: shape.transactions, dayCommand: shape.otherCommands });
  // the audit of a student is its newest page of at most 100 commands
  load('load.auditStudent', 2, { studentTransaction: Math.min(studentCommands, 100) });
  load('load.backupExport', 1, { command: a.commands });
  return lines;
}

/** The lease: a renewal every minute for the hours the operator holds it, a listener snapshot of each renewal on every page. */
function leaseLines(a: Assumptions): WorkloadLine[] {
  const renewals = a.openHours * 30;
  return [
    { operation: 'lease.acquire', perDay: a.leaseEvents / 2 },
    { operation: 'lease.release', perDay: a.leaseEvents / 2 },
    { operation: 'lease.renew', perDay: renewals },
    { operation: 'lease.listenerSnapshot', perDay: renewals * a.pages },
    { operation: 'lease.status', perDay: 2 * a.pages },
    { operation: 'listener.operatorDocument', perDay: a.pages },
  ];
}

export function workloadOf(a: Assumptions): WorkloadLine[] {
  return [...commandLines(a), ...loadLines(a), ...leaseLines(a)];
}

export function businessOperations(): string[] {
  return [...DAY_COMMANDS, ...PAGE_COMMANDS.map(([kind]) => kind)].map(kind => `command.${kind}`);
}

// ---- storage -----------------------------------------------------------------------------------------------------------

export interface CreatedDocument { collection: string; documentBytes: number; indexBytes: number }
export interface StorageProfile {
  kinds: Record<string, CreatedDocument[]>;
  leaseEvents: { acquire: CreatedDocument[]; release: CreatedDocument[] };
  maxCommand: { kind: string; documentBytes: number };
}
export interface StorageFootprints { schemaVersion: 1; typical: StorageProfile; worst: StorageProfile; fields: Record<string, string[]> }

const bytesOf = (documents: CreatedDocument[]) => documents.reduce((sum, item) => sum + item.documentBytes + item.indexBytes, 0);

export interface StorageProjection {
  /** Bytes the days add (commands, transactions, days, settlements, access events). */
  perDayBytes: number;
  /** The roster and vendors, which do not grow with the days. */
  fixedBytes: number;
  totalBytes: number;
  /** Days until the 85 % line (0.85 GiB) at this rate. */
  daysToFail: number;
  byCollection: Record<string, number>;
}

/** What the days and the roster add up to over `a.days` days, from the footprints of one profile. */
export function projectStorage(profile: StorageProfile, a: Assumptions): StorageProjection {
  const byCollection: Record<string, number> = {};
  const add = (documents: CreatedDocument[], times: number) => {
    for (const item of documents) byCollection[item.collection] = (byCollection[item.collection] ?? 0) + (item.documentBytes + item.indexBytes) * times;
  };
  const perKind = (kind: string): CreatedDocument[] => {
    const found = profile.kinds[kind];
    if (!found) throw new Error(`capacity gate: no storage footprint for command kind ${kind}`);
    return found;
  };
  for (const line of commandLines(a)) add(perKind(line.operation.slice('command.'.length)), line.perDay);
  add(profile.leaseEvents.acquire, a.leaseEvents / 2);
  add(profile.leaseEvents.release, a.leaseEvents / 2);
  const perDayBytes = Object.values(byCollection).reduce((sum, bytes) => sum + bytes, 0);
  // the roster and the vendors, created once
  const fixed = (kind: string, count: number) => Math.round(bytesOf(perKind(kind)) * count);
  const fixedBytes = fixed('CreateStudent', a.roster) + fixed('SaveVendor', a.vendors);
  const totalBytes = Math.round(perDayBytes * a.days + fixedBytes);
  return {
    perDayBytes: Math.round(perDayBytes),
    fixedBytes,
    totalBytes,
    daysToFail: Math.floor((THRESHOLDS.storageFailBytes - fixedBytes) / perDayBytes),
    byCollection: Object.fromEntries(Object.entries(byCollection).map(([name, bytes]) => [name, Math.round(bytes * a.days)])),
  };
}

// ---- the gate ----------------------------------------------------------------------------------------------------------

export type Verdict = 'PASS' | 'WARN' | 'FAIL';

export interface ScenarioResult {
  label: string;
  assumptions: Assumptions;
  /** `passedBy` is the count that decided a PASS (the conservative one, or at the design ceiling the deduped one), null for a FAIL. */
  reads: { conservative: number; deduped: number; limit: number; verdict: Verdict; passedBy: 'conservative' | 'deduped' | null };
  writes: { count: number; limit: number; verdict: Verdict };
  deletes: { count: number; limit: number; verdict: Verdict };
  /** The lines that read the most (conservative), largest first. */
  topReads: Array<{ operation: string; perDay: number; reads: number }>;
  storage?: { profile: 'typical' | 'worst'; projection: StorageProjection; verdict: Verdict };
}

const round = (value: number) => Math.round(value);

/**
 * The read verdict: the conservative count under the limit passes; when `dedupedMayDecide` (the design ceiling), a conservative count
 * under the band (10 % over) passes if the deduped count is under the limit.
 */
export function readVerdictOf(conservative: number, deduped: number, dedupedMayDecide: boolean): { verdict: Verdict; passedBy: 'conservative' | 'deduped' | null } {
  if (conservative < THRESHOLDS.reads) return { verdict: 'PASS', passedBy: 'conservative' };
  if (dedupedMayDecide && conservative < THRESHOLDS.readsConservativeBand && deduped < THRESHOLDS.reads) return { verdict: 'PASS', passedBy: 'deduped' };
  return { verdict: 'FAIL', passedBy: null };
}

function describeUsage(label: string, assumptions: Assumptions, usage: DailyUsage, dedupedMayDecide: boolean): Omit<ScenarioResult, 'storage'> {
  const decided = readVerdictOf(usage.reads.conservative, usage.reads.deduped, dedupedMayDecide);
  const merged = new Map<string, { perDay: number; reads: number }>();
  for (const line of usage.lines) {
    const found = merged.get(line.operation) ?? { perDay: 0, reads: 0 };
    merged.set(line.operation, { perDay: found.perDay + line.perDay, reads: found.reads + line.reads });
  }
  return {
    label, assumptions,
    reads: { conservative: round(usage.reads.conservative), deduped: round(usage.reads.deduped), limit: THRESHOLDS.reads, ...decided },
    writes: { count: round(usage.writes), limit: THRESHOLDS.writes, verdict: usage.writes < THRESHOLDS.writes ? 'PASS' : 'FAIL' },
    deletes: { count: round(usage.deletes), limit: THRESHOLDS.deletes, verdict: usage.deletes <= THRESHOLDS.deletes ? 'PASS' : 'FAIL' },
    topReads: [...merged.entries()].map(([operation, line]) => ({ operation, perDay: Math.round(line.perDay * 100) / 100, reads: round(line.reads) }))
      .sort((a, b) => b.reads - a.reads).slice(0, 10),
  };
}

export function storageVerdict(bytes: number): Verdict {
  if (bytes < THRESHOLDS.storagePassBytes) return 'PASS';
  return bytes < THRESHOLDS.storageFailBytes ? 'WARN' : 'FAIL';
}

function scenario(table: CostTable, a: Assumptions, footprints: StorageFootprints, profile: 'typical' | 'worst'): ScenarioResult {
  const result = describeUsage(a.label, a, dailyUsage(table, workloadOf(a)), a.commands >= DESIGN.commands);
  const projection = projectStorage(footprints[profile], a);
  return { ...result, storage: { profile, projection, verdict: storageVerdict(projection.totalBytes) } };
}

/** The table with the cost per unit of some dimensions of some operations multiplied by `factor` (reads and authorization). */
export function scaleDimensions(table: CostTable, operations: string[], dimensions: string[], factor: number): CostTable {
  const scale = (linear: Linear): Linear => ({
    fixed: linear.fixed,
    perUnit: Object.fromEntries(Object.entries(linear.perUnit).map(([name, value]) => [name, dimensions.includes(name) ? value * factor : value])),
  });
  const next: CostTable = { ...table, operations: { ...table.operations } };
  for (const name of operations) {
    const cost = table.operations[name]!;
    next.operations[name] = { ...cost, reads: scale(cost.reads), readAuthorization: scale(cost.readAuthorization), readAuthorizationDeduped: scale(cost.readAuthorizationDeduped) };
  }
  return next;
}

export interface WhatIf {
  label: string;
  /** An estimate with the measured table, not a measurement of changed code. */
  reads: number;
}

export interface GateResult {
  schemaVersion: 1;
  thresholds: typeof THRESHOLDS;
  /** The gate decides on the design ceiling; the others show how far each assumption moves the result. */
  design: ScenarioResult;
  typical: ScenarioResult;
  smallShop: ScenarioResult;
  fullRoster: ScenarioResult;
  /** The design ceiling with every business command replaced by the kind that reads the most (plan R10). */
  worstCase: Omit<ScenarioResult, 'storage'>;
  /** The design ceiling with the largest student record the Rules allow in every command's before/after (storage only). */
  storageWorstProfile: NonNullable<ScenarioResult['storage']>;
  whatIf: WhatIf[];
  /**
   * The least a small shop reads in a day: its commands, the orders reload after each of them and the lease, with no report,
   * audit, account query or any other page opened. Above the limit means no assumption about page opens can save the gate.
   */
  floor: { label: string; reads: number; limit: number; verdict: Verdict };
  commandBytes: { maxBytes: number; kind: string; limit: number; verdict: Verdict };
  verdict: Verdict;
}

/** The gate: reads, writes and deletes of a day, the two-year storage, and the size of a command document. */
export function evaluateGate(table: CostTable, footprints: StorageFootprints): GateResult {
  const design = scenario(table, DESIGN, footprints, 'typical');
  const typical = scenario(table, TYPICAL, footprints, 'typical');
  const smallShop = scenario(table, SMALL_SHOP, footprints, 'typical');
  const fullRoster = scenario(table, FULL_ROSTER, footprints, 'typical');
  const worstCase = describeUsage('design ceiling, every command the costliest kind', DESIGN,
    dailyUsage(table, worstCaseWorkload(table, workloadOf(DESIGN), businessOperations())), true);
  const storageWorstProfile = scenario(table, DESIGN, footprints, 'worst').storage!;

  const designLines = workloadOf(DESIGN);
  const designReads = dailyUsage(table, designLines).reads.conservative;
  const reads = (lines: WorkloadLine[], from: CostTable = table) => round(dailyUsage(from, lines).reads.conservative);
  // the orders page as it was before S4: a full reload (the roster, every transaction of the day) after each command
  const fullReload = (line: WorkloadLine): WorkloadLine => {
    if (line.operation !== 'load.ordersRefresh') return line;
    const open = designLines.find(item => item.operation === 'load.orders')!;
    return { operation: 'load.orders', perDay: line.perDay, units: open.units! };
  };
  // the loads that read every document twice (the document, then its id again to prove the set is complete)
  const singleRead = scaleDimensions(table, ['load.report', 'load.accountHistory', 'load.auditDay', 'load.auditStudent', 'load.auditRangeStudent', 'load.auditRange'],
    ['dayTransaction', 'rangeAccount', 'studentTransaction', 'studentRangeTransaction', 'dayCommand'], 0.5);
  const whatIf: WhatIf[] = [
    { label: 'the design ceiling as measured', reads: round(designReads) },
    { label: 'the orders page reloads fully after every command, as before P16f2 S4', reads: reads(designLines.map(fullReload)) },
    { label: 'the history loads read each transaction or command once instead of twice (needs CheerC: the second read is an integrity check)', reads: reads(designLines, singleRead) },
  ];

  const floorLines = workloadOf(SMALL_SHOP).filter(line => line.operation.startsWith('command.') || line.operation.startsWith('lease.') || line.operation.startsWith('listener.')
    || line.operation === 'load.orders' || line.operation === 'load.ordersRefresh');
  const floorReads = reads(floorLines);
  const floor = { label: 'small shop floor: commands, one orders refresh per command, the lease', reads: floorReads, limit: THRESHOLDS.reads, verdict: (floorReads < THRESHOLDS.reads ? 'PASS' : 'FAIL') as Verdict };

  const profiles = [footprints.typical, footprints.worst];
  const maxCommand = profiles.map(profile => profile.maxCommand).reduce((best, item) => (item.documentBytes > best.documentBytes ? item : best));
  const commandBytes = {
    maxBytes: maxCommand.documentBytes, kind: maxCommand.kind, limit: THRESHOLDS.commandBytes,
    verdict: (maxCommand.documentBytes < THRESHOLDS.commandBytes ? 'PASS' : 'FAIL') as Verdict,
  };

  const verdicts: Verdict[] = [
    design.reads.verdict, design.writes.verdict, design.deletes.verdict, design.storage!.verdict, commandBytes.verdict,
    typical.reads.verdict, worstCase.reads.verdict, worstCase.writes.verdict,
  ];
  const verdict: Verdict = verdicts.includes('FAIL') ? 'FAIL' : verdicts.includes('WARN') ? 'WARN' : 'PASS';
  return { schemaVersion: 1, thresholds: THRESHOLDS, design, typical, smallShop, fullRoster, worstCase, storageWorstProfile, whatIf, floor, commandBytes, verdict };
}
