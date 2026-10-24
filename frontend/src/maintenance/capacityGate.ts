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
 * command of the orders page ends with a full reload of that page's snapshot (`CloudOrdersPage.completeSuccess`).
 */

export const THRESHOLDS = {
  /** Spark gives 50,000 reads and 20,000 writes a day; the gate keeps 50 % of headroom (spec §10). */
  reads: 25_000,
  writes: 10_000,
  deletes: 0,
  /** The storage limit is 1 GiB: pass below 512 MiB, "needs a retention spec before 85 %" up to 0.85 GiB, fail from there. */
  storagePassBytes: 512 * 1024 * 1024,
  storageFailBytes: Math.round(0.85 * 1024 * 1024 * 1024),
  commandBytes: 64 * 1024,
} as const;

export interface Assumptions {
  label: string;
  /** Business commands a day (the design ceiling, or the typical day). */
  commands: number;
  /** Hours a day the operator holds the lease (the heartbeat renews it every 60 seconds). */
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
 * Page loads a day. ASSUMPTIONS (opens per day are a guess of how a shop uses the app; the reloads after commands are not):
 * - orders page: a reload after every command of the page (read from the code) plus 6 opens;
 * - ledger scan: when each page starts (cold: nothing is cached yet), after opening or closing a day (2) and when the anomalies page is opened (1);
 * - day pages: the vendors page is opened 4 times and reloads after each of its 3 commands, the day-close page 3 times, the
 *   students page 4 times;
 * - reports (R10): 10 a day, 6 of today, 3 of a week and 1 of a month, each a report, a range audit and (without a student) the
 *   access events, after a summary at the page start; 5 CSV or print runs repeat the report and the range audit of today. A report
 *   reads the transactions of the range and, for every account that has one in it, that account's whole history (twice): the
 *   accounts of a range are the students with a transaction in it (`activePerDay` a day, the whole roster at most), each with the
 *   history of an average student of the roster (the transactions of the days divided by the roster);
 * - account queries (R10: 50 a day at 500 commands, here in proportion to the commands: 20 at 200): the account history, the report
 *   of the student (the range and that one history), the student's range audit (every command of the student) and the roster,
 *   after a summary and the roster at the page start;
 * - audits: 3 of a day, 2 of a student, whose commands of the whole history are read;
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
  /**
   * The units of a report over `days` days: the accounts `A` of the range read their histories; `load.report` is fitted with the
   * `rangeAccount` step (an account with one transaction in the range, so the range read of that transaction is part of it), the
   * `dayTransaction` step (a transaction of an account that is already in the range: the range read and one more transaction of
   * that account's history) and the history beyond the range (`studentTransaction`).
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

  load('load.orders', shape.pageCommands + 6, { student: a.roster, dayTransaction: shape.transactionsOnPage, openDay: a.unclosedDays });
  // the first scan of a page that has just started reads every closed day's settlement; the later ones only what changed
  load('load.ledgerScanCold', a.pages, { closedDay: a.closedDays, openDay: a.unclosedDays });
  load('load.ledgerScan', 3, { closedDay: a.closedDays, openDay: a.unclosedDays });
  load('load.dayVendors', 4 + 3, { vendor: a.vendors, closedDay: a.closedDays, openDay: a.unclosedDays });
  load('load.dayCloseOverview', 3, { openDay: a.unclosedDays });
  load('load.dayCloseState', 3, { settlementVersion: 2 });
  load('load.students', 4, { student: a.roster });

  // reports: the summary at the page start, then one query per range
  load('load.summary', 2, { closedDay: 31, settlementVersion: 40 });
  for (const [days, perDay] of [[1, 6], [7, 3], [30, 1]] as Array<[number, number]>) {
    const transactions = shape.transactions * days;
    load('load.report', perDay, reportUnits(days));
    load('load.auditRange', perDay, { student: a.roster, vendor: a.vendors, dayTransaction: transactions, dayCommand: shape.otherCommands * days });
  }
  load('load.accessEvents', 6 + 3, { accessEvent: accessEventsPerDay * 7 });
  load('load.report', 5, reportUnits(1));
  load('load.auditRange', 5, { student: a.roster, vendor: a.vendors, dayTransaction: shape.transactions, dayCommand: shape.otherCommands });

  // account queries: R10 has 50 a day for 500 commands, so 20 at the ceiling of 200 and 10 on a typical day
  const accountQueries = (a.commands / 500) * 50;
  load('load.summary', accountQueries / 5, { closedDay: 1, settlementVersion: 1 });
  load('load.accountHistory', accountQueries, { student: a.roster, dayTransaction: shape.transactions, studentTransaction: studentTransactions });
  load('load.reportStudent', accountQueries, { student: a.roster, dayTransaction: shape.transactions, studentTransaction: studentTransactions });
  load('load.auditRangeStudent', accountQueries, { studentTransaction: studentCommands });
  // P16f1: the audit of a student is its newest page of at most 100 commands
  const auditPage = Math.min(studentCommands, 100);
  load('load.auditStudent', accountQueries, { studentTransaction: auditPage });
  load('load.students', accountQueries, { student: a.roster });

  load('load.auditDay', 3, { dayTransaction: shape.transactions, dayCommand: shape.otherCommands });
  load('load.auditStudent', 2, { studentTransaction: auditPage });
  load('load.backupExport', 1, { command: a.commands });
  return lines;
}

/** The lease: a renewal every minute for the hours the operator holds it, a listener snapshot of each renewal on every page. */
function leaseLines(a: Assumptions): WorkloadLine[] {
  const renewals = a.openHours * 60;
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
  reads: { conservative: number; deduped: number; limit: number; verdict: Verdict };
  writes: { count: number; limit: number; verdict: Verdict };
  deletes: { count: number; limit: number; verdict: Verdict };
  /** The lines that read the most (conservative), largest first. */
  topReads: Array<{ operation: string; perDay: number; reads: number }>;
  storage?: { profile: 'typical' | 'worst'; projection: StorageProjection; verdict: Verdict };
}

const round = (value: number) => Math.round(value);

function describeUsage(label: string, assumptions: Assumptions, usage: DailyUsage): Omit<ScenarioResult, 'storage'> {
  const readVerdict: Verdict = usage.reads.conservative < THRESHOLDS.reads ? 'PASS' : 'FAIL';
  const merged = new Map<string, { perDay: number; reads: number }>();
  for (const line of usage.lines) {
    const found = merged.get(line.operation) ?? { perDay: 0, reads: 0 };
    merged.set(line.operation, { perDay: found.perDay + line.perDay, reads: found.reads + line.reads });
  }
  return {
    label, assumptions,
    reads: { conservative: round(usage.reads.conservative), deduped: round(usage.reads.deduped), limit: THRESHOLDS.reads, verdict: readVerdict },
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
  const result = describeUsage(a.label, a, dailyUsage(table, workloadOf(a)));
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
    dailyUsage(table, worstCaseWorkload(table, workloadOf(DESIGN), businessOperations())));
  const storageWorstProfile = scenario(table, DESIGN, footprints, 'worst').storage!;

  const designLines = workloadOf(DESIGN);
  const designReads = dailyUsage(table, designLines).reads.conservative;
  const withoutRoster = (line: WorkloadLine): WorkloadLine => (
    line.operation === 'load.orders' ? { ...line, units: { ...line.units!, student: 0 } } : line
  );
  const withoutReload = (line: WorkloadLine): WorkloadLine => (
    line.operation === 'load.orders' ? { ...line, perDay: 6 } : line
  );
  const reads = (lines: WorkloadLine[], from: CostTable = table) => round(dailyUsage(from, lines).reads.conservative);
  // the loads that read every document twice (the document, then its id again to prove the set is complete)
  const singleRead = scaleDimensions(table, ['load.report', 'load.reportStudent', 'load.accountHistory', 'load.auditDay', 'load.auditStudent', 'load.auditRangeStudent', 'load.auditRange'],
    ['dayTransaction', 'rangeAccount', 'studentTransaction', 'dayCommand'], 0.5);
  // the report without the histories of its accounts (a balance kept on each transaction would let it read the range only): the
  // account, the history beyond the range and the history part of a transaction of the range (half of its 4.08) are gone
  const noHistories = scaleDimensions(scaleDimensions(table, ['load.report'], ['rangeAccount', 'studentTransaction'], 0), ['load.report'], ['dayTransaction'], 0.5);
  const whatIf: WhatIf[] = [
    { label: 'the design ceiling as measured', reads: round(designReads) },
    { label: 'orders reload after a command skips the roster (the roster is kept until a student changes)', reads: reads(designLines.map(withoutRoster)) },
    { label: 'orders page does not reload after a command (it keeps what it has; opens only)', reads: reads(designLines.map(withoutReload)) },
    { label: 'the history loads read each transaction or command once instead of twice (needs CheerC: the second read is an integrity check)', reads: reads(designLines, singleRead) },
    { label: 'the report does not read the history of its accounts (e.g. a balance kept on every transaction; needs a spec change and CheerC)', reads: reads(designLines, noHistories) },
    { label: 'all four together', reads: reads(designLines.map(withoutReload), scaleDimensions(noHistories, ['load.reportStudent', 'load.accountHistory', 'load.auditDay', 'load.auditStudent', 'load.auditRangeStudent', 'load.auditRange', 'load.report'],
      ['dayTransaction', 'rangeAccount', 'studentTransaction', 'dayCommand'], 0.5)) },
  ];

  const floorLines = workloadOf(SMALL_SHOP).filter(line => line.operation.startsWith('command.') || line.operation.startsWith('lease.') || line.operation.startsWith('listener.') || line.operation === 'load.orders')
    .map(line => (line.operation === 'load.orders' ? { ...line, perDay: dayShape(SMALL_SHOP).pageCommands } : line));
  const floorReads = reads(floorLines);
  const floor = { label: 'small shop floor: commands, one orders reload per command, the lease', reads: floorReads, limit: THRESHOLDS.reads, verdict: (floorReads < THRESHOLDS.reads ? 'PASS' : 'FAIL') as Verdict };

  const profiles = [footprints.typical, footprints.worst];
  const maxCommand = profiles.map(profile => profile.maxCommand).reduce((best, item) => (item.documentBytes > best.documentBytes ? item : best));
  const commandBytes = {
    maxBytes: maxCommand.documentBytes, kind: maxCommand.kind, limit: THRESHOLDS.commandBytes,
    verdict: (maxCommand.documentBytes < THRESHOLDS.commandBytes ? 'PASS' : 'FAIL') as Verdict,
  };

  const verdicts: Verdict[] = [
    design.reads.verdict, design.writes.verdict, design.deletes.verdict, design.storage!.verdict, commandBytes.verdict,
    worstCase.reads.verdict, worstCase.writes.verdict,
  ];
  const verdict: Verdict = verdicts.includes('FAIL') ? 'FAIL' : verdicts.includes('WARN') ? 'WARN' : 'PASS';
  return { schemaVersion: 1, thresholds: THRESHOLDS, design, typical, smallShop, fullRoster, worstCase, storageWorstProfile, whatIf, floor, commandBytes, verdict };
}
