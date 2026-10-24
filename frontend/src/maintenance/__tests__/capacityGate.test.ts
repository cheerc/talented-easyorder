// @ts-expect-error Node-only file access reads the checked-in cost table, storage footprints and gate result.
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DESIGN, LEDGER_WINDOW_DAYS, MENU_SCAN_WINDOW_DAYS, THRESHOLDS, TYPICAL, dayShape, evaluateGate, projectStorage, readVerdictOf, scaleDimensions, storageVerdict, workloadOf,
  type StorageFootprints, type StorageProfile,
} from '../capacityGate';
import { dailyUsage, type CostTable } from '../capacityModel';

/**
 * P16e capacity gate. The arithmetic is checked by hand on small numbers; the real evaluation (the checked-in cost table and
 * storage footprints, the design workload) must equal `docs/ops/p16-capacity-gate.json`, so a change of cost, of footprint or of
 * assumption shows up as a change of that file in the same PR. Regenerate it with `EASYORDER_P16_WRITE_GATE=<file>`.
 */
declare const process: { env: Record<string, string | undefined>; cwd: () => string };

const root = `${process.cwd()}/..`;
const json = <T>(path: string) => JSON.parse(readFileSync(`${root}/${path}`, 'utf8') as string) as T;

describe('P16e capacity gate: the day', () => {
  it('splits 200 commands into the 7 day commands and 193 of the orders page, 185 of which create a transaction', () => {
    const shape = dayShape(DESIGN);
    expect(shape.pageCommands).toBe(193);
    // 117 + 56 + 8 + 4 of the 193 create a transaction
    expect(shape.transactions).toBeCloseTo(185, 9);
    expect(shape.otherCommands).toBeCloseTo(15, 9);
    expect(shape.transactionsOnPage).toBeCloseTo(92.5, 9);
    // half the traffic is half the page commands
    expect(dayShape(TYPICAL).pageCommands).toBe(93);
  });

  it('puts exactly the commands of the day in the workload', () => {
    for (const assumptions of [DESIGN, TYPICAL]) {
      const commands = workloadOf(assumptions).filter(line => line.operation.startsWith('command.')).reduce((sum, line) => sum + line.perDay, 0);
      expect(commands).toBeCloseTo(assumptions.commands, 9);
    }
  });

  it('opens the orders page 6 times and refreshes it from the receipt after every command of the page (P16f2 S4)', () => {
    const lines = workloadOf(DESIGN);
    const load = lines.find(line => line.operation === 'load.orders')!;
    expect(load.perDay).toBe(6);
    expect(load.units).toEqual({ student: 200, dayTransaction: 92.5, openDay: 3 });
    expect(lines.find(line => line.operation === 'load.ordersRefresh')!.perDay).toBe(193);
  });
});

describe('P16e capacity gate: the accounts a report reads', () => {
  const reports = (assumptions: typeof DESIGN) => workloadOf(assumptions).filter(line => line.operation === 'load.report');

  it('counts the accounts of the range and their transactions (a day, a week, a month)', () => {
    // 185 transactions a day over a roster of 200: an average student has 0.925 × 730 = 675 in two years; 100 students order on a day
    const [today, week, month] = reports(DESIGN);
    expect(today!.perDay).toBe(6);
    expect(today!.units).toEqual({ student: 200, rangeAccount: 100, dayTransaction: 85, studentTransaction: 100 * 675 - 185 });
    // a week and a month reach the whole roster; the histories hold everything, less the transactions of the range itself
    expect(week!.units).toEqual({ student: 200, rangeAccount: 200, dayTransaction: 1295 - 200, studentTransaction: 200 * 675 - 1295 });
    expect(month!.units).toEqual({ student: 200, rangeAccount: 200, dayTransaction: 5550 - 200, studentTransaction: 200 * 675 - 5550 });
  });

  it('never has more accounts than students or than transactions in the range', () => {
    const small = { ...DESIGN, commands: 20, roster: 5, activePerDay: 10 };
    const today = reports(small)[0]!.units!;
    // 13 page commands, 12.4 transactions at most: 10 active, 5 on the roster
    expect(today.rangeAccount).toBe(5);
    expect(today.rangeAccount! + today.dayTransaction!).toBeCloseTo(dayShape(small).transactions, 9);
  });

  it('prices an account query by the student\'s month (the range of the page, from its start to today), not by the whole history', () => {
    const lines = workloadOf(DESIGN);
    // the account page reads the history of the account (with the days of the range) and the range audit; no second report of the student
    expect(lines.some(line => line.operation === 'load.reportStudent')).toBe(false);
    const history = lines.find(line => line.operation === 'load.accountHistory')!;
    expect(history.perDay).toBe(10);
    // 185 transactions a day over 200 students: 0.925 a day, 29 in 31 days (of 675 in two years)
    expect(history.units).toEqual({ student: 200, dayTransaction: 185, studentTransaction: 675, studentRangeTransaction: 29 });
    // 200 commands over 200 students: 31 commands in 31 days (of 730 in two years)
    const audit = lines.find(line => line.operation === 'load.auditRangeStudent')!;
    expect(audit.perDay).toBe(10);
    expect(audit.units).toEqual({ studentTransaction: 31 });
    expect(workloadOf(TYPICAL).find(line => line.operation === 'load.accountHistory')!.perDay).toBe(5);
  });
});

describe('P16f2 S9: the usage the workload states', () => {
  const perDay = (assumptions: typeof DESIGN, operation: string) => workloadOf(assumptions).filter(line => line.operation === operation).reduce((sum, line) => sum + line.perDay, 0);

  it('has 6 daily reports, 1 weekly and 0.2 monthly, the range audit only with the 2 CSV or print runs, 3 day audits', () => {
    for (const assumptions of [DESIGN, TYPICAL]) {
      const reports = workloadOf(assumptions).filter(line => line.operation === 'load.report');
      expect(reports.map(line => line.perDay)).toEqual([6, 1, 0.2]);
      expect(perDay(assumptions, 'load.auditRange')).toBe(2);
      expect(perDay(assumptions, 'load.auditDay')).toBe(3);
      // an access-events read goes with each report
      expect(perDay(assumptions, 'load.accessEvents')).toBeCloseTo(7.2, 9);
    }
  });

  it('has 10 account queries at the ceiling and 5 on a typical day, with the account page opened twice', () => {
    expect(perDay(DESIGN, 'load.accountHistory')).toBe(10);
    expect(perDay(TYPICAL, 'load.accountHistory')).toBe(5);
    expect(perDay(DESIGN, 'load.auditRangeStudent')).toBe(10);
    // 2 opens of the account page read a summary of one day each; the report page opens twice (a month of day heads)
    expect(workloadOf(DESIGN).filter(line => line.operation === 'load.summary').map(line => line.perDay)).toEqual([2, 2]);
  });

  it('renews the lease every 120 seconds', () => {
    // 10 hours: 300 renewals, a listener snapshot of each on both pages
    expect(perDay(DESIGN, 'lease.renew')).toBe(300);
    expect(perDay(DESIGN, 'lease.listenerSnapshot')).toBe(600);
  });

  it('scans at most the 62 days of the window, which is what the repository reads', () => {
    const source = readFileSync(`${process.cwd()}/src/firebase/cloudDayCloseRepository.ts`, 'utf8') as string;
    expect(Number(/const LEDGER_WINDOW_DAYS = (\d+);/.exec(source)![1])).toBe(LEDGER_WINDOW_DAYS);
    for (const operation of ['load.ledgerScanCold', 'load.ledgerScan']) {
      expect(workloadOf(DESIGN).find(line => line.operation === operation)!.units!.closedDay).toBe(62);
      expect(workloadOf({ ...DESIGN, closedDays: 20 }).find(line => line.operation === operation)!.units!.closedDay).toBe(20);
    }
  });
});

describe('P16f2 S9: the vendors page', () => {
  it('reads the first 32-day window for the latest menu, which is what the repository reads first', () => {
    const source = readFileSync(`${process.cwd()}/src/firebase/cloudDayVendorRepository.ts`, 'utf8') as string;
    expect(Number(/const INITIAL_SOURCE_WINDOW_DAYS = (\d+);/.exec(source)![1])).toBe(MENU_SCAN_WINDOW_DAYS);
    const load = workloadOf(DESIGN).find(line => line.operation === 'load.dayVendors')!;
    expect(load.perDay).toBe(7);
    expect(load.units).toEqual({ vendor: 20, closedDay: 32, openDay: 3 });
    expect(workloadOf({ ...DESIGN, closedDays: 10 }).find(line => line.operation === 'load.dayVendors')!.units!.closedDay).toBe(10);
  });
});

describe('P16f2: the read verdict (plan P16f §7)', () => {
  it('passes below 25,000 the conservative way, at the ceiling also on the deduped count while the conservative one is under 27,500', () => {
    expect(readVerdictOf(24_999, 30_000, false)).toEqual({ verdict: 'PASS', passedBy: 'conservative' });
    expect(readVerdictOf(25_000, 20_000, false)).toEqual({ verdict: 'FAIL', passedBy: null });
    expect(readVerdictOf(26_000, 24_999, true)).toEqual({ verdict: 'PASS', passedBy: 'deduped' });
    expect(readVerdictOf(26_000, 25_000, true)).toEqual({ verdict: 'FAIL', passedBy: null });
    // 10 % over or more: the deduped count no longer decides
    expect(readVerdictOf(27_500, 20_000, true)).toEqual({ verdict: 'FAIL', passedBy: null });
    expect(readVerdictOf(27_499, 20_000, true)).toEqual({ verdict: 'PASS', passedBy: 'deduped' });
  });
});

describe('P16e capacity gate: storage', () => {
  // a two-document profile: a command of 1,000 + 500 bytes and a transaction of 100 + 400, one lease event of 200 + 100
  const profile: StorageProfile = {
    kinds: Object.fromEntries([
      'EnsureDay', 'SetDayMenu', 'SetOpeningCash', 'CloseDay', 'RecordBackup', 'RecordExport', 'RecordPrint', 'CreateCashMovement', 'CreateRefund',
      'CorrectTransaction', 'VoidTransaction', 'CancelKeepDeposit', 'CancelRefund', 'Undo', 'CreateStudent', 'SaveVendor',
    ].map(kind => [kind, [{ collection: 'commands', documentBytes: 1_000, indexBytes: 500 }]])),
    leaseEvents: { acquire: [{ collection: 'accessEvents', documentBytes: 200, indexBytes: 100 }], release: [{ collection: 'accessEvents', documentBytes: 200, indexBytes: 100 }] },
    maxCommand: { kind: 'CreateOrder', documentBytes: 1_000 },
  };
  profile.kinds.CreateOrder = [{ collection: 'commands', documentBytes: 1_000, indexBytes: 500 }, { collection: 'transactions', documentBytes: 100, indexBytes: 400 }];
  profile.kinds.CreatePayment = [{ collection: 'commands', documentBytes: 1_000, indexBytes: 500 }, { collection: 'transactions', documentBytes: 100, indexBytes: 400 }];

  it('adds the bytes of what each command of the day creates, over the days, with the roster and vendors once', () => {
    const small = { ...DESIGN, commands: 10, roster: 2, vendors: 1, days: 10, leaseEvents: 2 };
    // 10 commands: 7 day commands + 3 of the page: 117/193 × 3 orders and 56/193 × 3 payments, the rest corrections
    // commands: 10 × 1,500 = 15,000; transactions of orders and payments: (117 + 56) / 193 × 3 × 500 = 1,344.559...; lease: 2 events × 300 = 600
    const projection = projectStorage(profile, small);
    const transactions = ((117 + 56) / 193) * 3 * 500;
    expect(projection.byCollection.commands).toBe(Math.round(10 * 1_500 * 10));
    expect(projection.byCollection.transactions).toBe(Math.round(transactions * 10));
    expect(projection.byCollection.accessEvents).toBe(2 * 300 * 10);
    // fixed: 2 students and 1 vendor, 1,500 each
    expect(projection.fixedBytes).toBe(3 * 1_500);
    expect(projection.perDayBytes).toBe(Math.round(15_000 + transactions + 600));
    expect(projection.totalBytes).toBe(Math.round((15_000 + transactions + 600) * 10 + 4_500));
  });

  it('judges the total against 512 MiB and 0.85 GiB', () => {
    expect(storageVerdict(THRESHOLDS.storagePassBytes - 1)).toBe('PASS');
    expect(storageVerdict(THRESHOLDS.storagePassBytes)).toBe('WARN');
    expect(storageVerdict(THRESHOLDS.storageFailBytes - 1)).toBe('WARN');
    expect(storageVerdict(THRESHOLDS.storageFailBytes)).toBe('FAIL');
  });
});

describe('P16e capacity gate: what-if tables', () => {
  const toy: CostTable = {
    schemaVersion: 1,
    operations: {
      'load.x': { units: ['a', 'b'], reads: { fixed: 10, perUnit: { a: 4, b: 1 } }, readAuthorization: { fixed: 2, perUnit: { a: 2 } }, readAuthorizationDeduped: { fixed: 2, perUnit: { a: 1 } }, writes: 0, deletes: 0 },
    },
    rules: {},
  };

  it('halves the cost per unit of the named dimensions of the named operations and nothing else', () => {
    const halved = scaleDimensions(toy, ['load.x'], ['a'], 0.5);
    // reads 10 + 2a + b, authorization 2 + a; at a = 10, b = 3: 10 + 20 + 3 + 2 + 10 = 45 (before: 10 + 40 + 3 + 2 + 20 = 75)
    const line = { operation: 'load.x', perDay: 1, units: { a: 10, b: 3 } };
    expect(dailyUsage(toy, [line]).reads.conservative).toBe(75);
    expect(dailyUsage(halved, [line]).reads.conservative).toBe(45);
    // the original table is not changed
    expect(toy.operations['load.x']!.reads.perUnit.a).toBe(4);
  });
});

describe('P16e capacity gate: the evaluation of the checked-in table', () => {
  const table = json<CostTable>('docs/ops/p16-capacity-costs.json');
  const footprints = json<StorageFootprints>('docs/ops/p16-storage-footprints.json');

  it('equals the checked-in gate result', () => {
    const result = evaluateGate(table, footprints);
    const target = process.env.EASYORDER_P16_WRITE_GATE;
    if (target) writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`);
    expect(result).toEqual(json('docs/ops/p16-capacity-gate.json'));
  });

  it('prices every operation of the workload (a line of a missing operation or with a wrong dimension throws)', () => {
    expect(() => evaluateGate(table, footprints)).not.toThrow();
  });
});
