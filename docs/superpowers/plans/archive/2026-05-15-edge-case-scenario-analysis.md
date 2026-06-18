# Edge Case Scenario Analysis — talented-easyorder

> **日期**: 2026-05-15
> **基準**: origin/main `99be298`, 224 tests
> **參考規格**: `docs/iPad人臉辨識訂餐系統設計方案_V3.pdf` + 6 domain specs
> **方法**: 邊界案例 + 多角色操作流程 + spec 對照

---

## 1. 邊界案例情境

### 1.1 大量訂單日 (200+ 筆交易)

**預期行為**:
- POS 鍵盤操作流暢，每筆交易 < 5 秒
- Report 頁面可捲動，grouped table 正常展開/收合
- 資料不因筆數增加而遺失

**目前實作分析**:

| 面向 | 狀態 | 說明 |
|------|------|------|
| POS commit 效能 | ✅ 可接受 | `commitPosTransactionDraft` 是 O(1) array spread + O(n) student find，200 筆約 < 1ms |
| Report 篩選效能 | ✅ 可接受 | `getEffectiveLedgerRows` + `filter` + `groupLedgerRowsByStudent` 皆為 O(n)，200 筆 < 5ms |
| 記憶體 | ✅ 可接受 | 每筆 ~500 bytes，200 筆 = ~100KB，微不足道 |
| UI 捲動 | ⚠️ 潛在問題 | `LedgerGroupedTable` 無虛擬化，200 個學生群組的 grouped table 若全部展開會產生上千行 DOM，可能 lag |
| SearchBox 效能 | ✅ 可接受 | 搜尋建議每次 onChange 過濾 students 陣列，通常 < 100 人 |

**建議**:
- 400+ 筆時考慮 `LedgerGroupedTable` 加入虛擬捲動 (react-window)
- 無需立即處理 — 單日 200 筆對現代瀏覽器仍可接受

### 1.2 網路頻繁斷線/恢復 (Network Flapping)

**預期行為**:
- 斷線時標記離線，交易繼續
- 恢復時自動推送 queue
- 頻繁切換不產生 duplicate rows

**目前實作分析**:

| 面向 | 狀態 | 說明 |
|------|------|------|
| 斷線偵測 | ✅ | `navigator.onLine` + online/offline events (PR #9) |
| 離線交易 | ✅ | syncStatus 設為 `queued`，本地先存 |
| 自動補登 | ⚠️ 僅有 boundary | `ledgerSyncBoundary.ts` 定義了 queueable payload 結構，但實際 sync worker 尚未實作 (僅為 boundary/interface) |
| Idempotency | ⚠️ 僅有定義 | `buildTransactionQueuePayload` 產生 stable idempotencyKey (`tx:<id>:v<revision>`)，但 transport 層未實作 |
| 重複預防 | ✅ schema 層 | transactionId 使用 `crypto.randomUUID()`，理論上不碰撞 |
| Flapping 保護 | ❌ 無 | 沒有 debounce/throttle，online/offline events 連發時可能觸發多次 sync 啟動 |

**潛在問題**:
1. **(HIGH)** Sync worker 未實作 — 離線交易永遠停留在 `queued`，不會自動補登。目前的「雲端已同步」標籤只反映 online 狀態，不等於 data 已 sync。
2. **(MEDIUM)** Network flapping 無 debounce — 建議加入 5s debounce 後再觸發 sync worker。

**建議**:
- Phase 1.4: 實作 sync worker（Google Sheets API transport + retry + idempotency）
- 加入 `online` event debounce (5s)

### 1.3 日結後發現錯帳 — 修正流程

**預期行為** (per spec):
- 已關帳日期不可直接編輯
- 需 reopen → 更正 → reclose
- 每次 reopen/reclose 產生新的 settlement revision
- 更正操作記錄 audit event

**目前實作分析**:

| 面向 | 狀態 | 說明 |
|------|------|------|
| 關帳鎖定 | ✅ | `getBusinessDateStatus === 'closed'` → POS historical lock + report 按鈕停用 |
| Reopen 機制 | ✅ | `ReopenDialog.tsx` + `reopenBusinessDate()` + reason required |
| Reclose (revision) | ⚠️ 部分 | `DailySettlement` 有 `settlementRevision` 欄位，但 store 層的新 revision 建立邏輯待驗證 |
| Audit events | ✅ | `ledgerAudit.ts` 有 createVoidTransaction/createCorrectionTransaction/createLedgerAuditEvent |
| 跨日更正 | ✅ | 任何 `businessDate` 的關帳狀態獨立，reopen 該日期後可更正該日交易 |

**完整流程**:
1. 主任發現錯帳 → Report tab → 選擇該日期
2. 看到「🔒 已關閉」→ 點「重新開啟日期」→ 輸入原因 → 確認
3. 日期變為 `reopened` → 找到錯誤交易 → CorrectionDialog/VoidDialog
4. 更正完成 → CashClosePanel 再次關帳（新 revision）
5. 關帳記錄有 v1 (原關帳) + v2 (修正後關帳)

**潛在問題**:
1. **(MEDIUM)** Audit trail 無法直接檢視 — audit events 存在 store 但無 UI 顯示。主任無法看到「誰在何時 reopen/修正了什麼」的完整軌跡。
2. **(LOW)** Reopen 後的 reclose 要求所有欄位重新填寫（countedCash、note），與第一次關帳相同的 UX。

### 1.4 跨日操作 (Midnight Boundary)

**預期行為**:
- `systemDate` 隨實際日期自動更新
- 23:59 的交易屬於今天，00:01 的交易屬於明天
- 不會因跨日而寫入錯誤的 `businessDate`

**目前實作分析**:

| 面向 | 狀態 | 說明 |
|------|------|------|
| systemDate | ⚠️ Mount-time snapshot | `useMemo(() => new Date().toISOString().split('T')[0], [])` — `systemDate` 在 App mount 時固定，不會隨時間更新 |
| businessDate | ⚠️ 手動切換 | `viewDate` 初始為 systemDate，可透過 TopBar date input 手動改變 |
| 跨夜操作 | ⚠️ 潛在錯誤 | App 若在 23:55 開啟，操作到 00:10，systemDate 仍為前一天。操作員若不手動切換日期，交易會寫入錯誤的 `businessDate` |
| 日期邊界 | ✅ | 所有交易以 `businessDate` 為準，非 wall clock |

**潛在問題**:
1. **(MEDIUM)** `systemDate` 為 mount-time snapshot，不隨午夜更新。操作員跨夜操作需手動切換日期，若忘記則交易日期錯誤。
2. **(LOW)** 無午夜自動提醒 — 可在 23:55 顯示 banner 提醒「即將跨日，請確認日期」。

**建議**:
- `systemDate` 改用 `setInterval` 每 60 秒更新（或 watch `document.visibilitychange`）
- 日結前自動檢查 `viewDate === systemDate`，若不一致顯示提醒

### 1.5 多 iPad 同時操作衝突

**預期行為** (per spec):
- 多個裝置獨立操作，各自產生 local transactions
- Sync 到 Google Sheets 時依 idempotency key 合併
- Conflict rows 顯示在 report 中

**目前實作分析**:

| 面向 | 狀態 | 說明 |
|------|------|------|
| 獨立操作 | ✅ | 每個裝置有獨立 Zustand persist/localStorage |
| 交易隔離 | ✅ | `crypto.randomUUID()` 保證 transactionId 全域唯一 |
| Conflict detection | ⚠️ 未實作 | `syncStatus` 有 `conflict` 值，但無 conflict detection logic |
| 合併策略 | ❌ 無 | 無 CRDT 或最後寫入勝出策略 |

**潛在問題**:
1. **(MEDIUM)** Sync worker 未實作，多裝置場景目前無法測試。Conflict detection/resolution 僅有 schema 定義，無 logic。
2. **(LOW)** 同一學生在兩台裝置上各訂一份便當 → balance 同時扣兩次 → sync 後可能一方 balance 不正確。取決於 sync 時的合併策略。

**建議**:
- Phase 2 (iPad handoff) 實作時一併處理 conflict resolution
- 目前單裝置部署可接受此限制

---

## 2. 多角色操作流程

### 2.1 新手合作社阿姨 — 從開機到一日營運

**完整流程**:

```
08:00 開機 → 打開瀏覽器 → 看到 POS 畫面 (IdleHero)
         → 檢查今天菜單是否正確 (Admin tab F3)
         → 返回 POS (F1)
12:00 開始訂餐 → 輸入學號 → Enter → Q 訂餐 → 輸入金額 → Enter
               → 看到 ✓ flash → 下一位
13:00 結束 → Report tab (F2) → 查看今日統計
           → CashClosePanel 輸入實際現金 → 備註 → 關帳
           → 匯出 CSV → 下班
```

**UX 盲點**:

| 步驟 | 潛在問題 | 目前支援 |
|------|---------|---------|
| 首次使用 | 不知道 F1-F4 切換 | M1: IdleHero 有鍵盤提示 |
| 確認菜單 | Admin 功能簡單直覺 | ✅ |
| 高峰期操作 | 可能手忙腳亂 | ✅ keyboard flow |
| 關帳 | 可能不理解「系統現金 vs 實際現金」 | H1: 強制手輸 countedCash |
| 匯出 | ExportActions onExportCsv 目前為 `() => {}` (no-op) | ❌ CSV export 未實作 |

**關鍵缺口**:
1. **(HIGH)** CSV 匯出為 no-op — spec 要求 CSV export with stable columns，但目前 `ExportActions.onExportCsv` 是空函數。
2. **(MEDIUM)** 無「今日 SOP checklist」引導新手依序完成開機→檢查→營運→關帳。

### 2.2 主任月底結算 — 跨日期查詢、匯出、對帳

**完整流程**:

```
月底 → Report tab (F2) → 日期範圍選「本月」
     → 瀏覽 grouped table → 展開各學生 → 查看摘要列
     → 對照每日 settlement records → 確認所有日期已關帳
     → 匯出 CSV → 寄給行政
     → 查特定學生 → H4 搜尋框輸入姓名 → 查看歷史
```

**UX 盲點**:

| 步驟 | 潛在問題 | 目前支援 |
|------|---------|---------|
| 跨月查詢 | 日期範圍「本月」只覆蓋當前月 | ⚠️ 無上月/自訂月份 preset |
| Settlement history | 無 UI 顯示所有日期的 settlement 列表 | ❌ dailySettlements 存在 store 但無列表 UI |
| 對帳 | 只能手動比對 | ⚠️ 無自動 reconciliation |
| CSV export | no-op | ❌ |
| 學生歷史 | H4 搜尋 + H3 檢視歷史 | ✅ |

**關鍵缺口**:
1. **(HIGH)** 無 Settlement History 列表 — 主任無法一次看到所有日期的關帳狀態（哪天已關、哪天未關、現金差異）。
2. **(MEDIUM)** CSV export 未實作（同 2.1）。
3. **(LOW)** 日期範圍 preset 不支援跨月自訂區間（如「上個月」）。

### 2.3 臨時替代人員 — 接手未完成日結

**完整流程**:

```
下午接手 → 看到 POS 畫面
         → 查看 Report tab → 發現當天未關帳
         → cashClosePanel 看到 countedCash 空白（無預填）
         → 點算現金 → 輸入金額 → 輸入備註 → 關帳
         → 不知道前面操作員做了什麼 → 查看 RecentStrip
```

**UX 盲點**:

| 步驟 | 潛在問題 | 目前支援 |
|------|---------|---------|
| 了解當日狀態 | 不知道哪些已做、哪些待做 | ⚠️ 無 dashboard |
| 關帳接管 | countedCash 空白 — 接手者必須自己數錢 | ✅ H1: 空白預設 |
| 歷史紀錄 | RecentStrip 只顯示最近 5 筆（反向排序） | ⚠️ 不足以了解全日操作 |
| 異常交易 | 不知道前面有無更正/作廢 | ⚠️ audit events 無 UI |
| 操作筆記 | 無交接備註欄位 | ❌ |

**關鍵缺口**:
1. **(MEDIUM)** 無「今日狀態摘要」dashboard — 接手者需要快速了解：已幾筆交易、是否有人做過更正、關帳狀態、待同步筆數。
2. **(LOW)** 無接班筆記/交接功能。

---

## 3. Spec 對照驗證

對照 6 份 domain spec + PDF 規格，逐一檢驗邊界案例相關要求：

### 3.1 Order Ledger And Cash Close Spec

| 要求 | 狀態 | 邊界缺口 |
|------|------|---------|
| CSV export with stable columns | ❌ | onExportCsv 為 no-op |
| Print view with full layout | ❌ | onPrint 僅 `window.print()` |
| Sync status blocking close | ✅ | failed/conflict 阻擋關帳 |
| Settlement revision on reclose | ⚠️ | schema 支援，logic 待驗證 |
| Audit UI | ❌ | audit events 存在但無顯示 |
| Post-close balance recalculation | ✅ | getEffectiveLedgerRows |

### 3.2 PC POS Order Flow Spec

| 要求 | 狀態 | 邊界缺口 |
|------|------|---------|
| Persistent searchText after cancel | ✅ | PR #11 L4 修復 |
| Barcode/QR scan input | ⚠️ | boundary 定義，無 scanner hardware |
| iPad handoff preselect (no auto-order) | ⚠️ | ipadHandoff.ts protocol 定義，integration 待做 |
| Error state retry | ✅ | posFlow error state with retryable flag |

### 3.3 Google Sheets Sync And Offline Spec

| 要求 | 狀態 | 邊界缺口 |
|------|------|---------|
| Online/offline detection | ✅ | PR #9 |
| Local durable queue | ✅ | Zustand persist |
| Idempotency keys | ⚠️ | schema 層有定義，transport 未實作 |
| Auto-retry on reconnect | ❌ | sync worker 未實作 |
| Conflict resolution | ❌ | 只有 `conflict` status 定義 |
| Health check before sync | ❌ | 未實作 |
| Restore from Sheets | ❌ | 未實作 |

---

## 4. 發現摘要與優先順序

### 🔴 HIGH — 需立即處理

| # | 問題 | 影響 |
|---|------|------|
| H-E1 | CSV export 為 no-op (`ExportActions.onExportCsv = () => {}`) | 主任月底無法匯出對帳 |
| H-E2 | Sync worker 未實作 — 離線交易永遠 queued | 離線功能形同虛設 |

### 🟡 MEDIUM — 下個 Phase 處理

| # | 問題 | 影響 |
|---|------|------|
| M-E1 | systemDate 為 mount-time snapshot，不隨午夜更新 | 跨夜操作可能寫錯日期 |
| M-E2 | 無 Settlement History UI — 主任無法綜覽關帳狀態 | 月底對帳效率低 |
| M-E3 | 無 audit trail UI — 看不到更正/作廢/reopen 軌跡 | 帳務核對無從查證 |
| M-E4 | 無今日狀態 dashboard — 替代人員無法快速了解狀況 | 接班困難 |
| M-E5 | 200+ 筆交易時 LedgerGroupedTable 無虛擬化 | 大量交易可能 lag |

### 🟢 LOW — 改進建議

| # | 問題 |
|---|------|
| L-E1 | 午夜無跨日提醒 |
| L-E2 | 無接班筆記/交接功能 |
| L-E3 | 無「上個月」日期 preset |
| L-E4 | Multi-device conflict resolution 未實作 (Phase 2 才需要) |
| L-E5 | Network flapping debounce 未實作 |

---

## 5. 建議

1. **Phase 1.4 優先**: CSV export 實作 + sync worker 基礎 transport（即使只是 mock/skeleton）
2. **Phase 1.5**: Settlement history UI + audit trail UI + 今日狀態 dashboard
3. **Phase 2**: iPad handoff integration + multi-device conflict resolution
4. **系統性修復**: systemDate 改為動態更新 + 午夜提醒
