import { describe, expect, it } from 'vitest';
import { meter, normalizePath, wrapFirestoreLiteMeterModule, wrapFirestoreMeterModule } from './helpers/firestoreMeter';

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
  onSnapshot(reference: unknown, next: (snapshot: unknown) => void): () => void;
}

interface FakeSnapshot { data: object | null; fromCache?: boolean }
const snapshotOf = ({ data, fromCache = false }: FakeSnapshot) => ({
  exists: () => data !== null, data: () => data, metadata: { fromCache, hasPendingWrites: false },
});

function fakeModule(options: { rowsPerQuery?: number; attemptsBeforeCommit?: number; failCommit?: boolean; snapshots?: FakeSnapshot[]; refuseReads?: boolean } = {}) {
  const rows = options.rowsPerQuery ?? 0;
  const calls: string[] = [];
  const refused = (): undefined => { if (options.refuseReads) throw new Error('permission-denied'); return undefined; };
  const mod = {
    collection: (_db: unknown, path: string): FakeRef => ({ path, type: 'collection' }),
    doc: (_db: unknown, path: string): FakeRef => ({ path, type: 'document' }),
    documentId: () => fieldPath('__name__'),
    where: (field: unknown, op: string, value: unknown) => ({ field, op, value }),
    orderBy: (field: unknown, direction?: string) => ({ field, direction }),
    limit: (count: number) => ({ count }),
    startAfter: (...values: unknown[]) => ({ values }),
    query: (base: unknown, ...constraints: unknown[]) => ({ base, constraints }),
    getDocs: async () => refused() ?? ({ size: rows, docs: Array.from({ length: rows }) }),
    getDocsFromServer: async () => refused() ?? ({ size: rows, docs: Array.from({ length: rows }) }),
    getDoc: async () => refused() ?? ({ exists: () => false }),
    getDocFromServer: async () => refused() ?? ({ exists: () => false }),
    onSnapshot: (_ref: unknown, next: (snapshot: unknown) => void) => { for (const item of options.snapshots ?? []) next(snapshotOf(item)); return () => undefined; },
    runTransaction: async (_db: unknown, update: (tx: FakeTx) => Promise<unknown>) => {
      const attempts = options.attemptsBeforeCommit ?? 1;
      let result: unknown;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        calls.push(`attempt ${attempt}`);
        const tx: FakeTx = {
          get: async () => refused() ?? ({ exists: () => true }),
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
  return {
    mod: wrapFirestoreMeterModule(mod as unknown as Record<string, unknown>) as unknown as FakeApi,
    lite: wrapFirestoreLiteMeterModule(mod as unknown as Record<string, unknown>) as unknown as FakeApi,
    calls,
  };
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

describe('P16d meter: one Firestore instance', () => {
  it('counts only the calls on the instance it was started for', async () => {
    const { mod } = fakeModule({ rowsPerQuery: 2 });
    const app = { name: 'app' };
    const admin = { name: 'admin' };
    meter.start(app);
    const ownDoc = { ...mod.doc(app, 'students/a'), firestore: app };
    const otherDoc = { ...mod.doc(admin, 'students/b'), firestore: admin };
    await mod.getDocFromServer(ownDoc);
    await mod.getDocFromServer(otherDoc);
    await mod.runTransaction(app, async tx => { await tx.get({ path: 'system/dataHead' }); tx.update({ path: 'system/dataHead' }, { seq: 1 }); });
    await mod.runTransaction(admin, async tx => { await tx.get({ path: 'commands/c' }); tx.set({ path: 'commands/c' }, {}); });
    const report = meter.stop();
    expect(report.reads.map(event => event.key)).toEqual(['students/*', 'system/dataHead']);
    expect(report.billedWrites).toBe(1);
  });
});

describe('P16d meter: refused reads and the lite module', () => {
  it('counts a read that the Rules refuse as 1 read and lets the error through (a document, a query and a tx.get)', async () => {
    const { mod } = fakeModule({ refuseReads: true });
    meter.start();
    await expect(mod.getDocFromServer({ ...mod.doc(null, 'students/a'), firestore: null })).rejects.toThrow('permission-denied');
    await expect(mod.getDocs(mod.query(mod.collection(null, 'students'), mod.limit(5)))).rejects.toThrow('permission-denied');
    await expect(mod.runTransaction(null, async tx => { await tx.get({ path: 'system/dataHead' }); })).rejects.toThrow('permission-denied');
    const report = meter.stop();
    expect(report.reads.map(event => `${event.form} ${event.key}`)).toEqual(['doc students/*', 'query students', 'tx-doc system/dataHead']);
    expect(report.billedReads).toBe(3);
  });

  it('meters the lite module like the full one (document reads and queries)', async () => {
    const { lite } = fakeModule({ rowsPerQuery: 4 });
    meter.start();
    await lite.getDocFromServer({ ...lite.doc(null, 'system/dataHead'), firestore: null });
    await lite.getDocs(lite.query(lite.collection(null, 'students'), lite.where('status', '==', 'active'), lite.limit(10)));
    const report = meter.stop();
    expect(report.reads.map(event => [event.form, event.key, event.billed])).toEqual([['doc', 'system/dataHead', 1], ['query', 'students', 4]]);
    expect(report.reads[1]?.shape).toMatchObject({ collection: 'students', where: ['status =='], limit: 10 });
  });
});

describe('P16d meter: the compat Firestore of rules-unit-testing', () => {
  it('matches the modular instance that its references point at (`_delegate`)', async () => {
    const { mod } = fakeModule();
    const modular = { name: 'modular' };
    const compat = { _delegate: modular };
    meter.start(compat);
    await mod.getDocFromServer({ ...mod.doc(modular, 'students/a'), firestore: modular });
    await mod.runTransaction(modular, async tx => { await tx.get({ path: 'system/dataHead' }); });
    expect(meter.stop().reads.map(event => event.key)).toEqual(['students/*', 'system/dataHead']);
  });
});

describe('P16d meter: document listeners', () => {
  const listen = (snapshots: FakeSnapshot[]) => {
    const { mod } = fakeModule({ snapshots });
    meter.start();
    mod.onSnapshot({ ...mod.doc(null, 'system/accessLease'), firestore: null }, () => undefined);
    return meter.stop();
  };

  it('counts the attach as 1 read even when the first snapshot comes from the SDK cache', () => {
    expect(listen([{ data: { epoch: 1 }, fromCache: true }]).billedReads).toBe(1);
  });

  it('counts a later snapshot only when the server data changed', () => {
    const report = listen([{ data: { epoch: 1 } }, { data: { epoch: 1 } }, { data: { epoch: 2 } }, { data: { epoch: 3 }, fromCache: true }]);
    expect(report.reads.map(event => `${event.form} ${event.key}`)).toEqual(['listener-doc system/accessLease', 'listener-doc system/accessLease']);
  });

  it('does not count the server snapshot that confirms the cached one it follows', () => {
    expect(listen([{ data: { epoch: 1 }, fromCache: true }, { data: { epoch: 1 } }]).billedReads).toBe(1);
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
