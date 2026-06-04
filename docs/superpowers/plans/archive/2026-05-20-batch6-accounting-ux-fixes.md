# Implementation Plan — Batch 6: Accounting & UX Fixes

> Generated: 2026-05-20
> Addresses: all user annotations in commit `43c80149ee69d0e29f4d2c4f98dcb23a1ab30707`

---

## Issue Inventory (extracted from commit diff)

| # | Source | Issue | Severity |
|---|--------|-------|----------|
| B6-1 | F4-1 | Q/W 切換模式後，焦點應自動移至金額輸入框；在金額輸入框中按 Q/W/E 仍能切換模式 | UX |
| B6-2 | F4-2 extra-1 | 收入/支出 flash banner 的「餘額」欄位應顯示**櫃台淨現金**，而非硬編碼 0 | Bug |
| B6-3 | F4-2 extra-2 | 輸入備註後按 Enter，flash banner 不跳出（Enter 事件被 ConfirmBanner 的 window keydown 搶走） | Bug |
| B6-4 | F4-3 extra-1 | RecentStrip 中 `__cashier__` + `櫃台` 文字重疊（40px 的 `.recent-id` 欄位塞不下） | UI |
| B6-5 | F4-3 extra-2 | expense_direction / expense_reason 狀態下，鍵盤 ← → 無法選擇按鈕、Enter 無法確認 | UX |
| B6-6 | F4-3 extra-3 | expense_other_note 輸入欄位被 `.pay-input-container` 的 80px 固定高度壓住，鍵盤提示與輸入框重疊 | UI |
| B6-7 | F4-4 extra-1 | 「收」badge 背景/文字顏色不理想（橘色底+咖啡色字），需要統一 RecentStrip badge CSS | UI |
| B6-8 | F4-4 extra-2 | RecentStrip 中收支記錄希望顯示備註前 4 字（如「支 繳便當費 500」） | Feature |
| B6-9 | F4-5 extra-1 | 總交易筆數包含未繳費的訂單，應只計算有現金流的交易 | Bug |
| B6-10 | F4-5 extra-2 | LedgerGroupedTable「櫃台 收入/支出」只顯示標題，底下完全沒有行（expense rows 不渲染） | Bug |
| B6-11 | F4-6 extra-1 | 同一學生多筆訂單顯示方式混亂（待繳費金額逐步累加不直觀）— **暫緩，需獨立設計** | Design |
| B6-12 | F4-6 extra-2 | 繳費銷帳邏輯（優先抵銷最舊欠款）— **暫緩，需獨立設計** | Design |
| B6-13 | F4-7 extra-1 | 關帳時出現「報表區塊發生錯誤」 | Bug |
| B6-14 | F4-7 extra-2 | 今日開帳金額應 = 昨日實際關帳金額（countedCash），每日報表獨立 | Feature |
| B6-15 | 整合 extra-1 | 學生今天已訂過便當 → 再次選擇時預設模式應為 W（繳費） | UX |
| B6-16 | 整合 extra-2 | 新增快捷鍵 A → 進入收入/支出模式 | Feature |

> [!IMPORTANT]
> **B6-11、B6-12（訂單合併顯示 + 銷帳邏輯）涉及核心帳務結構變動，本批次暫緩。**
> 將另開 Batch 7 設計文件處理。

---

## Proposed Changes

---

### 1. POS 金額輸入焦點 & 快捷鍵 (B6-1, B6-16)

#### [MODIFY] [pos-components.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/components/pos-components.tsx)
**CustomerCard (L357-365)**: 為金額 input 加上 `ref`，新增 `useEffect` 監聽 `mode` 變化時自動 `.focus()`。  
**同時保留 Q/W/E 在 number input 中可用的行為**（`useKeyboardShortcuts` 已對 `type="number"` 放行，無需改動）。

#### [MODIFY] [useKeyboardShortcuts.ts](file:///Users/cheerc/talented-easyorder/frontend/src/hooks/useKeyboardShortcuts.ts)
- 新增 optional callback `enterExpenseMode?: () => void`。
- 新增快捷鍵 `a`：在 idle 狀態（`!isStudentSelected`）且非 text input 時呼叫 `enterExpenseMode()`。
- 抑制規則與 Q/W/E 相同（text/search/email/password/url/tel input 中不觸發）。

#### [MODIFY] [App.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/App.tsx)
- 傳入 `enterExpenseMode` 至 `useKeyboardShortcuts`。

---

### 2. Expense Flash Banner 顯示淨現金 (B6-2)

#### [MODIFY] [App.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/App.tsx)
**flashData memo (L412-444)**: expense flash 目前 `after: 0`，改為計算櫃台淨現金：

```ts
// 計算當日櫃台淨現金 = Σ(收入 paidAmount) - Σ(支出 mealPrice) for type=expense
const counterNetCash = allTx
  .filter(t => t.studentId === '__cashier__' && t.type === 'expense')
  .reduce((sum, t) => sum + (t.paidAmount > 0 ? t.paidAmount : -t.mealPrice), 0);
```

將 `after: 0` 改為 `after: counterNetCash`。

---

### 3. 備註 Enter 被 ConfirmBanner 搶走 (B6-3)

#### 根因分析
`ExpensePanel` 的 `expense_other_note` 狀態下，使用者在 input 按 Enter → `onKeyDown` 先觸發 `onNoteConfirm` → reducer 轉為 `committing` → `useEffect` 觸發 `commitTransaction` → 成功後轉為 `success` → `ConfirmBanner` 的 `useEffect` 註冊 window keydown 監聽 Enter → **同一輪事件冒泡**讓 ConfirmBanner 的 listener 立刻 dismiss。

#### [MODIFY] [pos-components.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/components/pos-components.tsx)
**ExpensePanel expense_other_note onKeyDown (L748-753)**: 在 `onNoteConfirm` 呼叫後加上 `e.stopPropagation()` 不夠（因為 ConfirmBanner 的 listener 是 window 層級）。

正確修法：**在 `onNoteConfirm` 的 input onKeyDown 中加上 `e.nativeEvent.stopImmediatePropagation()`**，阻止同一 keydown 事件傳遞到 window 上其他 listener。

---

### 4. RecentStrip `__cashier__` 文字重疊 (B6-4)

#### [MODIFY] [pos-components.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/components/pos-components.tsx)
**RecentStrip (L602)**: 將 cashier 的 ID 欄位隱藏（`__cashier__` 無意義給使用者看）：

```tsx
<span className="recent-id mono">
  {r.studentId === '__cashier__' ? '' : r.studentId}
</span>
```

#### [MODIFY] [index.css](file:///Users/cheerc/talented-easyorder/frontend/src/index.css)
RecentStrip grid 的第二欄 `40px` 足夠顯示 3 位數字編號但塞不下 `__cashier__`；隱藏 ID 後名稱欄位自然有足夠空間。無需改動 grid。

---

### 5. ExpensePanel 鍵盤導航 (B6-5)

#### [MODIFY] [pos-components.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/components/pos-components.tsx)
**ExpensePanel (L658-768)**: 為 `expense_direction` 和 `expense_reason` 兩個步驟新增鍵盤導航：

1. 新增元件內部 state `selIdx`（預設 0）。
2. 新增 `useEffect` 註冊 window keydown 監聽：
   - `ArrowLeft` / `ArrowRight` → 切換 `selIdx`
   - `Enter` → 觸發對應的 `onDirectionSelect` / `onReasonSelect`
   - `Escape` → `onCancel()`
3. 為選中按鈕加上 CSS ring outline：`outline: 2px solid var(--accent); outline-offset: 2px`。
4. `useEffect` cleanup 時移除 listener。

---

### 6. Expense Note 輸入欄位佈局修正 (B6-6)

#### [MODIFY] [pos-components.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/components/pos-components.tsx)
**ExpensePanel expense_other_note (L740-764)**: 將外層 `className="pay-input-container"` 改為普通 `div`（去掉 `.pay-input-container` 類名），避免被 CSS 的 80px 固定高度壓縮。改用自訂佈局：

```tsx
<div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px 0' }}>
  <span className="dim" style={{ fontSize: '12px' }}>備註（必填）</span>
  <input ... />
  <div className="dim" style={{ fontSize: '12px', marginTop: '4px' }}>
    <span className="kbd">↵</span> 確認 · <span className="kbd">Esc</span> 取消
  </div>
</div>
```

---

### 7. RecentStrip Badge CSS 統一 (B6-7)

#### [MODIFY] [index.css](file:///Users/cheerc/talented-easyorder/frontend/src/index.css)
將 `.type-income` 的配色從 `accent-soft/accent-ink`（橘/咖啡色調）改為明確的綠色調：

```css
.type-income {
  background: rgba(34, 197, 94, 0.15);
  color: #16a34a;
}

.type-payment {
  background: rgba(34, 197, 94, 0.15);
  color: #16a34a;
}

.type-expense {
  background: rgba(239, 68, 68, 0.15);
  color: #dc2626;
}
```

同時新增 `.recent-amt.neg` 樣式以確保紅色數字正確渲染。

---

### 8. RecentStrip 備註前 4 字 (B6-8)

#### [MODIFY] [pos-components.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/components/pos-components.tsx)
**RecentStrip (L603)**: 在名稱後方附加備註縮寫：

```tsx
<span className="recent-name">
  {r.studentNameSnapshot}
  {r.note && r.type === 'expense' && (
    <span className="dim" style={{ fontSize: '11px', marginLeft: '4px' }}>
      {r.note.slice(0, 4)}
    </span>
  )}
</span>
```

---

### 9. 總交易筆數修正 (B6-9)

#### [MODIFY] [ledgerReport.ts](file:///Users/cheerc/talented-easyorder/frontend/src/domain/ledgerReport.ts)
**calculateLedgerTotals (L111)**: 將 `transactionCount: transactions.length` 改為只計算有現金流的交易：

```ts
transactionCount: transactions.filter(t =>
  t.type !== 'order' || t.paidAmount > 0
).length,
```

邏輯：order 且 paidAmount=0 的記錄（純記帳/欠款）不計入「總交易」。payment、expense、已付費 order 都計入。

---

### 10. LedgerGroupedTable 櫃台 rows 不顯示 (B6-10)

#### 根因（已確認）
`LedgerGroupedTable` 的 `expenseSection`（L202-230）中，income/expense rows 的 grid 模板是 7 欄（`80px 60px 100px 1fr 1fr 1fr auto`），但每個 row 只渲染了 **6 個子 div**（time, type, amount, dash, note, actions），**少了一欄**。

CSS grid 在子元素少於欄數時，會把多餘的空欄推到行尾，導致 `actions` 按鈕被擠到看不到的地方，而且如果 `height` 設為固定值且 overflow hidden，整行可能視覺上看不見。

同時 `posStore.ts` L147 確認 expense 交易的 `studentId` 被正確設為 `CASHIER_SENTINEL`（`__cashier__`），`screens.tsx` 的 `expenseRows` 過濾條件 `t.type === 'expense'` 也正確。**問題純粹是 grid 子元素數量不匹配。**

#### [MODIFY] [LedgerGroupedTable.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/components/report/LedgerGroupedTable.tsx)
將 expense section 的 grid 模板改為 5 欄（不需要 studentId 和 studentName 欄位）：

```
gridTemplateColumns: '80px 60px 1fr 1fr auto'
```

對應 5 個子 div：時間、類型、金額、備註、操作。

---

### 11. 關帳「報表區塊發生錯誤」(B6-13)

#### 根因分析
需要追蹤 `closeBusinessDate` 呼叫後的錯誤。最可能的原因：
- `CashClosePanel` 或 `ReportScreen` 在 `dateStatus` 變為 `'closed'` 後重新渲染時，某個元件存取了 undefined 屬性。
- `ErrorBoundary` 包住了 report section，錯誤被捕獲顯示為「報表區塊發生錯誤」。

#### [MODIFY] [screens.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/components/screens.tsx)
在 `ReportScreen` 中用 `try/catch` 和 defensive coding 保護：
- `CashClosePanel` 的 `queuedRowCount` prop 加上 fallback。
- 關帳後 `dateStatus === 'closed'` 時 `CashClosePanel` 仍渲染（需要看關帳後的狀態），確保 props 不為 undefined。

**具體方案**：在實作階段用 browser devtools 捕獲實際的 error stack trace 來定位根因。

---

### 12. 今日開帳金額 = 昨日 countedCash (B6-14)

#### [MODIFY] [screens.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/components/screens.tsx)
**ReportScreen (L51)**: 目前 `openingCash = currentCashSession?.openingCash ?? 4000`。改為：

```ts
const dailySettlements = usePosStore((s) => s.dailySettlements);
const yesterdayStr = (() => {
  const d = new Date(viewDate);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
})();
const yesterdaySettlement = dailySettlements.find(
  s => s.businessDate === yesterdayStr && s.status === 'closed'
);
const defaultOpeningCash = yesterdaySettlement?.countedCash ?? 4000;
const openingCash = currentCashSession?.openingCash ?? defaultOpeningCash;
```

#### [MODIFY] [App.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/App.tsx)
同理更新 AdminScreen 傳入的 `openingCash` fallback。

---

### 13. 學生已訂過便當 → 預設繳費模式 (B6-15)

#### [MODIFY] [posFlow.ts](file:///Users/cheerc/talented-easyorder/frontend/src/domain/posFlow.ts)
**selectStudent event (L22)**: 新增 `hasOrderToday?: boolean`。  
**reduceIdle (L78)** & **reduceStudentSelected (L101)**: 預設 mode 改為：

```ts
mode: event.hasOrderToday ? 'payment' : 'order'
```

#### [MODIFY] [usePosFlow.ts](file:///Users/cheerc/talented-easyorder/frontend/src/hooks/usePosFlow.ts)
**selectStudent callback (L74-77)**: 傳入 `hasOrderToday`：

```ts
const selectStudent = useCallback((studentId: string, source: PosSelectionSource) => {
  const searchTextHint = state.kind === 'idle' ? state.searchText : '';
  const hasOrderToday = countActiveOrdersForStudent(transactions, studentId, args.businessDate) > 0;
  dispatch({ type: 'selectStudent', studentId, source, searchTextHint, hasOrderToday });
}, [state.kind, state.searchText, transactions, args.businessDate]);
```

---

## Deferred Items (Batch 7)

| # | Issue | Reason |
|---|-------|--------|
| B6-11 | 同學多筆訂單合併顯示 (訂x4 待繳費 360) | 需要重新設計 RecentStrip 資料結構和展開互動 |
| B6-12 | 繳費銷帳邏輯（優先抵銷最舊欠款） | 核心帳務邏輯變動，需要獨立驗證計畫 |

---

## Verification Plan

### Automated Tests
```bash
cd frontend && npx vitest run
```
- 確保現有 363 個測試全部通過
- 新增單元測試：
  - `posFlow.test.ts`: `selectStudent` 帶 `hasOrderToday=true` → mode 為 `payment`
  - `ledgerReport.test.ts`: `calculateLedgerTotals` 排除未付費 order
  - `cashClose.test.ts`: 開帳金額繼承昨日 countedCash

### Manual Verification
1. **B6-1**: Q → 焦點在金額框 → 直接輸入 500 → Enter → 確認
2. **B6-2**: 新增收入/支出 → flash 顯示正確淨現金
3. **B6-3**: 輸入備註 → Enter → flash 跳出（不被立即 dismiss）
4. **B6-4**: RecentStrip 無文字重疊
5. **B6-5**: expense 方向選擇畫面 ← → Enter 可操作
6. **B6-6**: 備註輸入欄位不與外框重疊
7. **B6-7**: 「收」badge 為綠色底
8. **B6-8**: RecentStrip 顯示備註前 4 字
9. **B6-9**: 總交易不含未付費訂單
10. **B6-10**: 櫃台收入/支出區塊正確渲染每一筆
11. **B6-13**: 關帳不再出現「報表區塊發生錯誤」
12. **B6-14**: 今日開帳金額 = 昨日關帳金額
13. **B6-15**: 已訂過便當的學生 → 預設繳費模式
14. **B6-16**: idle 畫面按 A → 進入收入/支出模式
