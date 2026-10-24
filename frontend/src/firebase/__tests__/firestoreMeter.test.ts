import { describe, expect, it } from 'vitest';
import { meter, normalizePath, wrapFirestoreMeterModule } from './helpers/firestoreMeter';

/**
 * P16d meter, with a fake SDK (no Emulator): the wrapper must count what the metering rules of the helper say, on the calls
 * the production repositories make, and must not change what the wrapped functions return.
 */
interface FakeRef { path: string; type?: string }
interface FakeTx {
  get(ref: FakeRef): Promise<unknown>;
  set(ref: FakeRef, data: object): unknown;
  update(ref: FakeRef, data: object): unknown;
  delete(ref: FakeRef): unknown;
}
const fieldPath = (name: string) => ({ _internalPath: { canonicalString: () => name } });

/** The calls the tests make; the fake itself ignores its arguments. */
interface FakeApi {
  collection(db: unknown, path: string): FakeRef;
  doc(db: unknown, path: string): FakeRef;
  documentId(): unknown;
  where(field: unknown, op: string, value: unknown): unknown;
  orderBy(field: unknown, direction?: string): unknown;
  limit(count: number): unknown;
  startAfter(...values: unknown[]): unknown;
  query(base: unknown, ...constraints: unknown[]): unknown;
  getDocs(target: unknown): Promise<{ size: number }>;
  getDocsFromServer(target: unknown): Promise<{ size: number }>;
  getDocFromServer(reference: unknown): Promise<unknown>;
  runTransaction(db: unknown, update: (tx: FakeTx) => Promise<unknown>): Promise<unknown>;
}

function fakeModule(options: { rowsPerQuery?: number; attemptsBeforeCommit?: number; failCommit?: boolean } = {}) {
  const rows = options.rowsPerQuery ?? 0;
  const calls: string[] = [];
  const mod = {
    collection: (_db: unknown, path: string): FakeRef => ({ path, type: 'collection' }),
    doc: (_db: unknown, path: string): FakeRef => ({ path, type: 'document' }),
    documentId: () => fieldPath('__name__'),
    where: (field: unknown, op: string, value: unknown) => ({ field, op, value }),
    orderBy: (field: unknown, direction?: string) => ({ field, direction }),
    limit: (count: number) => ({ count }),
    startAfter: (...values: unknown[]) => ({ values }),
    query: (base: unknown, ...constraints: unknown[]) => ({ base, constraints }),
    getDocs: async () => ({ size: rows, docs: Array.from({ length: rows }) }),
    getDocsFromServer: async () => ({ size: rows, docs: Array.from({ length: rows }) }),
    getDoc: async () => ({ exists: () => false }),
    getDocFromServer: async () => ({ exists: () => false }),
    runTransaction: async (_db: unknown, update: (tx: FakeTx) => Promise<unknown>) => {
      const attempts = options.attemptsBeforeCommit ?? 1;
      let result: unknown;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        calls.push(`attempt ${attempt}`);
        const tx: FakeTx = {
          get: async () => ({ exists: () => true }),
          set: () => tx,
          update: () => tx,
          delete: () => tx,
        };
        result = await update(tx);
      }
      if (options.failCommit) throw new Error('refused');
      return result;
    },
  };
  return { mod: wrapFirestoreMeterModule(mod as unknown as Record<string, unknown>) as unknown as FakeApi, calls };
}

describe('P16d meter: paths', () => {
  it('replaces ids by * and keeps the two system documents', () => {
    expect(normalizePath('students/abc')).toBe('students/*');
    expect(normalizePath('days/2026-10-24/settlements/1')).toBe('days/*/settlements/*');
    expect(normalizePath('system/dataHead')).toBe('system/dataHead');
    expect(normalizePath('system/accessLease')).toBe('system/accessLease');
    expect(normalizePath('operators/u1')).toBe('operators/*');
  });
});

describe('P16d meter: reads', () => {
  it('counts a document read as 1 even when the document is missing, and a query as max(1, documents)', async () => {
    const empty = fakeModule({ rowsPerQuery: 0 });
    const some = fakeModule({ rowsPerQuery: 7 });
    meter.start();
    await empty.mod.getDocFromServer(empty.mod.doc(null, 'students/a'));
    await empty.mod.getDocsFromServer(empty.mod.query(empty.mod.collection(null, 'students')));
    await some.mod.getDocs(some.mod.query(some.mod.collection(null, 'transactions')));
    const report = meter.stop();
    expect(report.reads.map(event => [event.form, event.key, event.documents, event.billed])).toEqual([
      ['doc', 'students/*', 1, 1], ['query', 'students', 0, 1], ['query', 'transactions', 7, 7],
    ]);
    expect(report.billedReads).toBe(1 + 1 + 7);
    expect(report.billedWrites).toBe(0);
  });

  it('records the shape of a query: collection, where and orderBy fields with operators, limit and cursor', async () => {
    const { mod } = fakeModule({ rowsPerQuery: 2 });
    const snapshot = { id: 'x' };
    meter.start();
    await mod.getDocsFromServer(mod.query(
      mod.collection(null, 'days/2026-10-24/settlements'),
      mod.where('status', 'in', ['open', 'reopened']),
      mod.where(mod.documentId(), '>=', 'a'),
      mod.orderBy('createdAt', 'desc'),
      mod.orderBy(mod.documentId()),
      mod.startAfter(snapshot),
      mod.limit(201),
    ));
    const [event] = meter.stop().reads;
    expect(event?.shape).toEqual({
      collection: 'days/*/settlements',
      where: ['status in[2]', '__name__ >='],
      orderBy: ['createdAt desc', '__name__ asc'],
      limit: 201,
      cursor: true,
    });
  });

  it('does not count anything while no recording is running', async () => {
    const { mod } = fakeModule({ rowsPerQuery: 3 });
    await mod.getDocs(mod.query(mod.collection(null, 'students')));
    meter.start();
    expect(meter.stop().billedReads).toBe(0);
  });
});

describe('P16d meter: transactions', () => {
  it('counts every tx.get and only the writes of a transaction that committed', async () => {
    const { mod } = fakeModule();
    const { report } = await meter.measure(() => mod.runTransaction(null, async (tx: FakeTx) => {
      await tx.get({ path: 'commands/c1' });
      await tx.get({ path: 'system/dataHead' });
      tx.set({ path: 'commands/c1' }, { kind: 'x' });
      tx.update({ path: 'system/dataHead' }, { seq: 2 });
      tx.delete({ path: 'studentCodes/001' });
    }));
    expect(report.reads.map(event => [event.form, event.key])).toEqual([['tx-doc', 'commands/*'], ['tx-doc', 'system/dataHead']]);
    expect(report.writes.map(write => [write.kind, write.key])).toEqual([['set', 'commands/*'], ['update', 'system/dataHead'], ['delete', 'studentCodes/*']]);
    expect(report.billedWrites).toBe(2);
    expect(report.billedDeletes).toBe(1);
  });

  it('counts the reads of every attempt of a retried transaction but the writes of the last attempt only', async () => {
    const { mod, calls } = fakeModule({ attemptsBeforeCommit: 3 });
    const { report } = await meter.measure(() => mod.runTransaction(null, async (tx: FakeTx) => {
      await tx.get({ path: 'system/dataHead' });
      tx.update({ path: 'system/dataHead' }, { seq: 1 });
    }));
    expect(calls).toEqual(['attempt 1', 'attempt 2', 'attempt 3']);
    expect(report.billedReads).toBe(3);
    expect(report.billedWrites).toBe(1);
  });

  it('counts the reads but no write of a transaction that was refused, and lets the error through', async () => {
    const { mod } = fakeModule({ failCommit: true });
    meter.start();
    await expect(mod.runTransaction(null, async (tx: FakeTx) => {
      await tx.get({ path: 'system/dataHead' });
      tx.update({ path: 'system/dataHead' }, { seq: 1 });
    })).rejects.toThrow('refused');
    const report = meter.stop();
    expect(report.billedReads).toBe(1);
    expect(report.billedWrites).toBe(0);
  });

  it('ends the recording when the measured code throws', async () => {
    await expect(meter.measure(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(() => meter.stop()).toThrow(/without meter\.start/);
  });
});
