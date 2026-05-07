# iPad 人臉辨識訂餐系統 (POS) - 系統設計規格書

## 1. 系統架構：Local Master + Cloud Backup (DR)
本專案採「本地主機為主，雲端為輔」的離線優先架構，確保系統在任何網路環境下皆能達到 100% 穩定且「零延遲」的操作體驗。
- **PC 端 (Local Master)**：作為店內運算中心與主資料庫，負責所有的餘額扣款、點餐紀錄與報表產生。
- **iPad 端 (Sensor)**：作為感測器，當人臉辨識成功後，透過內部區網 (Intranet) 將學號推播至 PC 端。
- **雲端端 (Disaster Recovery)**：Google Sheets 僅作為災難復原備份與極端狀況下的手動操作區。

## 2. 技術選型 (Tech Stack)
全面採用 TypeScript 進行開發，兼顧跨平台 (Mac/Win11) 能力與開發速度。
- **前端 (Frontend)**：`React` + `Vite` + `TypeScript`
- **後端 (Backend)**：`Node.js` (Express 或 Hono) 
- **本地資料庫 (Local DB)**：`SQLite`
- **跨平台方案**：初期以純 Web (Browser + Node Server) 運行，驗證流程無誤後，可直接用 Electron 打包成 Windows 11 單一執行檔 (`.exe`)。

## 3. 資料流與備援機制 (Data Flow)
- **日常營運 (極致效能)**：所有的點餐、搜人、儲值扣款，皆直接在 PC 端的 SQLite 進行讀寫，達成毫秒級反應。
- **背景備份 (Background Push)**：每完成一筆交易，後端會在背景呼叫 Google Apps Script (GAS) API，將紀錄 `Append` 至 Google Sheets。此動作不阻塞前端 UI。
- **災難復原 (Restore)**：若 PC 毀損，管理員可開啟 Google Sheets 進行手動記帳。待新 PC 備妥後，點擊系統內的「從雲端還原」按鈕，完整下載 Sheets 資料並重建本地 SQLite。

## 4. 階段開發目標
- **Phase 1: PC 網頁核心 POS 系統 (當前原型重點)**
  - 建立 SQLite 核心邏輯與 API。
  - 實作前端 POS 介面（雙模快速搜尋、一單一作業自動結案）。
  - 完成與 Google Sheets 的單向備份串接。
- **Phase 2: iPad 人臉辨識模組**
  - 開發 iPad 端網頁/App，實作相機辨識。
  - 實作區網推播 (WebSocket 或 Local API) 將 ID 傳至 PC 端。

## 5. UI/UX 與隱私核心規範
- **一人一單作業**：嚴格執行「搜尋 -> 顯示 -> 動作 -> 自動結案」流程。
- **隱私保護 (Phase 2)**：iPad 僅顯示綠色成功回饋與姓名，絕對不顯示餘額與欠費資訊。
