# RecentStrip 簡化 + E 訂餐狀況重新設計

> **Status**: Approved  
> **Date**: 2026-06-22  
> **Scope**: RecentStrip 展開移除、TransactionStatusView 重設計、CustomerCard DRY、檢視歷史就地顯示

## 1. 動機

「最近帳戶」（RecentStrip）列表中，點擊學生同時觸發「展開明細」和「跳到 E 訂餐狀況」，兩邊顯示的資訊重複。使用者希望簡化為：點擊直接跳到 E 訂餐狀況，不再展開明細。

同時，E 訂餐狀況面板存在多項 UX 問題需修正。

## 2. 變更項目

### 2.1 RecentStrip 簡化

**移除：**
- `expandedSids` state 和 `toggleExpand` 邏輯
- `RecentDetailRow` 子元件（展開明細列）
- Props：`onEditClick`、`onDeleteClick`（只在展開明細中使用）
- 展開圖示 `▾` / `▸`
- CSS：`.recent-details`、`.recent-detail-header`、`.recent-detail-row` 相關樣式

**保留：**
- 學生摘要列（姓名、便當數、餘額）
- `onStudentClick` prop（點擊 → 上層導航到該學生的 E 訂餐狀況）

**PosColumn 端連帶改動：**
- 移除傳給 RecentStrip 的 `onEditClick` / `onDeleteClick`
- `handleRecentEditClick` / `handleRecentDeleteClick` 保留（E 模式 TransactionStatusView 接手使用）

### 2.2 TransactionStatusView 重設計

**現況：** grid 佈局（時間 | 類型 | 收入 | 支出），字小、無操作按鈕、偏左顯示。

**目標：** 時間 + 類型 badge + 右對齊金額，附帶編輯/刪除按鈕。

**改動：**
- 移除「收入」「支出」雙欄 header，改為單行列表
- 每列：`時間` `類型badge` → 右側 `金額`（正數 +N 綠色、負數 −N 紅色）→ `操作按鈕`
- 新增 props：
  - `onEditClick?: (tx: LedgerTransaction) => void`
  - `onDeleteClick?: (tx: LedgerTransaction) => void`
  - `locked?: boolean`（日期 closed 時隱藏操作按鈕）
- 複用現有 `EditTransactionModal` + `DeleteConfirmDialog`（已在 PosColumn 層級實作）
- 字體放大至 `1rem`（原 `0.85rem`）
- 金額數字靠右對齊

### 2.3 CustomerCard DRY 重構

**現況：** Q（order）和 W（payment）的結帳明細是兩段幾乎相同的 JSX，差別僅在 Q 多一行「今日便當」。

**改動：**
- 提取共用 JSX 模式：「目前帳戶餘額」→（Q 才有的「今日便當」）→「此次繳費金額」→ divider →「預計結帳後餘額」
- 用一個 shared render block 配合 `mode` 條件，取代兩段重複 JSX
- E 模式維持獨立：顯示改良後的 TransactionStatusView

### 2.4 檢視歷史行為變更

**現況：** `onViewHistory` → `setReportStudentFilter(studentId)` + `setTab('report')` → 跳到報表畫面（今日帳 F2）。

**目標：** 留在 POS 畫面內，在 CustomerCard 區域顯示該學生「所有日期」的交易歷史。

**改動：**
- 新增 `focusZone` 值：`'view-history'`
- `onViewHistory` 改為 `setFocusZone('view-history')`
- CustomerCard 內，當 `focusZone === 'view-history'` 時：
  - 顯示該學生所有日期交易（從 `allTx` 篩選 `studentId`）
  - 排序：最新在最上
  - 每筆交易顯示日期 + 時間 + 類型 badge + 右對齊金額
  - 複用 TransactionStatusView 元件（需擴充支援跨日期資料、顯示日期分隔線）
  - 提供「返回」按鈕回到當前模式
- 需要把 `allTx` 傳入 PosColumn → CustomerCard 的 props chain
  - 新增 PosColumn prop：`allTransactions: LedgerTransaction[]`
  - CustomerCard 新增 prop：`allStudentTransactions?: LedgerTransaction[]`
  - 在 PosColumn 層用 `useMemo` 篩選 `allTx.filter(t => t.studentId === picked.studentId)` 並按 `createdAt` 降序排列

### 2.5 字體放大

- ActionBar `.mode-lbl`：放大（現有值視 CSS 而定，目標至少 `1rem`）
- TransactionStatusView 所有文字：`0.85rem` → `1rem`

## 3. 不變項（不動的東西）

- Q / W / E 三個 Tab 結構不變
- ActionBar 元件介面不變
- 報表畫面（ReportScreen）不受影響
- HistoryScreen 不受影響
- Store / domain layer 不變（純 UI 層改動）
- 現有的 `EditTransactionModal` 和 `DeleteConfirmDialog` 元件不改

## 4. 受影響檔案

| 檔案 | 改動類型 |
|------|---------|
| `frontend/src/components/pos/RecentStrip.tsx` | 大幅簡化 |
| `frontend/src/components/pos/TransactionStatusView.tsx` | 重新設計 |
| `frontend/src/components/pos/CustomerCard.tsx` | DRY 重構 + history view |
| `frontend/src/components/PosColumn.tsx` | Props 調整 |
| `frontend/src/components/PosColumn.types.ts` | Types 更新 |
| `frontend/src/App.tsx` | onViewHistory 行為修改 + allTx 傳遞 |
| `frontend/src/hooks/usePosColumnProps.ts` | Props 更新 |
| `frontend/src/styles/pos.css` | 樣式修改 |
| `frontend/src/components/pos/__tests__/*` | 測試更新 |
| `frontend/src/components/__tests__/pos-components.test.tsx` | 測試更新 |
