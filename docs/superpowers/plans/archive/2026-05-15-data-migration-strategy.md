# 資料遷移策略實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 EasyOrder 能從目前純前端 localStorage/Zustand prototype，無痛遷移到 IndexedDB local-first，再遷移到 local + cloud sync，同時保留歷史帳務、避免多裝置衝突造成重複交易，並支援 CSV/JSON 備份匯入匯出。

**Architecture:** 採用 staged migration：先把目前 `pos-storage` 轉成可驗證的 migration source，再建立 IndexedDB schema/versioning，最後導入 cloud sync 與多裝置 merge/conflict policy。Zustand 保持 UI facade；IndexedDB 與 sync queue 成為 durable source of truth。

**Tech Stack:** Vite 8, React 19, TypeScript 6, Zustand 5 persist middleware, IndexedDB, localStorage migration source, JSON/CSV import-export, Vitest 4, future Cloudflare Worker + D1 或 Google Sheets sync transport, append-only ledger migration model.

---

## 已讀資料與現況

- 派發指定的 `/Users/cheerc/talented-easyorder/docs/superpowers/specs/talented-easyorder-spec.pdf` 目前不存在。
- 已改讀實際存在的 `docs/iPad人臉辨識訂餐系統設計方案_V3.pdf`。
- 已讀 `docs/superpowers/specs/2026-05-14-google-sheets-sync-offline-spec.md`。
- 已讀 `docs/superpowers/specs/2026-05-14-order-ledger-cash-close-spec.md`。
- 已讀 `docs/superpowers/plans/2026-05-15-pwa-offline-first-strategy.md`。
- 已讀 `docs/superpowers/plans/2026-05-15-error-handling-recovery-strategy.md`。
- 已讀 `docs/superpowers/plans/2026-05-15-cross-platform-android-support.md`。
- 已檢查 `frontend/src/store/posStore.ts`、`frontend/src/store/__tests__/posStore.test.ts`、`frontend/src/mocks/initialData.ts`、`frontend/src/domain/ledger.ts`、`frontend/src/domain/syncStatus.ts`。

## 官方參考來源

- MDN IndexedDB API: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- MDN Using IndexedDB: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB
- MDN Storage quotas and eviction criteria: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- Zustand persist middleware: https://zustand.site/en/docs/persist/

## Current State

1. `usePosStore` 使用 Zustand `persist` 寫入 localStorage key `pos-storage`。
2. `persist` version 目前是 `1`。
3. `migrate` 已能把舊 shape `{ id, name, balance }` student、old transaction、old vendor、old menu 正規化到現有 domain shape。
4. 目前 localStorage 是唯一 durable store；沒有 IndexedDB。
5. 目前 ledger row 有 `transactionId`、`businessDate`、`syncStatus`、`revision`，但沒有 `idempotencyKey`、remote metadata、install/device metadata。
6. 目前 transaction correction 還能 destructive edit/delete；正式 migration 前必須先轉成 append-only correction/void policy。
7. `BackupScreen` 有匯出/匯入 UI 示意，但沒有 route、沒有真實 JSON/CSV schema，且文案提到 SQLite，不符合目前架構。
8. 多 iPad/Android 同時記帳還沒有 cloud sync/conflict gate；不能靠純 local-first 啟用多裝置 production。

## Migration Principles

- Migration never destroys source data before a verified receipt is written.
- Ledger and settlements are append-only after production mode starts.
- Student/menu/vendor mutable records can merge; transactions, voids, corrections, settlements require explicit conflict handling.
- Zustand state is cache/UI state, not the final accounting authority.
- Every migration batch has `migrationBatchId`, `source`, counts, invalid rows, operator id placeholder, created time, and result.
- Import preview always runs before write.
- Cloud sync migration starts with one primary device unless conflict handling is already verified.
- Zero-downtime means the operator can keep using the local app while the new schema is prepared, but not that unsafe background rewriting is allowed during an active transaction.

## Migration Stages

| Stage | Source | Target | Gate |
|---|---|---|---|
| M0 | Current localStorage `pos-storage` | Validated localStorage v1 | State validator, corrupt backup, compatibility tests. |
| M1 | localStorage v1 | IndexedDB v1 | One-time local migration receipt, row counts, balance recalculation. |
| M2 | IndexedDB v1 | IndexedDB v2+ schema upgrades | Versioned upgrade functions and rollback-safe receipts. |
| M3 | IndexedDB local-only | IndexedDB + sync queue + cloud mirror | Idempotency keys, queue, receipts, remote health. |
| M4 | Single device cloud sync | Multi-device cloud sync | Device/install ids, conflict policy, manual resolve UI. |
| M5 | Old Google Forms/Sheets/CSV | Structured domain rows | Import preview, invalid-row repair, migration batch audit. |

## Target IndexedDB Schema

Database name: `easyorder-pos`

Stores:

- `app_meta`: schema version, app version, install id, device label, last migration, last successful sync.
- `students`: `studentId`, status, revision, remote metadata.
- `vendors`: `vendorId`, status, revision, remote metadata.
- `menus`: `businessDate` or `menuId`, vendor reference, revision.
- `transactions`: append-only ledger rows with `transactionId`, `businessDate`, `idempotencyKey`, `syncStatus`.
- `daily_settlements`: closeout and settlement revisions.
- `sync_queue`: durable outbound operations.
- `sync_events`: migration, sync, restore, conflict, repair audit events.
- `migration_batches`: one row per migration/import/export/restore operation.
- `outbox_receipts`: accepted idempotency keys and remote revisions.
- `import_previews`: temporary preview output before confirm.

## Versioning Policy

```ts
export const EASYORDER_DB_NAME = 'easyorder-pos';
export const EASYORDER_DB_VERSION = 1;

export interface SchemaMigration {
  fromVersion: number;
  toVersion: number;
  description: string;
  apply(db: IDBDatabase, tx: IDBTransaction): void;
}
```

Rules:

- Every IndexedDB upgrade is one explicit `SchemaMigration`.
- Upgrade functions may create stores/indexes and write metadata, but must not silently delete accounting rows.
- Destructive cleanup requires a separate admin-confirmed migration batch.
- Store/index names are append-only where possible; rename means create new store, copy, verify counts, then mark old store archived.
- `app_meta.schemaVersion` and IndexedDB version must agree after upgrade.
- If upgrade fails, app enters recovery mode and does not show POS ready.

## Zustand Migration Policy

Current `persist` migration remains useful only as a bootstrap source.

Rules:

- Keep `pos-storage` migrate function for legacy localStorage shapes.
- Add validation after migrate.
- Add `partialize` so future localStorage contains UI preferences only.
- Add explicit `storageVersion` and `sourceVersion` in migration receipts.
- After IndexedDB migration succeeds, write `app_meta.localStorageMigratedAt`.
- Do not delete `pos-storage` immediately; keep it as recoverable source until the operator confirms backup/export or a retention period passes.

Recommended target:

```ts
persist(
  createUiState,
  {
    name: 'easyorder-ui-preferences',
    version: 2,
    partialize: (state) => ({
      tweaks: state.tweaks,
      preferredTab: state.preferredTab,
    }),
    migrate: migrateUiPreferences,
  },
)
```

## Multi-Device Conflict Policy

### Device Identity

Each browser/install gets:

- `installId`: generated once in `app_meta`.
- `deviceId`: admin-visible logical device name, for example `counter-pc-1`, `ipad-front-1`, `android-tablet-1`.
- `deviceRole`: `pc_authority`, `ipad_handoff`, `android_pos`, `admin`.

### Conflict Rules

| Entity | Merge Policy |
|---|---|
| Student profile mutable fields | Manual preview with server-wins or last-write-wins when no accounting impact. |
| Student balance | Derived from ledger; never merge as a free mutable field. |
| Vendor/menu | Last-write-wins only before service starts; after first transaction use manual resolve. |
| Transaction | Append-only. Duplicate idempotency key means already synced; conflicting payload means manual resolve. |
| Correction/void | Append-only, reason required. |
| Settlement | Append-only revision; conflict requires reopen/revision flow. |
| Face profile metadata | Manual review if profile status differs; raw biometric data is out of scope. |

### Multi-iPad/Multi-Android Gate

Do not enable multiple devices to commit transactions for the same business date until:

- Cloud sync queue has idempotency and remote receipts.
- Conflict UI exists.
- Device ids are visible in report/admin.
- Closeout can detect unsynced/failed/conflict rows across devices.
- Operator SOP defines who owns final cash close.

Before this gate, additional iPad/Android devices may perform lookup/handoff only.

## History Retention And Cleanup

Default policy:

- Keep all transaction, correction, void, settlement, and sync audit rows indefinitely for the pilot.
- Allow export by date range before any cleanup.
- Archive old business dates to compressed JSON only after cloud sync and restore are verified.
- Never delete the only local copy of unsynced or failed rows.
- Student inactive records stay available for historical report snapshots.

Cleanup batch must record:

- `migrationBatchId`
- date range
- exported file hash
- row counts by store
- operator id placeholder
- created time
- result

## Export / Import Strategy

### JSON Backup

Use JSON as authoritative full backup/restore format.

```ts
export interface EasyOrderBackupV1 {
  format: 'easyorder-backup';
  version: 1;
  exportedAt: string;
  appVersion: string;
  installId: string;
  deviceId: string;
  stores: {
    app_meta: unknown[];
    students: unknown[];
    vendors: unknown[];
    menus: unknown[];
    transactions: unknown[];
    daily_settlements: unknown[];
    sync_queue: unknown[];
    sync_events: unknown[];
    outbox_receipts: unknown[];
  };
  checksum: string;
}
```

Rules:

- Export includes schema version and checksum.
- Import must preview before apply.
- Import into non-empty production store requires backup first.
- Import never overwrites append-only rows without mapping to restore batch and conflict preview.

### CSV Export

CSV is for accounting/reporting, not full restore.

Recommended CSV files:

- `students.csv`
- `transactions.csv`
- `daily_settlements.csv`
- `sync_failures.csv`

CSV import allowed only for controlled master data or legacy migration preview. Transaction CSV import must create migration batch rows and stable transaction ids.

## Zero-Downtime Upgrade Strategy

1. App starts with old code and localStorage v1.
2. New code deploys with migration readiness check.
3. On first launch, show `正在準備本機資料` blocking screen before POS ready.
4. Copy localStorage source to migration input snapshot.
5. Create/open IndexedDB.
6. Validate and write rows in one migration batch.
7. Recalculate balances from ledger and compare with stored balances.
8. Write migration receipt and backup pointer.
9. Hydrate Zustand from IndexedDB.
10. Show POS ready.

During active lunch service:

- Do not run large migration after a student is selected.
- If migration is required and not yet complete, POS stays unavailable until migration completes or admin chooses emergency old-mode rollback.
- If migration fails, preserve old localStorage and show recovery/export path.
- Service worker update prompt should defer reload until no active transaction and queue state is safe.

## Suggested Files

- Create: `frontend/src/storage/dbSchema.ts`
- Create: `frontend/src/storage/dbMigrations.ts`
- Create: `frontend/src/storage/easyOrderDb.ts`
- Create: `frontend/src/storage/localStorageMigration.ts`
- Create: `frontend/src/storage/migrationBatch.ts`
- Create: `frontend/src/storage/exportBackup.ts`
- Create: `frontend/src/storage/importPreview.ts`
- Create: `frontend/src/storage/csvExport.ts`
- Create: `frontend/src/storage/conflictPolicy.ts`
- Create: `frontend/src/storage/__tests__/*.test.ts`
- Modify: `frontend/src/store/posStore.ts`
- Modify: `frontend/src/store/__tests__/posStore.test.ts`
- Modify: `frontend/src/components/screens.tsx`
- Create: `docs/ops/data-migration-runbook.md`
- Create: `docs/ops/backup-restore-runbook.md`

## Task 1: Migration Types And Batch Records

**Files:**
- Create: `frontend/src/storage/migrationBatch.ts`
- Test: `frontend/src/storage/__tests__/migrationBatch.test.ts`

- [ ] **Step 1: 寫 migration batch 測試**

```ts
import { describe, expect, it } from 'vitest';
import { createMigrationBatch } from '../migrationBatch';

describe('createMigrationBatch', () => {
  it('creates an auditable migration batch', () => {
    const batch = createMigrationBatch({
      source: 'localStorage-pos-storage',
      target: 'indexeddb-v1',
      operatorId: 'operator-demo',
      counts: { students: 2, transactions: 3 },
    });

    expect(batch.migrationBatchId).toMatch(/^mig_/);
    expect(batch.status).toBe('previewed');
    expect(batch.counts.transactions).toBe(3);
  });
});
```

- [ ] **Step 2: 實作 migration batch**

```ts
export type MigrationSource =
  | 'localStorage-pos-storage'
  | 'indexeddb'
  | 'json-backup'
  | 'csv-import'
  | 'cloud-restore';

export type MigrationStatus = 'previewed' | 'running' | 'applied' | 'failed' | 'cancelled';

export interface MigrationBatch {
  migrationBatchId: string;
  source: MigrationSource;
  target: string;
  operatorId?: string;
  status: MigrationStatus;
  counts: Record<string, number>;
  invalidRows: number;
  createdAt: string;
  appliedAt?: string;
  errorMessage?: string;
}

export function createMigrationBatch(input: {
  source: MigrationSource;
  target: string;
  operatorId?: string;
  counts: Record<string, number>;
}): MigrationBatch {
  return {
    migrationBatchId: `mig_${crypto.randomUUID()}`,
    source: input.source,
    target: input.target,
    operatorId: input.operatorId,
    status: 'previewed',
    counts: input.counts,
    invalidRows: 0,
    createdAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 3: Commit**

```bash
cd frontend && npx vitest run src/storage/__tests__/migrationBatch.test.ts
git add frontend/src/storage/migrationBatch.ts frontend/src/storage/__tests__/migrationBatch.test.ts
git commit -m "test: add migration batch records"
```

## Task 2: IndexedDB Schema And Versioned Upgrades

**Files:**
- Create: `frontend/src/storage/dbSchema.ts`
- Create: `frontend/src/storage/dbMigrations.ts`
- Test: `frontend/src/storage/__tests__/dbMigrations.test.ts`

- [ ] **Step 1: 定義 schema constants**

```ts
export const EASYORDER_DB_NAME = 'easyorder-pos';
export const EASYORDER_DB_VERSION = 1;

export const stores = {
  appMeta: 'app_meta',
  students: 'students',
  vendors: 'vendors',
  menus: 'menus',
  transactions: 'transactions',
  dailySettlements: 'daily_settlements',
  syncQueue: 'sync_queue',
  syncEvents: 'sync_events',
  migrationBatches: 'migration_batches',
  outboxReceipts: 'outbox_receipts',
  importPreviews: 'import_previews',
} as const;
```

- [ ] **Step 2: 實作 v1 upgrade**

`dbMigrations.ts` 建立所有 stores 與必要 indexes：

- `transactions`: `businessDate`, `studentId`, `syncStatus`, `createdAt`, `idempotencyKey`
- `sync_queue`: `status`, `nextRetryAt`, `entity`, `idempotencyKey`, `businessDate`
- `daily_settlements`: `businessDate`, `status`, `syncStatus`
- `sync_events`: `entityType`, `entityId`, `businessDate`, `createdAt`

- [ ] **Step 3: 測試 migration list 連續**

測試 `fromVersion` / `toVersion` 沒有缺口，且 v1 包含所有 required store names。

- [ ] **Step 4: Commit**

```bash
cd frontend && npx vitest run src/storage/__tests__/dbMigrations.test.ts
git add frontend/src/storage/dbSchema.ts frontend/src/storage/dbMigrations.ts frontend/src/storage/__tests__/dbMigrations.test.ts
git commit -m "test: define IndexedDB migration schema"
```

## Task 3: Open Database Repository

**Files:**
- Create: `frontend/src/storage/easyOrderDb.ts`
- Test: `frontend/src/storage/__tests__/easyOrderDb.test.ts`

- [ ] **Step 1: 寫 open database 測試**

```ts
import { describe, expect, it } from 'vitest';
import { openEasyOrderDb } from '../easyOrderDb';

describe('openEasyOrderDb', () => {
  it('opens the database and exposes schema version', async () => {
    const db = await openEasyOrderDb();
    expect(db.name).toBe('easyorder-pos');
    expect(db.version).toBe(1);
    db.close();
  });
});
```

- [ ] **Step 2: 實作 `openEasyOrderDb`**

使用 native IndexedDB wrapper，處理 `onupgradeneeded`、`onsuccess`、`onerror`、`onblocked`。回傳 promise，錯誤轉成 typed error，不直接 `throw` raw DOMException 到 UI。

- [ ] **Step 3: Commit**

```bash
cd frontend && npx vitest run src/storage/__tests__/easyOrderDb.test.ts
git add frontend/src/storage/easyOrderDb.ts frontend/src/storage/__tests__/easyOrderDb.test.ts
git commit -m "feat: open EasyOrder IndexedDB repository"
```

## Task 4: localStorage `pos-storage` Migration Preview

**Files:**
- Create: `frontend/src/storage/localStorageMigration.ts`
- Test: `frontend/src/storage/__tests__/localStorageMigration.test.ts`
- Modify: `frontend/src/store/posStore.ts`

- [ ] **Step 1: Extract current migrate logic**

把 `posStore.ts` 內 old-shape normalization 抽到 pure functions：

- `normalizeLegacyStudents`
- `normalizeLegacyTransactions`
- `normalizeLegacyVendors`
- `normalizeLegacyTodayMenu`
- `previewLocalStorageMigration`

- [ ] **Step 2: 測試 preview**

Test with the existing old shape from `posStore.test.ts` and assert:

- 2 students previewed。
- menu date/name/price normalized。
- invalid rows counted without writing。
- source raw payload remains untouched。

- [ ] **Step 3: Wire store migrate to pure functions**

`posStore.ts` 的 `migrate` 呼叫 extracted functions，保持現有 compatibility test passing。

- [ ] **Step 4: Commit**

```bash
cd frontend && npx vitest run src/storage/__tests__/localStorageMigration.test.ts src/store/__tests__/posStore.test.ts
git add frontend/src/storage/localStorageMigration.ts frontend/src/storage/__tests__/localStorageMigration.test.ts frontend/src/store/posStore.ts frontend/src/store/__tests__/posStore.test.ts
git commit -m "refactor: extract localStorage migration preview"
```

## Task 5: localStorage To IndexedDB Apply

**Files:**
- Modify: `frontend/src/storage/localStorageMigration.ts`
- Modify: `frontend/src/storage/easyOrderDb.ts`
- Test: `frontend/src/storage/__tests__/localStorageMigration.test.ts`

- [ ] **Step 1: 實作 apply**

`applyLocalStorageMigration(db, preview)` must:

1. Write app meta install id if missing.
2. Write students, vendors, menu, transactions.
3. Recalculate balances from ledger.
4. Write migration batch row.
5. Write `app_meta.localStorageMigratedAt`.
6. Keep source `pos-storage` untouched.

- [ ] **Step 2: Idempotency**

If migration receipt already exists, return `{ status: 'already_applied' }` and do not duplicate rows.

- [ ] **Step 3: Commit**

```bash
cd frontend && npx vitest run src/storage/__tests__/localStorageMigration.test.ts
git add frontend/src/storage/localStorageMigration.ts frontend/src/storage/easyOrderDb.ts frontend/src/storage/__tests__/localStorageMigration.test.ts
git commit -m "feat: migrate POS storage into IndexedDB"
```

## Task 6: Zustand Hydration From IndexedDB

**Files:**
- Modify: `frontend/src/store/posStore.ts`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/store/__tests__/posStore.test.ts`

- [ ] **Step 1: Store API**

Add store actions:

- `hydrateFromRepository(snapshot)`
- `setRepositoryReady(status)`
- `setMigrationStatus(status)`

- [ ] **Step 2: App startup**

App startup:

1. Open IndexedDB.
2. Run localStorage migration if needed.
3. Load repository snapshot.
4. Hydrate Zustand.
5. Render POS only after repository ready.

- [ ] **Step 3: UI preferences**

Move future UI preferences out of `pos-storage` into `easyorder-ui-preferences` with `partialize` as described above.

- [ ] **Step 4: Commit**

```bash
cd frontend && npx vitest run src/store/__tests__/posStore.test.ts
git add frontend/src/store/posStore.ts frontend/src/App.tsx
git commit -m "feat: hydrate POS state from IndexedDB"
```

## Task 7: Sync Migration Metadata

**Files:**
- Create: `frontend/src/storage/syncMigration.ts`
- Create: `frontend/src/storage/conflictPolicy.ts`
- Test: `frontend/src/storage/__tests__/syncMigration.test.ts`

- [ ] **Step 1: Add idempotency keys**

For every local row that will sync, assign stable idempotency keys:

```ts
export function makeIdempotencyKey(input: {
  installId: string;
  entity: string;
  entityId: string;
  operation: string;
}): string {
  return `${input.installId}:${input.entity}:${input.entityId}:${input.operation}`;
}
```

- [ ] **Step 2: Queue local-only rows**

Rows without remote receipt become `queued`; rows with matching receipt become `synced`; rows with inconsistent remote metadata become `conflict`.

- [ ] **Step 3: Commit**

```bash
cd frontend && npx vitest run src/storage/__tests__/syncMigration.test.ts
git add frontend/src/storage/syncMigration.ts frontend/src/storage/conflictPolicy.ts frontend/src/storage/__tests__/syncMigration.test.ts
git commit -m "feat: prepare local data for cloud sync"
```

## Task 8: JSON Backup Export / Import Preview

**Files:**
- Create: `frontend/src/storage/exportBackup.ts`
- Create: `frontend/src/storage/importPreview.ts`
- Test: `frontend/src/storage/__tests__/backupImport.test.ts`
- Modify: `frontend/src/components/screens.tsx`

- [ ] **Step 1: Export full JSON backup**

Export all stores listed in `EasyOrderBackupV1`, with schema version, install id, device id, and checksum.

- [ ] **Step 2: Import preview**

Import preview validates:

- format/version。
- required stores。
- duplicate ids。
- invalid dates。
- transaction balance recalculation。
- local-only rows that would be overwritten。

- [ ] **Step 3: UI**

Backup screen becomes reachable from Admin and no longer mentions SQLite. It must say JSON backup is full restore, CSV is report/export.

- [ ] **Step 4: Commit**

```bash
cd frontend && npx vitest run src/storage/__tests__/backupImport.test.ts
git add frontend/src/storage/exportBackup.ts frontend/src/storage/importPreview.ts frontend/src/storage/__tests__/backupImport.test.ts frontend/src/components/screens.tsx
git commit -m "feat: add JSON backup import preview"
```

## Task 9: CSV Export And Controlled CSV Import

**Files:**
- Create: `frontend/src/storage/csvExport.ts`
- Create: `frontend/src/storage/csvImportPreview.ts`
- Test: `frontend/src/storage/__tests__/csvMigration.test.ts`

- [ ] **Step 1: CSV export**

Implement exports:

- students
- transactions
- daily settlements
- sync failures

- [ ] **Step 2: Controlled CSV import**

Allow CSV import only for:

- student master data preview。
- vendor/menu preview。
- legacy transaction migration batch with generated stable ids。

Block direct overwrite of existing production transactions.

- [ ] **Step 3: Commit**

```bash
cd frontend && npx vitest run src/storage/__tests__/csvMigration.test.ts
git add frontend/src/storage/csvExport.ts frontend/src/storage/csvImportPreview.ts frontend/src/storage/__tests__/csvMigration.test.ts
git commit -m "feat: add CSV export and import preview"
```

## Task 10: Multi-Device Conflict UI Plan Hook

**Files:**
- Modify: `frontend/src/components/screens.tsx`
- Create: `frontend/src/storage/conflictSummary.ts`
- Test: `frontend/src/storage/__tests__/conflictSummary.test.ts`

- [ ] **Step 1: Conflict summary**

Summarize conflicts by entity, business date, source device, and settlement impact.

- [ ] **Step 2: Admin entry**

Admin screen shows:

- queued count。
- failed count。
- conflict count。
- devices seen。
- last sync per device。

- [ ] **Step 3: Block unsafe multi-device mode**

If more than one committing device is detected for the same business date and cloud conflict handling is not enabled, show blocking admin warning.

- [ ] **Step 4: Commit**

```bash
cd frontend && npx vitest run src/storage/__tests__/conflictSummary.test.ts
git add frontend/src/storage/conflictSummary.ts frontend/src/storage/__tests__/conflictSummary.test.ts frontend/src/components/screens.tsx
git commit -m "feat: surface multi-device migration conflicts"
```

## Task 11: Runbooks And Operator Drill

**Files:**
- Create: `docs/ops/data-migration-runbook.md`
- Create: `docs/ops/backup-restore-runbook.md`
- Create: `docs/qa/data-migration-drill.md`

- [ ] **Step 1: Data migration runbook**

Include:

- pre-migration backup。
- migration preview。
- apply。
- failure recovery。
- rollback to old localStorage source。
- post-migration row count and balance checks。

- [ ] **Step 2: Backup/restore runbook**

Include:

- JSON full backup。
- CSV report export。
- JSON import preview。
- restore into replacement device。
- local-only row decision。
- checksum verification。

- [ ] **Step 3: Drill**

Drill covers:

- old localStorage -> IndexedDB。
- corrupt localStorage。
- JSON backup export/import。
- CSV export。
- two-device conflict preview。
- cloud sync migration with queued rows。

- [ ] **Step 4: Commit**

```bash
git add docs/ops/data-migration-runbook.md docs/ops/backup-restore-runbook.md docs/qa/data-migration-drill.md
git commit -m "docs: add data migration runbooks"
```

## Verification Commands

Every implementation PR:

```bash
cd frontend
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```

Migration-specific:

```bash
cd frontend
npx vitest run src/storage src/store/__tests__/posStore.test.ts
```

Manual drills:

1. Existing `pos-storage` v1 data migrates to IndexedDB once.
2. Old shape `{ id, name, balance }` still migrates.
3. Corrupt `pos-storage` is backed up and does not show empty production state silently.
4. JSON backup exports and imports with checksum.
5. CSV export opens in spreadsheet software and preserves Traditional Chinese text.
6. Two-device same-day conflict is blocked or surfaced before closeout.
7. Upgrade during active selected-student flow defers until safe or blocks POS with clear message.

## DISCUSS WITH USER

1. Pilot 期間歷史交易保留多久？建議先 indefinite。
2. 是否允許多台裝置同時 commit 交易？若允許，必須先完成 cloud sync/conflict UI。
3. JSON backup 是否需要密碼保護或加密？目前 plan 先定義格式，安全政策需另定。
4. CSV 匯入是否允許交易列？建議只允許 legacy migration preview，不允許直接覆蓋 production ledger。
5. `pos-storage` 成功遷移後要保留幾天再清除？
6. 哪個角色可以執行 restore/import/cleanup？
7. cloud sync 最終目標是 Cloudflare D1、Google Sheets，或兩者並存作報表鏡像？

## Definition Of Done

- localStorage v1 與舊 shape 都能 preview、validate、migrate。
- IndexedDB schema/version upgrade 有明確 migration list 與測試。
- Migration receipt 可證明 row counts、source、target、operator、結果。
- Zustand 不再是 durable accounting source；它從 repository hydrate。
- Cloud sync migration 產生 stable idempotency keys、queue entries 與 receipts。
- 多裝置 conflict policy 阻止 unsafe 同日多裝置 local-only 記帳。
- JSON backup 是 full restore 格式；CSV 是報表/受控 migration 格式。
- Zero-downtime upgrade 不會在 active transaction 中破壞或重複 ledger。
- Runbooks 與 drills 覆蓋 migration、backup、restore、corrupt source、multi-device conflict。
