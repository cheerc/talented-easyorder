# Apps Script Sheets Sync And Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the earlier backend exploration with a zero-new-provider, Google-account-first sync plan using IndexedDB local authority, Apps Script serialized writes, and Google Sheets as the visible operational database.

**Architecture:** The frontend writes POS operations to IndexedDB first, then an outbox sends append-only events to an Apps Script web app. Apps Script uses `LockService` and idempotency keys to serialize writes into three visible Sheets: students, transactions, and daily_settlements. Opening service pulls the latest Sheets snapshot; realtime sync is not required for Phase 1.

**Tech Stack:** React 19, TypeScript 6, Zustand 5, IndexedDB, Vitest, Google Apps Script `doGet`/`doPost`, SpreadsheetApp, LockService, Google Sheets.

---

## Product Decisions Locked By This Plan

- Use Apps Script + Google Sheets as the Phase 1 backend because the product constraint is "free, existing Google account, zero extra provider, Sheets visible to the director."
- Do not use Cloudflare Workers + D1 as the default Phase 1 backend. Keep it as a future fallback if Sheets/Apps Script quota or maintenance risk becomes unacceptable.
- Do not write from browser directly to the Google Sheets API in production. The browser talks only to Apps Script.
- No last-write-wins for accounting. Use event idempotency and revision checks.
- PC POS remains transaction authority. iPad handoff may select/queue a student in later phases but must not independently commit accounting rows in this plan.
- No separate fourth visible worksheet for MVP. Idempotency is enforced by `event_id` columns on `transactions` and `daily_settlements`; student imports use `student_revision`.

## Supersedes / Consolidates

- Supersedes `docs/superpowers/plans/2026-05-14-phase-1-3-google-sheets-sync-offline.md`.
- Supersedes the backend choice in `docs/superpowers/plans/2026-05-15-free-backend-architecture-exploration.md`.
- Consolidates the practical student import path from `docs/superpowers/plans/2026-05-15-data-migration-strategy.md`.
- Must remain consistent with `docs/superpowers/plans/2026-05-15-pwa-offline-first-strategy(DONE).md` and `docs/superpowers/plans/2026-05-15-frontend-security-considerations.md`.

## Official Sources Checked

- Google Sheets API usage limits: `https://developers.google.com/workspace/sheets/api/limits`
- Apps Script quotas: `https://developers.google.com/apps-script/guides/services/quotas`
- Apps Script web apps: `https://developers.google.com/apps-script/guides/web`
- Apps Script LockService: `https://developers.google.com/apps-script/reference/lock`

## File Structure

- Create `frontend/src/sync/syncTypes.ts` for shared event, pull, and response contracts.
- Create `frontend/src/sync/__tests__/syncTypes.test.ts` for event validation and idempotency key expectations.
- Create `frontend/src/storage/easyorderDb.ts` for IndexedDB object stores.
- Create `frontend/src/storage/__tests__/easyorderDb.test.ts` for local outbox persistence.
- Create `frontend/src/sync/outbox.ts` for queueing, retry, and applying server acknowledgements.
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
      transaction: { transactionId: 'tx-1', studentId: '015' },
    });

    expect(event).toMatchObject({
      eventId: 'pc-1:1',
      eventType: 'transaction_committed',
      businessDate: '2026-05-15',
      baseServerRevision: 0,
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
  | 'daily_settlement_closed'
  | 'student_snapshot_imported';

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

export interface SyncPushResponse {
  ok: true;
  acks: SyncPushAck[];
  conflicts: SyncPushConflict[];
}

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
  transaction: Record<string, unknown>;
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
      eventId: 'pc-1:1',
      deviceId: 'pc-1',
      deviceSeq: 1,
      eventType: 'transaction_committed',
      businessDate: '2026-05-15',
      createdAt: '2026-05-15T08:00:00.000Z',
      baseServerRevision: 0,
      payload: { transactionId: 'tx-1' },
    });

    const events = await db.listOutboxEvents();
    expect(events.map(event => event.eventId)).toEqual(['pc-1:1']);
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

export interface EasyOrderDb {
  putOutboxEvent(event: SyncEvent): Promise<void>;
  listOutboxEvents(): Promise<SyncEvent[]>;
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
        database.createObjectStore(OUTBOX_STORE, { keyPath: 'eventId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return {
    async putOutboxEvent(event) {
      const tx = db.transaction(OUTBOX_STORE, 'readwrite');
      await requestToPromise(tx.objectStore(OUTBOX_STORE).put(event));
    },
    async listOutboxEvents() {
      const tx = db.transaction(OUTBOX_STORE, 'readonly');
      return requestToPromise(tx.objectStore(OUTBOX_STORE).getAll());
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

### Task 3: Implement Outbox Push Protocol

**Files:**
- Create: `frontend/src/sync/outbox.ts`
- Create: `frontend/src/sync/__tests__/outbox.test.ts`

- [ ] **Step 1: Write failing outbox tests**

Create `frontend/src/sync/__tests__/outbox.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { pushOutboxEvents } from '../outbox';
import type { SyncEvent } from '../syncTypes';

const event: SyncEvent = {
  eventId: 'pc-1:1',
  deviceId: 'pc-1',
  deviceSeq: 1,
  eventType: 'transaction_committed',
  businessDate: '2026-05-15',
  createdAt: '2026-05-15T08:00:00.000Z',
  baseServerRevision: 0,
  payload: { transactionId: 'tx-1' },
};

describe('pushOutboxEvents', () => {
  it('deletes accepted events from local outbox', async () => {
    const db = {
      listOutboxEvents: vi.fn().mockResolvedValue([event]),
      deleteOutboxEvent: vi.fn().mockResolvedValue(undefined),
    };
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, acks: [{ eventId: 'pc-1:1', status: 'accepted', serverRevision: 1 }], conflicts: [] }),
    });

    await pushOutboxEvents({ db, endpoint: 'https://script.google.com/s/mock/exec', deviceId: 'pc-1', fetcher });

    expect(fetcher).toHaveBeenCalledWith('https://script.google.com/s/mock/exec', expect.objectContaining({ method: 'POST' }));
    expect(db.deleteOutboxEvent).toHaveBeenCalledWith('pc-1:1');
  });

  it('keeps conflicted events queued', async () => {
    const db = {
      listOutboxEvents: vi.fn().mockResolvedValue([event]),
      deleteOutboxEvent: vi.fn().mockResolvedValue(undefined),
    };
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, acks: [], conflicts: [{ eventId: 'pc-1:1', status: 'conflict', serverRevision: 9, message: 'revision mismatch' }] }),
    });

    const result = await pushOutboxEvents({ db, endpoint: 'https://script.google.com/s/mock/exec', deviceId: 'pc-1', fetcher });

    expect(db.deleteOutboxEvent).not.toHaveBeenCalled();
    expect(result.conflicts).toHaveLength(1);
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
import type { SyncEvent, SyncPushResponse } from './syncTypes';

interface OutboxDb {
  listOutboxEvents(): Promise<SyncEvent[]>;
  deleteOutboxEvent(eventId: string): Promise<void>;
}

export async function pushOutboxEvents(input: {
  db: OutboxDb;
  endpoint: string;
  deviceId: string;
  fetcher?: typeof fetch;
}): Promise<SyncPushResponse> {
  const fetcher = input.fetcher ?? fetch;
  const events = await input.db.listOutboxEvents();
  if (events.length === 0) {
    return { ok: true, acks: [], conflicts: [] };
  }

  const response = await fetcher(input.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: input.deviceId, events }),
  });

  if (!response.ok) {
    throw new Error(`Sync push failed: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as SyncPushResponse;
  for (const ack of payload.acks) {
    if (ack.status === 'accepted' || ack.status === 'duplicate') {
      await input.db.deleteOutboxEvent(ack.eventId);
    }
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

### Task 4: Add Apps Script Backend

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

function hasEventId(sheet, eventId) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const eventIdIndex = headers.indexOf('event_id');
  if (eventIdIndex < 0) return false;
  const rows = sheet.getDataRange().getValues().slice(1);
  return rows.some(row => row[eventIdIndex] === eventId);
}

function getServerRevision() {
  return Number(PropertiesService.getScriptProperties().getProperty('serverRevision') || '0');
}

function setServerRevision(value) {
  PropertiesService.getScriptProperties().setProperty('serverRevision', String(value));
}

function doGet(e) {
  const action = e.parameter.action || 'bootstrap';
  if (action !== 'bootstrap') {
    return jsonResponse({ ok: false, message: `Unsupported action: ${action}` });
  }

  return jsonResponse({
    ok: true,
    serverRevision: getServerRevision(),
    businessDate: e.parameter.businessDate || '',
    students: readObjects(getSheet(SHEETS.students)),
    settings: {},
    latestTransactions: readObjects(getSheet(SHEETS.transactions)).slice(-200),
    latestSettlements: readObjects(getSheet(SHEETS.settlements)).slice(-30),
  });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const request = JSON.parse(e.postData.contents || '{}');
    const events = Array.isArray(request.events) ? request.events : [];
    const acks = [];
    const conflicts = [];
    let serverRevision = getServerRevision();

    const txSheet = getSheet(SHEETS.transactions);
    const settlementSheet = getSheet(SHEETS.settlements);

    events.forEach(event => {
      if (event.baseServerRevision > serverRevision) {
        conflicts.push({
          eventId: event.eventId,
          status: 'conflict',
          serverRevision,
          message: 'Client base revision is ahead of server',
        });
        return;
      }

      const targetSheet = event.eventType === 'daily_settlement_closed' ? settlementSheet : txSheet;
      if (hasEventId(targetSheet, event.eventId)) {
        acks.push({ eventId: event.eventId, status: 'duplicate', serverRevision });
        return;
      }

      serverRevision += 1;
      const payload = event.payload || {};
      appendObject(targetSheet, {
        ...payload,
        event_id: event.eventId,
        device_id: event.deviceId,
        device_seq: event.deviceSeq,
        business_date: event.businessDate,
        server_revision: serverRevision,
        synced_at: new Date().toISOString(),
      });
      acks.push({ eventId: event.eventId, status: 'accepted', serverRevision });
    });

    setServerRevision(serverRevision);
    return jsonResponse({ ok: true, acks, conflicts });
  } catch (error) {
    return jsonResponse({ ok: false, message: String(error && error.message ? error.message : error) });
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
student_id,display_name,status,current_balance,student_revision,updated_at
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
4. Deploy -> New deployment -> Web app.
5. Execute as: Me.
6. Who has access: school/operator Google account policy.
7. Copy the web app URL into frontend sync settings.

## Operational Rule

The frontend never writes directly to Google Sheets. It sends events to this web app. The script serializes writes with `LockService.getScriptLock()`.
```

- [ ] **Step 3: Commit**

```bash
git add apps-script/easyorder-sync/Code.gs apps-script/easyorder-sync/README.md
git commit -m "feat: add Apps Script Sheets sync backend"
```

---

### Task 5: Enqueue Local POS Events After Commit

**Files:**
- Modify: `frontend/src/store/posStore.ts`
- Modify: `frontend/src/store/__tests__/posStore.test.ts`

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
```

- [ ] **Step 2: Run store tests**

Run:

```bash
cd frontend
npx vitest run src/store/__tests__/posStore.test.ts
```

Expected: FAIL while created transactions still use `syncStatus: 'local'`.

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

### Task 6: Add Bootstrap Pull From Sheets

**Files:**
- Create: `frontend/src/sync/bootstrap.ts`
- Create: `frontend/src/sync/__tests__/bootstrap.test.ts`

- [ ] **Step 1: Write failing bootstrap tests**

Create `frontend/src/sync/__tests__/bootstrap.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { pullBootstrap } from '../bootstrap';

describe('pullBootstrap', () => {
  it('calls Apps Script bootstrap endpoint for a business date', async () => {
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
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledWith('https://script.google.com/s/mock/exec?action=bootstrap&businessDate=2026-05-15');
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
import type { SyncBootstrapResponse } from './syncTypes';

export async function pullBootstrap(input: {
  endpoint: string;
  businessDate: string;
  fetcher?: typeof fetch;
}): Promise<SyncBootstrapResponse> {
  const fetcher = input.fetcher ?? fetch;
  const url = `${input.endpoint}?action=bootstrap&businessDate=${encodeURIComponent(input.businessDate)}`;
  const response = await fetcher(url);

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

### Task 7: Student Import Workflow Through Sheets

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
3. Apply the import to the Google Sheet `students` tab.
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

### Task 8: Sync Closeout Gate

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

### Task 9: Final Verification

**Files:**
- All files touched in Tasks 1-8

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
- Apps Script `doPost` serializes append-only event writes with `LockService`.
- Sheets remain visible and understandable to the director: students, transactions, daily_settlements.
- Event ids are idempotency keys.
- Accounting conflicts are surfaced instead of last-write-wins.
- Student import path starts from Excel/CSV into Sheets and app bootstrap.
- Daily closeout blocks failed/conflict rows and requires explicit acknowledgement for queued rows.
- No browser code directly calls the Google Sheets API with exposed credentials.
