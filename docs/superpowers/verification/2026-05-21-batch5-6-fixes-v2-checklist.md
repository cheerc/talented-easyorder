# Batch 5-6 Fixes v2 — Verification Checklist

## Test Chain (自動化)
- [x] t1 `npx tsc --noEmit` — PASS
- [x] t2 `npm run lint` — PASS (1 pre-existing warning: expenseProps dep)
- [x] t3 `npx vitest run` — 48 files, 385 tests PASS
- [x] t4 `npm run build` — PASS

## R1 Rework (PR #51 review findings)

### §3.1 價格修改區域 + 便當統計過濾
- [x] App.tsx todayCount: 加入 `menuNameSnapshot` + `mealPrice` 過濾
- [x] index.css: 加入 `.price-override`（border-top dashed 分隔 + 間距）
- [x] index.css: 加入 `.price-override-fields`（flex gap: 12px, 淺色虛線卡片）

### §3.2 RecentStrip 容量
- [x] `slice(0,5)` → `slice(0,12)`
- [x] 標題 "最近 5 筆" → "最近 12 筆"

### §1.2 IdleHero 按鈕 CSS
- [x] 按鈕改用 `.mode` class（與 ActionBar Q/W/E 統一）
- [x] `<span className="mode-key">A</span>` + `<span className="mode-lbl">新增 收入/支出</span>`
- [x] `style={{ flex: 'none', width: 'auto' }}`

### §3.4 RecentStrip expense 分欄
- [x] expense 有備註: `recent-amt-lbl`（備註）+ `recent-amt-val`（金額）分欄結構
- [x] expense 無備註: 僅 `recent-amt-val`
- [x] CSS: `.recent-row` grid 第 5 欄 140px 固定
- [x] CSS: `.recent-amt` flexbox `justify-content: space-between`
- [x] CSS: `.recent-amt-lbl` 左對齊、overflow ellipsis、color ink-3
- [x] CSS: `.recent-amt-val` 右對齊、flex-shrink: 0

### §4 CSS 重複
- [x] index.css: 移除重複的 `.rpt-detail-actions` block

## §1.1 搜尋框自動聚焦
- [x] 初始載入：搜尋框不自動聚焦
- [x] 按下數字鍵：自動填入數字 + 聚焦搜尋框
- [x] Escape：清除文字 + blur 搜尋框
- [x] App.tsx: `searchFocusKey` state 傳入 SearchBox
- [x] SearchBox useEffect: `focusKey > 0` guard

## §1.2 按鈕 DRY
- [x] IdleHero 按鈕文字: `新增 收入/支出 (A)`（無重複）

## §1.4 Escape 返回上層
- [x] expense_direction cancel → expense_input
- [x] expense_reason cancel → expense_direction
- [x] expense_other_note cancel (income) → expense_direction
- [x] expense_other_note cancel (expense) → expense_reason
- [x] ExpensePanel: kind 變化時 selIdx 重置為 0
- [x] posFlow.test.ts: 4 個新 test case PASS

## §2.1 NumericInput DRY + E 快捷鍵
- [x] NumericInput.tsx 新建: forwardRef, onKeyDown block [-+eE.], onChange /^\d*$/, onWheel blur
- [x] NumberField.tsx 內部改用 NumericInput
- [x] CustomerCard payAmount → NumericInput
- [x] CustomerCard priceOverride → NumericInput
- [x] ExpensePanel amountText → NumericInput
- [x] AdminScreen price → NumericInput
- [x] AdminScreen openingCashDraft → NumericInput
- [x] CashClosePanel countedCash → NumericInput
- [x] useKeyboardShortcuts: primary shortcut bypass (q/w/e/a/escape/enter)

## §3.4 RecentStrip 重複標籤
- [x] expense 類型: recent-amt 不再顯示重複的 收/支
- [x] 保持左側 recent-type badge 顯示收/支

## §4.1 關帳崩潰
- [x] CashClosePanel props 解構補上 `businessDate`

## §4.2 帳本表格 detail row
- [x] Detail row 7 欄: 時間 + 類型 + 姓名(佔位) + 當日應付 + 當日實收 + 餘額 + 備註/操作
- [x] Detail row `padding: '0 18px'`
- [x] CSS `.rpt-detail-row::before` left: 6px
- [x] CSS `.counter-row::before { display: none; }`
- [x] expenseSection 的 income/expenseOnly row 加上 `counter-row` class
- [x] `.rpt-detail-actions` + `.rpt-detail-note` CSS 新增

## §4.3 首次開帳 dialog
- [x] handleSaveOpeningCash: 一律 showOpeningCashConfirm (移除 hasCashSession 條件)
- [x] ConfirmDialog: hasCashSession → variant="danger" / 修改開帳金額
- [x] ConfirmDialog: !hasCashSession → variant="primary" / 設定開帳金額
