---
required_reads:
  - frontend/src/store/posStore.ts
  - frontend/src/storage/posStateValidator.ts
  - frontend/src/storage/migration.ts
  - frontend/src/App.tsx
  - frontend/src/hooks/usePosFlow.ts
  - frontend/src/hooks/useUndoCountdown.ts
  - frontend/src/hooks/useCrashDraftRecovery.ts
  - frontend/src/components/TodayDashboard.tsx
  - frontend/src/components/screens/ReportScreen.tsx
  - frontend/src/components/report/AuditTrailTable.tsx
  - frontend/src/components/report/SettlementHistoryTable.tsx
  - frontend/src/store/__tests__/posStore.test.ts
  - frontend/src/__tests__/pcPosFlow.integration.test.tsx
  - frontend/src/__tests__/pcPosSafety.integration.test.tsx
  - frontend/src/__tests__/orderPayment.integration.test.tsx
  - frontend/src/__tests__/reportScreen.integration.test.tsx
  - frontend/src/components/__tests__/screens.test.tsx
  - frontend/src/store/__tests__/ledgerStore.test.ts
complexity: complex+
---

# Split Monolithic usePosStore — 執行計畫書

**日期**：2026-05-30
**Issue**：[#97](https://github.com/cheerc/talented-easyorder/issues/97)
**目標**：將 544 行 God Store 按 concern 拆分為 persistence / types / domain action factories，保留單一 Zustand store 避免跨 store 原子性問題。

---

## 現況分析

`usePosStore` (`frontend/src/store/posStore.ts`, 544 行) 同時承擔三層責任：

1. **Persistence**：Zustand `persist` middleware 設定（name, version, onRehydrateStorage, migrate）
2. **Domain logic**：13 個 action methods（CRUD、business date management、cash session、data reset）
3. **Type definitions**：`PosState` interface、`BusinessDateStatus`、input types

### Consumer-Selector 矩陣

| Consumer | Selectors | Actions (via hook) | Actions (via getState) |
|----------|-----------|-------------------|----------------------|
| App.tsx | students, transactions, todayMenu, vendors, cashSessions, dailySettlements | setTodayMenu, setVendors, resetData, getBusinessDateStatus, openCashSession, updateOpeningCash | getState().transactions |
| TodayDashboard.tsx | transactions, auditEvents, dailySettlements, businessDateStatuses | — | — |
| ReportScreen.tsx | transactions, cashSessions, dailySettlements, getBusinessDateStatus(viewDate) | closeBusinessDate, reopenBusinessDate, deleteOrderWithRefundCheck | getState().deleteTransaction, getState().editTransaction |
| AuditTrailTable.tsx | auditEvents | — | — |
| SettlementHistoryTable.tsx | dailySettlements | — | — |
| usePosFlow.ts | students, todayMenu, transactions | commitPosTransactionDraft | — |
| useUndoCountdown.ts | — | — | getState().deleteTransaction |
| useCrashDraftRecovery.ts | — | — | getState().students |

### Type consumers（僅 import type）

- `frontend/src/storage/posStateValidator.ts` — `import type { PosState } from '../store/posStore'`
- `frontend/src/storage/migration.ts` — `import type { PosState } from '../store/posStore'`

---

## 拆分策略

> **設計決策**：不拆成多個 Zustand store。`closeBusinessDate` 需要同時讀取 `transactions`、`cashSessions`、`businessDateStatuses`，跨 store 無法原子讀寫。改為 **extract action factories + persistence config + types**，保持單一 store 但每個檔案只負責一種 concern。

### 新建檔案（4 個）

| 檔案 | 職責 | 預估行數 |
|------|------|---------|
| `frontend/src/store/posTypes.ts` | `PosState`, `BusinessDateStatus`, `CloseBusinessDateInput`, `ReopenBusinessDateInput`, `OpenCashSessionInput`, `DeleteOrderResult` | ~90 |
| `frontend/src/store/posPersistence.ts` | persist middleware config（name, version, onRehydrateStorage, migrate）+ `defaultState` | ~60 |
| `frontend/src/store/posActions/transactionActions.ts` | `createTransactionActions(set, get)` → 6 action methods | ~220 |
| `frontend/src/store/posActions/sessionActions.ts` | `createSessionActions(set, get)` → 5 action methods | ~130 |
| `frontend/src/store/posActions/menuActions.ts` | `createMenuActions(set)` → 3 action methods | ~25 |

### 修改檔案（3 個）

| 檔案 | 變更內容 |
|------|----------|
| `frontend/src/store/posStore.ts` | 改為 thin composition layer（~80 lines）：import types + persistence config + action factories，組合成 `create<PosState>()(persist(...))` |
| `frontend/src/storage/posStateValidator.ts` | 改 `import type { PosState } from '../store/posStore'` → `from '../store/posTypes'` |
| `frontend/src/storage/migration.ts` | 同上，改 type import source |

### 不需變更的檔案（10 個 consumers + 7 test files）

所有 consumer 的 `import { usePosStore } from '../store/posStore'` 保持不變 — `posStore.ts` 仍 export `usePosStore`。Test files 的 import 同樣不受影響。

---

## 實作步驟

### Step 1: 建立 `posTypes.ts` — 新增

將以下型別從 `posStore.ts` 移至新檔案：

- `PosState` interface（完整 84 行含所有 method signatures）
- `BusinessDateStatus` type
- `DeleteOrderResult` interface
- `CloseBusinessDateInput` interface
- `ReopenBusinessDateInput` interface
- `OpenCashSessionInput` interface

```typescript
// frontend/src/store/posTypes.ts
import type { StudentAccount } from '../domain/student';
import type { Vendor, TodayMenu } from '../domain/menu';
import type { LedgerTransaction } from '../domain/ledger';
import type { PosTransactionDraft } from '../domain/posTransaction';
import type { DailyCashSession } from '../domain/cashSession';

export type BusinessDateStatus = 'open' | 'closed' | 'reopened';

export interface DeleteOrderResult { ... }
export interface CloseBusinessDateInput { ... }
export interface ReopenBusinessDateInput { ... }
export interface OpenCashSessionInput { ... }

export interface PosState { ... }
```

**Affected callers**：`posStore.ts`（import PosState）、`posStateValidator.ts`（改 import source）、`migration.ts`（改 import source）

**Related tests**：`posStore.test.ts`（type inference via usePosStore — no change needed）

### Step 2: 建立 `posActions/transactionActions.ts` — 新增

從 `posStore.ts` 提取 6 個 transaction 相關 action：

- `commitPosTransactionDraft`
- `processTransaction`
- `updateTransaction`
- `deleteTransaction`
- `deleteOrderWithRefundCheck`
- `editTransaction`

Export factory function：

```typescript
// frontend/src/store/posActions/transactionActions.ts
import type { PosState } from '../posTypes';
import { CASHIER_SENTINEL, recalculateStudentBalances } from '../../domain/ledger';
// ... other domain imports

export function createTransactionActions(
  set: (partial: Partial<PosState> | ((state: PosState) => Partial<PosState>)) => void,
  get: () => PosState
): Pick<PosState, 'commitPosTransactionDraft' | 'processTransaction' | ...> {
  return {
    commitPosTransactionDraft: (draft) => { /* existing impl */ },
    processTransaction: (studentId, type, mealPrice, paidAmount, note) => { /* existing impl */ },
    updateTransaction: (id, updates) => { /* existing impl */ },
    deleteTransaction: (id) => { /* existing impl */ },
    deleteOrderWithRefundCheck: (id) => { /* existing impl */ },
    editTransaction: (id, updates) => { /* existing impl */ },
  };
}
```

**Affected callers**：無（內部實作搬遷，export 透過 posStore.ts 轉發）

**Related tests**：`posStore.test.ts`、`pcPosFlow.integration.test.tsx`、`pcPosSafety.integration.test.tsx`、`orderPayment.integration.test.tsx`

### Step 3: 建立 `posActions/sessionActions.ts` — 新增

提取 5 個 business date / cash session 相關 action：

- `openCashSession`
- `updateOpeningCash`
- `closeBusinessDate`
- `reopenBusinessDate`
- `setBusinessDateStatus`
- `getBusinessDateStatus`

```typescript
// frontend/src/store/posActions/sessionActions.ts
export function createSessionActions(
  set: ...,
  get: () => PosState
): Pick<PosState, 'openCashSession' | ...> {
  return { ... };
}
```

**Affected callers**：無

**Related tests**：`posStore.test.ts`（Cash Sessions describe block）、`reportScreen.integration.test.tsx`

### Step 4: 建立 `posActions/menuActions.ts` — 新增

提取 3 個簡單 action：

- `setTodayMenu`
- `setVendors`
- `resetData`

```typescript
// frontend/src/store/posActions/menuActions.ts
import { INITIAL_STUDENTS, INITIAL_TODAY_MENU, INITIAL_TODAY_TX, VENDORS } from '../../mocks/initialData';

export function createMenuActions(
  set: ...
): Pick<PosState, 'setTodayMenu' | 'setVendors' | 'resetData'> {
  return { ... };
}
```

**Affected callers**：無

**Related tests**：`posStore.test.ts`（beforeEach calls resetData）

### Step 5: 建立 `posPersistence.ts` — 新增

從 `posStore.ts` 提取 persist middleware 設定：

```typescript
// frontend/src/store/posPersistence.ts
import type { PosState } from './posTypes';
import { migratePersistedState } from '../storage/migration';
import { migrateState, validatePersistedState } from '../storage/posStateValidator';
import { appendErrorLog } from '../errors/errorLogger';
import { INITIAL_STUDENTS, INITIAL_TODAY_MENU, INITIAL_TODAY_TX, VENDORS } from '../mocks/initialData';

export const defaultState = {
  auditEvents: [] as PosState['auditEvents'],
  dailySettlements: [] as PosState['dailySettlements'],
  businessDateStatuses: {} as PosState['businessDateStatuses'],
  cashSessions: {} as PosState['cashSessions'],
};

export const posPersistenceConfig = {
  name: 'pos-storage',
  version: 2,
  onRehydrateStorage: () => { /* existing impl */ },
  migrate: migratePersistedState,
};
```

**Affected callers**：`posStore.ts`（import config instead of inline）

**Related tests**：`posStore.test.ts`（Compatibility describe block — rehydration still works）

### Step 6: 重構 `posStore.ts` — 縮減為 ~80 lines

```typescript
// frontend/src/store/posStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PosState } from './posTypes';
import { defaultState, posPersistenceConfig } from './posPersistence';
import { createTransactionActions } from './posActions/transactionActions';
import { createSessionActions } from './posActions/sessionActions';
import { createMenuActions } from './posActions/menuActions';
import { INITIAL_STUDENTS, INITIAL_TODAY_MENU, INITIAL_TODAY_TX, VENDORS } from '../mocks/initialData';

export { type PosState, type BusinessDateStatus } from './posTypes';

export const usePosStore = create<PosState>()(
  persist(
    (set, get) => ({
      students: INITIAL_STUDENTS,
      transactions: INITIAL_TODAY_TX,
      vendors: VENDORS,
      todayMenu: INITIAL_TODAY_MENU,
      ...defaultState,
      ...createMenuActions(set),
      ...createSessionActions(set, get),
      ...createTransactionActions(set, get),
    }),
    posPersistenceConfig,
  )
);
```

**Affected callers**：無（所有 consumer 的 `import { usePosStore } from '../store/posStore'` 保持有效）

**Related tests**：全部 — 但行為完全等價，測試應全部 PASS 無需修改

### Step 7: 更新 type import sources — 修改 2 個檔案

**`frontend/src/storage/posStateValidator.ts` L1**：
```diff
- import type { PosState } from '../store/posStore';
+ import type { PosState } from '../store/posTypes';
```

**`frontend/src/storage/migration.ts` L1**：
```diff
- import type { PosState } from '../store/posStore';
+ import type { PosState } from '../store/posTypes';
```

### Step 8: 驗證 — 全測試鏈

```bash
cd frontend && npx vitest run
```

預期：所有 455 tests PASS（拆分為純重構，行為零變更）。

---

## Affected Callers Summary

| 檔案 | 變更類型 | 說明 |
|------|----------|------|
| `posTypes.ts` | **新增** | 型別定義獨立 |
| `posPersistence.ts` | **新增** | persist config 獨立 |
| `posActions/transactionActions.ts` | **新增** | 6 個 transaction action |
| `posActions/sessionActions.ts` | **新增** | 6 個 session action |
| `posActions/menuActions.ts` | **新增** | 3 個 menu/reset action |
| `posStore.ts` | **修改** | 縮減為 thin composition |
| `posStateValidator.ts` | **修改** | type import 改來源（1 行） |
| `migration.ts` | **修改** | type import 改來源（1 行） |

Consumer files（0 行變更）：App.tsx、TodayDashboard.tsx、ReportScreen.tsx、AuditTrailTable.tsx、SettlementHistoryTable.tsx、usePosFlow.ts、useUndoCountdown.ts、useCrashDraftRecovery.ts

---

## Test Impact

| Test file | 影響 | 預期結果 |
|-----------|------|---------|
| `posStore.test.ts` | import 保持不變（usePosStore from posStore） | 全部 PASS |
| `ledgerStore.test.ts` | 無 import 變更 | 全部 PASS |
| `pcPosFlow.integration.test.tsx` | 無 import 變更 | 全部 PASS |
| `pcPosSafety.integration.test.tsx` | 無 import 變更 | 全部 PASS |
| `orderPayment.integration.test.tsx` | 無 import 變更 | 全部 PASS |
| `reportScreen.integration.test.tsx` | 無 import 變更 | 全部 PASS |
| `screens.test.tsx` | 無 import 變更 | 全部 PASS |

---

## Risk Assessment

- **風險等級**：低。純內部重構，公開 API（`usePosStore` export）不變。所有 consumer 無需修改。
- **Rollback**：若測試失敗，`git revert` 即可恢復原狀。
- **Edge cases**：注意 `posPersistence.ts` 中 `onRehydrateStorage` 的 `Object.assign(state, ...)` mutation pattern 需保留（Zustand persist rehydration 依賴 mutation）。
