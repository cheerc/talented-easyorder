# Plan: Storage Wire Format Types — Decouple Persistence from Domain

> Issue: #238
> Complexity: complex+ (4 files, structural type extraction)
> Created: 2026-06-03

## Background

`posStateValidator.ts` 和 `migration.ts` 目前直接 import domain types（`LedgerTransaction`、`StudentAccount`、`Vendor`），形成 persistence → domain 耦合。Issue #238 要求在 storage 層定義獨立的 wire format types，打破這條依賴鏈。

關鍵約束：`migrateState()` 和 `migratePersistedState()` 都呼叫 `recalculateStudentBalances()`（domain logic），這是不可避免的 boundary crossing。Wire types 結構與 domain types 完全一致，使用 type assertion 標記此 boundary。

## Scope

### Included
1. 建立 `frontend/src/storage/wireTypes.ts` — 獨立 wire format interfaces（零 domain import）
2. 更新 `posStateValidator.ts` — 以 wire types 取代 domain type imports
3. 更新 `migration.ts` — 以 wire types 取代 domain type imports
4. 在 `recalculateStudentBalances()` 呼叫處使用 `as unknown as` type assertion（結構相同，safe cast）
5. 驗證 tsc + lint + vitest 全 PASS

### Excluded
- 不更動 domain types 本身
- 不建立 mapper layer（wire ↔ domain）（結構相同，不需要轉換）
- 不更動 `store/posPersistence.ts`（它只呼叫 top-level functions，不受內部 type 變更影響）
- 不更動其他 domain type consumers

## Affected Files

| File | Change |
|------|--------|
| `frontend/src/storage/wireTypes.ts` | **NEW** — WireLedgerTransaction, WireStudentAccount, WireVendor, WireTodayMenu |
| `frontend/src/storage/posStateValidator.ts` | Replace domain imports with wire types |
| `frontend/src/storage/migration.ts` | Replace domain imports with wire types; add boundary assertions |
| `frontend/src/storage/__tests__/` | Check if storage tests exist (grep first) |

## Wire Types Design

```typescript
// storage/wireTypes.ts — zero domain imports

export type WireTransactionType = 'order' | 'payment' | 'expense';
export type WireSyncStatus = 'local' | 'queued' | 'synced' | 'failed' | 'conflict';
export type WireSourceDevice = 'pc' | 'barcode_scanner' | 'ipad_handoff';
export type WireStudentStatus = 'active' | 'inactive';
export type WireFaceEnrollmentStatus = 'none' | 'enrolled' | 'disabled' | 'needs_review';
export type WireRecordStatus = 'active' | 'inactive';

export interface WireLedgerTransaction {
  transactionId: string;
  businessDate: string;
  createdAt: string;
  studentId: string;
  studentNameSnapshot: string;
  type: WireTransactionType;
  mealPrice: number;
  paidAmount: number;
  amount: number;
  afterBalance: number;
  menuNameSnapshot: string;
  vendorNameSnapshot: string;
  sourceDevice: WireSourceDevice;
  operatorId?: string;
  syncStatus: WireSyncStatus;
  revision: number;
  note: string;
  depositAmount?: number;
  unpaidAmount?: number;
}

export interface WireStudentAccount {
  studentId: string;
  displayName: string;
  status: WireStudentStatus;
  currentBalance: number;
  aliases: string[];
  className?: string;
  groupName?: string;
  faceProfileId?: string;
  faceEnrollmentStatus: WireFaceEnrollmentStatus;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface WireVendor {
  vendorId: string;
  name: string;
  phone: string;
  note: string;
  status: WireRecordStatus;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface WireTodayMenu {
  businessDate: string;
  itemName: string;
  price: number;
  vendorId: string;
  vendorNameSnapshot: string;
  catalogItemId?: string;
  updatedAt: string;
  revision: number;
}
```

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

保留 `recalculateStudentBalances` 的 import（它是 pure function，不是 type），只對 data 做 assertion。

## Verification Steps

1. `npx tsc --noEmit` — wire types 與 domain types 結構相容性驗證
2. `npm run lint` — ESLint pass
3. `npx vitest run` — 所有現有 tests pass（validator tests 特別關注）
4. Manual: 確認 app 啟動後 localStorage/IndexedDB 資料正常載入

## Risk Assessment

- **Risk**: MEDIUM — 若 wire types 與 domain types 結構不同步，type assertion 會在 runtime 產生問題
- **Mitigation**: Wire types 從 domain types 逐欄位複製，tsc 會驗證 `recalculateStudentBalances` 的參數型別與 assertion target 一致
- **Rollback**: Revert 4 files，無 data migration
- **Blast radius**: 僅 storage layer（`posStateValidator.ts` + `migration.ts`），不影響 UI/store
