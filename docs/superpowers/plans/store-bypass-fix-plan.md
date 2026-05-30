---
required_reads:
  - frontend/src/components/screens/ReportScreen.tsx
  - frontend/src/components/report/LedgerGroupedTable.tsx
  - frontend/src/components/TodayDashboard.tsx
  - frontend/src/store/posStore.ts
  - frontend/src/domain/ledger.ts
  - frontend/src/domain/ledgerReport.ts
  - frontend/src/domain/cashClose.ts
  - frontend/src/domain/ledgerExport.ts
---

# Plan: Fix Components Bypassing Store with Direct Domain Imports (#149)

## Objective
消除 UI components 直接匯入 domain 層 runtime functions 的 pattern，建立 store → derived hook → component 的清晰架構邊界。

## Approach
建立 `frontend/src/store/derived/` 目錄，容納組合 store state + domain logic 的 derived hooks。Components 改為使用這些 hooks，不再直接 import domain runtime functions。

純 type imports（`import type`）不在修復範圍內——這是安全的。

## Files

| 檔案 | 語意 |
|------|------|
| `frontend/src/store/derived/useLedgerReport.ts` (new) | 組合 transactions + domain/ledgerReport computations |
| `frontend/src/store/derived/useCashClose.ts` (new) | 組合 cashSessions + domain/cashClose computations |
| `frontend/src/store/derived/useLedgerExport.ts` (new) | 組合 domain/ledgerExport + triggerCsvDownload callback |
| `frontend/src/components/screens/ReportScreen.tsx` (modify) | 改用 derived hooks，移除 domain imports |
| `frontend/src/components/report/LedgerGroupedTable.tsx` (modify) | CASHIER_SENTINEL 改由 store re-export，mergeLedgerTransactions 改用 callback prop |
| `frontend/src/components/TodayDashboard.tsx` (modify) | 改用 useLedgerReport hook |
| `frontend/src/store/posStore.ts` (modify) | re-export CASHIER_SENTINEL |

## Section 1: Create `useLedgerReport` Derived Hook

建立 `frontend/src/store/derived/useLedgerReport.ts`

封裝：
- `createLedgerDateRange(dateRange, viewDate, custom)` → `range`
- `transactions.filter(...)` by range → `filtered`
- `calculateLedgerTotals(filtered)` → `totals`
- `groupLedgerRowsByStudent(filtered)` → `groups`

Hook interface：
```typescript
function useLedgerReport(args: {
  dateRange: LedgerDateRangeKind;
  viewDate: string;
  customStart?: string;
  customEnd?: string;
}): { range: DateRange; filtered: LedgerTransaction[]; totals: LedgerTotals; groups: LedgerGroup[] }
```

純 computation hook，內部使用 `usePosStore(s => s.transactions)` + `useMemo`。

**Verification**: `npx tsc --noEmit` + `npx vitest run`

## Section 2: Create `useCashClose` Derived Hook

建立 `frontend/src/store/derived/useCashClose.ts`

封裝：
- `getOpeningCash(viewDate, dailySettlements, currentCashSession)` → `openingCash`
- `getBusinessDateStatus(viewDate)` → `dateStatus`

Hook interface：
```typescript
function useCashClose(viewDate: string): {
  openingCash: number;
  dateStatus: string;
  currentCashSession: CashSessionDraft | undefined;
}
```

**Verification**: same as Section 1

## Section 3: Create `useLedgerExport` Derived Hook

建立 `frontend/src/store/derived/useLedgerExport.ts`

封裝 CSV export 邏輯為 callback：
```typescript
function useLedgerExport(viewDate: string): {
  exportCsv: (transactions: LedgerTransaction[], displayMode: 'merged' | 'original') => void;
}
```

內部使用 `mergeLedgerTransactions`、`buildTransactionCsvRows`、`serializeCsv`、`triggerCsvDownload`、`TRANSACTION_CSV_COLUMNS`。

**Verification**: same as Section 1

## Section 4: Migrate ReportScreen.tsx

**移除** 以下 domain imports：
- `mergeLedgerTransactions` from `domain/ledger`
- `createLedgerDateRange`, `calculateLedgerTotals`, `groupLedgerRowsByStudent` from `domain/ledgerReport`
- `getOpeningCash` from `domain/cashClose`
- `TRANSACTION_CSV_COLUMNS`, `buildTransactionCsvRows`, `serializeCsv`, `triggerCsvDownload` from `domain/ledgerExport`

**改用** derived hooks：
- `useLedgerReport` → 取代 range/filtered/totals/groups 的 useMemo
- `useCashClose` → 取代 openingCash 計算
- `useLedgerExport` → 取代 CSV export callback

`import type { LedgerTransaction }` 保持不變（type-only import）。

**Verification**: `npx tsc --noEmit` + `npx vitest run`（所有報表相關測試 PASS）

## Section 5: Migrate LedgerGroupedTable.tsx

**變更**：
- `CASHIER_SENTINEL` → 改從 `store/posStore` import（store re-export）
- `mergeLedgerTransactions` → 改為接受 optional prop `mergeTransactions`（由 parent 傳入），default 仍使用 domain function（避免 breaking change）

若 parent 未傳入 mergeTransactions，LedgerGroupedTable 內部 fallback 到 domain function（向後相容）。

**Verification**: same as Section 4

## Section 6: Migrate TodayDashboard.tsx

**移除**: `calculateLedgerTotals` from `domain/ledgerReport`

**改用**: `useLedgerReport` hook（僅取 totals 欄位）

**Verification**: same as Section 4

## Section 7: Store Re-export CASHIER_SENTINEL

在 `posStore.ts` 中：
```typescript
export { CASHIER_SENTINEL } from '../domain/ledger';
```

## Affected Callers
- `ReportScreen.tsx` — 主要 consumer，移除 5 組 domain imports
- `LedgerGroupedTable.tsx` — 改 CASHIER_SENTINEL source + mergeTransactions prop
- `TodayDashboard.tsx` — 改用 useLedgerReport

## Test Impact
- 既有 component tests（`pos-components.test.tsx`）必須全 PASS
- 既有 store tests（`posStore.test.ts`、`ledgerStore.test.ts`）必須全 PASS
- Derived hooks 內部使用既有的 domain functions，不改變計算邏輯
- 可選：為 derived hooks 新增 unit test（不在本次 scope）

## ⚠️ Risk
- `useLedgerReport` 的 dependency array 若錯誤會導致 stale computation
- `LedgerGroupedTable` 的 `mergeTransactions` prop 是向後相容的 breaking change interface
- `useLedgerExport` 中的 `triggerCsvDownload` 是 side effect（browser download），需確保 hook 不回傳 unstable callback

## Success Criteria
1. `frontend/src/components/` 下無 `from '../../domain/'` 的 runtime import（`import type` 除外）
2. 3 個 derived hooks 存在於 `frontend/src/store/derived/`
3. `CASHIER_SENTINEL` 從 store re-export
4. t1~t4 全 PASS
5. ReportScreen、LedgerGroupedTable、TodayDashboard 功能不變
