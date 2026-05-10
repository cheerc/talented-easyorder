# iPad 人臉辨識訂餐系統 (POS) - 系統設計規格書 (v2.0)

## 1. 系統架構：Local Master + Cloud Backup (DR)
本專案採「本地主機為主，雲端為輔」的離線優先架構。
- **PC 端 (Local Master)**：核心運算中心。目前已實作高保真前端原型，採用 Zustand + Persistence 確保資料在瀏覽器重新整理後不遺失。
- **後端擴充 (Planned)**：未來將補齊 Node.js + SQLite 達成真正的跨裝置服務。
- **雲端同步 (Planned)**：透過 GAS API 將每筆交易即時備份至 Google Sheets。

## 2. 核心交易邏輯 (Accounting Engine)
系統不再採用單一餘額扣款，而是記錄每一動作的原始屬性：
- **訂餐 (Order)**：產生 `mealPrice` (負項) 與可選的 `paidAmount` (正項)。
- **儲值 (Topup)**：僅產生 `paidAmount` (正項)。
- **退餐 (Cancel)**：反向產生 `mealPrice` (正項) 並可選產生物理退現 `paidAmount` (負項)。
- **餘額計算**：`NewBalance = OldBalance + (paidAmount - mealPrice)`。

## 3. UI/UX 互動規範
- **Action-Grid 佈局**：左側為交易預覽與「交易後預估餘額」，右側為大字級輸入面板。
- **全鍵盤操作**：支援 `Q` (訂餐)、`W` (儲值)、`E` (取消) 快速鍵與 `Enter` 快速結案。
- **二層式報表**：今日帳採「學員匯總列」為主，點擊展開「流水帳明細」為輔，兼顧清爽與追溯。

## 4. 階段開發進度
- [x] **Phase 1.1: 高保真前端原型** (已達成)
  - 實作 Premium UI 與動畫。
  - 完成雙欄會計邏輯。
  - 實作分組報表與即時統計。
- [ ] **Phase 1.2: 後端持久化與同步** (待啟動)
  - 串接 Node.js + SQLite。
  - 實作 Google Sheets 背景推播。
- [ ] **Phase 2: iPad 相機模組** (待啟動)

## 5. 隱私核心規範
- **一人一單作業**：嚴格執行「搜尋 -> 顯示 -> 動作 -> 自動結案」流程。
- **隱私保護 (Phase 2)**：iPad 僅顯示綠色成功回饋與姓名，絕對不顯示餘額與欠費資訊。
