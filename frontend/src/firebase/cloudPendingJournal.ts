import type { Firestore } from 'firebase/firestore';

export const CLOUD_PENDING_JOURNAL_VERSION = 1 as const;
export const CLOUD_PENDING_JOURNAL_CAPACITY = 1_000;
export const CLOUD_PENDING_JOURNAL_PAGE_SIZE = 100;
export const LEGACY_CLOUD_ORDER_PENDING_KEY = 'easyorder-cloud-pending-order';

const JOURNAL_ROOT = 'easyorder-cloud-command-journal';
const CHANGE_EVENT = 'easyorder:cloud-command-journal-change';
const RECORD_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PendingCommandIdentity {
  commandId: string;
  datasetId: string;
  uid: string;
}

export interface PendingJournalPage {
  records: PendingCommandIdentity[];
  total: number;
  offset: number;
  nextOffset: number | null;
  complete: true;
}

export interface PendingJournalSnapshot {
  records: PendingCommandIdentity[];
  total: number;
  complete: true;
}

export type PendingJournalChangeSource = 'same-tab' | 'other-tab' | 'storage-cleared';

export class PendingJournalUnavailableError extends Error {
  constructor() {
    super('本機待核對日誌無法安全讀取或保存');
    this.name = 'PendingJournalUnavailableError';
  }
}

export interface PendingJournalStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PendingJournalLocks {
  request<T>(name: string, options: { mode: 'exclusive' }, callback: () => Promise<T>): Promise<T>;
}

export interface PendingJournalAdapter {
  getStorage(): PendingJournalStorage;
  getLocks(): PendingJournalLocks;
}

export interface CloudPendingJournal {
  readonly namespace: string;
  readAll(): Promise<PendingJournalSnapshot>;
  readPage(offset?: number): Promise<PendingJournalPage>;
  put(record: PendingCommandIdentity): Promise<void>;
  removeIf(record: PendingCommandIdentity, isCurrent?: () => boolean): Promise<boolean>;
  migrateLegacyOrderSlot(): Promise<'empty' | 'migrated' | 'already-migrated'>;
  subscribe(listener: (source: PendingJournalChangeSource) => void): () => void;
  registerInFlight(record: PendingCommandIdentity, leaseEpoch: number): () => void;
  isInFlight(record: PendingCommandIdentity, leaseEpoch: number): boolean;
}

function safeIdentity(value: unknown): PendingCommandIdentity {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new PendingJournalUnavailableError();
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 3 || keys[0] !== 'commandId' || keys[1] !== 'datasetId' || keys[2] !== 'uid'
    || typeof record.commandId !== 'string' || !RECORD_UUID.test(record.commandId)
    || typeof record.datasetId !== 'string' || record.datasetId.length < 1 || record.datasetId.length > 256
    || typeof record.uid !== 'string' || record.uid.length < 1 || record.uid.length > 256) {
    throw new PendingJournalUnavailableError();
  }
  return { commandId: record.commandId, datasetId: record.datasetId, uid: record.uid };
}

function encodeIdentity(record: PendingCommandIdentity): string {
  return JSON.stringify(safeIdentity(record));
}

function decodeCanonical(raw: string, commandId: string): PendingCommandIdentity {
  try {
    const decoded = safeIdentity(JSON.parse(raw) as unknown);
    if (decoded.commandId !== commandId || encodeIdentity(decoded) !== raw) throw new PendingJournalUnavailableError();
    return decoded;
  } catch {
    throw new PendingJournalUnavailableError();
  }
}

function identityMatches(left: PendingCommandIdentity, right: PendingCommandIdentity): boolean {
  return left.commandId === right.commandId && left.datasetId === right.datasetId && left.uid === right.uid;
}

function ownerIsCurrent(isCurrent: () => boolean): boolean {
  try {
    return isCurrent() === true;
  } catch {
    return false;
  }
}

function flightKey(namespace: string, record: PendingCommandIdentity, leaseEpoch: number): string {
  return `${namespace}\u0000${record.uid}\u0000${leaseEpoch}\u0000${record.commandId}`;
}

const inFlightCounts = new Map<string, number>();
let installedTestAdapter: PendingJournalAdapter | null = null;
const memoryTestAdapters = new WeakSet<PendingJournalAdapter>();

/** Explicitly installed by the Vitest setup; production has no default storage or lock bypass. */
export function installCloudPendingJournalTestAdapter(adapter: PendingJournalAdapter | null): void {
  installedTestAdapter = adapter;
}

export function createMemoryCloudPendingJournalTestAdapter(): PendingJournalAdapter & { reset(): void } {
  const values = new Map<string, string>();
  const queues = new Map<string, Promise<void>>();
  const storage: PendingJournalStorage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  const locks: PendingJournalLocks = {
    async request<T>(name: string, _options: { mode: 'exclusive' }, callback: () => Promise<T>): Promise<T> {
      const previous = queues.get(name) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>(resolve => { release = resolve; });
      const queued = previous.then(() => current);
      queues.set(name, queued);
      await previous;
      try {
        return await callback();
      } finally {
        release();
        if (queues.get(name) === queued) queues.delete(name);
      }
    },
  };
  const adapter: PendingJournalAdapter & { reset(): void } = {
    getStorage: () => storage,
    getLocks: () => locks,
    reset() { values.clear(); queues.clear(); inFlightCounts.clear(); },
  };
  memoryTestAdapters.add(adapter);
  return adapter;
}

function browserAdapter(): PendingJournalAdapter {
  return {
    getStorage() {
      try {
        if (typeof window === 'undefined') throw new PendingJournalUnavailableError();
        return window.localStorage;
      } catch {
        throw new PendingJournalUnavailableError();
      }
    },
    getLocks() {
      try {
        if (typeof navigator === 'undefined' || !navigator.locks) throw new PendingJournalUnavailableError();
        return navigator.locks;
      } catch {
        throw new PendingJournalUnavailableError();
      }
    },
  };
}

function namespaceFor(db: Firestore, memoryTestAdapter: boolean): string {
  try {
    const projectId = db.app.options.projectId;
    const appName = db.app.name;
    if (typeof projectId !== 'string' || projectId.length < 1 || typeof appName !== 'string' || appName.length < 1) {
      throw new PendingJournalUnavailableError();
    }
    return `${JOURNAL_ROOT}:v${CLOUD_PENDING_JOURNAL_VERSION}:${encodeURIComponent(projectId)}:${encodeURIComponent(appName)}`;
  } catch {
    if (memoryTestAdapter) {
      return `${JOURNAL_ROOT}:v${CLOUD_PENDING_JOURNAL_VERSION}:vitest-memory`;
    }
    throw new PendingJournalUnavailableError();
  }
}

export function createCloudPendingJournal(db: Firestore, adapter: PendingJournalAdapter = browserAdapter()): CloudPendingJournal {
  const namespace = namespaceFor(db, memoryTestAdapters.has(adapter));
  const prefix = `${namespace}:`;
  const lockName = `${namespace}:exclusive`;

  async function withLock<T>(operation: (storage: PendingJournalStorage) => Promise<T> | T): Promise<T> {
    try {
      const locks = adapter.getLocks();
      if (!locks || typeof locks.request !== 'function') throw new PendingJournalUnavailableError();
      return await locks.request(lockName, { mode: 'exclusive' }, async () => operation(adapter.getStorage()));
    } catch {
      throw new PendingJournalUnavailableError();
    }
  }

  function keyFor(commandId: string): string {
    if (!RECORD_UUID.test(commandId)) throw new PendingJournalUnavailableError();
    return `${prefix}${commandId}`;
  }

  function scan(storage: PendingJournalStorage): PendingCommandIdentity[] {
    try {
      const totalKeys = storage.length;
      if (!Number.isSafeInteger(totalKeys) || totalKeys < 0) throw new PendingJournalUnavailableError();
      const records: PendingCommandIdentity[] = [];
      for (let index = 0; index < totalKeys; index += 1) {
        const key = storage.key(index);
        if (key === null) throw new PendingJournalUnavailableError();
        if (!key.startsWith(prefix)) continue;
        const commandId = key.slice(prefix.length);
        if (!RECORD_UUID.test(commandId)) throw new PendingJournalUnavailableError();
        const raw = storage.getItem(key);
        if (raw === null) throw new PendingJournalUnavailableError();
        records.push(decodeCanonical(raw, commandId));
        if (records.length > CLOUD_PENDING_JOURNAL_CAPACITY) throw new PendingJournalUnavailableError();
      }
      records.sort((left, right) => left.commandId.localeCompare(right.commandId));
      return records;
    } catch {
      throw new PendingJournalUnavailableError();
    }
  }

  function notifySameTab(): void {
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { namespace } }));
      }
    } catch {
      // Storage is authoritative; notifications only refresh mounted views.
    }
  }

  return {
    namespace,
    async readAll(): Promise<PendingJournalSnapshot> {
      const records = await withLock(storage => scan(storage));
      return { records, total: records.length, complete: true };
    },
    async readPage(offset = 0): Promise<PendingJournalPage> {
      if (!Number.isSafeInteger(offset) || offset < 0) throw new PendingJournalUnavailableError();
      const records = await withLock(storage => scan(storage));
      const page = records.slice(offset, offset + CLOUD_PENDING_JOURNAL_PAGE_SIZE);
      const nextOffset = offset + page.length < records.length ? offset + page.length : null;
      return { records: page, total: records.length, offset, nextOffset, complete: true };
    },
    async put(untrustedRecord): Promise<void> {
      const record = safeIdentity(untrustedRecord);
      const key = keyFor(record.commandId);
      const raw = encodeIdentity(record);
      await withLock(storage => {
        const records = scan(storage);
        const existing = records.find(item => item.commandId === record.commandId);
        if (existing && !identityMatches(existing, record)) throw new PendingJournalUnavailableError();
        if (!existing && records.length >= CLOUD_PENDING_JOURNAL_CAPACITY) throw new PendingJournalUnavailableError();
        if (!existing) storage.setItem(key, raw);
        if (storage.getItem(key) !== raw) throw new PendingJournalUnavailableError();
        const verified = decodeCanonical(storage.getItem(key) ?? '', record.commandId);
        if (!identityMatches(verified, record)) throw new PendingJournalUnavailableError();
      });
      notifySameTab();
    },
    async removeIf(untrustedRecord, isCurrent = () => true): Promise<boolean> {
      const record = safeIdentity(untrustedRecord);
      const key = keyFor(record.commandId);
      const removed = await withLock(storage => {
        if (!ownerIsCurrent(isCurrent)) return false;
        const records = scan(storage);
        const existing = records.find(item => item.commandId === record.commandId);
        if (!existing) return false;
        if (!identityMatches(existing, record)) throw new PendingJournalUnavailableError();
        if (!ownerIsCurrent(isCurrent)) return false;
        storage.removeItem(key);
        if (storage.getItem(key) !== null) throw new PendingJournalUnavailableError();
        if (scan(storage).some(item => item.commandId === record.commandId)) throw new PendingJournalUnavailableError();
        return true;
      });
      if (removed) notifySameTab();
      return removed;
    },
    async migrateLegacyOrderSlot(): Promise<'empty' | 'migrated' | 'already-migrated'> {
      const outcome = await withLock(storage => {
        const legacyRaw = storage.getItem(LEGACY_CLOUD_ORDER_PENDING_KEY);
        if (legacyRaw === null) return 'empty' as const;
        let record: PendingCommandIdentity;
        try {
          const parsed = JSON.parse(legacyRaw) as Record<string, unknown>;
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
            || Object.keys(parsed).length !== 3
            || Object.keys(parsed)[0] !== 'uid' || Object.keys(parsed)[1] !== 'datasetId' || Object.keys(parsed)[2] !== 'commandId') {
            throw new PendingJournalUnavailableError();
          }
          record = safeIdentity({ commandId: parsed.commandId, datasetId: parsed.datasetId, uid: parsed.uid });
          if (JSON.stringify({ uid: record.uid, datasetId: record.datasetId, commandId: record.commandId }) !== legacyRaw) {
            throw new PendingJournalUnavailableError();
          }
        } catch {
          throw new PendingJournalUnavailableError();
        }
        const key = keyFor(record.commandId);
        const records = scan(storage);
        const existing = records.find(item => item.commandId === record.commandId);
        if (existing && !identityMatches(existing, record)) throw new PendingJournalUnavailableError();
        if (!existing && records.length >= CLOUD_PENDING_JOURNAL_CAPACITY) throw new PendingJournalUnavailableError();
        const raw = encodeIdentity(record);
        if (!existing) storage.setItem(key, raw);
        if (storage.getItem(key) !== raw || !identityMatches(decodeCanonical(storage.getItem(key) ?? '', record.commandId), record)) {
          throw new PendingJournalUnavailableError();
        }
        if (storage.getItem(LEGACY_CLOUD_ORDER_PENDING_KEY) !== legacyRaw) throw new PendingJournalUnavailableError();
        storage.removeItem(LEGACY_CLOUD_ORDER_PENDING_KEY);
        if (storage.getItem(LEGACY_CLOUD_ORDER_PENDING_KEY) !== null) throw new PendingJournalUnavailableError();
        return existing ? 'already-migrated' as const : 'migrated' as const;
      });
      if (outcome !== 'empty') notifySameTab();
      return outcome;
    },
    subscribe(listener): () => void {
      if (typeof window === 'undefined') return () => undefined;
      const onSameTab = (event: Event) => {
        const detail = (event as CustomEvent<{ namespace?: string }>).detail;
        if (detail?.namespace === namespace) listener('same-tab');
      };
      const onStorage = (event: StorageEvent) => {
        if (event.key === null) listener('storage-cleared');
        else if (event.key.startsWith(prefix)) listener('other-tab');
      };
      window.addEventListener(CHANGE_EVENT, onSameTab);
      window.addEventListener('storage', onStorage);
      return () => {
        window.removeEventListener(CHANGE_EVENT, onSameTab);
        window.removeEventListener('storage', onStorage);
      };
    },
    registerInFlight(record, leaseEpoch): () => void {
      const key = flightKey(namespace, safeIdentity(record), leaseEpoch);
      inFlightCounts.set(key, (inFlightCounts.get(key) ?? 0) + 1);
      notifySameTab();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const count = inFlightCounts.get(key) ?? 0;
        if (count <= 1) inFlightCounts.delete(key);
        else inFlightCounts.set(key, count - 1);
        notifySameTab();
      };
    },
    isInFlight(record, leaseEpoch): boolean {
      return inFlightCounts.has(flightKey(namespace, safeIdentity(record), leaseEpoch));
    },
  };
}

export function cloudPendingJournalForRepository(db: Firestore): CloudPendingJournal {
  return createCloudPendingJournal(db, installedTestAdapter ?? browserAdapter());
}
