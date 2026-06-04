# 顯示方式調整需求與金流影響分析 - 實作計畫

## 背景
目前系統在顯示訂單與付款資訊時，會針對同一筆便當訂單出現多筆記錄，且付款沖銷後的金額呈現方式不易讓櫃檯人員快速判讀。本計畫旨在前端顯示與報表產出層面進行調整，在不改變底層交易資料結構的前提下，簡化重複訂單顯示、提供付款與訂購記錄之獨立分列沖銷（非合併至單一訂單列中），並為每日帳務提供兩種顯示模式（合併／原始）的切換功能。

---

## 預期異動與實作內容

### 1. 交易合併與分配邏輯 (Core Data Layer)
我們將在前端實作一組在執行期動態處理與合併交易的邏輯。
- **檔案**：`frontend/src/domain/ledger.ts`
- **新增型別定義**：
  ```typescript
  export interface MergedTransaction extends LedgerTransaction {
    depositAmount: number; // 儲值金額
    unpaidAmount: number;  // 待繳金額
  }
  ```
- **新增函式**：`mergeLedgerTransactions(transactions: LedgerTransaction[]): MergedTransaction[]`
  - 排除櫃台收支（`studentId === '__cashier__'`），櫃台收支保持原樣。
  - 將學員交易依照 `(studentId, businessDate)` 進行分群，並於各群內依時間正序排序。
  - 計算該學員在當天交易後的最終餘額（`endBalance`）。
    - 若 `endBalance < 0`：帳戶總欠費為 `Math.abs(endBalance)`。
    - 若 `endBalance > 0`：帳戶儲值金額為 `endBalance`。
  - 對於當天交易的學員：
    - 將當日同商品之重複訂單予以合併（保留最早時間戳記的「訂」記錄，其 `mealPrice` 累計）。
    - **繳費/儲值記錄不與訂單合併為同一行，而是獨立分列**，以保留時間先後的帳務流向。
    - 計算當天實收總額與應收總額，在時序上進行分配：
      - 對於合併後的訂單：其 `paidAmount` 為分配到的繳費金額，若學員有欠費（`endBalance < 0`），其 `unpaidAmount` 呈現帳戶總欠費。
      - 對於付款記錄：其 `depositAmount` 呈現該筆繳費在扣除今日便當費用後所剩餘的儲值金額。若仍有欠費（`endBalance < 0`），其 `unpaidAmount` 呈現帳戶總欠費。

---

### 2. 櫃台「最近 20 筆」交易清單 (POS Frontend)
- **檔案**：`frontend/src/components/pos-components.tsx`
- 調整 `RecentStrip` 元件，使其接收分列後之交易資料：
  - 當點選「訂」交易時：
    - 若 `unpaidAmount === 0`：顯示狀態標籤 `已繳費` (綠色)，金額顯示為已繳費金額。
    - 若 `unpaidAmount > 0`：顯示狀態標籤 `待繳費` (紅色)，金額顯示為待繳總金額（即該學員的當前未付欠費總計）。
  - 當點選「繳」交易時：
    - 若 `unpaidAmount === 0`：
      - 若 `depositAmount > 0`，顯示標籤 `儲值` (綠色)，金額呈現該筆付款的剩餘儲值金額。
      - 若無剩餘儲值，則維持原樣呈現該筆實收金額（例 `+180`）。
    - 若 `unpaidAmount > 0`：顯示標籤 `待繳費` (紅色)，金額顯示為欠費總計。
  - **顯示順序效果**：
    - **先儲值後訂餐**（例：9:30 儲值 200，9:35 訂餐 180）：
      - 訂餐 (09:35)：`已繳費 180`
      - 繳費 (09:30)：`儲值 20`
    - **先訂餐後儲值**（例：9:30 訂餐 180，9:35 儲值 200）：
      - 繳費 (09:35)：`儲值 20`
      - 訂餐 (09:30)：`已繳費 180`

---

### 3. 今日帳務報表切換視圖 (Report View)
- **檔案**：`frontend/src/components/screens.tsx` & `frontend/src/components/report/LedgerGroupedTable.tsx`
- 今日帳務報表提供「顯示模式」的切換按鈕（合併模式／原始模式），於合併模式下將明細呈現出分列的 `MergedTransaction`（含儲值與已付分配列，且不顯示個別編輯與刪除按鈕），而在原始模式下則顯示最完整之原始分筆。
- CSV 匯出支援兩種顯示模式，並包含 `deposit_amount` (儲值) 與 `unpaid_amount` (待繳) 欄位。

---

## 驗收標準 (Acceptance Criteria)
1. **重複訂單合併**：當同一個學員於同一天多次下單相同商品時，僅顯示一筆最早時間的「訂」記錄，且其待繳費金額正確累計所有欠款。
2. **付款與儲值獨立分列**：已繳與儲值不可合併於同一行。先儲值後訂便當應正確顯示訂單列為 `已繳費 [金額]`，繳費列為 `儲值 [餘額]`；先訂便當後儲值則相反。
3. **最近 20 筆更新**：列表能夠正確呈現上述分列與狀態（綠色與紅色）。
4. **帳務原始明細保留**：在原始模式下可完整對照每一筆原始交易。
5. **報表視圖與會計分錄正確**：可切換視圖且匯出資料之金額完全吻合。
