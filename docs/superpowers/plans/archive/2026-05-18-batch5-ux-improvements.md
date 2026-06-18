---
status: approved
date: 2026-05-18
complexity: simple
batch: 5
review: gemini-6fca10 AGREE, opencode-257ef1 AGREE
required_reads:
  - frontend/src/hooks/useKeyboardShortcuts.ts
  - frontend/src/components/pos-components.tsx
  - frontend/src/components/screens.tsx
  - frontend/src/App.tsx
  - frontend/src/domain/posFlow.ts
---

# Batch 5 — UX 微調

## Background

使用者驗證 Batch 1-3 成果後提出的 UX 改善需求。這些不涉及會計邏輯正確性，但影響操作效率和使用體驗。

依賴：Batch 4（會計修正）應先完成再執行 Batch 5，避免修改同一檔案產生衝突。

origin/main: `a0ba4e8`（Batch 4 merge 後的 SHA 將更新）

## Issues

### F5-1: Q/W/E 快捷鍵在收支介面應無效（Medium）

**現狀**：進入「新增 收入/支出」流程後，按 Q/W 會 blur number input（因 useKeyboardShortcuts 在 expense flow 中仍然 enabled）。

**根因**：`App.tsx:366` — shortcuts enabled 條件：
```tsx
enabled: tab === 'pos' && !hasFlash,
```
expense flow 狀態（`expense_input`、`expense_direction`、`expense_reason`、`expense_other_note`）下 `tab === 'pos'` 且 `hasFlash === false`，所以 shortcuts 仍生效。

`useKeyboardShortcuts.ts:43-56` — Q/W 按下時，若 target 是 number input，會執行 `blur()` 再觸發 `changeMode`。

**改動**：
- `App.tsx:366` — 擴展 disabled 條件：
  ```tsx
  const isExpenseFlow = state.kind === 'expense_input' || state.kind === 'expense_direction'
    || state.kind === 'expense_reason' || state.kind === 'expense_other_note';
  // ...
  enabled: tab === 'pos' && !hasFlash && !isExpenseFlow,
  ```

**影響檔案**：`App.tsx`

---

### F5-2: 移除「本次繳費」預設金額按鈕（Low）

**現狀**：訂餐模式的「本次繳費」區塊下方有快速金額按鈕列（90, 100, 200, 500, 1000）。使用者認為不需要。

**程式碼位置**：`pos-components.tsx:371-381` — `pay-quick-grid` 區塊

**改動**：
- `pos-components.tsx` CustomerCard：移除 order mode 的 quick button grid
  - 條件移除：`mode === 'order'` 時不渲染 `pay-quick-grid`
  - payment mode 的 quick buttons 保留（[100, 500, 1000, 2000, 3000]）
- `getQuickAmounts`（line 13-25）：函式保留（payment mode 仍用），但 order 分支可標記為 unused 或一併清除

**影響檔案**：`pos-components.tsx`

---

### F5-3: 取消訂單後應回到首頁（Medium）

**現狀**：ConfirmDialog 確認取消訂單後，訂單被刪除但仍停留在學生訂餐介面（CustomerCard）。

**程式碼位置**：`App.tsx:645-648` — ConfirmDialog onConfirm：
```tsx
onConfirm={() => {
  handleDeleteOrder();
  setCancelDialogOpen(false);
}}
```

**改動**：
- `App.tsx` ConfirmDialog onConfirm：取消訂單後加 `cancelFlow()` 回到 idle：
  ```tsx
  onConfirm={() => {
    handleDeleteOrder();
    setCancelDialogOpen(false);
    cancelFlow();
  }}
  ```

**影響檔案**：`App.tsx`

---

### F5-4: TopBar ◀▶ 改為切日（非切月）（Medium）

**現狀**：◀▶ 按鈕切換上/下個月的 1 號。使用者認為切日更實用。

**程式碼位置**：`pos-components.tsx:62-83` — TopBar date buttons

**改動**：
- `pos-components.tsx` TopBar：
  - ◀ 按鈕：`d.setDate(d.getDate() - 1)` 取代 `d.setMonth(d.getMonth() - 1); d.setDate(1);`
  - ▶ 按鈕：`d.setDate(d.getDate() + 1)` 取代 `d.setMonth(d.getMonth() + 1); d.setDate(1);`
  - title 屬性：「上個月」→「前一天」，「下個月」→「後一天」

**影響檔案**：`pos-components.tsx`

---

### F5-5: 訂餐繳費 placeholder 移除（Low）

**現狀**：訂餐模式的付款金額 input 顯示 placeholder "0"。使用者覺得多餘。

**程式碼位置**：`pos-components.tsx:365`
```tsx
placeholder={mode === 'order' ? "0" : "輸入金額"}
```

**改動**：
- `pos-components.tsx`：order mode placeholder 改為空字串
  ```tsx
  placeholder={mode === 'order' ? "" : "輸入金額"}
  ```

**影響檔案**：`pos-components.tsx`

---

### F5-6: 「訂購其他餐點」展開後排版修正（Medium）

**現狀**：點擊「訂購其他餐點」後展開欄位，排版為：
```
本筆價格 <number input>
品項/原因 <text input>
取消改價
```

**期望排版**：
```
品項   <text input>
價格   <number input>
取消
```

**程式碼位置**：`pos-components.tsx:315-340` — `price-override-fields`

**改動**：
- `pos-components.tsx` price-override-fields：
  1. 調換欄位順序：品項（text input）在前，價格（number input）在後
  2. label 文字：「本筆價格」→「價格」，「品項/原因」→「品項」
  3. 按鈕文字：「取消改價」→「取消」

**影響檔案**：`pos-components.tsx`

---

### F5-7: 修改開帳金額需跳出警示（Medium）

**前置**：依賴 F4-7（開帳金額可重複儲存）完成後才有意義。

**現狀**：修改開帳金額直接儲存，無警告。

**期望**：修改已設定的開帳金額時，彈出 ConfirmDialog 警告「修改開帳金額會影響今日所有帳務計算」。

**改動**：
- `screens.tsx` AdminScreen：
  1. 檢查 `cashSessions[viewDate]` 是否已存在
  2. 若已存在且新金額 ≠ 舊金額 → 彈出 ConfirmDialog（「修改開帳金額會影響今日所有帳務計算」）
  3. 確認後才呼叫 `updateOpeningCash`（F4-7 新增的 action）
  4. 首次設定（尚無 cashSession）不需要警告
  5. 已關帳日期（`dateStatus === 'closed'`）→ disable 輸入欄 + 儲存按鈕，不可修改

**影響檔案**：`screens.tsx`

---

## Test Impact

| Issue | Affected Tests | 預期變更 |
|-------|---------------|---------|
| F5-1 | `useKeyboardShortcuts` 相關 test | 新增 expense flow 下 Q/W 無效的 test |
| F5-2 | `pcPosFlow.integration.test.tsx` | 確認 order mode 無 quick buttons |
| F5-3 | 可能新增 cancel-order-returns-idle test | 驗證 cancel 後 state = idle |
| F5-4 | TopBar test | 更新 ◀▶ 預期為 ±1 day |
| F5-5 | 無（CSS/placeholder only） | — |
| F5-6 | 無（layout only） | — |
| F5-7 | 新增 opening cash confirm dialog test | 驗證重複設定觸發 dialog |

## Success Criteria

- 所有現有 tests pass + 新增 tests
- `npx tsc --noEmit` + `npm run lint` + `npx vitest run` + `npm run build` 全綠
- 手動驗證：
  - 進入收支流程後 Q/W/E 鍵無反應
  - 訂餐的「本次繳費」區塊無快速金額按鈕
  - 取消訂單 → 自動回到搜尋/首頁
  - ◀▶ 切換前一天/後一天
  - 訂餐付款欄位無 placeholder "0"
  - 訂購其他餐點：品項→價格→取消
  - 修改已設定的開帳金額 → 跳出確認 dialog
