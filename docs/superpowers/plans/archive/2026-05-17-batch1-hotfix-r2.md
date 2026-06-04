---
status: approved
date: 2026-05-17
complexity: simple
batch: 1-hotfix-r2
review: codex-7c3c81 REJECTED draft → corrections applied
---

# Batch 1 Hotfix Round 2 — 第二輪測試修復

## Background

Batch 1 Hotfix (PR #38) merge 後使用者第二輪手動測試發現 4 個問題。

## Issues

### R2-1: 已訂便當份數計算錯誤（Critical）

**現狀**：idle 首頁顯示「已訂 5.555555555555555 份」，因為用金額除以單價計算。

**Root cause**：`App.tsx:419`
```ts
const todayCount = tx.reduce((acc, t) => acc + ((t.mealPrice || 0) / todayMenu.price), 0);
```
當 mealPrice 與 todayMenu.price 不整除（例如不同餐價的交易混合）就出小數。

**期望**：已訂份數 = 今日 type=order 的交易筆數（直接 count），不做金額除法。

**改動**：
- `App.tsx:419`：改為 `const todayCount = tx.filter(t => t.type === 'order').length;`
- `pos-components.tsx` IdleHero 的 `todayCount` prop 同步（若有獨立計算也一併修正）

### R2-2: 支出入口改為首頁按鈕（High）

**現狀**：支出只能從 idle 按 E 快捷鍵進入，無可見 UI 按鈕，使用者不知道功能存在。

**期望**：
- 移除 E 快捷鍵觸發支出的功能
- 在 idle 首頁加一顆可見按鈕「新增 收入/支出」，點擊進入 expense flow

**改動**：
- `useKeyboardShortcuts.ts`：移除 `enterExpenseMode` 參數和 E key 觸發 expense 的邏輯。E key 在 idle 狀態變成 no-op。
- `pos-components.tsx` IdleHero：加一顆按鈕 `新增 收入/支出`，onClick callback = `onEnterExpense`
- `pos-components.tsx` IdleHero keyboard hints：移除 `E 支出` hint
- `App.tsx`：將 `enterExpenseMode` callback 傳給 IdleHero 的 `onEnterExpense` prop

### R2-3: 支出功能擴充為「收入/支出」（High）

**現狀**：ExpensePanel 標題「櫃台支出」，只支持支出（正數金額視為支出）。

**期望**：
- 改名為「新增 收入/支出」
- 金額輸入後，讓使用者選擇「收入」或「支出」方向
- 收入場景：撿到錢、家長多給、其他收入
- 支出場景：付便當錢、其他支出

**Ledger 存儲模型**（Codex review correction）：
- `LedgerTransaction.amount` 是 derived field：`calculateTransactionAmount(mealPrice, paidAmount) = paidAmount - mealPrice`（ledger.ts:45-50）
- 支出存儲：`type: 'expense'`, cashier sentinel, `mealPrice = amount`, `paidAmount = 0` → derived amount = -amount（負數）
- 收入存儲：`type: 'expense'`, cashier sentinel, `mealPrice = 0`, `paidAmount = amount` → derived amount = +amount（正數）
- 內部 type 維持 `'expense'`（避免大規模 rename），靠 `mealPrice`/`paidAmount` 的組合區分方向

**改動**：
- `pos-components.tsx` ExpensePanel：
  - 標題改為「新增 收入/支出」
  - 金額輸入步驟後（expense_reason state），先選方向再選原因：
    - 「支出：付便當錢」→ mealPrice=amount, paidAmount=0
    - 「支出：其他原因」→ mealPrice=amount, paidAmount=0 + 輸入備註
    - 「收入：其他原因」→ mealPrice=0, paidAmount=amount + 輸入備註
- `posFlow.ts`：
  - 新增 `ExpenseDirection = 'income' | 'expense'` type
  - `expense_reason` state 擴充：加入 direction 選擇
  - `PosFlowEvent` 的 `expenseSelectReason` union 擴充：`'付便當錢' | '支出其他' | '收入其他'`
  - committing state 加 `expenseDirection: ExpenseDirection` field
- `posStore.ts`：commit expense 時依 direction 決定 mealPrice/paidAmount 組合：
  - direction='expense' → `mealPrice=amount, paidAmount=0`
  - direction='income' → `mealPrice=0, paidAmount=amount`
- `ledgerReport.ts` `calculateLedgerTotals`（lines 85-97）：
  - 目前只計 `totalExpense += roundedMealPrice`（忽略 expense 的 paidAmount）
  - 修正：expense rows 中 `paidAmount > 0` 的視為收入，計入 `totalIncome`（或新增 field）
  - 確保 `netCash` 正確反映收入（目前 netCash = totalPaid - totalExpense，需加 income）
- `ReportSummaryStats` / cash close：消費 `totals` 的地方同步顯示收入
- `LedgerGroupedTable.tsx` expense section（lines 199-207）：
  - 目前硬編碼「櫃台支出」+ `−${fmt(t.mealPrice)}`
  - 修正：區分收入/支出 row，收入顯示 `+${fmt(t.paidAmount)}`，支出顯示 `−${fmt(t.mealPrice)}`
  - section 標題改為「櫃台 收入/支出」
- 命名：整個 flow 維持用 `expense` 作為內部名稱，UI 顯示改為「收入/支出」

### R2-4: 學生介面 ActionBar 改為 Q/W/E 三等寬按鈕（Medium）

**現狀**：student_selected 顯示 Q(訂便當) W(繳費) 兩個 mode 按鈕 + 獨立 R(取消訂餐) action button。

**期望**：
- 三個按鈕：Q(訂餐) W(繳費) E(取消訂餐)
- 三按鈕同排、等寬
- E 快捷鍵在 student_selected 狀態觸發取消訂餐（= `handleDeleteOrder`）
- 移除 R 快捷鍵

**改動**：
- `pos-components.tsx` ActionBar：
  - 移除獨立 R action button
  - 三個等寬視覺按鈕：Q(訂餐) W(繳費) E(取消訂餐)
  - **不要**把 cancel 加進 radiogroup/opts array（現有 opts 是 `role="radio"` with `aria-checked`）
  - Q/W 保持 mode radio 行為；E 是獨立 action button，click handler 呼叫 `onDeleteOrder`（觸發 ConfirmDialog）
  - 三按鈕視覺上同排等寬（`flex: 1`），但語意上 Q/W = mode selection, E = action
  - `PosMode` type 不變（維持 `'order' | 'payment' | 'expense'`），cancel 不加入
- **取消訂餐確認畫面**（使用現有 `ConfirmDialog` component at `ui/ConfirmDialog.tsx`）：
  - E 按下後不直接刪除，先開啟 `ConfirmDialog`：title=「取消訂餐」, message=「確定要取消 [學生姓名] 的訂餐嗎？」
  - confirm button label=「確認取消」（danger variant），cancel label=「返回」
  - 確認後才真正呼叫 `deleteOrderWithRefundCheck`
- `useKeyboardShortcuts.ts`：
  - 新增參數 `isStudentSelected: boolean`
  - E key：若 `isStudentSelected` 且有 `cancelOrder` callback → 呼叫 cancelOrder（此 callback 應觸發確認畫面，非直接刪除）；否則 no-op（idle 不再觸發 expense）
  - 移除 R key 邏輯（或讓 R = no-op）
  - Q/W 在 student_selected 維持原邏輯
- `App.tsx`：傳入 `isStudentSelected` 給 useKeyboardShortcuts；`cancelOrder` callback 改為先顯示確認 dialog

## Success Criteria

- 所有現有 tests pass + 新增測試
- `./workflow.sh t6` 全綠
- 手動驗證：
  - idle 首頁份數為整數（= order 筆數）
  - idle 有「新增 收入/支出」按鈕，E 鍵無反應
  - 點按鈕可進入收入/支出 flow，收入和支出都能正確記帳
  - 選學生後 Q/W/E 三按鈕等寬，E=取消訂餐

## Required Tests

- **todayCount**: mock 3 筆 order + 1 筆 payment，assert todayCount === 3
- **IdleHero button**: render idle state，assert 「新增 收入/支出」按鈕存在且可點擊
- **ExpensePanel income flow**: 輸入金額 → 選收入 → 確認 → assert committed with mealPrice=0, paidAmount=amount (derived amount positive)
- **ExpensePanel expense flow**: 輸入金額 → 選支出 → 確認 → assert committed with mealPrice=amount, paidAmount=0 (derived amount negative)
- **calculateLedgerTotals with income**: expense row with paidAmount>0 正確計入收入，netCash 包含 income
- **LedgerGroupedTable income row**: 收入 row 顯示 `+$amount`，支出 row 顯示 `−$amount`
- **ActionBar 3 buttons**: student_selected render，assert 3 buttons equal width，E button triggers confirm dialog (not direct delete)
- **Cancel confirm dialog**: E → 顯示確認畫面 → 點「確認取消」→ assert deleteOrder called; 點「返回」→ assert no delete
- **useKeyboardShortcuts**: E key in idle = no-op; E key in student_selected = triggers cancelOrder (confirm flow); R key = no-op everywhere
