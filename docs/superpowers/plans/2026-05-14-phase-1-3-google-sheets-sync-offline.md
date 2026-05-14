# Phase 1.3 Google Sheets Sync And Offline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local-first Google Sheets persistence with a durable queue, idempotent retry, offline recovery, conflict repair, restore, and old-sheet migration while keeping POS service usable when remote sync is unavailable.

**Architecture:** Keep domain commits authoritative locally, then enqueue serializable operations for a transport adapter. Use a fake adapter for deterministic tests and an Apps Script web app adapter for the Phase 1.3 pilot; backend proxy remains the production escalation path if deployment, security, quota, or observability requirements exceed Apps Script.

**Tech Stack:** Vite 8, React 19, TypeScript 6, Zustand 5, Vitest 4, Testing Library, Google Sheets, Apps Script web app pilot transport, current `frontend/` verification chain.

---

## Source Specs

- `docs/superpowers/specs/2026-05-14-google-sheets-sync-offline-spec.md`
- `docs/superpowers/specs/2026-05-14-order-ledger-cash-close-spec.md`
- `docs/superpowers/specs/2026-05-14-student-account-management-spec.md`
- `docs/superpowers/specs/2026-05-14-menu-vendor-management-spec.md`
- `docs/superpowers/plans/2026-05-14-phase-1-0-foundation-hardening.md`
- `docs/superpowers/plans/2026-05-14-phase-1-1-pc-pos-formalization.md`
- `docs/superpowers/plans/2026-05-14-phase-1-2-reporting-and-settlement.md`
- `docs/superpowers/plans/ROADMAP.md`

## Official Transport References

Checked on 2026-05-14:

- Apps Script web apps support `doGet(e)` / `doPost(e)` and can execute as the script owner or the accessing user: https://developers.google.com/apps-script/guides/web
- Google Sheets browser JavaScript quickstart uses OAuth client setup and API key restrictions, and points production apps to proper auth/credential choices: https://developers.google.com/workspace/sheets/api/quickstart/js
- Google API Console credentials separate OAuth client IDs from API keys; API keys identify projects and do not authorize account data access: https://support.google.com/googleapi/answer/6158857
- Google Cloud IAM documents service account credentials and warns that service account keys must be stored securely, with short-lived credentials preferred when possible: https://docs.cloud.google.com/iam/docs/service-account-creds

## Phase Estimate

- Total estimate: 8-12 dev days.
- Complexity: high. The work touches persistence, remote state, retry, accounting close policy, admin repair, and operational recovery.
- Recommended PR split:
  - PR 1: transport decision record, schema mappers, queue model, fake adapter, and worker tests.
  - PR 2: Apps Script pilot adapter, online/offline health, UI status, and close-policy integration.
  - PR 3: conflict repair, restore preview/apply, migration preview/commit, and pilot verification.

## Transport Architecture Decision Matrix

| Option | How It Works | Strengths | Risks / Costs | Phase 1.3 Decision |
|---|---|---|---|---|
| Apps Script web app | Frontend posts batch operations to a deployed Apps Script `doPost(e)` endpoint that writes to the target spreadsheet under the deployment identity. | Fastest path for current pure-frontend app; no service account key in browser; close to Google Sheets; easy pilot sheet deployment; small amount of server-side script can enforce idempotency. | Endpoint deployment and access policy must be controlled; Apps Script quotas/latency are operational limits; versioning and local CI are weaker than normal backend code; leaked endpoint can receive requests if access is too broad. | **Choose for Phase 1.3 pilot** with domain-restricted access where available, endpoint URL in env config, fake adapter tests, and manual pilot gate. |
| Backend proxy | Frontend sends queue batches to a backend API; backend uses Google auth libraries and server-held credentials to write Sheets. | Best production security and observability; service account or workload identity stays server-side; easier rate limiting, audit logs, schema migrations, and future database replacement. | Adds hosting, deployment, monitoring, auth, and operational ownership to a repo that is currently frontend-only. | **Escalate after pilot** if app leaves trusted environment, Apps Script quota/latency fails, or operator wants stronger auth/audit guarantees. |
| Direct Google API from browser | Frontend calls Sheets API directly with browser OAuth and Google API client libraries. | No custom server; official browser flow exists; useful for admin-only tools or read-only inspection. | Write scopes and user OAuth live in the browser; each operator needs consent/session handling; API key is not authorization; privileged service account keys cannot be embedded in frontend; shared counter PC workflow becomes fragile. | **Reject as Phase 1.3 write path**. Keep only as a possible admin read-only diagnostic route after separate approval. |

## Task Board Breakdown

| Task ID | Title | Estimate | Primary Files | Depends On |
|---|---|---:|---|---|
| EO-P13-T01 | Transport decision record and adapter contract | 0.75 day / 2 SP | `docs/sync/google-sheets-transport-decision.md`, `frontend/src/domain/syncTransport.ts` | Phase 1.2 |
| EO-P13-T02 | Google Sheets schema mappers and row validators | 1 day / 3 SP | `frontend/src/domain/sheetsSchema.ts`, `frontend/src/domain/__tests__/sheetsSchema.test.ts` | EO-P13-T01 |
| EO-P13-T03 | Durable queue model, idempotency keys, and persistence migration | 1.25 days / 5 SP | `frontend/src/domain/syncQueue.ts`, `frontend/src/store/posStore.ts`, `frontend/src/store/__tests__/syncQueueStore.test.ts` | EO-P13-T02 |
| EO-P13-T04 | Sync worker lifecycle, dependency ordering, and fake adapter | 1.25 days / 5 SP | `frontend/src/domain/syncWorker.ts`, `frontend/src/services/sheets/fakeSheetsTransport.ts` | EO-P13-T03 |
| EO-P13-T05 | Apps Script pilot adapter and script source | 1.25 days / 5 SP | `frontend/src/services/sheets/appsScriptTransport.ts`, `integrations/google-sheets/apps-script/Code.gs` | EO-P13-T04 |
| EO-P13-T06 | Online/offline health and automatic reconnect flush | 0.75 day / 2 SP | `frontend/src/domain/syncHealth.ts`, `frontend/src/hooks/useSyncWorker.ts`, `frontend/src/__tests__/syncHealth.integration.test.tsx` | EO-P13-T04 |
| EO-P13-T07 | Conflict detection and repair policy | 1 day / 3 SP | `frontend/src/domain/syncConflict.ts`, `frontend/src/domain/__tests__/syncConflict.test.ts` | EO-P13-T04 |
| EO-P13-T08 | Restore preview and apply flow | 1 day / 3 SP | `frontend/src/domain/syncRestore.ts`, `frontend/src/domain/__tests__/syncRestore.test.ts` | EO-P13-T05, EO-P13-T07 |
| EO-P13-T09 | Old sheet migration preview and commit flow | 1 day / 3 SP | `frontend/src/domain/syncMigration.ts`, `frontend/src/domain/__tests__/syncMigration.test.ts` | EO-P13-T05, EO-P13-T08 |
| EO-P13-T10 | Sync UI integration and repair surfaces | 1 day / 3 SP | `frontend/src/components/sync/*`, `frontend/src/components/screens.tsx`, `frontend/src/App.tsx` | EO-P13-T06-T09 |
| EO-P13-T11 | Phase verification and pilot gate | 0.75 day / 2 SP | `frontend/src/__tests__/syncWorker.integration.test.tsx`, `docs/sync/google-sheets-pilot-checklist.md` | EO-P13-T10 |

## Key Technical Decisions

1. Local state remains authoritative for POS service.
   - POS transaction, correction, void, and close actions commit locally first.
   - Remote failure changes sync status, not the local committed accounting fact.

2. The queue is durable and idempotent.
   - Queue entries persist through Zustand storage and browser restart.
   - Idempotency keys are stable across retries and use entity id plus revision or event id.
   - Spreadsheet row number is never an identity.

3. Fake transport is mandatory before Apps Script.
   - Worker behavior, retry, conflict, restore, and migration tests use `fakeSheetsTransport`.
   - Apps Script pilot is an integration gate, not the only verification path.

4. Apps Script is the Phase 1.3 pilot transport.
   - Frontend stores only the deployment endpoint URL and non-secret config.
   - No service account key, privileged token, OAuth client secret, or Apps Script OAuth token is embedded in frontend code.
   - Domain-restricted deployment is preferred when the customer has Google Workspace.

5. Direct browser Sheets writes are not accepted for Phase 1.3.
   - Browser OAuth can be useful for admin tooling, but it is too fragile for the shared counter workflow.
   - API keys identify projects and quota, not account authorization.

6. The PDF-required Sheets are the primary sync contract.
   - Required tabs: `students`, `transactions`, and `daily_settlements`.
   - Supporting tabs: `vendors`, `menus`, and `sync_events` exist to preserve snapshots, master-data sync, and audit/idempotency repair.

## Data Flow

```text
Student/menu/ledger/settlement domain write
  -> local Zustand commit
  -> SyncQueueEntry persisted with idempotency key and dependencies
  -> sync worker claims eligible queued entry
  -> transport adapter health check and batch write
  -> synced / queued retry / failed / conflict status
  -> local row sync metadata and UI summary update
```

## Component Tree Impact

```text
App
  usePosStore
  useSyncWorker
  TopBarSyncStatus
  POS screen
  ReportScreen
    close panel consumes sync blocking summary
    row repair links for failed/conflict rows
  AdminScreen
    SyncAdminPanel
    RestorePanel
    MigrationPanel
```

No iPad face-recognition UI is introduced in Phase 1.3. Face profile metadata can be mapped as student fields only.

## EO-P13-T01: Transport Decision Record And Adapter Contract

**Estimate:** 0.75 day / 2 SP

**Files:**

- Create: `docs/sync/google-sheets-transport-decision.md`
- Create: `frontend/src/domain/syncTransport.ts`
- Create: `frontend/src/domain/__tests__/syncTransport.test.ts`
- Modify: `frontend/src/domain/index.ts`

**Implementation Plan:**

- [ ] Create `docs/sync/google-sheets-transport-decision.md` with the matrix from this plan, the Phase 1.3 decision, and these operational gates:
  - Apps Script pilot is allowed for a trusted single-site deployment.
  - Backend proxy is required before multi-site rollout, public internet exposure, strict per-operator auth, or high-volume sync.
  - Direct Google API from browser is not used for write transport.
- [ ] Define the transport contract:

```ts
export type RemoteWriteResult =
  | { ok: true; idempotencyKey: string; remoteRevision: number; remoteUpdatedAt: string }
  | { ok: false; idempotencyKey: string; errorCode: 'transient' | 'validation' | 'auth' | 'schema' | 'conflict'; message: string; remoteRevision?: number };

export interface RemoteSnapshot {
  students: Record<string, unknown>[];
  vendors: Record<string, unknown>[];
  menus: Record<string, unknown>[];
  transactions: Record<string, unknown>[];
  dailySettlements: Record<string, unknown>[];
  syncEvents: Record<string, unknown>[];
}

export interface SheetsTransport {
  name: 'fake' | 'apps_script' | 'backend_proxy' | 'direct_google_api';
  healthCheck(): Promise<{ ok: true; checkedAt: string } | { ok: false; checkedAt: string; message: string }>;
  batchWrite(entries: Record<string, unknown>[]): Promise<RemoteWriteResult[]>;
  readSnapshot(): Promise<RemoteSnapshot>;
}
```

- [ ] Define `SyncTransportConfig` with:
  - `transportName`
  - `endpointUrl`
  - `spreadsheetId`
  - `environmentLabel`
  - `operatorId`
- [ ] Implement `validateSyncTransportConfig(config)`:
  - fake transport requires only `transportName: 'fake'`.
  - Apps Script requires an HTTPS endpoint URL and spreadsheet id.
  - backend proxy requires an HTTPS endpoint URL.
  - direct Google API returns invalid for `writeEnabled: true`.
- [ ] Export types/functions from `frontend/src/domain/index.ts`.

**Testing Strategy:**

- Unit:
  - fake config validates with no endpoint.
  - Apps Script config rejects non-HTTPS endpoint.
  - direct Google API config rejects write mode.
  - backend proxy config validates only with HTTPS endpoint.
  - transport contract result types distinguish transient, validation, auth, schema, and conflict.

**Acceptance Criteria:**

- Transport decision is documented before implementation.
- Every sync implementation depends on `SheetsTransport`, not a concrete Google API call.
- Tests run with `npx vitest run src/domain/__tests__/syncTransport.test.ts`.

## EO-P13-T02: Google Sheets Schema Mappers And Row Validators

**Estimate:** 1 day / 3 SP

**Files:**

- Create: `frontend/src/domain/sheetsSchema.ts`
- Create: `frontend/src/domain/__tests__/sheetsSchema.test.ts`
- Modify: `frontend/src/domain/index.ts`

**Implementation Plan:**

- [ ] Define sheet names:

```ts
export type SheetName = 'students' | 'vendors' | 'menus' | 'transactions' | 'daily_settlements' | 'sync_events';
```

- [ ] Define stable column arrays for:
  - `students`: student fields from the student spec; this is the PDF student master sheet.
  - `vendors`: vendor fields from the menu/vendor spec.
  - `menus`: today's menu plus catalog fields needed by Phase 1.0 and 1.3.
  - `transactions`: the Phase 1.2 transaction schema; this is the PDF transaction ledger sheet.
  - `daily_settlements`: the Phase 1.2 settlement schema plus `settlement_id`; this is the PDF daily settlement summary sheet.
  - `sync_events`: event fields from the sync spec.
- [ ] Implement `mapStudentToSheetRow(student)`.
- [ ] Implement `mapVendorToSheetRow(vendor)`.
- [ ] Implement `mapMenuToSheetRow(menu)`.
- [ ] Implement `mapTransactionToSheetRow(transaction)`.
- [ ] Implement `mapSettlementToSheetRow(settlement)`.
- [ ] Implement `mapSyncEventToSheetRow(event)`.
- [ ] Implement reverse parsers for restore:
  - `parseStudentSheetRow(row)`
  - `parseVendorSheetRow(row)`
  - `parseMenuSheetRow(row)`
  - `parseTransactionSheetRow(row)`
  - `parseSettlementSheetRow(row)`
  - `parseSyncEventSheetRow(row)`
- [ ] Implement `validateSheetRow(sheetName, row)` with required field checks, numeric field checks, date string checks, status enum checks, and revision checks.
- [ ] Preserve Traditional Chinese text fields without normalization that changes display values.
- [ ] Export functions/constants from `frontend/src/domain/index.ts`.

**Testing Strategy:**

- Unit:
  - each sheet mapper emits columns in exact schema order.
  - missing required ids fail validation.
  - numeric fields reject non-numeric strings.
  - invalid enum statuses fail validation.
  - Traditional Chinese names round-trip unchanged.
  - settlement parser preserves `settlement_id`, revision, close/reopen fields, and sync status.
  - transaction parser preserves snapshot fields and void metadata.

**Acceptance Criteria:**

- All Google Sheets rows are flat serializable objects.
- Restore and migration use the same parser/validator path as sync writes.
- Tests run with `npx vitest run src/domain/__tests__/sheetsSchema.test.ts`.

## EO-P13-T03: Durable Queue Model, Idempotency Keys, And Persistence Migration

**Estimate:** 1.25 days / 5 SP

**Files:**

- Create: `frontend/src/domain/syncQueue.ts`
- Create: `frontend/src/domain/__tests__/syncQueue.test.ts`
- Modify: `frontend/src/store/posStore.ts`
- Create: `frontend/src/store/__tests__/syncQueueStore.test.ts`
- Modify: `frontend/src/domain/index.ts`

**Implementation Plan:**

- [ ] Define queue types:

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
```

- [ ] Implement `createIdempotencyKey(entity, entityId, revision, operation)`:
  - transactions use `transaction:${transactionId}:rev:${revision}`.
  - settlements use `settlement:${settlementId}:rev:${revision}`.
  - sync events use `sync_event:${eventId}`.
  - mutable master data uses `entity:${entityId}:rev:${revision}`.
- [ ] Implement `createSyncQueueEntry(args)`.
- [ ] Implement `sortQueueByDependencies(entries)` with this order:
  - student/vendor/menu before transactions.
  - transactions before settlements for the same business date.
  - sync events after the entity row they describe.
- [ ] Implement `markQueueEntryRetrying`, `markQueueEntrySynced`, `markQueueEntryFailed`, and `markQueueEntryConflict`.
- [ ] Implement `getEligibleQueueEntries(entries, now)` returning queued entries with satisfied dependencies and retrying entries whose `nextRetryAt` has passed.
- [ ] Implement `calculateBackoffDelayMs(attemptCount)` with deterministic capped exponential backoff:
  - attempt 0: `0`
  - attempt 1: `5_000`
  - attempt 2: `30_000`
  - attempt 3: `120_000`
  - attempt 4 and above: `300_000`
- [ ] Extend Zustand state:

```ts
interface PosState {
  syncQueue: SyncQueueEntry[];
  enqueueSyncEntry: (entry: SyncQueueEntry) => void;
  updateSyncQueueEntry: (queueId: string, updates: Partial<SyncQueueEntry>) => void;
  clearSyncedQueueEntries: () => void;
}
```

- [ ] Add persistence migration:
  - missing `syncQueue` hydrates as `[]`.
  - existing rows without sync status hydrate as `local` or `queued` according to Phase 1.2 data.
  - no queued entry is dropped during migration.

**Testing Strategy:**

- Unit:
  - idempotency keys stay stable across repeated calls.
  - dependency sort puts master data before dependent rows.
  - settlement waits for same-date transaction dependencies.
  - retrying row becomes eligible only after `nextRetryAt`.
  - backoff values match the fixed schedule.
- Store:
  - queue persists and hydrates through Zustand storage.
  - legacy state hydrates with empty queue.
  - enqueue does not create duplicate idempotency keys.

**Acceptance Criteria:**

- Queue survives refresh and browser restart through persisted store state.
- Queue identity never depends on spreadsheet row number or array index.
- Tests run with `npx vitest run src/domain/__tests__/syncQueue.test.ts src/store/__tests__/syncQueueStore.test.ts`.

## EO-P13-T04: Sync Worker Lifecycle, Dependency Ordering, And Fake Adapter

**Estimate:** 1.25 days / 5 SP

**Files:**

- Create: `frontend/src/domain/syncWorker.ts`
- Create: `frontend/src/domain/__tests__/syncWorker.test.ts`
- Create: `frontend/src/services/sheets/fakeSheetsTransport.ts`
- Create: `frontend/src/services/sheets/__tests__/fakeSheetsTransport.test.ts`
- Modify: `frontend/src/domain/index.ts`

**Implementation Plan:**

- [ ] Define worker result types:

```ts
import type { SyncQueueEntry } from './syncQueue';

export interface SyncWorkerCycleInput {
  entries: SyncQueueEntry[];
  now: string;
  maxBatchSize: number;
}

export interface SyncWorkerCycleResult {
  updatedEntries: SyncQueueEntry[];
  syncedCount: number;
  queuedCount: number;
  failedCount: number;
  conflictCount: number;
  attemptedQueueIds: string[];
}
```

- [ ] Implement `runSyncWorkerCycle(input, transport)`:
  - calls `transport.healthCheck()` first.
  - if health fails, leaves entries queued and returns zero attempted ids.
  - selects eligible entries from EO-P13-T03.
  - marks selected entries retrying before transport write.
  - calls `transport.batchWrite()` with at most `maxBatchSize`.
  - maps transient results back to queued/retrying with backoff.
  - maps validation/auth/schema results to failed.
  - maps conflict results to conflict.
  - maps ok results to synced and stores remote revision metadata.
- [ ] Implement `fakeSheetsTransport` with in-memory tables:
  - `healthCheck` can be configured to pass or fail.
  - `batchWrite` stores rows by idempotency key.
  - duplicate idempotency key returns the prior successful remote revision.
  - configured errors can produce transient, validation, auth, schema, and conflict responses.
  - `readSnapshot` returns current in-memory rows.
- [ ] Ensure worker never mutates committed domain rows back to uncommitted state.
- [ ] Export worker helpers from `frontend/src/domain/index.ts`.

**Testing Strategy:**

- Unit:
  - health failure leaves entries queued.
  - successful write marks rows synced.
  - unknown duplicate retry with same idempotency key does not duplicate remote row.
  - transient failure schedules retry.
  - validation/auth/schema failure marks failed and stops automatic retry.
  - conflict response marks conflict.
  - max batch size limits attempted entries.
  - dependency ordering is respected across a mixed batch.
- Service:
  - fake adapter stores and reads snapshot rows.
  - fake adapter returns deterministic remote revisions.

**Acceptance Criteria:**

- Sync worker is testable without real Google Sheets.
- Retry and idempotency behavior is covered before Apps Script integration.
- Tests run with `npx vitest run src/domain/__tests__/syncWorker.test.ts src/services/sheets/__tests__/fakeSheetsTransport.test.ts`.

## EO-P13-T05: Apps Script Pilot Adapter And Script Source

**Estimate:** 1.25 days / 5 SP

**Files:**

- Create: `frontend/src/services/sheets/appsScriptTransport.ts`
- Create: `frontend/src/services/sheets/__tests__/appsScriptTransport.test.ts`
- Create: `frontend/src/config/syncConfig.ts`
- Create: `integrations/google-sheets/apps-script/Code.gs`
- Create: `integrations/google-sheets/apps-script/README.md`

**Implementation Plan:**

- [ ] Implement `loadSyncConfigFromEnv()`:

```ts
export interface RuntimeSyncConfig {
  transportName: 'fake' | 'apps_script';
  endpointUrl: string;
  spreadsheetId: string;
  environmentLabel: string;
  operatorId: string;
}
```

- [ ] Read only non-secret values from Vite env:
  - `VITE_EASYORDER_SYNC_TRANSPORT`
  - `VITE_EASYORDER_SYNC_ENDPOINT`
  - `VITE_EASYORDER_SPREADSHEET_ID`
  - `VITE_EASYORDER_ENVIRONMENT_LABEL`
- [ ] Implement `createAppsScriptTransport(config)` with:
  - `healthCheck()` posting `{ action: 'health', spreadsheetId }`.
  - `batchWrite(entries)` posting `{ action: 'batchWrite', spreadsheetId, entries }`.
  - `readSnapshot()` posting `{ action: 'readSnapshot', spreadsheetId }`.
  - request timeout using `AbortController`.
  - mapping HTTP/network failures to transient errors.
  - mapping Apps Script response codes to `validation`, `auth`, `schema`, or `conflict`.
- [ ] Implement `integrations/google-sheets/apps-script/Code.gs` with:
  - `doPost(e)` JSON parsing.
  - action routing for `health`, `batchWrite`, and `readSnapshot`.
  - spreadsheet lookup by `spreadsheetId`.
  - required sheet creation/validation for schema names.
  - append or upsert behavior by idempotency key/entity identity.
  - duplicate idempotency key returning the existing remote revision.
  - JSON response format compatible with `RemoteWriteResult`.
- [ ] Add `integrations/google-sheets/apps-script/README.md` with:
  - deployment steps.
  - recommended access setting: domain-restricted where available.
  - endpoint URL copied into local environment config.
  - no service account key or OAuth token in frontend.
  - pilot rollback: switch `VITE_EASYORDER_SYNC_TRANSPORT=fake`.
- [ ] Unit-test `appsScriptTransport` by mocking `fetch`; do not call a real Apps Script endpoint in automated tests.

**Testing Strategy:**

- Unit:
  - health request sends expected payload.
  - batch write request sends queue entries unchanged.
  - timeout maps to transient failure.
  - 401/403-style response maps to auth failure.
  - schema response maps to schema failure.
  - conflict response maps to conflict status.
  - env config rejects missing endpoint when transport is Apps Script.
- Manual pilot:
  - deploy Apps Script to a pilot spreadsheet.
  - configure env values locally.
  - write one student, one transaction, one settlement, and one sync event.
  - retry the same batch and confirm no duplicate rows.

**Acceptance Criteria:**

- Apps Script adapter is behind the same `SheetsTransport` interface as fake transport.
- Automated tests do not require network access or Google credentials.
- Pilot instructions are present without committing secrets.
- Tests run with `npx vitest run src/services/sheets/__tests__/appsScriptTransport.test.ts`.

## EO-P13-T06: Online/Offline Health And Automatic Reconnect Flush

**Estimate:** 0.75 day / 2 SP

**Files:**

- Create: `frontend/src/domain/syncHealth.ts`
- Create: `frontend/src/domain/__tests__/syncHealth.test.ts`
- Create: `frontend/src/hooks/useSyncWorker.ts`
- Create: `frontend/src/__tests__/syncHealth.integration.test.tsx`
- Modify: `frontend/src/App.tsx`

**Implementation Plan:**

- [ ] Define health summary:

```ts
export interface SyncHealthSummary {
  online: boolean;
  remoteAvailable: boolean;
  syncing: boolean;
  queuedCount: number;
  failedCount: number;
  conflictCount: number;
  lastSuccessfulSyncAt?: string;
  lastHealthCheckAt?: string;
  message: string;
}
```

- [ ] Implement `buildSyncHealthSummary(args)` combining:
  - browser online flag.
  - remote health check result.
  - queue counts.
  - worker in-flight flag.
  - last successful sync timestamp.
- [ ] Implement `shouldAutoFlushOnReconnect(previous, next)`:
  - true when browser or remote transitions from unavailable to available and queued count is greater than zero.
  - false when failed or conflict counts are the only pending work.
- [ ] Implement `useSyncWorker`:
  - subscribes to browser `online` and `offline` events.
  - runs remote health check at app startup.
  - starts worker cycle after successful health check when queued entries exist.
  - exposes manual flush action for admin/report UI.
  - prevents overlapping worker cycles.
- [ ] Replace fake `online`, `syncing`, and `lastSync` state in `App.tsx` with `SyncHealthSummary`.

**Testing Strategy:**

- Unit:
  - `navigator.onLine` true with failed health check reports remote unavailable.
  - queued rows show queued count.
  - failed/conflict rows show repair counts.
  - reconnect with queued rows triggers auto flush.
  - reconnect with only failed/conflict rows does not auto flush.
- Integration:
  - offline browser event changes top bar state.
  - online event plus successful health check triggers worker once.
  - manual flush reports per-row success/failure counts.

**Acceptance Criteria:**

- `navigator.onLine` alone is never treated as authoritative remote health.
- Reconnection automatically flushes queued rows when remote health succeeds.
- Tests run with `npx vitest run src/domain/__tests__/syncHealth.test.ts src/__tests__/syncHealth.integration.test.tsx`.

## EO-P13-T07: Conflict Detection And Repair Policy

**Estimate:** 1 day / 3 SP

**Files:**

- Create: `frontend/src/domain/syncConflict.ts`
- Create: `frontend/src/domain/__tests__/syncConflict.test.ts`
- Modify: `frontend/src/domain/index.ts`

**Implementation Plan:**

- [ ] Define conflict types:

```ts
export type ConflictEntity = 'student' | 'vendor' | 'menu' | 'transaction' | 'settlement';
export type ConflictResolutionStrategy = 'server_wins' | 'last_write_wins' | 'manual_resolve';

export interface SyncConflictRecord {
  conflictId: string;
  entity: ConflictEntity;
  entityId: string;
  businessDate?: string;
  localRevision: number;
  remoteRevision: number;
  localRow: Record<string, unknown>;
  remoteRow: Record<string, unknown>;
  detectedAt: string;
  status: 'open' | 'resolved';
  resolutionReason?: string;
}
```

- [ ] Implement `classifyConflict(record)`:
  - student/vendor/menu conflicts may offer `server_wins` and `last_write_wins`.
  - transaction and settlement conflicts require `manual_resolve`.
  - any conflict affecting cash, balance, or close status requires `manual_resolve`.
- [ ] Implement `resolveMutableConflict(record, strategy, reason)`:
  - `server_wins` replaces local mutable row with remote version.
  - `last_write_wins` compares updated timestamp or revision and picks the newer mutable row.
  - both require an audit event and dependent unsynced ledger rows revalidation.
- [ ] Implement `buildManualResolutionGuidance(record)` for transaction and settlement conflicts:
  - shows local row.
  - shows remote row.
  - shows cash/balance/close impact.
  - requires explicit reason.
  - returns next action as correction, void/replacement, or new settlement revision.
- [ ] Ensure destructive overwrite is never returned for transactions or settlements.

**Testing Strategy:**

- Unit:
  - student conflict offers server-wins and last-write-wins.
  - vendor/menu conflict offers mutable strategies.
  - transaction conflict requires manual resolve.
  - settlement conflict requires manual resolve.
  - cash-impacting mutable conflict is escalated to manual resolve.
  - last-write-wins is rejected for append-only rows.
  - manual guidance includes local, remote, impact, and reason requirement.

**Acceptance Criteria:**

- Conflict strategy matches the sync spec by entity class.
- Append-only accounting data is never silently overwritten.
- Tests run with `npx vitest run src/domain/__tests__/syncConflict.test.ts`.

## EO-P13-T08: Restore Preview And Apply Flow

**Estimate:** 1 day / 3 SP

**Files:**

- Create: `frontend/src/domain/syncRestore.ts`
- Create: `frontend/src/domain/__tests__/syncRestore.test.ts`
- Modify: `frontend/src/store/posStore.ts`
- Modify: `frontend/src/domain/index.ts`

**Implementation Plan:**

- [ ] Define restore types:

```ts
export type LocalOnlyRowsDecision = 'keep' | 'export' | 'discard';

export interface RestorePreview {
  remoteStudentCount: number;
  remoteVendorCount: number;
  remoteMenuCount: number;
  remoteTransactionCount: number;
  remoteSettlementCount: number;
  conflictCount: number;
  localOnlyRowCount: number;
  invalidRemoteRows: Array<{ sheet: string; rowIndex: number; message: string }>;
  canApply: boolean;
}
```

- [ ] Implement `buildRestorePreview(localState, remoteSnapshot)`:
  - parses remote rows through EO-P13-T02 validators.
  - counts students, vendors, menus, transactions, settlements, conflicts, local-only rows, and invalid rows.
  - sets `canApply` false when invalid remote rows exist.
- [ ] Implement `applyRestore(localState, remoteSnapshot, decision)`:
  - requires `canApply === true`.
  - requires local-only row decision.
  - rebuilds student balances from ledger rows.
  - rebuilds business-date close statuses from settlement rows.
  - preserves exported local-only rows only when decision is `export`.
  - creates restore audit event.
- [ ] Add store action `previewRestoreFromSnapshot(snapshot)` and `applyRestoreFromSnapshot(snapshot, decision, operatorId)`.

**Testing Strategy:**

- Unit:
  - valid snapshot preview counts all remote row types.
  - invalid remote row blocks apply.
  - local-only rows require explicit keep/export/discard decision.
  - apply rebuilds student balances from ledger rows.
  - apply rebuilds close status from latest settlement revision.
  - restore creates audit event.

**Acceptance Criteria:**

- Restore never overwrites local state without preview counts and local-only decision.
- Restored balances derive from ledger, not remote `current_balance` alone.
- Tests run with `npx vitest run src/domain/__tests__/syncRestore.test.ts`.

## EO-P13-T09: Old Sheet Migration Preview And Commit Flow

**Estimate:** 1 day / 3 SP

**Files:**

- Create: `frontend/src/domain/syncMigration.ts`
- Create: `frontend/src/domain/__tests__/syncMigration.test.ts`
- Modify: `frontend/src/store/posStore.ts`
- Modify: `frontend/src/domain/index.ts`

**Implementation Plan:**

- [ ] Define migration types:

```ts
export interface LegacySheetRow {
  rowIndex: number;
  values: Record<string, unknown>;
}

export interface MigrationPreview {
  migrationBatchId: string;
  validStudentCount: number;
  validTransactionCount: number;
  validSettlementCount: number;
  invalidRows: Array<{ rowIndex: number; field: string; message: string }>;
  canCommit: boolean;
}
```

- [ ] Implement `inferLegacyRowType(row)` returning `student`, `transaction`, `settlement`, or `unknown`.
- [ ] Implement `mapLegacyStudentRow(row)`.
- [ ] Implement `mapLegacyTransactionRow(row)`.
- [ ] Implement `mapLegacySettlementRow(row)`.
- [ ] Implement `buildMigrationPreview(rows, migrationBatchId)`:
  - maps rows into target schemas.
  - lists invalid rows with row number and field.
  - sets `canCommit` false when invalid rows exist.
- [ ] Implement `commitMigrationPreview(preview, operatorId)`:
  - creates queue entries with operation `migrate`.
  - attaches `migrationBatchId` to sync events.
  - creates migration audit event.
  - refuses commit when `canCommit` is false.
- [ ] Add store action `previewLegacySheetMigration(rows)` and `commitLegacySheetMigration(preview, operatorId)`.

**Testing Strategy:**

- Unit:
  - valid legacy student row maps to target student schema.
  - valid legacy transaction row maps to target transaction schema with snapshots.
  - valid legacy settlement row maps to target settlement schema.
  - unknown row type is listed as invalid.
  - invalid rows block commit.
  - commit emits queue entries with migration batch id.
  - commit emits audit event.

**Acceptance Criteria:**

- Migration is preview-confirm and never writes before clean preview.
- Invalid rows are visible with row index and field.
- Tests run with `npx vitest run src/domain/__tests__/syncMigration.test.ts`.

## EO-P13-T10: Sync UI Integration And Repair Surfaces

**Estimate:** 1 day / 3 SP

**Files:**

- Create: `frontend/src/components/sync/TopBarSyncStatus.tsx`
- Create: `frontend/src/components/sync/SyncAdminPanel.tsx`
- Create: `frontend/src/components/sync/RestorePanel.tsx`
- Create: `frontend/src/components/sync/MigrationPanel.tsx`
- Create: `frontend/src/components/sync/ConflictRepairPanel.tsx`
- Create: `frontend/src/__tests__/syncUi.integration.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/screens.tsx`
- Modify: `frontend/src/index.css`

**Implementation Plan:**

- [ ] Replace existing fake top-bar sync copy with `TopBarSyncStatus`.
- [ ] Show online, syncing, offline, queued count, failed count, conflict count, and last successful sync time.
- [ ] Add manual "push to cloud" action that calls `useSyncWorker.flushNow()`.
- [ ] Add `SyncAdminPanel` under admin tools:
  - transport name.
  - endpoint configured or missing.
  - health status.
  - queue counts.
  - manual flush result.
- [ ] Add `ConflictRepairPanel`:
  - list failed and conflict rows.
  - show error message and entity id.
  - expose server-wins/last-write-wins only for allowed mutable conflicts.
  - expose manual-resolution guidance for transactions and settlements.
- [ ] Add `RestorePanel`:
  - calls `transport.readSnapshot()`.
  - shows preview counts.
  - requires local-only row decision before apply.
- [ ] Add `MigrationPanel`:
  - accepts pasted or uploaded legacy rows parsed by an implementation-local parser.
  - shows preview counts and invalid rows.
  - commits only clean previews.
- [ ] Update `ReportScreen` close panel to consume `getCloseBlockingSyncSummary`:
  - failed/conflict rows block close.
  - queued rows require explicit settlement queued confirmation.

**Testing Strategy:**

- Integration:
  - top bar shows offline and queued counts.
  - online health plus queued rows shows syncing state during flush.
  - manual flush shows success/failure counts.
  - failed/conflict row appears in repair panel.
  - transaction conflict does not offer server-wins.
  - restore preview blocks apply when invalid rows exist.
  - migration preview blocks commit when invalid rows exist.
  - report close blocks failed/conflict rows and allows queued rows only after confirmation.

**Acceptance Criteria:**

- Sync status is visible without interrupting POS service.
- Failed and conflict states are actionable from admin/report surfaces.
- Restore and migration are preview-confirm flows.
- Tests run with `npx vitest run src/__tests__/syncUi.integration.test.tsx`.

## EO-P13-T11: Phase Verification And Pilot Gate

**Estimate:** 0.75 day / 2 SP

**Files:**

- Create: `frontend/src/__tests__/syncWorker.integration.test.tsx`
- Create: `docs/sync/google-sheets-pilot-checklist.md`
- Modify: `docs/superpowers/plans/2026-05-14-phase-1-3-google-sheets-sync-offline.md` only if implementation discoveries require scope clarification before review.

**Implementation Plan:**

- [ ] Run focused domain and service tests from `frontend/`:

```bash
npx vitest run src/domain/__tests__/syncTransport.test.ts src/domain/__tests__/sheetsSchema.test.ts src/domain/__tests__/syncQueue.test.ts src/domain/__tests__/syncWorker.test.ts src/domain/__tests__/syncHealth.test.ts src/domain/__tests__/syncConflict.test.ts src/domain/__tests__/syncRestore.test.ts src/domain/__tests__/syncMigration.test.ts src/services/sheets/__tests__/fakeSheetsTransport.test.ts src/services/sheets/__tests__/appsScriptTransport.test.ts
```

- [ ] Run focused store/UI integration tests from `frontend/`:

```bash
npx vitest run src/store/__tests__/syncQueueStore.test.ts src/__tests__/syncHealth.integration.test.tsx src/__tests__/syncUi.integration.test.tsx src/__tests__/syncWorker.integration.test.tsx
```

- [ ] Run the global verification gate from `frontend/`:

```bash
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```

- [ ] Create `docs/sync/google-sheets-pilot-checklist.md` with these manual pilot checks:
  - Apps Script health check succeeds.
  - app starts offline and POS service continues.
  - order committed offline is queued and survives browser refresh.
  - reconnect auto-flush syncs queued order.
  - retrying the same idempotency key does not duplicate remote transaction row.
  - failed validation row appears in admin repair panel.
  - conflict row appears in conflict repair panel.
  - daily settlement waits for same-date transaction dependencies.
  - restore preview shows counts before apply.
  - migration preview lists invalid rows and blocks commit.
- [ ] Commit Phase 1.3 implementation with a message that identifies Sheets sync/offline:

```bash
git add frontend/src/domain frontend/src/services frontend/src/store frontend/src/hooks frontend/src/components frontend/src/App.tsx frontend/src/index.css frontend/src/__tests__ integrations/google-sheets docs/sync
git commit -m "feat: add sheets sync and offline queue"
```

**Acceptance Criteria:**

- Global verification gate passes from `frontend/`.
- Fake adapter tests prove queue, retry, idempotency, conflict, restore, and migration behavior without network.
- Apps Script pilot checklist exists and can be run without committing secrets.
- No Phase 2 biometric implementation is added.

## Testing Matrix

| Behavior | Unit Test | Integration Test | Manual Pilot |
|---|---|---|---|
| Transport config and matrix decision | `syncTransport.test.ts` | no | review decision doc |
| Sheet schema mapping | `sheetsSchema.test.ts` | restore/migration tests | pilot sheet inspection |
| Durable queue persistence | `syncQueue.test.ts` | `syncQueueStore.test.ts` | refresh with queued rows |
| Idempotency | `syncQueue.test.ts`, `fakeSheetsTransport.test.ts` | `syncWorker.integration.test.tsx` | retry same Apps Script batch |
| Dependency ordering | `syncQueue.test.ts`, `syncWorker.test.ts` | `syncWorker.integration.test.tsx` | settlement after transactions |
| Retry/backoff | `syncQueue.test.ts`, `syncWorker.test.ts` | `syncWorker.integration.test.tsx` | transient Apps Script failure |
| Online/offline health | `syncHealth.test.ts` | `syncHealth.integration.test.tsx` | disconnect/reconnect |
| Conflict policy | `syncConflict.test.ts` | `syncUi.integration.test.tsx` | conflict repair panel |
| Restore preview/apply | `syncRestore.test.ts` | `syncUi.integration.test.tsx` | remote snapshot restore |
| Migration preview/commit | `syncMigration.test.ts` | `syncUi.integration.test.tsx` | legacy sheet import |
| Close policy sync boundary | `ledgerSyncBoundary.test.ts`, `syncWorker.test.ts` | report close integration from Phase 1.2 plus sync UI tests | close with queued/failed rows |

## Phase Done Criteria

- Transport decision record exists and includes Apps Script vs backend proxy vs direct Google API trade-off matrix.
- `SheetsTransport` contract exists and fake plus Apps Script adapters implement it.
- No frontend bundle contains service account keys, privileged tokens, OAuth client secrets, or Apps Script OAuth tokens.
- Google Sheets row mappers cover students, vendors, menus, transactions, daily settlements, and sync events.
- PDF-required Sheets are explicitly mapped as `students`, `transactions`, and `daily_settlements`; supporting tabs remain subordinate to those three accounting surfaces.
- Durable queue survives refresh/browser restart and stores idempotency keys, dependencies, attempts, status, and remote metadata.
- Sync worker handles queued, retrying, synced, failed, and conflict states.
- Dependency order is enforced: master data before transactions, transactions before settlements, sync events after their entity.
- Online/offline detection combines browser events with remote health check.
- Reconnection auto-flushes queued rows when remote health succeeds.
- Failed/conflict states are visible and repairable from admin/report surfaces.
- Restore preview/apply rebuilds balances from ledger rows and close statuses from settlements.
- Migration preview/commit uses migration batch id and blocks invalid rows.
- Full gate passes from `frontend/`: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build`.

## Out Of Scope For Phase 1.3

- Backend proxy implementation; the plan records when it becomes required but does not build it in Phase 1.3.
- Direct Google API write transport from browser.
- Google Cloud project provisioning, billing setup, or organization credential policy.
- Long-term database replacement beyond Google Sheets.
- iPad camera, face recognition, enrollment UI, or biometric model/profile sync beyond existing student metadata fields.
- Payment provider settlement.
