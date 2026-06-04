# Frontend Improvement Roadmap — talented-easyorder

**日期**: 2026-05-15
**基礎文件**: `docs/superpowers/plans/2026-05-15-spec-conformance-audit.md`

---

## 1. Gap Resolution Plans (G1-G5)

### G1: Phase 2 iPad 人臉辨識自動化 — P2

**現狀**: `ipadHandoff.ts` 已定義 protocol（`validateIpadHandoffMessage`, `readHandoffIntent`, `toHandoffScannerInput`），`usePosFlow.ts` 已實作 `receiveIpadHandoff()` receiver boundary。但無人臉辨識模組。

**實作方式**:
1. iPad 端: 使用 WebRTC `getUserMedia()` + face-api.js 或 TensorFlow.js 進行本地人臉偵測
2. 辨識成功後 → 透過 WebSocket / BroadcastChannel 推送 studentId 到 PC 端
3. PC 端 `receiveIpadHandoff(channel)` 已 ready，只需接上 IPC channel

**依賴**: 無後端依賴；純前端可完成。需要 iPad 硬體 + 學生照片資料庫（Phase 2 前置需求）

**預估**: 3-5 天（含照片註冊流程）

---

### G2: iPad 本地照片註冊與建模 — P2

**現狀**: 無照片管理模組。

**實作方式**:
1. 在 iPad 端建立 `FaceRegistrationScreen`: 拍照 → 儲存 face descriptor 到 IndexedDB
2. 照片資料需與 studentId 綁定
3. 可透過 Google Sheets 或本地 JSON 匯出/匯入 face descriptors

**依賴**: 需要 iPad 鏡頭權限（HTTPS 或 localhost）；與 G1 共用 face-api.js

**預估**: 2-3 天

---

### G3: iPad 隱私顯示 — P2

**現狀**: iPad handoff 成功後 PC 端直接顯示完整 CustomerCard。

**實作方式**:
1. iPad 端 handoff 成功後顯示簡化 UI：學生姓名 + 綠色勾 + 訂餐數量
2. 不顯示餘額、欠款資訊
3. 可考慮在 `ipadHandoff.ts` 中定義 `IpadDisplayState`（僅 name + success indicator）

**依賴**: 無後端依賴；純前端 UI 調整

**預估**: 1 天

---

### G4: 跨 Sheet 自動遷移/封存 — P3

**現狀**: `businessDate.ts` 有關帳/重開機制，但關帳後不自動遷移交易到新 sheet。所有交易持續累積在同一 sheet。

**實作方式**:
1. 在 `closeBusinessDate()` 時觸發 `archiveTransactions(range)` 邏輯
2. 將已關帳日期的交易移到封存 sheet，原 sheet 僅保留當期活躍資料
3. 新學期/新月份自動建立新 sheet 或在新 sheet 上開始記帳

**依賴**: Google Sheets API（需要 service account 寫入權限）；目前 `ledgerSyncBoundary.ts` 已有 Google Sheets 讀寫基礎

**預估**: 2-3 天（含 API 測試）

---

### G5: 實體數錢機整合 — P3

**現狀**: `CashClosePanel.tsx` 需手動輸入 countedCash。

**實作方式**:
1. 若數錢機有 serial/USB HID 輸出 → 使用 Web Serial API 讀取
2. 若數錢機有藍牙輸出 → 使用 Web Bluetooth API
3. 解析數錢機輸出格式（通常為純數字），自動填入 countedCash 欄位

**依賴**: 數錢機硬體規格需確認；Web Serial / Web Bluetooth API 需要 HTTPS

**預估**: 2-5 天（視硬體 API 複雜度）

---

## 2. Deviation Resolution Plans (D1-D3)

### D1: Google Sheets 非唯一資料源 → **ACCEPT**

**理由**: 離線優先架構是正確的設計決策。本地 storage 為第一層持久層確保：
- 斷網時不遺失交易
- 櫃台操作零延遲
- Google Sheets 為 second source of truth（同步層）

**決議**: 接受此 deviation。不需要修改。

---

### D2: 跨 Sheet 自動遷移未實作 → **DEFER to P3**

**理由**: 目前單一 sheet 容量可支撐數萬筆交易。在達到 Google Sheets cell limit（10M cells）之前不需要自動遷移。

**觸發條件**: 當單一 sheet 行數超過 50,000 行或使用者回報效能問題時啟動。

**決議**: 延後至 P3。與 G4 合併處理。

---

### D3: iPad 人臉辨識為 Phase 2 scope → **DEFER to Phase 2**

**理由**: Phase 1 聚焦 PC 端核心帳務；Phase 2 的 protocol 已預留，receiver boundary (`receiveIpadHandoff`) 已實作且 tested。

**決議**: 延後至 Phase 2。Protocol 整合點已完成，不需額外前端準備工作。

---

## 3. Priority-Ordered Roadmap

### Phase 1.X — UX Polish (當前, 2026-05-15)

| 順序 | 項目 | 類別 | 預估 |
|------|------|------|------|
| 1 | ~~UX Round 1 (C1/H1/H2/L1/L5)~~ | ✅ Done | — |
| 2 | ~~UX Round 2 (H3/H4/M2/M3/M5)~~ | ✅ Done | — |
| 3 | ~~UX Round 3 (M4/M1/L2/L4)~~ | ✅ Done | — |
| 4 | ~~L3: VendorsScreen delete dialog~~ | ✅ Done | — |

**Phase 1.X 全部完成** — 無剩餘 LOW/MEDIUM UX 項目。

### Phase 1.1 — Stability & Observability (建議下一步)

| 順序 | 項目 | 說明 | 預估 |
|------|------|------|------|
| S1 | Error boundary + crash reporting | 全域 React error boundary，避免白畫面 | 1d |
| S2 | Google Sheets sync retry with backoff | `ledgerSyncBoundary.ts` 增加 exponential backoff | 1d |
| S3 | Transaction log viewer (dev only) | 開發者用 syncStatus 監控面板 | 0.5d |
| S4 | Playwright smoke tests | 核心 POS flow E2E（搜尋→訂餐→確認） | 2d |

### Phase 1.2 — Operational Enhancements

| 順序 | 項目 | 說明 | 預估 |
|------|------|------|------|
| O1 | Batch student import | CSV 匯入學生名冊（取代手動一個個加） | 1d |
| O2 | Menu presets / templates | 常用便當組合儲存與快速選擇 | 1d |
| O3 | Daily summary email | 關帳後自動寄送當日報表摘要 | 2d |

### Phase 2 — iPad Integration (future)

| 順序 | 項目 | 對應 Gap | 預估 |
|------|------|----------|------|
| P2-1 | Face registration module | G2 | 2-3d |
| P2-2 | Face recognition + handoff | G1 | 3-5d |
| P2-3 | iPad privacy display | G3 | 1d |

### Phase 3 — Scale & Hardware

| 順序 | 項目 | 對應 Gap | 預估 |
|------|------|----------|------|
| P3-1 | Cross-sheet archival | G4 / D2 | 2-3d |
| P3-2 | Cash counter integration | G5 | 2-5d |

---

## 4. Frontend-Only vs Backend-Dependent

### 純前端可完成

| 項目 | 說明 |
|------|------|
| G3: iPad privacy display | UI only |
| S1: Error boundary | React only |
| S4: Playwright smoke tests | E2E in browser |
| O1: Batch student import | CSV parse + store write |
| O2: Menu presets | Local storage + UI |
| P2-3: iPad privacy display | UI only |
| Phase 1.X polish items | All done |

### 需要 Google Sheets API（已有基礎）

| 項目 | 依賴 |
|------|------|
| G4: Cross-sheet archival | Sheets API write to archive sheet |
| S2: Sync retry with backoff | Sheets API（已有 `ledgerSyncBoundary.ts`） |
| O3: Daily summary email | Sheets API + email service (Apps Script or backend) |

### 需要硬體 / 原生 API

| 項目 | 依賴 |
|------|------|
| G1: Face recognition | iPad camera + face-api.js（HTTPS） |
| G2: Face registration | iPad camera + IndexedDB |
| G5: Cash counter integration | 數錢機硬體規格 + Web Serial / Bluetooth API |
