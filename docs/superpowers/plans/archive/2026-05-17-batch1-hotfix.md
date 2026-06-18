---
status: approved
date: 2026-05-17
complexity: simple
batch: 1-hotfix
review: codex-7c3c81 REJECTED draft → corrections applied
---

# Batch 1 Hotfix — 金流重設計後的 bug 修復

## Background

Batch 1 (PR #37, 5517eae) merged 後使用者實測發現 6 個問題，需要在 Batch 2 之前修完。

## Issues

### H1: 支出模式 UX 修正（Critical）

**現狀**：選了學生後，mode tab 顯示 Q(訂餐) W(繳費) E(支出)，讓使用者以為支出跟學生有關。

**期望**：
- 支出（expense）= 櫃台動用跟學生無關的錢，只能從 idle 狀態進入（E key 或按鈕）
- 選了學生後的 mode tab 只顯示 Q(訂餐) W(繳費)，加一顆獨立的「取消訂餐」action button（hint: R）
- 學生的收入/支出用繳費模式的 +/- 處理

**改動**：
- `pos-components.tsx` ActionBar：student_selected 時 mode opts 改為 `[order, payment]`，另加一顆獨立 action button `取消訂餐 (R)`，callback 為 `onDeleteOrder`（非 changeMode）
- **不要**把 cancel 加進 `PosMode` type — PosMode 維持 `'order' | 'payment' | 'expense'`
- 確保 E key 從 idle 直接進 expense_input 仍然正常

### H2: 支出模式金額輸入框未顯示（Critical）

**現狀**：idle 按 E 後 state 進 `expense_input`，但 `picked` 為 null，所以 render 落入 idle branch（SearchBox/IdleHero），ExpensePanel 永遠不顯示。

**期望**：`ExpensePanel` 在 `expense_input` state 時要正確渲染，含金額 input。

**改動**：
- `App.tsx`：在 `!picked` 的 render branch 中加入 `state.kind === 'expense_input' || state.kind === 'expense_reason' || state.kind === 'expense_other_note'` 的條件，render `<ExpensePanel>` 而非 SearchBox/IdleHero
- `App.tsx` handleConfirm：當 state.kind === 'expense_input' 時，確認金額要讀 `state.amountText`（非 `currentPaidAmount`），避免 Enter 讀錯值

### H3: 快捷鍵修復（High）

**現狀**：E 快捷鍵選學生後無效（因為走 changeMode 把 mode 設成 expense，跟 H1 同源），R 快捷鍵不存在。

**期望**：
- 選了學生後：Q=訂餐, W=繳費, R=取消訂單, Enter=確認, Esc=返回
- 未選學生（idle）：E=支出模式, R=no-op
- R 在 student_selected 狀態觸發 `handleDeleteOrder` / `deleteOrderWithRefundCheck`（真正的取消訂餐），不是 `cancelFlow`（那只是回 idle）

**改動**：
- `useKeyboardShortcuts.ts`：
  - 新增參數 `cancelOrder?: () => void`
  - R key：如果有 `cancelOrder` callback 就呼叫它，否則 no-op
  - 移除 student_selected 狀態下 E 的 mode 切換（因為 expense 不再出現在 selected 面板）
- `App.tsx`：傳入 `cancelOrder` callback（= `handleDeleteOrder` 或 confirm dialog trigger）
- `pos-components.tsx`：底部 hint 文字更新為 Q 訂餐 · W 繳費 · R 取消 · E 支出(idle) · ↵ 確認 · Esc 返回

### H4: 最近 5 筆顯示格式（Medium）

**現狀**：未繳費 order 顯示 `-90`，已繳費 order 顯示 `0`。

**期望**：
- 未繳費：顯示「待繳費 90」
- 已繳費：顯示「已繳費 90」

**資料模型澄清**（Codex review correction）：
- 繳費狀態不是「另一筆 payment transaction 對應」，而是同一筆 order 的 `mealPrice` vs `paidAmount`
- `calculateTransactionAmount` = `paidAmount - mealPrice`（ledger.ts:45-46）
- 未繳：paidAmount=0, mealPrice=90 → amount=-90
- 已繳：paidAmount=90, mealPrice=90 → amount=0

**改動**：
- `pos-components.tsx` RecentStrip：對 `type === 'order'` 的交易：
  - `remaining = Math.max(mealPrice - paidAmount, 0)`
  - `remaining > 0` → 顯示 `待繳費 ${remaining}`
  - `remaining === 0` → 顯示 `已繳費 ${mealPrice}`
- 其他 type（payment, expense）維持原顯示邏輯

### H5: F2 報表 crash（Critical）

**現狀**：點今日帳(F2) → `TypeError: a.forEach is not a function` at `LedgerGroupedTable.tsx`

**Root cause**（Codex review correction）：
- `LedgerGroupRow` 內的 `useDynamicRowHeight` 把單一 `HTMLElement` 傳給 `observeRowElements(rowRef.current)`
- react-window 的 `observeRowElements` 預期 `Element[] | NodeListOf<Element>`，內部呼叫 `.forEach()`
- 單一 HTMLElement 沒有 `forEach` method → crash

**改動**：
- `LedgerGroupedTable.tsx`：移除 `LedgerGroupRow` 裡的 per-row `useDynamicRowHeight` + `useEffect` + `rowRef`
- 改用外層 `List` 的統一 `rowHeight` function，依 `row.kind` 回傳固定高度（group header: 48px, detail: 36px, expense: 40px）
- 或改為 `observeRowElements([rowRef.current])` wrap 成 array（最小改動）

### H6: 金額編輯入口（Low — deferred to Batch 2）

**現狀**：使用者找不到編輯金額的地方。

**Codex 確認**：`editTransaction` 已存在於 store（posStore.ts:350-422），入口在報表 detail row 的「編輯」按鈕（LedgerGroupedTable.tsx:139-151, screens.tsx:104-116）。

**結論**：功能已存在，是 discoverability 問題。Deferred to Batch 2 UI 修復，不在此 hotfix 處理。可在 POS 的 RecentStrip 加 tap-to-edit 入口作為 Batch 2 項目。

## Success Criteria

- 所有現有 356 tests pass + 新增測試覆蓋 H1-H5
- H1-H5 修復後手動驗證通過
- `./workflow.sh t6` 全綠

## Required Tests

- **LedgerGroupedTable**: render with at least one grouped transaction，assert no crash
- **ActionBar/useKeyboardShortcuts**: selected student 只顯示 Q/W + R(cancel) button；R calls cancel-order handler；idle R no-op；E only from idle
- **RecentStrip**: order unpaid → 「待繳費 90」; order paid → 「已繳費 90」; payment/expense 各一筆正確顯示
- **Expense flow**: idle E → renders ExpensePanel input → type amount → Enter → reason step → confirm → committed
