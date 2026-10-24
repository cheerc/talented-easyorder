// @ts-expect-error Node-only file access reads the checked-in cost table, storage footprints and gate result.
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DESIGN, THRESHOLDS, TYPICAL, dayShape, evaluateGate, projectStorage, scaleDimensions, storageVerdict, workloadOf,
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

  it('reloads the orders snapshot after every command of the orders page, with the whole roster', () => {
    const load = workloadOf(DESIGN).find(line => line.operation === 'load.orders')!;
    expect(load.perDay).toBe(193 + 6);
    expect(load.units).toEqual({ student: 200, dayTransaction: 92.5, openDay: 3 });
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
