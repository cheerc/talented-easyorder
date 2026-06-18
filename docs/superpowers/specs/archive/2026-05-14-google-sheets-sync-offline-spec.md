[DEPRECATED] — Google Sheets 同步已被 Firebase Firestore 完全取代。

取代方案：
- Firebase Firestore (`frontend/src/firebase/`) 作為即時資料庫與同步層
- `frontend/src/domain/ledgerSyncBoundary.ts` 定義 queueable payload 與 sync boundary
- `frontend/src/firebase/ledgerRepository.ts`, `settlementRepository.ts`, `studentRepository.ts` 處理 CRUD 與 sync
- `frontend/src/firebase/realtimeSubscriptions.ts` 處理即時訂閱
- 本地 durable queue 概念保留在 `ledgerSyncBoundary.ts`，但 transport 層已從 Google Sheets API 改為 Firestore

---
# Google Sheets Sync And Offline Spec (DEPRECATED)

## 功能描述

Google Sheets Sync And Offline 定義 Phase 1 的資料持久層：Google Sheets 三表 schema、本地 durable queue、離線可用、重試/idempotency、衝突處理、restore、以及 PDF 提到的「舊表單資料一鍵轉移」遷移流程。

目前 app 只有 Zustand persist/localStorage 與假同步動畫。此模組不改變 PC POS 的 local-first 體驗：交易先在本地 commit，再透過 queue 同步；網路或 Sheets 失敗不能阻塞午餐隊伍，但必須在報表/closeout 顯示可修復狀態。

## 使用者故事

- As a counter operator, I want transactions to continue while offline so that lunch service does not stop when the network drops.
- As an admin, I want Google Sheets to receive student, transaction, and settlement rows so that the operation remains inspectable outside the app.
- As an admin, I want retry and idempotency so that refreshing or reconnecting does not duplicate orders.
- As an accounting user, I want failed/conflict rows surfaced before close so that daily settlement is trustworthy.
- As an admin, I want to restore local state from Google Sheets so that a damaged browser/device can recover.
- As an operator migrating from the initial form/sheet, I want previewed one-click migration so that existing data moves into the structured schema safely.

## 驗收標準

### Local-First Queue

Given the PC is offline
When the operator commits an order
Then the transaction is saved locally, assigned a stable idempotency key, marked `queued`, and service can continue.

Given the browser is refreshed with queued rows pending
When the app loads
Then the queue is restored from durable local storage and no queued operation is lost.

Given the same queued operation retries after an unknown network result
When Google Sheets receives the request again
Then idempotency prevents duplicate transaction rows.

### Sync Retry And Status

Given the network is online and queued rows exist
When the sync worker runs
Then queued rows are sent in dependency order: student/menu changes before transactions before daily settlements.

Given the browser receives an `online` event after being offline
When queued rows exist
Then the sync worker starts automatically and attempts補登 without requiring operator action.

Given the browser reports online but the Sheets health check fails
When the sync worker attempts to run
Then the app treats remote sync as unavailable, keeps local service enabled, and schedules retry.

Given Google Sheets returns a transient failure such as timeout, 429, or 5xx
When a queued row is processed
Then the row remains queued or retrying with incremented attempt count and next retry time.

Given Google Sheets returns a validation or authorization failure
When a queued row is processed
Then the row becomes `failed`, the error is visible in admin/report UI, and automatic retry stops until repair.

Given a row syncs successfully
When the remote confirms the idempotency key/revision
Then the local row becomes `synced` and stores remote metadata.

### Conflict Handling

Given a mutable row has local revision `3` and remote revision `4`
When sync attempts to update it
Then the row becomes `conflict` and the app does not overwrite remote data silently.

Given a transaction row is append-only
When it has already been synced
Then later corrections are sent as correction/void rows, not as destructive rewrites.

Given a settlement row was closed locally and remote settlement changed first
When sync detects revision mismatch
Then the settlement enters `conflict` and close status remains locally visible until admin repair.

Given a conflict is opened for a mutable student/menu/vendor record
When the admin chooses `server-wins`
Then the local mutable record is replaced by the remote version, a local conflict-resolution audit event is recorded, and dependent unsynced ledger rows are revalidated.

Given a conflict is opened for a mutable student/menu/vendor record
When the admin chooses `last-write-wins`
Then the newer `updatedAt` revision wins only if the entity is not a ledger transaction or closed settlement.

Given a conflict is opened for a transaction, correction, void, or settlement row
When the admin chooses manual resolve
Then the UI requires an explicit resolution action and reason; destructive overwrites are not allowed for append-only accounting rows.

### Restore

Given an admin starts restore from Google Sheets
When remote rows are downloaded
Then the app previews counts for students, vendors/menu rows, transactions, settlements, conflicts, and local-only rows before applying.

Given restore is confirmed
When the local state is rebuilt
Then student balances are derived from ledger rows and daily close statuses match settlement rows.

Given local-only rows exist that are not in Google Sheets
When restore preview is shown
Then the UI requires explicit choice to keep, export, or discard those local-only rows.

### Migration

Given an initial unstructured/old form sheet is selected
When migration preview runs
Then rows are mapped into target sheets, invalid rows are listed, and no data is written before confirmation.

Given migration is confirmed with a clean preview
When the migration executes
Then rows are written to the new schema with migration batch id and audit event.

Given migration has invalid rows
When the admin attempts to execute
Then migration is blocked until invalid rows are fixed or explicitly excluded.

### PC Offline Recovery Flow

Given the PC is online at app startup
When the app initializes
Then it performs a lightweight sync health check and shows the last successful sync time.

Given the PC loses connectivity during lunch service
When the browser emits `offline` or sync health checks fail
Then the top bar changes to offline/queueing state and POS transactions continue local-first.

Given the PC commits transactions while offline
When each transaction is saved locally
Then each transaction receives a queue entry with idempotency key, dependency ids, attempt count `0`, and status `queued`.

Given connectivity returns
When the browser emits `online` and the health check succeeds
Then the sync worker flushes queued rows in order and updates each row to `synced`, `failed`, or `conflict`.

Given some queued rows fail during recovery
When the worker finishes a cycle
Then successful rows remain synced, failed rows stay repairable, and the operator can continue serving students.

## 技術約束

- Frontend remains Vite 8 + React 19 + TypeScript 6 + Zustand 5 for the first implementation pass.
- The repo is currently pure frontend. Any production Google Sheets write path must choose one architecture in the implementation plan:
  - Apps Script web app/API with deployment token.
  - Lightweight backend proxy.
  - Direct Google API from frontend with OAuth, only if the security tradeoff is accepted.
- Service account secrets or privileged tokens must not be embedded in frontend code.
- Queue storage must survive page refresh and browser restart.
- Stable ids and idempotency keys are required; spreadsheet row number is never the primary identity.
- Sync code must be testable without real Google Sheets by using a transport interface and fake adapter.
- Queue processing must not mutate already committed POS rows into uncommitted state.
- Online/offline detection must combine browser events with an application-level remote health check; `navigator.onLine` alone is not authoritative.
- Reconnection must auto-flush queued rows without requiring the operator to click "push to cloud".
- Existing test chain applies from `frontend/`: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build`.

## UI/UX 要求

- Top bar sync state shows online, syncing, offline, queued count, failed count, and conflict count without interrupting normal POS work.
- Failed/conflict states are actionable from admin/report views with row-level error details.
- Manual "push to cloud" flushes the queue and reports per-row success/failure counts.
- Restore and migration are preview-confirm flows with counts, invalid rows, and irreversible-change warnings.
- Closeout screens consume sync status: failed/conflict blocks close; queued local rows require explicit settlement-queued confirmation.
- Offline copy should tell the operator that service can continue and how many changes are queued.

## 與其他模組的介面

### 輸入

- `StudentAccount`, vendor, menu, and catalog rows from `student-account-management` and `menu-and-vendor-management`.
- Committed transactions, corrections, voids, close/reopen events, and settlements from `order-ledger-and-cash-close`.
- Queueable transaction operations from `pc-pos-order-flow`.
- Future face profile references/status updates from `face-auth-ipad-handoff`, excluding raw biometric data.

### 輸出

- Sync status and remote metadata back to all domain modules.
- Queue health summary for top bar and admin UI.
- Conflict/failure records for report/admin repair screens.
- Restored domain state snapshots.
- Migration audit results and imported row ids.

### 依賴關係

- Depends on stable schemas from student, menu/vendor, and ledger modules.
- Feeds `pc-pos-order-flow` with online/offline/queued display state.
- Feeds `order-ledger-and-cash-close` with sync status used by close policy.
- Feeds admin screens with repair, restore, and migration status.

## Google Sheets Schema

### `students`

- `student_id`
- `display_name`
- `status`
- `current_balance`
- `aliases`
- `class_name`
- `group_name`
- `face_profile_id`
- `face_enrollment_status`
- `created_at`
- `updated_at`
- `revision`

### `transactions`

- `business_date`
- `transaction_id`
- `created_at`
- `student_id`
- `student_name_snapshot`
- `type`
- `meal_price`
- `paid_amount`
- `amount`
- `after_balance`
- `menu_name_snapshot`
- `vendor_name_snapshot`
- `source_device`
- `operator_id`
- `sync_status`
- `revision`
- `note`
- `voided_at`
- `voided_by`
- `void_reason`

### `daily_settlements`

- `business_date`
- `settlement_id`
- `settlement_revision`
- `status`
- `order_count`
- `transaction_count`
- `expected_cash`
- `counted_cash`
- `difference`
- `note`
- `closed_by`
- `closed_at`
- `reopened_by`
- `reopened_at`
- `reopen_reason`
- `sync_status`
- `revision`

### Optional `sync_events`

- `event_id`
- `event_type`
- `entity_type`
- `entity_id`
- `business_date`
- `created_at`
- `payload_json`
- `operator_id`
- `migration_batch_id`

## Durable Queue Lifecycle

Every local write that must reach Google Sheets follows this lifecycle:

1. `local commit`: domain module writes the change to local state and emits a queueable operation.
2. `queue`: sync module stores `SyncQueueEntry` with idempotency key, entity, operation, payload, dependencies, and attempt count.
3. `retrying`: worker claims an eligible entry and calls the configured transport adapter.
4. `synced`: remote confirms idempotency key and revision; local domain row stores remote metadata.
5. `failed`: non-retryable validation/auth/schema error; row requires admin repair.
6. `conflict`: remote revision or append-only invariant prevents automatic write; row requires conflict resolution.

Dependency order:

- `student`, `vendor`, `menu` updates before transactions that reference them.
- `transaction` and correction/void rows before `settlement` rows for the same business date.
- `sync_event` audit rows may follow the entity row they describe.

Retry policy:

- Retry transient network, timeout, 429, and 5xx failures with backoff.
- Do not retry validation, auth, schema mismatch, or conflict responses automatically.
- Idempotency key is stable across retries and browser refreshes.

## 衝突解決策略

Supported strategies:

- `server-wins`: Accept remote row for mutable master data. Allowed for students, vendors, menus, and catalog items when no local append-only accounting row would be invalidated.
- `last-write-wins`: Compare `updatedAt`/revision for mutable master data only. Not allowed for transactions or settlement revisions.
- `manual-resolve`: Required for transactions, corrections, voids, closed settlements, and any case where server/local changes affect cash, balance, or close status.

Default policy by entity:

- Student/menu/vendor mutable fields: manual prompt offering server-wins or last-write-wins with preview.
- Transactions: append-only; conflicts create correction/void/replacement workflow, never overwrite synced rows directly.
- Daily settlements: settlement revisions are append-only; conflicts require manual resolve and a new settlement revision.
- Sync events: append-only; duplicate idempotency key is treated as already synced.

Manual resolve UI must show local row, remote row, dependent rows, cash/balance impact, and required reason.

## 建議資料型別

```ts
export type SyncEntity = 'student' | 'vendor' | 'menu' | 'transaction' | 'settlement' | 'sync_event';
export type SyncOperationKind = 'create' | 'update' | 'append' | 'void' | 'close' | 'reopen' | 'migrate';
export type QueueStatus = 'queued' | 'retrying' | 'synced' | 'failed' | 'conflict';

export interface SyncQueueEntry {
  queueId: string;
  idempotencyKey: string;
  entity: SyncEntity;
  operation: SyncOperationKind;
  entityId: string;
  payload: Record<string, unknown>;
  dependencyIds: string[];
  status: QueueStatus;
  attemptCount: number;
  nextRetryAt?: string;
  lastError?: string;
  remoteRevision?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SyncHealthSummary {
  online: boolean;
  syncing: boolean;
  queuedCount: number;
  failedCount: number;
  conflictCount: number;
  lastSuccessfulSyncAt?: string;
}
```

## 現有實作對照

- Current sync state: `App.tsx` uses `online = true`, fake `syncing`, and fake `lastSync`.
- Current persistence: `usePosStore` uses Zustand `persist` with localStorage.
- Current UI stubs: report buttons for print/export/cloud push; backup/restore sample UI exists but active navigation does not expose it.
- Current gaps: no queue, no Sheets schema, no retry/idempotency, no conflict handling, no migration preview, no restore from remote, no real offline health model.

## 不在本模組範圍

- Google Cloud project provisioning or credential runbook.
- Actual face matching/model sync.
- Long-term database replacement beyond Google Sheets.
- Payment provider settlement.
