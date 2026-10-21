import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import {
  CLOUD_PENDING_JOURNAL_CAPACITY,
  CLOUD_PENDING_JOURNAL_PAGE_SIZE,
  LEGACY_CLOUD_ORDER_PENDING_KEY,
  createCloudPendingJournal,
  createMemoryCloudPendingJournalTestAdapter,
  PendingJournalUnavailableError,
  type PendingCommandIdentity,
  type PendingJournalAdapter,
} from '../cloudPendingJournal';

const testDb = {
  app: { options: { projectId: 'demo-easyorder' }, name: '[DEFAULT]' },
} as unknown as Firestore;

function commandId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

function record(index: number, uid = 'operator-a', datasetId = 'dataset-a'): PendingCommandIdentity {
  return { commandId: commandId(index), datasetId, uid };
}

function rawIdentity(value: PendingCommandIdentity): string {
  return JSON.stringify(value);
}

describe('Cloud pending command journal', () => {
  it('allows only an explicit memory test adapter to namespace a Node fixture without Firebase app metadata', () => {
    const memoryAdapter = createMemoryCloudPendingJournalTestAdapter();
    const journal = createCloudPendingJournal({} as Firestore, memoryAdapter);
    expect(journal.namespace).toContain(':vitest-memory');
    expect(() => createCloudPendingJournal({} as Firestore)).toThrow(PendingJournalUnavailableError);
  });

  it('serializes concurrent writes, enforces the hard cap, and exposes full 100-entry pages', async () => {
    const adapter = createMemoryCloudPendingJournalTestAdapter();
    const journal = createCloudPendingJournal(testDb, adapter);

    await Promise.all(Array.from({ length: CLOUD_PENDING_JOURNAL_CAPACITY }, (_, index) => journal.put(record(index + 1))));
    await expect(journal.put(record(CLOUD_PENDING_JOURNAL_CAPACITY + 1))).rejects.toBeInstanceOf(PendingJournalUnavailableError);

    const first = await journal.readPage(0);
    const middle = await journal.readPage(450);
    const last = await journal.readPage(900);
    expect(first).toMatchObject({ total: 1000, offset: 0, nextOffset: 100, complete: true });
    expect(first.records).toHaveLength(CLOUD_PENDING_JOURNAL_PAGE_SIZE);
    expect(middle).toMatchObject({ total: 1000, offset: 450, nextOffset: 550, complete: true });
    expect(middle.records).toHaveLength(CLOUD_PENDING_JOURNAL_PAGE_SIZE);
    expect(last).toMatchObject({ total: 1000, offset: 900, nextOffset: null, complete: true });
    expect(last.records).toHaveLength(CLOUD_PENDING_JOURNAL_PAGE_SIZE);
    expect((await journal.readAll()).records).toHaveLength(1000);
  });

  it.each([
    ['truncated JSON', '{"commandId":'],
    ['duplicate JSON property', '{"commandId":"00000000-0000-4000-8000-000000000001","commandId":"00000000-0000-4000-8000-000000000001","datasetId":"dataset-a","uid":"operator-a"}'],
    ['non-canonical whitespace', '{ "commandId":"00000000-0000-4000-8000-000000000001","datasetId":"dataset-a","uid":"operator-a"}'],
    ['extra identity field', '{"commandId":"00000000-0000-4000-8000-000000000001","datasetId":"dataset-a","uid":"operator-a","reason":"private"}'],
  ])('fails closed on %s', async (_label, raw) => {
    const adapter = createMemoryCloudPendingJournalTestAdapter();
    const journal = createCloudPendingJournal(testDb, adapter);
    adapter.getStorage().setItem(`${journal.namespace}:${commandId(1)}`, raw);
    await expect(journal.readAll()).rejects.toBeInstanceOf(PendingJournalUnavailableError);
  });

  it('fails closed when exclusive Web Lock access is unavailable or denied', async () => {
    const storage = createMemoryCloudPendingJournalTestAdapter().getStorage();
    const adapter: PendingJournalAdapter = {
      getStorage: () => storage,
      getLocks: () => ({ request: async () => { throw new DOMException('lock denied', 'NotAllowedError'); } }),
    };
    const journal = createCloudPendingJournal(testDb, adapter);
    await expect(journal.readAll()).rejects.toBeInstanceOf(PendingJournalUnavailableError);
    await expect(journal.put(record(1))).rejects.toBeInstanceOf(PendingJournalUnavailableError);
  });

  it('only removes the exact stored identity after a verified readback', async () => {
    const adapter = createMemoryCloudPendingJournalTestAdapter();
    const journal = createCloudPendingJournal(testDb, adapter);
    const expected = record(10);
    await journal.put(expected);

    await expect(journal.put({ ...expected, uid: 'different-operator' })).rejects.toBeInstanceOf(PendingJournalUnavailableError);
    await expect(journal.removeIf({ ...expected, datasetId: 'other-dataset' })).rejects.toBeInstanceOf(PendingJournalUnavailableError);
    expect(await journal.readAll()).toMatchObject({ records: [expected], total: 1, complete: true });
    expect(await journal.removeIf(expected)).toBe(true);
    expect(await journal.removeIf(expected)).toBe(false);
    expect((await journal.readAll()).records).toEqual([]);
  });

  it('rechecks a live owner only after acquiring the exclusive lock before removal', async () => {
    const memory = createMemoryCloudPendingJournalTestAdapter();
    let releaseLock!: () => void;
    let markRequested!: () => void;
    let inCriticalSection = false;
    let guardRanInCriticalSection = false;
    const lock = new Promise<void>(resolve => { releaseLock = resolve; });
    const requested = new Promise<void>(resolve => { markRequested = resolve; });
    const adapter: PendingJournalAdapter = {
      getStorage: () => memory.getStorage(),
      getLocks: () => ({
        async request<T>(
          _name: string,
          _options: { mode: 'exclusive' },
          callback: () => Promise<T>,
        ): Promise<T> {
          markRequested();
          await lock;
          inCriticalSection = true;
          try {
            return await callback();
          } finally {
            inCriticalSection = false;
          }
        },
      }),
    };
    const journal = createCloudPendingJournal(testDb, adapter);
    const expected = record(11);
    memory.getStorage().setItem(`${journal.namespace}:${expected.commandId}`, rawIdentity(expected));
    let ownerCurrent = true;
    const removeWithOwnerGuard = journal.removeIf as unknown as (
      item: PendingCommandIdentity,
      isCurrent: () => boolean | Promise<boolean>,
    ) => Promise<boolean>;
    const pendingRemoval = removeWithOwnerGuard(expected, async () => {
      await Promise.resolve();
      guardRanInCriticalSection = inCriticalSection;
      return ownerCurrent;
    });

    await requested;
    ownerCurrent = false;
    releaseLock();

    await expect(pendingRemoval).resolves.toBe(false);
    expect(guardRanInCriticalSection).toBe(true);
    expect(await journal.readAll()).toMatchObject({ records: [expected], total: 1, complete: true });
  });

  it('migrates only the exact canonical legacy slot and preserves unrelated storage', async () => {
    const adapter = createMemoryCloudPendingJournalTestAdapter();
    const journal = createCloudPendingJournal(testDb, adapter);
    const legacyRecord = record(20, 'legacy-operator', 'legacy-dataset');
    const storage = adapter.getStorage();
    storage.setItem(LEGACY_CLOUD_ORDER_PENDING_KEY, JSON.stringify({
      uid: legacyRecord.uid,
      datasetId: legacyRecord.datasetId,
      commandId: legacyRecord.commandId,
    }));
    storage.setItem('unrelated-key', 'unrelated-value');

    await expect(journal.migrateLegacyOrderSlot()).resolves.toBe('migrated');
    expect(storage.getItem(LEGACY_CLOUD_ORDER_PENDING_KEY)).toBeNull();
    expect(storage.getItem('unrelated-key')).toBe('unrelated-value');
    expect(storage.getItem(`${journal.namespace}:${legacyRecord.commandId}`)).toBe(rawIdentity(legacyRecord));
    await expect(journal.migrateLegacyOrderSlot()).resolves.toBe('empty');
  });

  it('rejects duplicate legacy keys and never removes a malformed legacy value', async () => {
    const adapter = createMemoryCloudPendingJournalTestAdapter();
    const journal = createCloudPendingJournal(testDb, adapter);
    const duplicate = '{"uid":"operator-a","uid":"operator-b","datasetId":"dataset-a","commandId":"00000000-0000-4000-8000-000000000001"}';
    adapter.getStorage().setItem(LEGACY_CLOUD_ORDER_PENDING_KEY, duplicate);

    await expect(journal.migrateLegacyOrderSlot()).rejects.toBeInstanceOf(PendingJournalUnavailableError);
    expect(adapter.getStorage().getItem(LEGACY_CLOUD_ORDER_PENDING_KEY)).toBe(duplicate);
    expect((await journal.readAll()).records).toEqual([]);
  });

  it('notifies same-tab listeners and tracks active same-mount submissions by UID, epoch, and command ID', async () => {
    const adapter = createMemoryCloudPendingJournalTestAdapter();
    const journal = createCloudPendingJournal(testDb, adapter);
    const item = record(30);
    const changes: string[] = [];
    const unsubscribe = journal.subscribe(source => changes.push(source));
    const release = journal.registerInFlight(item, 4);

    expect(journal.isInFlight(item, 4)).toBe(true);
    expect(journal.isInFlight(item, 5)).toBe(false);
    await journal.put(item);
    release();
    expect(journal.isInFlight(item, 4)).toBe(false);
    expect(changes).toContain('same-tab');
    unsubscribe();
  });
});
