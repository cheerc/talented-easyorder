# 本地整合審查收據（U3 + U2b + U4）

- 精確 HEAD：`3bfa4d6df86f595287bf529fb9cfa825a905daaa`
- 來源 SHA：
  - U3：`efaa9ce221b4a51625069deddf9b1ee11cba5370`
  - U2b：`4827cc6b3f55a473a1ee2674ddd0dea469389659`
  - U4：`b38563c90b8ed35f7d516d388970128820d9a98c`
- 祖先確認：`git merge-base --is-ancestor` 已確認三者皆包含於本整合歷程中。
- 性質與邊界：此為本地整合獨立審查（review）通過紀錄，非 merge／push 授權；不變更三個 PR heads，未修改正式後端受保護檔案，未 push，未 merge main。

## 合併衝突解法核對

檢查 merge commit `359a0fd03e69b29ca13713a9875c3dc8032e97a6`：App／AppRouter／AdminScreen／ReportSummaryStats.test／spec 同時保留：

- **F3 學員管理**：編號排序、缺號列、碰撞保留、編輯改號理由與確認、交易紀錄入口、停用帳戶退款。
- **App 導向與快捷鍵 guard**：`historyLookupTarget` 消費與離頁清除，頂部切頁和快捷鍵均走清除路徑。
- **退款流程**：明確 `studentId` 的退款 handler、不依賴 F1 picked；退款 modal guard、manualFlash、5 秒 undo 路徑。
- **報表與用語**：`ReportSummaryStats` 的「今日餐點」新用語與獨立「退款」卡片、淨現金公式「收現 − 支出 − 退款」。
- **規格文件**：spec §8.4 新用語對照表與退款交易筆數定義共存。
- **領域模型與校驗**：audit amount 標籤、refund validator、draft 建造器、ledger 算式與 props 傳遞皆完整保留，未見整合遺失。

## 完整 App 跨功能驗證與真實 Persist 重載

已將 review 期間使用之完整 App 驗證與真實 persist reader 測試移植為 repo 永久測試：`frontend/src/__tests__/integrationApp.test.tsx`。

驗證內容（全數通過，無 skip）：

1. **完整 App F3 停用改號後退款、精確 F5 與離開後 target 清除、真實 storage 新 reader 重載**：
   - 完整 App 實際從 F3 編輯停用 `005`，輸入 `009`／理由並按「確認改號」；再直接點「退款 009」退款 $120，初始 300 → 180，仍維持停用。
   - 退款對話框開啟時，Q/W/E/F1/F2/F3/F5/方向鍵/Enter 不穿透。
   - 點「交易紀錄 009」進入 F5，精確帳戶摘要為 `009 整合甲`，不混入 `0090 整合乙`，退款理由清晰可見；F1 離開後 F5 重入回到預設結帳歷史，無舊 target 殘留。
   - **真實 persist 與重載核對**：
     - 讀取 App 使用的真實 storage（namespace `pos-storage`），確認 saved students／refund／student_code_changed 存在。
     - 用新的 `createStore(persist(..., createPosPersistenceConfig()))` reader，以空資料作初始，執行 `reader.persist.rehydrate()`；載入後資料與 writer 完全相等，舊號／新號稽核查詢保留，無回填範例帳戶。
     - 卸載 App，暫停寫入後將原 singleton 記憶體重設為 initial state（確認整合甲不在記憶體中），恢復原 storage，實際呼叫 `persist.rehydrate()`，再掛載完整 App。從 F3「交易紀錄 009」進 F5，仍正確顯示現在餘額 $180 及整合離班退款。
   - **限制說明**：此為 jsdom 環境下真實 `localStorage` fallback pipeline 與 remount 驗證，非 Chromium 實體瀏覽器之 IndexedDB reload 或人工瀏覽器驗收。
2. **完整 App F3 改號退款後以實際撤回按鈕恢復餘額**：
   - 改號後退款，切換至 F1 點擊畫面真實「撤回」按鈕，交易移除、餘額恢復 300、成功 flash 橫幅清除。
3. **完整 App 改號退款後撤回按鈕倒數 5 秒消失，退款仍保留**：
   - 改號後退款，實際等待 countdown，撤回按鈕在 5 秒倒數結束後消失；退款及餘額 180 穩定保留。測試耗時約 5.4 秒，驗證真實 effect／timer 機制。

## 原模組整合測試（層級定位說明）

`frontend/src/__tests__/crossFeatureIntegration.test.tsx` 4 cases 通過，其驗證層級明確定位於：
- 元件單元（`TransactionStatusView`、`RefundDialog`）
- 報表純函式算式（`calculateLedgerTotals`）
- 稽核 Presenter 與查詢匹配函式（`describeAuditEvents`、`matchesAuditQuery`）
- Store 底層撤回動作（`deleteTransaction(id, { reason: UNDO_REASON })`）
- 狀態架構校驗器（`validatePersistedState`）

## 全量回歸、建置與靜態檢查

- **Vitest 全量**：`npm --prefix frontend exec -- vitest run --root frontend` → **exit 0；160 files passed／7 skipped；1535 tests passed／248 skipped**。
- **Lint 與 Build**：`npm run lint && npm run build` → **exit 0**。PWA manifest（`dist/manifest.json`）產物完全符合「訂餐櫃台」新品牌。
- **Git diff**：`git diff --check 15de317 HEAD` → **exit 0**；工作樹 clean。
- **TypeScript 基準說明**：
  - `tsc -b --pretty false`：base（U4 `b38563c`）與整合版均為 exit 1，211 處既有 diagnostics。multiset 比對中 210 處完全相同，唯一差異為既有 `App.tsx` TS2345 支出理由字面量由「付便當錢」改為「付餐費給廠商」的文字差異，無任何新增診斷類別或型別錯誤。
  - `tsc -p tsconfig.app.json --noEmit`：460 行（main 基準 478 行），新增整合測試零新增診斷。
  - **不以不讀 project references 的空檢查來宣稱 tsc clean。**

## 獨立本地 Playwright／Emulator 驗證

- 指令：`npm --prefix frontend run test:e2e`（以 `firebase emulators:exec` 啟動 Auth／Firestore demo-easyorder emulators）。
- **Cloud Chromium**：15 passed (22.7s)。
- **Prototype Chromium**：7 passed (8.2s)。
- **總計**：22 passed，exit 0。
- 說明：既有 E2E 為現存 cloud 與 prototype 回歸；本輪改號→退款→reload 之跨功能新流程證據來自完整 App jsdom 補測，兩類證據分開列示。
