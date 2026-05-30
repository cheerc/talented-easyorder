---
required_reads:
  - frontend/src/store/posActions/transactionActions.ts
  - frontend/src/store/posActions/sessionActions.ts
  - frontend/src/store/posActions/menuActions.ts
  - frontend/src/store/__tests__/posStore.test.ts
  - frontend/src/store/__tests__/ledgerStore.test.ts
---

# Plan: Store Actions Unit Test Coverage (#145)

## Objective
為三個 store action module 補齊 unit test：`transactionActions`、`sessionActions`、`menuActions`。

## Test Pattern
沿用既有 `posStore.test.ts` pattern：直接 import `usePosStore`，透過 `getState()` 呼叫 actions，assert store state 變化。

## Section 1: transactionActions.test.ts

建立 `frontend/src/store/__tests__/transactionActions.test.ts`

| # | Test | 說明 |
|---|------|------|
| T1 | commitPosTransactionDraft (order) | 建立 order → 驗證 transaction 欄位、student balance 更新 |
| T2 | commitPosTransactionDraft (payment) | 建立 payment → 驗證 paidAmount、balance recalculation |
| T3 | commitPosTransactionDraft (expense) | 建立 expense → 驗證 CASHIER_SENTINEL、balance 不變 |
| T4 | commitPosTransactionDraft (nonexistent student) | studentId 不存在 → state unchanged |
| T5 | processTransaction — legacy batch | 驗證 processTransaction 批次處理、audit event 產生 |
| T6 | updateTransaction — type change | 變更 transaction type → 驗證 afterBalance recalc |
| T7 | editTransaction — balance recalc | 編輯 transaction → 驗證 audit event + balance chain |
| T8 | deleteTransaction | 刪除 transaction → 驗證 soft delete + balance recalc |
| T9 | deleteOrderWithRefundCheck | 刪除 order → 驗證 refund 追蹤 |

**Verification**: `npx vitest run --reporter=verbose transactionActions`

## Section 2: sessionActions.test.ts

建立 `frontend/src/store/__tests__/sessionActions.test.ts`

| # | Test | 說明 |
|---|------|------|
| S1 | openCashSession | 開 session → 驗證 cashSessions 寫入 |
| S2 | openCashSession — duplicate | 重複開同日期 → state unchanged |
| S3 | updateOpeningCash | 更新 opening cash → 驗證金額 |
| S4 | closeBusinessDate | 關帳 → 驗證 dailySettlement 產生、cash session 關閉 |
| S5 | reopenBusinessDate | 重開帳 → 驗證 settlement 清除 |
| S6 | closeBusinessDate — no session | 無 session 關帳 → 錯誤處理 |

**Verification**: `npx vitest run --reporter=verbose sessionActions`

## Section 3: menuActions.test.ts

建立 `frontend/src/store/__tests__/menuActions.test.ts`

| # | Test | 說明 |
|---|------|------|
| M1 | setTodayMenu | 設定 menu → 驗證 todayMenu 更新 |
| M2 | setVendors | 設定 vendors → 驗證 vendors 更新 |
| M3 | resetData | 重置 → 驗證所有 state 回到 initial |

**Verification**: `npx vitest run --reporter=verbose menuActions`

## Affected Callers
- 無 — 純新增 test files，不修改 source code

## Test Impact
- `posStore.test.ts` 已 cover `processTransaction`、`updateTransaction` — 新測試不重複既有的 case，focus on uncovered actions
- 目標：至少新增 15 tests（9 + 6 + 3）

## Success Criteria
1. 3 個新 test files，每個獨立可執行
2. `npx vitest run` 全 PASS，test count 從 606 → 621+
3. `npx tsc --noEmit` PASS
