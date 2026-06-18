# Plan: Storage Wire Format Types — Decouple Persistence from Domain

> Issue: #238
> Complexity: complex+ (5 files, structural type extraction + return type change)
> Created: 2026-06-03
> Revised: 2026-06-03 (reviewer feedback: add LedgerAuditEvent, DailySettlement, CashSession, WirePersistedState)

## Background

`posStateValidator.ts` 和 `migration.ts` 目前直接 import domain types（`LedgerTransaction`、`StudentAccount`、`Vendor`、`LedgerAuditEvent`、`DailySettlement`）以及 store type（`PosState`），形成 persistence → domain/store 耦合。Issue #238 要求在 storage 層定義獨立的 wire format types，完全斷開這條依賴鏈。

關鍵約束：`migrateState()` 和 `migratePersistedState()` 都呼叫 `recalculateStudentBalances()`（domain logic），這是不可避免的 boundary crossing。Wire types 結構與 domain types 完全一致，使用 type assertion 標記此 boundary。

## Scope

### Included
1. 建立 `frontend/src/storage/wireTypes.ts` — 完整 wire format interfaces（9 個 type/interface，零 domain/store import）
2. 更新 `posStateValidator.ts` — wire types 取代所有 domain/store imports；`PersistedStateValidationResult` 和 `MigrationResult` 改用 `WirePersistedState`
3. 更新 `migration.ts` — wire types 取代 domain imports；內部邏輯用 wire types
4. 更新 `__tests__/posStateValidator.test.ts` — 更新 migrateState 相關型別引用
5. 在 `recalculateStudentBalances()` 呼叫處使用 `as unknown as` type assertion（結構相同，safe cast）
6. 驗證 tsc + lint + vitest 全 PASS

### Excluded
- 不更動 domain types 本身
- 不建立 mapper layer（wire ↔ domain）（結構相同，不需要轉換）
- 不更動 `store/posPersistence.ts`（它只檢查 `result.ok`，不使用 `result.state`）
- 不更動其他 domain type consumers

## Affected Files

| File | Change |
|------|--------|
| `frontend/src/storage/wireTypes.ts` | **NEW** — 9 wire types/interfaces |
| `frontend/src/storage/posStateValidator.ts` | Replace 6 domain/store imports with wire types; update 2 return types |
| `frontend/src/storage/migration.ts` | Replace 5 domain imports with wire types; add boundary assertions |
| `frontend/src/__tests__/posStateValidator.test.ts` | Update migrateState type references |
| `frontend/src/storage/__tests__/migration.test.ts` | Check if exists, update if needed |

## Wire Types Design

```typescript
// storage/wireTypes.ts — zero domain/store imports

// --- Enum unions (structurally identical to domain) ---
export type WireTransactionType = 'order' | 'payment' | 'expense';
export type WireSyncStatus = 'local' | 'queued' | 'synced' | 'failed' | 'conflict';
export type WireSourceDevice = 'pc' | 'barcode_scanner' | 'ipad_handoff';
export type WireStudentStatus = 'active' | 'inactive';
export type WireFaceEnrollmentStatus = 'none' | 'enrolled' | 'disabled' | 'needs_review';
export type WireRecordStatus = 'active' | 'inactive';
export type WireBusinessDateStatus = 'open' | 'closed' | 'reopened';
export type WireAuditEventType =
  | 'transaction_edited' | 'transaction_deleted' | 'transaction_hard_deleted'
  | 'business_date_closed' | 'business_date_reopened' | 'csv_exported' | 'report_printed';
export type WireCashSessionStatus = 'open' | 'closed';

// --- Data interfaces (structurally identical to domain types) ---
export interface WireLedgerTransaction {
  transactionId: string; businessDate: string; createdAt: string;
  studentId: string; studentNameSnapshot: string;
  type: WireTransactionType; mealPrice: number; paidAmount: number;
  amount: number; afterBalance: number;
  menuNameSnapshot: string; vendorNameSnapshot: string;
  sourceDevice: WireSourceDevice; operatorId?: string;
  syncStatus: WireSyncStatus; revision: number; note: string;
  depositAmount?: number; unpaidAmount?: number;
}

export interface WireStudentAccount {
  studentId: string; displayName: string; status: WireStudentStatus;
  currentBalance: number; aliases: string[];
  className?: string; groupName?: string; faceProfileId?: string;
  faceEnrollmentStatus: WireFaceEnrollmentStatus;
  createdAt: string; updatedAt: string; revision: number;
}

export interface WireVendor {
  vendorId: string; name: string; phone: string; note: string;
  status: WireRecordStatus; createdAt: string; updatedAt: string; revision: number;
}

export interface WireTodayMenu {
  businessDate: string; itemName: string; price: number;
  vendorId: string; vendorNameSnapshot: string;
  catalogItemId?: string; updatedAt: string; revision: number;
}

export interface WireLedgerAuditEvent {
  auditEventId: string; eventType: WireAuditEventType;
  entityType: 'transaction' | 'settlement' | 'business_date' | 'export';
  entityId: string; businessDate: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string; operatorId: string; createdAt: string;
}

export interface WireDailySettlement {
  settlementId: string; businessDate: string;
  status: WireBusinessDateStatus; settlementRevision: number;
  orderCount: number; transactionCount: number;
  totalIncome: number; totalExpense: number;
  openingCash: number; netCash: number; expectedCash: number;
  countedCash: number; difference: number; note: string;
  closedBy: string; closedAt: string;
  reopenedBy?: string; reopenedAt?: string; reopenReason?: string;
  syncStatus: WireSyncStatus; revision: number;
}

export interface WireDailyCashSession {
  cashSessionId: string; businessDate: string;
  openingCash: number; openedBy: string; openedAt: string;
  closedAt?: string; closedBy?: string;
  status: WireCashSessionStatus; revision: number;
}

// --- Wire persisted state (data-only, no store methods/Firestore) ---
export interface WirePersistedState {
  students: WireStudentAccount[];
  transactions: WireLedgerTransaction[];
  vendors: WireVendor[];
  todayMenu: WireTodayMenu;
  auditEvents: WireLedgerAuditEvent[];
  dailySettlements: WireDailySettlement[];
  businessDateStatuses: Record<string, WireBusinessDateStatus>;
  cashSessions: Record<string, WireDailyCashSession>;
  schemaVersion?: number;
}
```

## Return Type Changes

### posStateValidator.ts

```typescript
// Before
export type PersistedStateValidationResult =
  | { ok: true; state: PosState }
  | { ok: false; reason: string };

export type MigrationResult =
  | { ok: true; state: PosState & { schemaVersion: number } }
  | { ok: false; reason: string };

// After — PosState import removed
import type { WirePersistedState } from './wireTypes';

export type PersistedStateValidationResult =
  | { ok: true; state: WirePersistedState }
  | { ok: false; reason: string };

export type MigrationResult =
  | { ok: true; state: WirePersistedState & { schemaVersion: number } }
  | { ok: false; reason: string };
```

### migration.ts

`migratePersistedState` 的 return type 保持 `PosState`（Zustand `migrate` middleware 合約要求），但內部使用 wire types + 最終 `as unknown as PosState` assertion。

## Boundary Assertion Pattern

在 `migration.ts` 和 `posStateValidator.ts` 的 `migrateState()` 中，呼叫 `recalculateStudentBalances()` 處：

```typescript
// Wire types are structurally identical to domain types by design.
// This assertion is safe — any mismatch would be caught by tsc.
import { recalculateStudentBalances } from '../domain/ledger';
import type { StudentAccount } from '../domain/student';
import type { LedgerTransaction } from '../domain/ledger';

const result = recalculateStudentBalances(
  rawStudents as unknown as StudentAccount[],
  migratedTx as unknown as LedgerTransaction[],
);
```

## Test Impact

- `frontend/src/__tests__/posStateValidator.test.ts` — 8 migrateState 呼叫處，若測試中有存取 `result.state` 的 domain-specific 欄位，需更新為 wire type 欄位（結構相同，通常不需改）
- `frontend/src/__tests__/migration.test.ts` — check if exists (grep first)

## Verification Steps

1. `npx tsc --noEmit` — wire types 與 domain types 結構相容性驗證
2. `npm run lint` — ESLint pass
3. `npx vitest run` — 所有現有 tests pass（特別關注 posStateValidator.test.ts）
4. Manual: 確認 app 啟動後 localStorage/IndexedDB 資料正常載入

## Risk Assessment

- **Risk**: MEDIUM — 若 wire types 與 domain types 結構不同步，type assertion 會在 runtime 產生問題
- **Mitigation**: Wire types 從 domain types 逐欄位複製；tsc 驗證 `recalculateStudentBalances` 參數型別與 assertion target 一致；`PersistedStateValidationResult.state` 型別變更由 tsc 強制檢查所有 consumer
- **Rollback**: Revert 5 files，無 data migration
- **Blast radius**: Storage layer（`posStateValidator.ts` + `migration.ts`）+ 測試檔，不影響 UI/其他 store
