# Apps Script Sheets Sync And Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the earlier backend exploration with a zero-new-provider, Google-account-first sync plan using IndexedDB local authority, Apps Script serialized writes, and Google Sheets as the visible operational database.

**Architecture:** The frontend writes POS operations to IndexedDB first, then an outbox sends append-only events to an Apps Script web app. Apps Script is deployed by a school-owned Google account as `Execute as: Me` with link access, but every read/write request is rejected unless it carries a device pairing signature. Apps Script uses `LockService`, idempotency keys, per-student revision checks, and exact settlement revision checks to serialize writes into three visible Sheets: students, transactions, and daily_settlements. Opening service pulls the latest Sheets snapshot; realtime sync is not required for Phase 1.

**Tech Stack:** React 19, TypeScript 6, Zustand 5, IndexedDB, Vitest, Google Apps Script `doGet`/`doPost`, SpreadsheetApp, LockService, Google Sheets.

---

## Product Decisions Locked By This Plan

- Use Apps Script + Google Sheets as the Phase 1 backend because the product constraint is "free, existing Google account, zero extra provider, Sheets visible to the director."
- Do not use Cloudflare Workers + D1 as the default Phase 1 backend. Keep it as a future fallback if Sheets/Apps Script quota or maintenance risk becomes unacceptable.
- Do not write from browser directly to the Google Sheets API in production. The browser talks only to Apps Script.
- Production deployment uses a school-owned Google account, `Execute as: Me`, and link-access web app deployment, with an application-level HMAC pairing secret. The PWA must never commit a sync endpoint URL without a pairing secret configured locally on the device.
- No last-write-wins for accounting. Use event idempotency and revision checks.
- PC POS remains transaction authority. iPad handoff may select/queue a student in later phases but must not independently commit accounting rows in this plan.
- No separate fourth visible worksheet for MVP. Idempotency is enforced by `event_id` columns on `transactions` and `daily_settlements`; student imports are manual/admin-run roster maintenance through the `students` sheet and are not outbox events.

## Supersedes / Consolidates

- Supersedes `docs/superpowers/plans/2026-05-14-phase-1-3-google-sheets-sync-offline.md`.
- Supersedes the backend choice in `docs/superpowers/plans/2026-05-15-free-backend-architecture-exploration.md`.
- Consolidates the practical student import path from `docs/superpowers/plans/2026-05-15-data-migration-strategy.md`.
- Must remain consistent with `docs/superpowers/plans/2026-05-15-pwa-offline-first-strategy(DONE).md` and `docs/superpowers/plans/2026-05-15-frontend-security-considerations.md`.

## Official Sources Checked

- Google Sheets API usage limits: `https://developers.google.com/workspace/sheets/api/limits`
- Apps Script quotas: `https://developers.google.com/apps-script/guides/services/quotas`
- Apps Script web apps: `https://developers.google.com/apps-script/guides/web`
- Apps Script LockService: `https://developers.google.com/apps-script/reference/lock/lock-service`
- Apps Script Lock: `https://developers.google.com/apps-script/reference/lock/lock`

## File Structure

- Create `frontend/src/sync/syncTypes.ts` for shared event, pull, and response contracts.
- Create `frontend/src/sync/__tests__/syncTypes.test.ts` for event validation and idempotency key expectations.
- Create `frontend/src/sync/auth.ts` for signed Apps Script request URLs.
- Create `frontend/src/sync/__tests__/auth.test.ts` for request signing.
- Create `frontend/src/storage/easyorderDb.ts` for IndexedDB object stores.
- Create `frontend/src/storage/__tests__/easyorderDb.test.ts` for local outbox persistence with retry metadata.
- Create `frontend/src/sync/outbox.ts` for queueing, retry/backoff, conflict marking, unauthorized marking, and applying server acknowledgements.
- Create `frontend/src/sync/__tests__/outbox.test.ts`.
- Create `apps-script/easyorder-sync/Code.gs` for `doGet`, `doPost`, locking, and sheet writes.
- Create `apps-script/easyorder-sync/README.md` with setup and deployment steps.
- Modify `frontend/src/store/posStore.ts` to enqueue events after local commits.
- Modify `frontend/src/components/pos-components.tsx` or top-level sync indicator only if the existing queued/failed/conflict UI needs status labels.
- Modify tests under `frontend/src/__tests__/` for offline commit and reconnect sync.

---

### Task 1: Define Sync Event Contract

**Files:**
- Create: `frontend/src/sync/syncTypes.ts`
- Create: `frontend/src/sync/__tests__/syncTypes.test.ts`

- [ ] **Step 1: Write failing contract tests**

Create `frontend/src/sync/__tests__/syncTypes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  createEventId,
  createTransactionCommittedEvent,
  getIdempotencyKey,
  type SyncEvent,
} from '../syncTypes';

describe('syncTypes', () => {
  it('creates stable event ids from device id and sequence', () => {
    expect(createEventId('pc-1', 42)).toBe('pc-1:42');
  });

  it('uses event id as idempotency key', () => {
    const event: SyncEvent = {
      eventId: 'pc-1:42',
      deviceId: 'pc-1',
      deviceSeq: 42,
      eventType: 'transaction_committed',
      businessDate: '2026-05-15',
      createdAt: '2026-05-15T08:00:00.000Z',
      baseServerRevision: 7,
      payload: { transactionId: 'tx-1' },
    };

    expect(getIdempotencyKey(event)).toBe('pc-1:42');
  });

  it('creates transaction events with business date and revision boundary', () => {
    const event = createTransactionCommittedEvent({
      deviceId: 'pc-1',
      deviceSeq: 1,
      businessDate: '2026-05-15',
      createdAt: '2026-05-15T08:00:00.000Z',
      baseServerRevision: 0,
      transaction: {
        transactionId: 'tx-1',
        studentId: '015',
        expectedStudentRevision: 3,
        amount: -90,
        afterBalance: 410,
      },
    });

    expect(event).toMatchObject({
      eventId: 'pc-1:1',
      eventType: 'transaction_committed',
      businessDate: '2026-05-15',
      baseServerRevision: 0,
      payload: expect.objectContaining({ expectedStudentRevision: 3 }),
    });
  });
});
```

- [ ] **Step 2: Run the contract test**

Run:

```bash
cd frontend
npx vitest run src/sync/__tests__/syncTypes.test.ts
```

Expected: FAIL because `syncTypes.ts` does not exist.

- [ ] **Step 3: Implement sync types**

Create `frontend/src/sync/syncTypes.ts`:

```ts
export type SyncEventType =
  | 'transaction_committed'
  | 'daily_settlement_closed';

export interface TransactionSyncPayload {
  transactionId: string;
  studentId: string;
  expectedStudentRevision: number;
  amount: number;
  afterBalance: number;
  [key: string]: unknown;
}

export interface SettlementSyncPayload {
  settlementId: string;
  expectedServerRevision: number;
  [key: string]: unknown;
}

export interface SyncEvent<TPayload = Record<string, unknown>> {
  eventId: string;
  deviceId: string;
  deviceSeq: number;
  eventType: SyncEventType;
  businessDate: string;
  createdAt: string;
  baseServerRevision: number;
  payload: TPayload;
}

export interface SyncPushRequest {
  deviceId: string;
  events: SyncEvent[];
}

export interface SyncPushAck {
  eventId: string;
  status: 'accepted' | 'duplicate';
  serverRevision: number;
}

export interface SyncPushConflict {
  eventId: string;
  status: 'conflict';
  serverRevision: number;
  message: string;
}

export interface SyncPushOkResponse {
  ok: true;
  acks: SyncPushAck[];
  conflicts: SyncPushConflict[];
}

export interface SyncPushErrorResponse {
  ok: false;
  code: 'unauthorized' | 'lock_timeout' | 'quota_or_transient_error' | 'bad_request';
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;
}

export type SyncPushResponse = SyncPushOkResponse | SyncPushErrorResponse;

export interface SyncBootstrapResponse {
  ok: true;
  serverRevision: number;
  businessDate: string;
  students: unknown[];
  settings: Record<string, unknown>;
  latestTransactions: unknown[];
  latestSettlements: unknown[];
}

export function createEventId(deviceId: string, deviceSeq: number): string {
  return `${deviceId}:${deviceSeq}`;
}

export function getIdempotencyKey(event: Pick<SyncEvent, 'eventId'>): string {
  return event.eventId;
}

export function createTransactionCommittedEvent(input: {
  deviceId: string;
  deviceSeq: number;
  businessDate: string;
  createdAt: string;
  baseServerRevision: number;
  transaction: TransactionSyncPayload;
}): SyncEvent {
  return {
    eventId: createEventId(input.deviceId, input.deviceSeq),
    deviceId: input.deviceId,
    deviceSeq: input.deviceSeq,
    eventType: 'transaction_committed',
    businessDate: input.businessDate,
    createdAt: input.createdAt,
    baseServerRevision: input.baseServerRevision,
    payload: input.transaction,
  };
}
```

- [ ] **Step 4: Run contract tests**

Run:

```bash
cd frontend
npx vitest run src/sync/__tests__/syncTypes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/sync/syncTypes.ts frontend/src/sync/__tests__/syncTypes.test.ts
git commit -m "feat: define EasyOrder sync event contract"
```

---

### Task 2: Add IndexedDB Outbox Storage

**Files:**
- Create: `frontend/src/storage/easyorderDb.ts`
- Create: `frontend/src/storage/__tests__/easyorderDb.test.ts`

- [ ] **Step 1: Write failing IndexedDB tests**

Create `frontend/src/storage/__tests__/easyorderDb.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { openEasyOrderDb } from '../easyorderDb';

describe('easyorderDb', () => {
  beforeEach(async () => {
    indexedDB.deleteDatabase('easyorder-test');
  });

  it('stores and reads queued sync events', async () => {
    const db = await openEasyOrderDb('easyorder-test');

    await db.putOutboxEvent({
      event: {
        eventId: 'pc-1:1',
        deviceId: 'pc-1',
        deviceSeq: 1,
        eventType: 'transaction_committed',
        businessDate: '2026-05-15',
        createdAt: '2026-05-15T08:00:00.000Z',
        baseServerRevision: 0,
        payload: {
          transactionId: 'tx-1',
          studentId: '015',
          expectedStudentRevision: 3,
          amount: -90,
          afterBalance: 410,
        },
      },
      status: 'queued',
      attemptCount: 0,
      nextRetryAt: null,
      lastError: null,
    });

    const records = await db.listDueOutboxEvents(new Date('2026-05-15T08:00:00.000Z'));
    expect(records.map(record => record.event.eventId)).toEqual(['pc-1:1']);
  });

  it('persists retry metadata for transient failures', async () => {
    const db = await openEasyOrderDb('easyorder-test');

    await db.putOutboxEvent({
      event: {
        eventId: 'pc-1:2',
        deviceId: 'pc-1',
        deviceSeq: 2,
        eventType: 'transaction_committed',
        businessDate: '2026-05-15',
        createdAt: '2026-05-15T08:01:00.000Z',
        baseServerRevision: 0,
        payload: {
          transactionId: 'tx-2',
          studentId: '016',
          expectedStudentRevision: 1,
          amount: 100,
          afterBalance: 500,
        },
      },
      status: 'queued',
      attemptCount: 0,
      nextRetryAt: null,
      lastError: null,
    });

    await db.markOutboxRetry('pc-1:2', {
      attemptCount: 1,
      nextRetryAt: '2026-05-15T08:02:00.000Z',
      lastError: 'HTTP 429',
    });

    expect(await db.listDueOutboxEvents(new Date('2026-05-15T08:01:30.000Z'))).toEqual([]);
    expect((await db.listDueOutboxEvents(new Date('2026-05-15T08:02:00.000Z')))[0]).toMatchObject({
      status: 'retry',
      attemptCount: 1,
      lastError: 'HTTP 429',
    });
  });
});
```

- [ ] **Step 2: Run the test**

Run:

```bash
cd frontend
npx vitest run src/storage/__tests__/easyorderDb.test.ts
```

Expected: FAIL because `easyorderDb.ts` does not exist.

- [ ] **Step 3: Implement minimal IndexedDB repository**

Create `frontend/src/storage/easyorderDb.ts`:

```ts
import type { SyncEvent } from '../sync/syncTypes';

const DB_VERSION = 1;
const OUTBOX_STORE = 'sync_outbox';

export type OutboxStatus = 'queued' | 'retry' | 'conflict' | 'unauthorized';

export interface OutboxEventRecord {
  event: SyncEvent;
  status: OutboxStatus;
  attemptCount: number;
  nextRetryAt: string | null;
  lastError: string | null;
}

export interface EasyOrderDb {
  putOutboxEvent(record: OutboxEventRecord): Promise<void>;
  listDueOutboxEvents(now: Date): Promise<OutboxEventRecord[]>;
  markOutboxRetry(eventId: string, input: { attemptCount: number; nextRetryAt: string; lastError: string }): Promise<void>;
  markOutboxConflict(eventId: string, message: string): Promise<void>;
  markOutboxUnauthorized(eventId: string, message: string): Promise<void>;
  deleteOutboxEvent(eventId: string): Promise<void>;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function openEasyOrderDb(name = 'easyorder'): Promise<EasyOrderDb> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(OUTBOX_STORE)) {
        database.createObjectStore(OUTBOX_STORE, { keyPath: 'event.eventId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return {
    async putOutboxEvent(record) {
      const tx = db.transaction(OUTBOX_STORE, 'readwrite');
      await requestToPromise(tx.objectStore(OUTBOX_STORE).put(record));
    },
    async listDueOutboxEvents(now) {
      const tx = db.transaction(OUTBOX_STORE, 'readonly');
      const records = await requestToPromise<OutboxEventRecord[]>(tx.objectStore(OUTBOX_STORE).getAll());
      return records.filter(record =>
        (record.status === 'queued' || record.status === 'retry') &&
        (!record.nextRetryAt || new Date(record.nextRetryAt).getTime() <= now.getTime()),
      );
    },
    async markOutboxRetry(eventId, input) {
      const tx = db.transaction(OUTBOX_STORE, 'readwrite');
      const store = tx.objectStore(OUTBOX_STORE);
      const record = await requestToPromise<OutboxEventRecord | undefined>(store.get(eventId));
      if (!record) return;
      await requestToPromise(store.put({
        ...record,
        status: 'retry',
        attemptCount: input.attemptCount,
        nextRetryAt: input.nextRetryAt,
        lastError: input.lastError,
      }));
    },
    async markOutboxConflict(eventId, message) {
      const tx = db.transaction(OUTBOX_STORE, 'readwrite');
      const store = tx.objectStore(OUTBOX_STORE);
      const record = await requestToPromise<OutboxEventRecord | undefined>(store.get(eventId));
      if (!record) return;
      await requestToPromise(store.put({ ...record, status: 'conflict', lastError: message }));
    },
    async markOutboxUnauthorized(eventId, message) {
      const tx = db.transaction(OUTBOX_STORE, 'readwrite');
      const store = tx.objectStore(OUTBOX_STORE);
      const record = await requestToPromise<OutboxEventRecord | undefined>(store.get(eventId));
      if (!record) return;
      await requestToPromise(store.put({ ...record, status: 'unauthorized', lastError: message }));
    },
    async deleteOutboxEvent(eventId) {
      const tx = db.transaction(OUTBOX_STORE, 'readwrite');
      await requestToPromise(tx.objectStore(OUTBOX_STORE).delete(eventId));
    },
  };
}
```

- [ ] **Step 4: Run IndexedDB tests**

Run:

```bash
cd frontend
npx vitest run src/storage/__tests__/easyorderDb.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/storage/easyorderDb.ts frontend/src/storage/__tests__/easyorderDb.test.ts
git commit -m "feat: add IndexedDB sync outbox"
```

---

### Task 3: Add Signed Apps Script Request Auth

**Files:**
- Create: `frontend/src/sync/auth.ts`
- Create: `frontend/src/sync/__tests__/auth.test.ts`

- [ ] **Step 1: Write failing request signing tests**

Create `frontend/src/sync/__tests__/auth.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildSignedAppsScriptUrl, canonicalizePostBody } from '../auth';

describe('Apps Script request signing', () => {
  it('canonicalizes POST body without mutating event order', () => {
    const body = canonicalizePostBody({
      deviceId: 'pc-1',
      events: [
        { eventId: 'pc-1:1', deviceId: 'pc-1', deviceSeq: 1 },
        { eventId: 'pc-1:2', deviceId: 'pc-1', deviceSeq: 2 },
      ],
    });

    expect(body).toBe('{"deviceId":"pc-1","events":[{"eventId":"pc-1:1","deviceId":"pc-1","deviceSeq":1},{"eventId":"pc-1:2","deviceId":"pc-1","deviceSeq":2}]}');
  });

  it('adds device id, timestamp, nonce, and signature as URL parameters', async () => {
    const url = await buildSignedAppsScriptUrl({
      endpoint: 'https://script.google.com/macros/s/mock/exec',
      deviceId: 'pc-1',
      secret: 'pairing-secret',
      timestamp: 1770000000000,
      nonce: 'nonce-1',
      body: '{"deviceId":"pc-1","events":[]}',
    });

    expect(url).toContain('deviceId=pc-1');
    expect(url).toContain('timestamp=1770000000000');
    expect(url).toContain('nonce=nonce-1');
    expect(url).toMatch(/signature=[a-f0-9]{64}/);
  });
});
```

- [ ] **Step 2: Run the auth test**

Run:

```bash
cd frontend
npx vitest run src/sync/__tests__/auth.test.ts
```

Expected: FAIL because `auth.ts` does not exist.

- [ ] **Step 3: Implement request signing**

Create `frontend/src/sync/auth.ts`:

```ts
function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function canonicalizePostBody(input: { deviceId: string; events: unknown[] }): string {
  return JSON.stringify({ deviceId: input.deviceId, events: input.events });
}

export async function signAppsScriptMessage(input: {
  secret: string;
  deviceId: string;
  timestamp: number;
  nonce: string;
  body: string;
}): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(input.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const message = `${input.deviceId}\n${input.timestamp}\n${input.nonce}\n${input.body}`;
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return toHex(signature);
}

export async function buildSignedAppsScriptUrl(input: {
  endpoint: string;
  deviceId: string;
  secret: string;
  timestamp: number;
  nonce: string;
  body: string;
}): Promise<string> {
  const url = new URL(input.endpoint);
  url.searchParams.set('deviceId', input.deviceId);
  url.searchParams.set('timestamp', String(input.timestamp));
  url.searchParams.set('nonce', input.nonce);
  url.searchParams.set('signature', await signAppsScriptMessage(input));
  return url.toString();
}
```

- [ ] **Step 4: Run auth tests**

Run:

```bash
cd frontend
npx vitest run src/sync/__tests__/auth.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/sync/auth.ts frontend/src/sync/__tests__/auth.test.ts
git commit -m "feat: sign Apps Script sync requests"
```

---

### Task 4: Implement Outbox Push Protocol

**Files:**
- Create: `frontend/src/sync/outbox.ts`
- Create: `frontend/src/sync/__tests__/outbox.test.ts`

- [ ] **Step 1: Write failing outbox tests**

Create `frontend/src/sync/__tests__/outbox.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { pushOutboxEvents } from '../outbox';

const record = {
  event: {
    eventId: 'pc-1:1',
    deviceId: 'pc-1',
    deviceSeq: 1,
    eventType: 'transaction_committed',
    businessDate: '2026-05-15',
    createdAt: '2026-05-15T08:00:00.000Z',
    baseServerRevision: 0,
    payload: {
      transactionId: 'tx-1',
      studentId: '015',
      expectedStudentRevision: 3,
      amount: -90,
      afterBalance: 410,
    },
  },
  status: 'queued',
  attemptCount: 0,
  nextRetryAt: null,
  lastError: null,
};

describe('pushOutboxEvents', () => {
  it('deletes accepted events from local outbox', async () => {
    const db = {
      listDueOutboxEvents: vi.fn().mockResolvedValue([record]),
      deleteOutboxEvent: vi.fn().mockResolvedValue(undefined),
      markOutboxRetry: vi.fn(),
      markOutboxConflict: vi.fn(),
      markOutboxUnauthorized: vi.fn(),
    };
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, acks: [{ eventId: 'pc-1:1', status: 'accepted', serverRevision: 1 }], conflicts: [] }),
    });

    await pushOutboxEvents({
      db,
      endpoint: 'https://script.google.com/s/mock/exec',
      deviceId: 'pc-1',
      secret: 'pairing-secret',
      now: new Date('2026-05-15T08:00:00.000Z'),
      nonceFactory: () => 'nonce-1',
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('signature='), expect.objectContaining({ method: 'POST' }));
    expect(db.deleteOutboxEvent).toHaveBeenCalledWith('pc-1:1');
  });

  it('marks conflicted events for operator resolution', async () => {
    const db = {
      listDueOutboxEvents: vi.fn().mockResolvedValue([record]),
      deleteOutboxEvent: vi.fn().mockResolvedValue(undefined),
      markOutboxRetry: vi.fn(),
      markOutboxConflict: vi.fn(),
      markOutboxUnauthorized: vi.fn(),
    };
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, acks: [], conflicts: [{ eventId: 'pc-1:1', status: 'conflict', serverRevision: 9, message: 'revision mismatch' }] }),
    });

    const result = await pushOutboxEvents({
      db,
      endpoint: 'https://script.google.com/s/mock/exec',
      deviceId: 'pc-1',
      secret: 'pairing-secret',
      now: new Date('2026-05-15T08:00:00.000Z'),
      nonceFactory: () => 'nonce-1',
      fetcher,
    });

    expect(db.deleteOutboxEvent).not.toHaveBeenCalled();
    expect(db.markOutboxConflict).toHaveBeenCalledWith('pc-1:1', 'revision mismatch');
    expect(result.conflicts).toHaveLength(1);
  });

  it('marks transient HTTP failures for retry with backoff', async () => {
    const db = {
      listDueOutboxEvents: vi.fn().mockResolvedValue([{ ...record, attemptCount: 1 }]),
      deleteOutboxEvent: vi.fn(),
      markOutboxRetry: vi.fn(),
      markOutboxConflict: vi.fn(),
      markOutboxUnauthorized: vi.fn(),
    };
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 429 });

    await pushOutboxEvents({
      db,
      endpoint: 'https://script.google.com/s/mock/exec',
      deviceId: 'pc-1',
      secret: 'pairing-secret',
      now: new Date('2026-05-15T08:00:00.000Z'),
      nonceFactory: () => 'nonce-1',
      fetcher,
    });

    expect(db.markOutboxRetry).toHaveBeenCalledWith('pc-1:1', {
      attemptCount: 2,
      nextRetryAt: '2026-05-15T08:02:00.000Z',
      lastError: 'HTTP 429',
    });
  });
});
```

- [ ] **Step 2: Run the test**

Run:

```bash
cd frontend
npx vitest run src/sync/__tests__/outbox.test.ts
```

Expected: FAIL because `outbox.ts` does not exist.

- [ ] **Step 3: Implement outbox push**

Create `frontend/src/sync/outbox.ts`:

```ts
import { buildSignedAppsScriptUrl, canonicalizePostBody } from './auth';
import type { SyncPushResponse } from './syncTypes';
import type { OutboxEventRecord } from '../storage/easyorderDb';

interface OutboxDb {
  listDueOutboxEvents(now: Date): Promise<OutboxEventRecord[]>;
  markOutboxRetry(eventId: string, input: { attemptCount: number; nextRetryAt: string; lastError: string }): Promise<void>;
  markOutboxConflict(eventId: string, message: string): Promise<void>;
  markOutboxUnauthorized(eventId: string, message: string): Promise<void>;
  deleteOutboxEvent(eventId: string): Promise<void>;
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(5 * 60_000, 60_000 * 2 ** Math.max(0, attemptCount - 1));
}

async function markRetry(db: OutboxDb, records: OutboxEventRecord[], now: Date, error: string): Promise<void> {
  await Promise.all(records.map(record => {
    const attemptCount = record.attemptCount + 1;
    return db.markOutboxRetry(record.event.eventId, {
      attemptCount,
      nextRetryAt: new Date(now.getTime() + retryDelayMs(attemptCount)).toISOString(),
      lastError: error,
    });
  }));
}

export async function pushOutboxEvents(input: {
  db: OutboxDb;
  endpoint: string;
  deviceId: string;
  secret: string;
  now?: Date;
  nonceFactory?: () => string;
  fetcher?: typeof fetch;
}): Promise<SyncPushResponse> {
  const fetcher = input.fetcher ?? fetch;
  const now = input.now ?? new Date();
  const records = await input.db.listDueOutboxEvents(now);
  if (records.length === 0) {
    return { ok: true, acks: [], conflicts: [] };
  }

  const body = canonicalizePostBody({ deviceId: input.deviceId, events: records.map(record => record.event) });
  const url = await buildSignedAppsScriptUrl({
    endpoint: input.endpoint,
    deviceId: input.deviceId,
    secret: input.secret,
    timestamp: now.getTime(),
    nonce: input.nonceFactory?.() ?? crypto.randomUUID(),
    body,
  });

  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
  } catch (error) {
    await markRetry(input.db, records, now, error instanceof Error ? error.message : String(error));
    return { ok: false, code: 'quota_or_transient_error', message: 'Network failure during sync push', retryable: true };
  }

  if (!response.ok) {
    await markRetry(input.db, records, now, `HTTP ${response.status}`);
    return { ok: false, code: 'quota_or_transient_error', message: `Sync push failed: HTTP ${response.status}`, retryable: true };
  }

  const payload = (await response.json()) as SyncPushResponse;
  if (!payload.ok) {
    if (payload.code === 'unauthorized') {
      await Promise.all(records.map(record => input.db.markOutboxUnauthorized(record.event.eventId, payload.message)));
      return payload;
    }
    if (payload.retryable) {
      await markRetry(input.db, records, now, payload.message);
    }
    return payload;
  }

  for (const ack of payload.acks) {
    if (ack.status === 'accepted' || ack.status === 'duplicate') {
      await input.db.deleteOutboxEvent(ack.eventId);
    }
  }
  for (const conflict of payload.conflicts) {
    await input.db.markOutboxConflict(conflict.eventId, conflict.message);
  }

  return payload;
}
```

- [ ] **Step 4: Run outbox tests**

Run:

```bash
cd frontend
npx vitest run src/sync/__tests__/outbox.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/sync/outbox.ts frontend/src/sync/__tests__/outbox.test.ts
git commit -m "feat: add sync outbox push protocol"
```

---

### Task 5: Add Apps Script Backend

**Files:**
- Create: `apps-script/easyorder-sync/Code.gs`
- Create: `apps-script/easyorder-sync/README.md`

- [ ] **Step 1: Create Apps Script implementation**

Create `apps-script/easyorder-sync/Code.gs`:

```js
const SHEETS = {
  students: 'students',
  transactions: 'transactions',
  settlements: 'daily_settlements',
};

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function errorResponse(code, message, retryable, retryAfterSeconds) {
  return jsonResponse({ ok: false, code, message, retryable, retryAfterSeconds });
}

function getSyncSecret() {
  const secret = PropertiesService.getScriptProperties().getProperty('SYNC_API_SECRET');
  if (!secret) throw new Error('Missing Script Property SYNC_API_SECRET');
  return secret;
}

function toHex(bytes) {
  return bytes.map(byte => {
    const normalized = byte < 0 ? byte + 256 : byte;
    return normalized.toString(16).padStart(2, '0');
  }).join('');
}

function timingSafeEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

function verifySignedRequest(e, body) {
  const deviceId = e.parameter.deviceId || '';
  const timestamp = Number(e.parameter.timestamp || '0');
  const nonce = e.parameter.nonce || '';
  const signature = e.parameter.signature || '';
  if (!deviceId || !timestamp || !nonce || !signature) {
    return { ok: false, message: 'Missing sync authentication parameters' };
  }

  const skewMs = Math.abs(Date.now() - timestamp);
  if (skewMs > 5 * 60 * 1000) {
    return { ok: false, message: 'Sync authentication timestamp expired' };
  }

  const message = `${deviceId}\n${timestamp}\n${nonce}\n${body}`;
  const expected = toHex(Utilities.computeHmacSha256Signature(message, getSyncSecret()));
  if (!timingSafeEqual(signature, expected)) {
    return { ok: false, message: 'Invalid sync signature' };
  }

  return { ok: true, deviceId };
}

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`Missing sheet: ${name}`);
  return sheet;
}

function readObjects(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0].map(String);
  return values.slice(1).filter(row => row.some(cell => cell !== '')).map(row => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index];
    });
    return obj;
  });
}

function appendObject(sheet, object) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  sheet.appendRow(headers.map(header => object[header] ?? ''));
}

function findEventById(sheet, eventId) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const eventIdIndex = headers.indexOf('event_id');
  if (eventIdIndex < 0) return null;
  const rows = sheet.getDataRange().getValues().slice(1);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    if (rows[rowIndex][eventIdIndex] === eventId) {
      const object = {};
      headers.forEach((header, index) => {
        object[header] = rows[rowIndex][index];
      });
      return object;
    }
  }
  return null;
}

function maxServerRevision(sheet) {
  return readObjects(sheet).reduce((max, row) => {
    return Math.max(max, Number(row.server_revision || 0));
  }, 0);
}

function repairServerRevision(txSheet, settlementSheet) {
  const repaired = Math.max(getServerRevision(), maxServerRevision(txSheet), maxServerRevision(settlementSheet));
  setServerRevision(repaired);
  return repaired;
}

function findRowByColumn(sheet, columnName, value) {
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return null;
  const headers = values[0].map(String);
  const columnIndex = headers.indexOf(columnName);
  if (columnIndex < 0) throw new Error(`Missing column: ${columnName}`);
  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    if (String(values[rowIndex][columnIndex]) === String(value)) {
      return { rowNumber: rowIndex + 1, headers, row: values[rowIndex] };
    }
  }
  return null;
}

function setCellByHeader(sheet, rowNumber, headers, header, value) {
  const columnIndex = headers.indexOf(header);
  if (columnIndex < 0) throw new Error(`Missing column: ${header}`);
  sheet.getRange(rowNumber, columnIndex + 1).setValue(value);
}

function transactionsForStudent(txSheet, studentId) {
  return readObjects(txSheet)
    .filter(row => String(row.student_id) === String(studentId))
    .sort((left, right) => Number(left.server_revision || 0) - Number(right.server_revision || 0));
}

function computeStudentProjection(studentSheet, txSheet, studentId) {
  const found = findRowByColumn(studentSheet, 'student_id', studentId);
  if (!found) {
    return { ok: false, message: `Unknown student: ${studentId}` };
  }

  const openingBalanceIndex = found.headers.indexOf('opening_balance');
  if (openingBalanceIndex < 0) {
    throw new Error('students sheet requires opening_balance column so current balance can be repaired from transactions');
  }

  const rows = transactionsForStudent(txSheet, studentId);
  const openingBalance = Number(found.row[openingBalanceIndex] || 0);
  const balance = rows.reduce((total, row) => total + Number(row.amount || 0), openingBalance);
  return { ok: true, found, balance, revision: rows.length };
}

function validateTransactionRevision(studentSheet, txSheet, event, serverRevision) {
  const payload = event.payload || {};
  const projection = computeStudentProjection(studentSheet, txSheet, payload.studentId);
  if (!projection.ok) {
    return { ok: false, eventId: event.eventId, serverRevision, message: projection.message };
  }

  if (projection.revision !== Number(payload.expectedStudentRevision)) {
    return {
      ok: false,
      eventId: event.eventId,
      serverRevision,
      message: `Student revision conflict for ${payload.studentId}: expected ${payload.expectedStudentRevision}, actual ${projection.revision}`,
    };
  }

  return { ok: true };
}

function repairStudentFromLedger(studentSheet, txSheet, studentId) {
  const projection = computeStudentProjection(studentSheet, txSheet, studentId);
  if (!projection.ok) throw new Error(projection.message);
  const { found } = projection;
  setCellByHeader(studentSheet, found.rowNumber, found.headers, 'current_balance', projection.balance);
  setCellByHeader(studentSheet, found.rowNumber, found.headers, 'student_revision', projection.revision);
  setCellByHeader(studentSheet, found.rowNumber, found.headers, 'updated_at', new Date().toISOString());
  return projection;
}

function getServerRevision() {
  return Number(PropertiesService.getScriptProperties().getProperty('serverRevision') || '0');
}

function setServerRevision(value) {
  PropertiesService.getScriptProperties().setProperty('serverRevision', String(value));
}

function doGet(e) {
  const action = e.parameter.action || 'bootstrap';
  const businessDate = e.parameter.businessDate || '';
  const auth = verifySignedRequest(e, `action=${action}&businessDate=${businessDate}`);
  if (!auth.ok) {
    return errorResponse('unauthorized', auth.message, false);
  }

  if (action !== 'bootstrap') {
    return jsonResponse({ ok: false, message: `Unsupported action: ${action}` });
  }

  return jsonResponse({
    ok: true,
    serverRevision: getServerRevision(),
    businessDate,
    students: readObjects(getSheet(SHEETS.students)),
    settings: {},
    latestTransactions: readObjects(getSheet(SHEETS.transactions)).slice(-200),
    latestSettlements: readObjects(getSheet(SHEETS.settlements)).slice(-30),
  });
}

function doPost(e) {
  const rawBody = e.postData && e.postData.contents ? e.postData.contents : '{}';
  const auth = verifySignedRequest(e, rawBody);
  if (!auth.ok) {
    return errorResponse('unauthorized', auth.message, false);
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (error) {
    return errorResponse('lock_timeout', 'Could not acquire Apps Script lock within 30 seconds', true, 30);
  }

  try {
    const request = JSON.parse(rawBody);
    if (request.deviceId !== auth.deviceId) {
      return errorResponse('unauthorized', 'Signed device id does not match request body', false);
    }

    const events = Array.isArray(request.events) ? request.events : [];
    const acks = [];
    const conflicts = [];
    const txSheet = getSheet(SHEETS.transactions);
    const settlementSheet = getSheet(SHEETS.settlements);
    const studentSheet = getSheet(SHEETS.students);
    let serverRevision = repairServerRevision(txSheet, settlementSheet);

    events.forEach(event => {
      const targetSheet = event.eventType === 'daily_settlement_closed' ? settlementSheet : txSheet;
      const duplicate = findEventById(targetSheet, event.eventId);
      if (duplicate) {
        if (event.eventType === 'transaction_committed') {
          repairStudentFromLedger(studentSheet, txSheet, duplicate.student_id);
        }
        serverRevision = repairServerRevision(txSheet, settlementSheet);
        acks.push({ eventId: event.eventId, status: 'duplicate', serverRevision });
        return;
      }

      if (event.eventType === 'transaction_committed') {
        const validation = validateTransactionRevision(studentSheet, txSheet, event, serverRevision);
        if (!validation.ok) {
          conflicts.push({
            eventId: event.eventId,
            status: 'conflict',
            serverRevision,
            message: validation.message,
          });
          return;
        }
      } else if (event.eventType === 'daily_settlement_closed') {
        if (Number(event.baseServerRevision) !== serverRevision) {
          conflicts.push({
            eventId: event.eventId,
            status: 'conflict',
            serverRevision,
            message: `Settlement requires current server revision ${serverRevision}, got ${event.baseServerRevision}`,
          });
          return;
        }
      } else {
        conflicts.push({
          eventId: event.eventId || 'unknown',
          status: 'conflict',
          serverRevision,
          message: `Unsupported event type: ${event.eventType}`,
        });
        return;
      }

      serverRevision += 1;
      const payload = event.payload || {};
      // Source of truth first: if later derived-state repair fails, retry sees the event row and repairs.
      appendObject(targetSheet, {
        ...payload,
        event_id: event.eventId,
        device_id: event.deviceId,
        device_seq: event.deviceSeq,
        business_date: event.businessDate,
        server_revision: serverRevision,
        synced_at: new Date().toISOString(),
      });

      if (event.eventType === 'transaction_committed') {
        repairStudentFromLedger(studentSheet, txSheet, payload.studentId);
      }

      setServerRevision(serverRevision);
      acks.push({ eventId: event.eventId, status: 'accepted', serverRevision });
    });

    return jsonResponse({ ok: true, acks, conflicts });
  } catch (error) {
    return errorResponse('quota_or_transient_error', String(error && error.message ? error.message : error), true, 60);
  } finally {
    lock.releaseLock();
  }
}
```

- [ ] **Step 2: Create setup README**

Create `apps-script/easyorder-sync/README.md`:

```md
# EasyOrder Apps Script Sync Backend

This script is the Phase 1 backend for Talented EasyOrder.

## Required Sheets

Create three visible worksheets in one Google Spreadsheet:

1. `students`
2. `transactions`
3. `daily_settlements`

## Required Columns

`students`:

```text
student_id,display_name,status,opening_balance,current_balance,student_revision,updated_at
```

`transactions`:

```text
event_id,transaction_id,business_date,created_at,student_id,student_name_snapshot,type,meal_price,paid_amount,amount,after_balance,menu_name_snapshot,vendor_name_snapshot,note,device_id,device_seq,server_revision,synced_at
```

`daily_settlements`:

```text
event_id,settlement_id,business_date,opening_cash,net_cash,expected_cash,counted_cash,difference,note,closed_by,closed_at,device_id,device_seq,server_revision,synced_at
```

## Deploy

1. Open the Spreadsheet.
2. Extensions -> Apps Script.
3. Paste `Code.gs`.
4. Project Settings -> Script Properties -> add `SYNC_API_SECRET` with a generated pairing secret of at least 32 random bytes encoded as hex or base64.
5. Deploy -> New deployment -> Web app.
6. Execute as: Me. The account must be the school-owned production Google account, not a developer account.
7. Who has access: Anyone with the link. Production safety comes from the application-level HMAC pairing secret; do not use this setting without `SYNC_API_SECRET`.
8. Copy the web app URL into frontend sync settings.
9. Pair each production POS device by entering the same secret locally on the device. Do not commit this secret to git.

## Auth Model

Apps Script web apps can run as the script owner. That is required here so the PWA does not need direct Sheets OAuth. Because `Execute as: Me` gives the endpoint owner-level write capability, every `doGet` and `doPost` validates `deviceId`, `timestamp`, `nonce`, and `signature`.

For POST, the client signs:

```text
deviceId + "\\n" + timestamp + "\\n" + nonce + "\\n" + rawBody
```

For bootstrap GET, `rawBody` is replaced by:

```text
action=bootstrap&businessDate=YYYY-MM-DD
```

The server rejects missing, expired, or invalid signatures with:

```json
{ "ok": false, "code": "unauthorized", "retryable": false }
```

Rotating the pairing secret requires updating the Apps Script `SYNC_API_SECRET` property and re-pairing every production device.

## Operational Rule

The frontend never writes directly to Google Sheets. It sends events to this web app. The script serializes writes with `LockService.getScriptLock()`.
`transactions` and `daily_settlements` are the source of truth. The `students.current_balance` and `students.student_revision` fields are derived from `students.opening_balance` plus accepted transaction rows. Transaction events may proceed on a stale global server revision only when `expectedStudentRevision` matches the revision computed from transaction rows. Daily settlement events require exact current `serverRevision` and return a conflict otherwise. Student roster import is not a sync event; it is admin-controlled maintenance on the `students` sheet through the import runbook.

Duplicate/retry handling must be repairable:

1. If a transaction append succeeds but student repair fails, retrying the same event sees the duplicate transaction row and recomputes the student row from the ledger.
2. If transaction or settlement append succeeds but `serverRevision` property update fails, retrying the duplicate or handling the next request repairs `serverRevision` from the max `server_revision` in the event sheets.
3. If a student row is manually drifted, the next accepted or duplicate transaction for that student rewrites `current_balance` and `student_revision` from the transaction ledger.
```

- [ ] **Step 3: Verify partial-write simulations in review notes**

Before committing the Apps Script task, document these simulations in the PR/test notes and verify the code path against each one:

1. Force `repairStudentFromLedger` to throw immediately after a transaction row append. Expected retry: duplicate transaction is detected, student row is recomputed from `opening_balance + transactions.amount`, and the event is acknowledged as duplicate.
2. Force `setServerRevision` to throw immediately after a transaction or settlement row append. Expected retry or next request: `repairServerRevision` reads max `server_revision` from `transactions` and `daily_settlements`, updates Script Properties, and returns the repaired revision.
3. Manually edit `students.current_balance` or `students.student_revision` away from the ledger value. Expected next accepted or duplicate transaction for that student: derived fields are rewritten from transaction rows instead of trusted as source of truth.

- [ ] **Step 4: Commit**

```bash
git add apps-script/easyorder-sync/Code.gs apps-script/easyorder-sync/README.md
git commit -m "feat: add Apps Script Sheets sync backend"
```

---

### Task 6: Enqueue Local POS Events After Commit

**Files:**
- Modify: `frontend/src/store/posStore.ts`
- Modify: `frontend/src/store/__tests__/posStore.test.ts`
- Modify: `frontend/src/sync/syncTypes.ts`
- Modify: `frontend/src/storage/easyorderDb.ts`

- [ ] **Step 1: Add failing test for event creation**

Add to `frontend/src/store/__tests__/posStore.test.ts`:

```ts
it('marks committed local transactions as queued for sync', () => {
  const store = usePosStore.getState();
  const student = store.students[0];

  store.processTransaction(student.studentId, 'topup', 0, 100, '補錢');

  const tx = usePosStore.getState().transactions[0];
  expect(tx.syncStatus).toBe('queued');
});

it('queues transaction sync event with expected student revision', async () => {
  const store = usePosStore.getState();
  const student = store.students[0];
  const putOutboxEvent = vi.fn().mockResolvedValue(undefined);

  store.setOutboxWriter({ putOutboxEvent });
  store.processTransaction(student.studentId, 'topup', 0, 100, '補錢');

  expect(putOutboxEvent).toHaveBeenCalledWith(expect.objectContaining({
    event: expect.objectContaining({
      eventType: 'transaction_committed',
      payload: expect.objectContaining({
        studentId: student.studentId,
        expectedStudentRevision: student.revision,
        amount: 100,
      }),
    }),
    status: 'queued',
    attemptCount: 0,
  }));
});
```

- [ ] **Step 2: Run store tests**

Run:

```bash
cd frontend
npx vitest run src/store/__tests__/posStore.test.ts
```

Expected: FAIL while created transactions still use `syncStatus: 'local'` and no outbox writer exists.

- [ ] **Step 3: Set local committed rows to queued**

In `commitPosTransactionDraft` and `processTransaction`, after `createLedgerTransaction`, override sync status:

```ts
const queuedTransaction = { ...newTransaction, syncStatus: 'queued' as const };
```

Return:

```ts
transactions: [queuedTransaction, ...state.transactions],
```

Keep corrections/voids queued too once the outbox implementation is wired; do not let synced rows be overwritten.

Add an outbox writer adapter to store state:

```ts
interface OutboxWriter {
  putOutboxEvent: (record: import('../storage/easyorderDb').OutboxEventRecord) => Promise<void>;
}

deviceId: string;
nextDeviceSeq: number;
serverRevision: number;
outboxWriter: OutboxWriter | null;
setOutboxWriter: (writer: OutboxWriter | null) => void;
```

Initialize `deviceId` from a generated durable POS device ID, initialize `nextDeviceSeq` to the next local sequence number, and update `serverRevision` from bootstrap/push acknowledgements before creating later events.

When a transaction is committed, enqueue:

```ts
const event = createTransactionCommittedEvent({
  deviceId: state.deviceId,
  deviceSeq: state.nextDeviceSeq,
  businessDate: queuedTransaction.businessDate,
  createdAt: queuedTransaction.createdAt,
  baseServerRevision: state.serverRevision,
  transaction: {
    ...queuedTransaction,
    expectedStudentRevision: student.revision,
  },
});

state.outboxWriter?.putOutboxEvent({
  event,
  status: 'queued',
  attemptCount: 0,
  nextRetryAt: null,
  lastError: null,
});

state.nextDeviceSeq += 1;
```

If the write to IndexedDB fails, keep the transaction local and show a sync warning; do not roll back a counter transaction after the operator has confirmed it.

- [ ] **Step 4: Run tests**

Run:

```bash
cd frontend
npx vitest run src/store/__tests__/posStore.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/posStore.ts frontend/src/store/__tests__/posStore.test.ts
git commit -m "feat: mark local POS commits queued for sync"
```

---

### Task 7: Add Bootstrap Pull From Sheets

**Files:**
- Create: `frontend/src/sync/bootstrap.ts`
- Create: `frontend/src/sync/__tests__/bootstrap.test.ts`

- [ ] **Step 1: Write failing bootstrap tests**

Create `frontend/src/sync/__tests__/bootstrap.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { pullBootstrap } from '../bootstrap';

describe('pullBootstrap', () => {
  it('calls signed Apps Script bootstrap endpoint for a business date', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        serverRevision: 3,
        businessDate: '2026-05-15',
        students: [],
        settings: {},
        latestTransactions: [],
        latestSettlements: [],
      }),
    });

    const result = await pullBootstrap({
      endpoint: 'https://script.google.com/s/mock/exec',
      businessDate: '2026-05-15',
      deviceId: 'pc-1',
      secret: 'pairing-secret',
      now: new Date('2026-05-15T08:00:00.000Z'),
      nonceFactory: () => 'nonce-1',
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('action=bootstrap'));
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('signature='));
    expect(result.serverRevision).toBe(3);
  });
});
```

- [ ] **Step 2: Run bootstrap test**

Run:

```bash
cd frontend
npx vitest run src/sync/__tests__/bootstrap.test.ts
```

Expected: FAIL because `bootstrap.ts` does not exist.

- [ ] **Step 3: Implement bootstrap pull**

Create `frontend/src/sync/bootstrap.ts`:

```ts
import { buildSignedAppsScriptUrl } from './auth';
import type { SyncBootstrapResponse } from './syncTypes';

export async function pullBootstrap(input: {
  endpoint: string;
  businessDate: string;
  deviceId: string;
  secret: string;
  now?: Date;
  nonceFactory?: () => string;
  fetcher?: typeof fetch;
}): Promise<SyncBootstrapResponse> {
  const fetcher = input.fetcher ?? fetch;
  const now = input.now ?? new Date();
  const url = new URL(await buildSignedAppsScriptUrl({
    endpoint: input.endpoint,
    deviceId: input.deviceId,
    secret: input.secret,
    timestamp: now.getTime(),
    nonce: input.nonceFactory?.() ?? crypto.randomUUID(),
    body: `action=bootstrap&businessDate=${input.businessDate}`,
  }));
  url.searchParams.set('action', 'bootstrap');
  url.searchParams.set('businessDate', input.businessDate);
  const response = await fetcher(url.toString());

  if (!response.ok) {
    throw new Error(`Sync bootstrap failed: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as SyncBootstrapResponse | { ok: false; message: string };
  if (!payload.ok) {
    throw new Error(payload.message);
  }

  return payload;
}
```

- [ ] **Step 4: Run bootstrap test**

Run:

```bash
cd frontend
npx vitest run src/sync/__tests__/bootstrap.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/sync/bootstrap.ts frontend/src/sync/__tests__/bootstrap.test.ts
git commit -m "feat: add Sheets bootstrap pull"
```

---

### Task 8: Student Import Workflow Through Sheets

**Files:**
- Create: `docs/ops/student-import-runbook.md`
- Modify: `apps-script/easyorder-sync/README.md`
- Modify: `frontend/src/domain/__tests__/student.test.ts`

- [ ] **Step 1: Confirm student import parser expectations**

Run:

```bash
cd frontend
npx vitest run src/domain/__tests__/student.test.ts
```

Expected: PASS. Existing tests already cover duplicate IDs, missing names, and invalid opening balances.

- [ ] **Step 2: Add import runbook**

Create `docs/ops/student-import-runbook.md`:

```md
# Student Import Runbook

## Source

The school exports the existing Excel roster as CSV. The required columns are:

```text
studentId,displayName,openingBalance
```

## Import Path

1. Export Excel to CSV.
2. In the app, preview the CSV and fix duplicate `studentId`, blank `displayName`, or invalid `openingBalance`.
3. Apply the import to the Google Sheet `students` tab: `openingBalance` writes `opening_balance`, `current_balance` starts equal to `opening_balance`, and `student_revision` starts at `0`.
4. Start EasyOrder and run bootstrap pull.
5. Confirm the app shows the imported student count and opening balances.

## Safety Rules

- Never directly import transaction rows into production ledger.
- Keep a copy of the original CSV before import.
- If a student already exists, update only after operator confirms the preview diff.
- Inactive/graduated students stay in `students` with `status=inactive`; do not delete them during a lunch-service pilot.
```

- [ ] **Step 3: Link from Apps Script README**

Append to `apps-script/easyorder-sync/README.md`:

```md
## Student Import

Use `docs/ops/student-import-runbook.md`. Student import flows through the `students` worksheet, then the app pulls the latest roster during bootstrap. Production transaction rows are never imported from CSV.
```

- [ ] **Step 4: Commit**

```bash
git add docs/ops/student-import-runbook.md apps-script/easyorder-sync/README.md frontend/src/domain/__tests__/student.test.ts
git commit -m "docs: add student import runbook"
```

---

### Task 9: Sync Closeout Gate

**Files:**
- Modify: `frontend/src/domain/cashClose.ts`
- Modify: `frontend/src/domain/__tests__/cashClose.test.ts`
- Modify: `frontend/src/components/report/CashClosePanel.tsx`

- [ ] **Step 1: Add closeout gate tests**

Add to `frontend/src/domain/__tests__/cashClose.test.ts`:

```ts
it('blocks closeout when failed or conflict rows exist', () => {
  const result = validateCashClose(5260, 5260, true, false, false, '平帳');
  expect(result).toEqual({ ok: false, code: 'blocked_sync', message: '存在失敗或衝突的同步記錄，無法關帳' });
});

it('requires explicit queued-row acknowledgement before closeout', () => {
  const result = validateCashClose(5260, 5260, false, false, true, '平帳');
  expect(result).toEqual({ ok: false, code: 'queued_unconfirmed', message: '存在排隊中的記錄，需要確認後才能關帳' });
});
```

- [ ] **Step 2: Run test**

Run:

```bash
cd frontend
npx vitest run src/domain/__tests__/cashClose.test.ts
```

Expected: PASS if existing gate still matches this policy. If not, change the implementation to match these exact expectations.

- [ ] **Step 3: Verify UI copy**

In `CashClosePanel`, ensure queued rows copy says:

```tsx
尚有 {queuedRowCount} 筆交易未上傳 Google Sheets，仍要結帳
```

Ensure failed/conflict copy says:

```tsx
有同步失敗或衝突記錄，需處理後才能關帳
```

- [ ] **Step 4: Run test**

```bash
cd frontend
npx vitest run src/domain/__tests__/cashClose.test.ts src/__tests__/reportScreen.integration.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/domain/cashClose.ts frontend/src/domain/__tests__/cashClose.test.ts frontend/src/components/report/CashClosePanel.tsx
git commit -m "feat: gate closeout on sync status"
```

---

### Task 10: Final Verification

**Files:**
- All files touched in Tasks 1-9

- [ ] **Step 1: Typecheck**

```bash
cd frontend
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 2: Lint**

```bash
cd frontend
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Tests**

```bash
cd frontend
npx vitest run
```

Expected: PASS.

- [ ] **Step 4: Build**

```bash
cd frontend
npm run build
```

Expected: PASS.

- [ ] **Step 5: Docs and diff checks**

```bash
git diff --check
git status --short
```

Expected: `git diff --check` prints no errors. `git status --short` shows only intentional changes.

## Definition Of Done

- IndexedDB outbox stores local events before network sync.
- Outbox records preserve retry metadata: status, attempt count, next retry time, and last error.
- Apps Script web app deployment has a concrete auth decision: school-owned deployer, `Execute as: Me`, link access, and HMAC pairing secret validation on every `doGet`/`doPost`.
- Apps Script `doPost` serializes append-only event writes with `LockService`.
- Apps Script treats `transactions` and `daily_settlements` as source-of-truth event ledgers; `students.current_balance`, `students.student_revision`, and Script Property `serverRevision` are repairable derived state.
- Duplicate/retry paths explicitly repair partial-write cases: append succeeded but student repair failed, append succeeded but `serverRevision` update failed, or student row drifted from the ledger.
- Sheets remain visible and understandable to the director: students, transactions, daily_settlements.
- Event ids are idempotency keys.
- Accounting conflicts are surfaced instead of last-write-wins: transaction writes check `expectedStudentRevision`; settlement writes require exact current server revision.
- Student import path starts from Excel/CSV into the `students` sheet and app bootstrap; student import is not a browser outbox event.
- Daily closeout blocks failed/conflict rows and requires explicit acknowledgement for queued rows.
- No browser code directly calls the Google Sheets API with exposed credentials.
