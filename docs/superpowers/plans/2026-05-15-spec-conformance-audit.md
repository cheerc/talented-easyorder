# Spec Conformance Audit — talented-easyorder

**日期**: 2026-05-15
**參考規格**: `docs/iPad人臉辨識訂餐系統設計方案_V3.pdf`
**稽核對象**: frontend v0.0.0 (main branch, 224 tests)

---

## 1. Feature-by-feature Mapping

### 1.1 雙模快速搜尋 (Dual-mode Search)

| 規格需求 | 實作狀態 | 說明 |
|-----------|---------|------|
| 支援「編號直入」與「姓名模糊搜尋」 | ✅ | `posSearch.ts`: `resolveScannedStudent()` 支援 studentId 精確匹配 + displayName 模糊搜尋 |
| 搜尋框介面 | ✅ | `SearchBox` component in `pos-components.tsx`: 輸入框 + 下拉建議清單，支援鍵盤操作 (↑↓/Enter/Esc) |

### 1.2 一人一單作業 (One-at-a-time Transaction Flow)

| 規格需求 | 實作狀態 | 說明 |
|-----------|---------|------|
| 搜尋 → 顯示 → 動作 → 自動結案 | ✅ | `posFlow.ts` state machine: `idle` → `student_selected` → `committing` → `success` → (自動回 idle) |
| 每筆交易後自動復位 | ✅ | `dismissSuccess` → `{ kind: 'idle' }`，ConfirmBanner 關閉後回到 idle |
| 重複訂餐警告 | ✅ | `duplicate_warning` state: 今日已訂過則跳出確認對話 |

### 1.3 交易類型 (Transaction Types)

| 規格需求 | 實作狀態 | 說明 |
|-----------|---------|------|
| 訂餐 | ✅ | `mode: 'order'` — 扣便當款項，可選記帳或付現 |
| 儲值 | ✅ | `mode: 'topup'` — 純現金儲值到帳戶餘額 |
| 退餐 | ✅ | `mode: 'cancel'` — 取消當日訂餐，退回便當款 |
| 繳費 | ✅ | `order` mode + 付現 — 繳費同時訂餐 |

### 1.4 每日現金對帳 (Daily Cash Settlement)

| 規格需求 | 實作狀態 | 說明 |
|-----------|---------|------|
| 結算介面對比系統現金 vs 實際現金 | ✅ | `CashClosePanel.tsx`: 系統現金（netCash）vs 實際點算金額（countedCash） |
| 關帳備註 | ✅ | 一律要求輸入關帳備註（必填） |
| 差異顯示 | ✅ | 即時顯示差異金額，平帳顯示 ✓ |
| 關帳確認對話 | ✅ | 雙層確認：先填資訊 → 確認對話再確認 |
| 重開帳 | ✅ | `ReopenDialog.tsx`: 支援關帳後重開 |

### 1.5 資料同步至 Google Sheets

| 規格需求 | 實作狀態 | 說明 |
|-----------|---------|------|
| 全部交易紀錄即時同步 | ✅ | `ledgerSyncBoundary.ts` / `syncStatus.ts`: 交易標記 syncStatus (local/queued/synced/failed) |
| 線上/離線狀態指示 | ✅ | `TopBar`: 顯示「雲端已同步」/「離線中」+ 綠/紅點 |
| 排隊中交易計數 | ✅ | M4: counter badge 顯示「N 筆待傳」 |

### 1.6 資料庫結構 (Google Sheets)

| 規格需求 | 實作狀態 | 說明 |
|-----------|---------|------|
| 學生主檔 | ✅ | `posStore.ts`: students state (StudentAccount[]) |
| 交易流水帳 | ✅ | `posStore.ts`: transactions state (LedgerTransaction[]) |
| 每日結算總表 | ✅ | `businessDate.ts`: closeBusinessDate, getBusinessDateStatus |
| 一鍵結算遷移 / 封存 | ⚠️ 部分 | `businessDate.ts` 有關帳/重開機制；跨 sheet 自動遷移尚未實作（目前手動） |

### 1.7 更正與作廢 (Correction & Void)

| 規格需求 | 實作狀態 | 說明 |
|-----------|---------|------|
| 交易更正 | ✅ | `CorrectionDialog.tsx`: 更正交易金額與備註 |
| 交易作廢 | ✅ | `VoidDialog.tsx`: 作廢錯誤交易，產生反向沖銷記錄 |
| 關帳後鎖定 | ✅ | 關帳後更正/作廢按鈕停用，顯示「🔒 已關帳」 |

### 1.8 報表功能 (Reporting)

| 規格需求 | 實作狀態 | 說明 |
|-----------|---------|------|
| 當日交易統計 | ✅ | `ReportSummaryStats.tsx`: 總訂餐數、總收現、總欠款 |
| 學生分組帳務 | ✅ | `LedgerGroupedTable.tsx`: 依學生分組，可展開查看明細 |
| 日期範圍篩選 | ✅ | `ReportDateRangeControls.tsx`: 今日/本週/本月/自訂 |
| 匯出功能 | ✅ | `ExportActions.tsx`: 匯出 CSV |
| 學生搜尋篩選 | ✅ | H4: ReportScreen 有學生搜尋框 |

### 1.9 歷史紀錄與切換日期

| 規格需求 | 實作狀態 | 說明 |
|-----------|---------|------|
| 日期切換 | ✅ | `TopBar`: 日期選擇器（date input） |
| 歷史紀錄模式 | ✅ | 非今日日期 → historical_readonly，暫停結帳功能 |
| 歷史鎖定提示 | ✅ | 「目前檢視歷史紀錄」全頁提示 +「返回今日」按鈕 |

### 1.10 離線處理機制

| 規格需求 | 實作狀態 | 說明 |
|-----------|---------|------|
| 斷網暫存交易 | ✅ | syncStatus='local'/'queued'，本地先儲存 |
| 連線恢復自動補登 | ✅ | `ledgerSyncBoundary.ts`: 重新連線後推送排隊交易 |
| 離線狀態顯示 | ✅ | TopBar 顯示紅點 +「⚠ 離線中」 |

---

## 2. Deviations (實作與規格差異)

| # | 規格描述 | 實作差異 | 理由 |
|---|---------|---------|------|
| D1 | Google Sheets 作為唯一法律依據 | 實作使用 Google Sheets API 同步，但本地 storage 為第一層持久層 | 離線優先架構需求；本地資料不可遺失 |
| D2 | 一鍵結算遷移（跨 sheet） | 目前關帳後不自動遷移到新 sheet；僅標記 businessDate 狀態 | 單一 sheet 容量尚夠；自動遷移可延後至資料量瓶頸時再做 |
| D3 | Phase 2 iPad 人臉辨識 | `ipadHandoff.ts` 有 protocol 定義 + handoff receiver boundary，但無人臉辨識實作 | Phase 2 scope，已預留整合點 |

---

## 3. Extras (超出規格的實作)

| # | 功能 | 說明 | 正當性 |
|---|------|------|--------|
| E1 | 鍵盤全操作支援 | F1-F4 切換頁籤、Q/W/E 選交易模式、↑↓←→ 導航、Enter 確認、Esc 取消 | 櫃檯效率需求，減少滑鼠操作 |
| E2 | Undo（復原）機制 | 交易完成後 5 秒內可按復原按鈕取消交易 (`hardDeleteLocalDraft`) | 操作失誤防呆 |
| E3 | Tweaks Panel | 即時切換主題（亮/深/暖）與字體大小 | 開發/展示便利性 |
| E4 | 供應商管理頁 | `VendorsScreen`: 新增/編輯/刪除供應商 | 每日便當供應商需管理 |
| E5 | Admin 今日設定 | `AdminScreen`: 設定今日菜單、查看學生列表、重置資料 | 日常營運必要 |
| E6 | 快捷金額按鈕 | CustomerCard 有常見金額快速按鈕（90/100/200/500/1000） | 減少手動輸入時間 |
| E7 | 檢視歷史按鈕 | CustomerCard → 切換到 report tab 並自動展開該學生 | 快速查帳 |
| E8 | 學生摘要列 | LedgerGroupedTable 展開後顯示訂餐筆數、收現總計、淨變動 | 帳務核對效率 |

---

## 4. Gaps (規格有但尚未實作)

| # | 規格需求 | 優先級 | 備註 |
|---|---------|--------|------|
| G1 | Phase 2 iPad 人臉辨識自動化 | P2 | `ipadHandoff.ts` 已有 protocol 定義，face recognition module 待做 |
| G2 | iPad 本地照片註冊與建模 | P2 | 需 iOS native 功能 |
| G3 | iPad 隱私顯示（只顯示姓名、不顯示餘額） | P2 | Phase 2 UI |
| G4 | 跨 Sheet 自動遷移/封存 | P3 | 目前單 sheet 撐得住，需監控資料量 |
| G5 | 實體數錢機整合 | P3 | 目前手動輸入 countedCash |

---

## 5. 總結

- **Phase 1 核心規格**: 9/10 項目完全滿足（✅），1 項部分滿足（⚠️ 跨 sheet 遷移）
- **額外功能**: 8 項超出規格的 UX 增強
- **Phase 2**: 預留整合點，protocol 已定義
- **未實作缺口**: 5 項，全部為 Phase 2 / P3 優先級
