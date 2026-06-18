---
status: approved
date: 2026-05-18
complexity: complex+
batch: 4
review: gemini-6fca10 AGREE (1 CONCERN on F4-2→adopted), opencode-257ef1 AGREE (1 CONCERN on F4-2→adopted)
required_reads:
  - frontend/src/store/posStore.ts
  - frontend/src/hooks/usePosFlow.ts
  - frontend/src/domain/posFlow.ts
  - frontend/src/domain/ledger.ts
  - frontend/src/domain/posTransaction.ts
  - frontend/src/domain/ledgerReport.ts
  - frontend/src/components/pos-components.tsx
  - frontend/src/components/screens.tsx
  - frontend/src/components/report/ReportSummaryStats.tsx
  - frontend/src/components/report/LedgerGroupedTable.tsx
  - frontend/src/App.tsx
---

# Batch 4 — 會計正確性 + 收支流程修正

## Background

使用者驗證 Batch 1-3 成果後回報多項會計邏輯錯誤和收支流程問題。這些 bug 影響金額顯示正確性和基本操作流程，屬於 P0 必修。

origin/main: `a0ba4e8`

## Issues

### F4-1: 儲值 flash 餘額雙重計算（Critical）

**現狀**：學生餘額 0，儲值 500 → flash banner 顯示「+$500 餘額$1,000」，但學生訂餐介面正確顯示 $500。

**根因**：`App.tsx:449-463` — `flashData` 計算：
```tsx
after: picked.currentBalance + (amt - mealPrice),
```
`commitPosTransactionDraft` 已在 `posStore.ts:150-151` 更新 `student.currentBalance` 為 500。`picked` 反映更新後的值（500），再加 `amt - mealPrice`（500 - 0 = 500）→ 1000。

**改動**：
- `App.tsx` flashData 計算：`after` 直接使用 `picked.currentBalance`（已是交易後餘額），不再重複加 amount
- 同步修正 `detail` 字串中的金額顯示，確保 payment mode 顯示正確

**影響檔案**：`App.tsx`

---

### F4-2: 收支完成後狀態卡住（Critical）

**現狀**：輸入一筆收入或支出後，「新增 收入/支出」按鈕無法再使用，必須重新整理。

**根因**：expense commit 完成後 state 轉為 `success`（`posFlow.ts:177-178`），但：
1. expense 流程中 `picked = null`（無選定學生）
2. `App.tsx:450` — `if (!isSuccess || !picked) return null` → `flashData = null`
3. `ConfirmBanner` 收到 `flash=null` → 不顯示任何 dismiss UI
4. `hasFlash = state.kind === 'success'`（line 363）→ `true` → search disabled、keyboard disabled
5. 唯一出路是手動重整

**改動**（Review 後採方案二）：
- 讓 expense 也產生 flashData，提供復原按鈕（財務安全性）
- `App.tsx` flashData 計算：用 `picked === null` 偵測 expense mode（`success` state 不攜帶 `mode` 欄位，故改用此判斷）
- 當 `picked === null && isSuccess` 時，生成虛擬 flashData：
  ```tsx
  // expense flash — no student involved
  return {
    id: flashKey,
    name: '櫃台',
    sid: '',
    detail: /* 從最新 expense transaction 讀取 note + amount */,
    amount: /* 從最新 expense transaction 讀取 */,
    after: 0, // expense 不影響學生帳戶
  };
  ```
- 需同步修改 `ConfirmBanner` 的 undo handler：expense undo 只刪除 transaction（不需退還學生餘額）
- 注意：`dismissFlash` callback 已包含 `dismissSuccess()`（line 199），flash banner 消失後 state 會正確回到 idle

**影響檔案**：`App.tsx`

---

### F4-3: 收入流程不應共用支出 reason（High）

**現狀**：
1. 選「收入」後，進入 reason 選擇，選項是 ['付便當錢', '其他原因']（支出專用）
2. 選收入時應直接跳出輸入原因的視窗（備註輸入），不需經過 reason 選擇

**根因**：
- `posFlow.ts:133-141` — `reduceExpenseDirection` 不區分 direction，統一轉到 `expense_reason`
- `pos-components.tsx:626` — `EXPENSE_QUICK_OPTIONS = ['付便當錢', '其他原因']` 是支出專用

**改動**：
- `posFlow.ts` `reduceExpenseDirection`：當 `direction === 'income'` 時，直接跳到 `expense_other_note`（跳過 reason 選擇）
  ```
  case 'expenseSelectDirection':
    if (event.direction === 'income') {
      return { kind: 'expense_other_note', amount: state.amount, direction: 'income' };
    }
    return { kind: 'expense_reason', amount: state.amount, direction: event.direction };
  ```
- `posFlow.ts` `reduceExpenseReason`：保持支出邏輯不變（只有支出會走到這步）
- `pos-components.tsx` ExpensePanel `expense_reason` step：reason 選項維持不變，但此步驟現在只有支出會到達

**影響檔案**：`posFlow.ts`

---

### F4-4: 最近 5 筆收入顯示為「支」（High）

**現狀**：輸入收入 500，RecentStrip 顯示 '支' badge 和支出金額格式。

**根因**：`pos-components.tsx:604-607` — badge 邏輯：
```tsx
r.type === 'expense' ? '支' : ...
```
income 和 expense 共用 `type: 'expense'`，無法區分。

**改動**：
- `pos-components.tsx` RecentStrip badge 邏輯：
  ```
  r.type === 'expense'
    ? (r.paidAmount > 0 ? '收' : '支')  // income: paidAmount > 0; expense: mealPrice > 0
    : ...
  ```
- CSS：加 `.type-income` 樣式（綠色 accent），`.type-expense` 樣式（紅色 warn）
  - 動態 className：`'type-' + (r.type === 'expense' ? (r.paidAmount > 0 ? 'income' : 'expense') : r.type)`

**影響檔案**：`pos-components.tsx`, `index.css`

---

### F4-5: 今日帳看不到現金流記錄（High）

**現狀**：報表頁（今日帳）完全看不到收入/支出記錄。收支紀錄是錯的（收入也顯示為支出）。

**根因**：
1. `screens.tsx:63-65` — `expenseRows` 正確過濾 `type === 'expense'`
2. `ledgerReport.ts:117-118` — `groupLedgerRowsByStudent` 跳過 `CASHIER_SENTINEL`：
   ```
   if (tx.studentId === CASHIER_SENTINEL) continue;
   ```
   所以 expense/income transactions 不出現在 grouped table 中
3. `LedgerGroupedTable` 接收 `expenseRows` prop，但可能沒有正確渲染收入 vs 支出的區分

**需確認**：讀取 `LedgerGroupedTable.tsx` 和 `ReportSummaryStats.tsx` 確認渲染邏輯

**改動**：
- `ReportSummaryStats`：確認收入和支出分開顯示
  - 收入（income）：`type === 'expense' && paidAmount > 0`
  - 支出（expense）：`type === 'expense' && mealPrice > 0`
  - 兩者應使用不同顏色（綠/紅）
- `LedgerGroupedTable`：確認 expense section 正確區分收入/支出，每筆顯示方向和備註
- `ledgerReport.ts` `calculateLedgerTotals`：現有邏輯（line 95-102）已正確區分 income vs expense，確認無需修改

**影響檔案**：`components/report/ReportSummaryStats.tsx`, `components/report/LedgerGroupedTable.tsx`, 可能 `screens.tsx`

---

### F4-6: 最近 5 筆 order 顯示邏輯修正（High）

**現狀**：RecentStrip 用 `paidAmount >= mealPrice` 判斷已繳費/待繳費，不反映學生帳戶餘額狀態。

**期望行為**（使用者定義）：
- 帳戶餘額 500，訂便當 90 → 「已繳費 90」（綠）→ 餘額 410
- 帳戶餘額 50，訂便當 90 → 「待繳費 40」（紅）
- 帳戶欠款 400，訂便當 90 → 「待繳費 490」（紅）
- 訂餐未繳費（待繳費 90），繳費 50 → 繳費條目顯示「待繳費 40」（紅）

**核心邏輯**：使用 `afterBalance`（= `previousBalance + amount`）判斷：
- `afterBalance >= 0` → 「已繳費 {mealPrice}」（綠色）
- `afterBalance < 0` → 「待繳費 {|afterBalance|}」（紅色）

**根因**：`pos-components.tsx:610-616` — 現有邏輯：
```tsx
r.paidAmount >= r.mealPrice
  ? `已繳費 ${fmt(r.mealPrice)}`
  : `待繳費 ${fmt(r.mealPrice - r.paidAmount)}`
```
只看單筆 paidAmount，不看帳戶狀態。

**改動**：
- `pos-components.tsx` RecentStrip amount 顯示：
  ```
  r.type === 'order'
    ? (r.afterBalance >= 0
        ? `已繳費 ${fmt(r.mealPrice)}`       // 綠色
        : `待繳費 ${fmt(Math.abs(r.afterBalance))}`)  // 紅色
    : r.type === 'payment'
      ? (r.afterBalance >= 0
          ? `+${fmt(r.paidAmount)}`            // 綠色（繳清或有餘額）
          : `待繳費 ${fmt(Math.abs(r.afterBalance))}`) // 紅色（仍欠款）
      : // expense/income（afterBalance 固定為 0，用 amount 判斷）
        r.paidAmount > 0
          ? `+${fmt(r.paidAmount)}`              // 收入（綠色）
          : `−${fmt(r.mealPrice)}`               // 支出（紅色）
  ```
- CSS：`.pos` class 綠色、`.neg` class 紅色（已存在），確保正確套用
- **注意**：`afterBalance` 已存在於 `LedgerTransaction` 介面（`ledger.ts:14`），RecentStrip 的 `recent` prop 已包含此欄位

**影響檔案**：`pos-components.tsx`, 可能 `index.css`

---

### F4-7: 開帳金額儲存一次後失效（Medium）

**現狀**：AdminScreen 儲存開帳金額後，再次修改並點儲存無效。

**根因**：`posStore.ts:102-118` — `openCashSession` action：
```tsx
if (state.cashSessions[input.businessDate]) return state; // ← 擋住所有後續呼叫
```
第一次呼叫建立 cashSession，之後的呼叫被 guard 直接忽略。

**改動**：
- `posStore.ts`：新增 `updateOpeningCash(businessDate, amount)` action，直接更新 `cashSessions[businessDate].openingCash`
  - 保留 `openCashSession` 的 one-shot guard（首次建立語意不變）
  - `updateOpeningCash` 需檢查 `dateStatus !== 'closed'`，已關帳日期不可修改開帳金額
- `screens.tsx` AdminScreen：
  - 首次 vs 更新的條件判斷放在 AdminScreen 層（非 App 層）：檢查 `cashSessions[viewDate]` 是否存在，決定呼叫 `openCashSession` 或 `updateOpeningCash`
  - 儲存後加視覺反饋（如短暫顯示「已儲存」toast）
  - 已關帳日期（`dateStatus === 'closed'`）時 disable 開帳金額輸入 + 儲存按鈕
- `App.tsx`：傳遞 `dateStatus` 和 `updateOpeningCash` 給 AdminScreen

**影響檔案**：`posStore.ts`, `App.tsx`, `screens.tsx`

---

## Test Impact

| Issue | Affected Tests | 預期變更 |
|-------|---------------|---------|
| F4-1 | 新增 flashData 計算 test | 驗證 payment 後 after = currentBalance（非雙重計算）|
| F4-2 | `pcPosFlow.integration.test.tsx` | 新增 expense success auto-dismiss test |
| F4-3 | `posFlow.test.ts` | 更新 income direction → 直接到 note step |
| F4-4 | 新增 RecentStrip badge test | income → '收', expense → '支' |
| F4-5 | `reportScreen.integration.test.tsx` | 新增/更新 expense section 顯示 test |
| F4-6 | 新增 RecentStrip afterBalance display test | 驗證各種 balance 場景的顯示 |
| F4-7 | 新增 openingCash update test | 驗證可重複儲存 |

## Success Criteria

- 所有現有 363 tests pass + 新增 tests
- `npx tsc --noEmit` + `npm run lint` + `npx vitest run` + `npm run build` 全綠
- 手動驗證：
  - 儲值 500 → flash 顯示餘額 $500（非 $1,000）
  - 收入流程：選收入 → 直接輸入備註 → 完成後可再次點擊「新增 收入/支出」
  - 最近 5 筆：收入顯示「收」（綠），支出顯示「支」（紅）
  - 最近 5 筆：order 用 afterBalance 判斷已繳費/待繳費
  - 今日帳正確分列收入/支出
  - 開帳金額可重複修改儲存
