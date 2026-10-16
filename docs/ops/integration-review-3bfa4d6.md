# 本地整合審查收據（U3 + U2b + U4）

- 精確受測 HEAD：`3bfa4d6df86f595287bf529fb9cfa825a905daaa`
- 審查環境：獨立 reviewer worktree
- 來源分支祖先確認：`git merge-base --is-ancestor` 已確認包含 U3 `efaa9ce221b4a51625069deddf9b1ee11cba5370`、U2b `4827cc6b3f55a473a1ee2674ddd0dea469389659`、U4 `b38563c90b8ed35f7d516d388970128820d9a98c`。
- 結論：**本輪無已確認的 blocking finding，本地整合 review 結論為 PASS**。這是本地整合 review 結論，不是 merge／push 授權；未變更三個 PR heads，未修改正式後端受保護檔案，未 push，未 merge。

---

## 一、合併衝突解法核對（ac 原審查紀錄）

檢查 merge commit `359a0fd03e69b29ca13713a9875c3dc8032e97a6` combined diff 與父版本；App／AppRouter／AdminScreen 同時保留：

- F3 編號排序、缺號列、碰撞保留、編輯改號理由與確認、交易紀錄入口、停用帳戶退款。
- App `historyLookupTarget` 消費與離頁清除，頂部切頁和快捷鍵均走清除路徑。
- 明確 `studentId` 的退款 handler、不依賴 F1 picked；退款 modal guard、manualFlash、5 秒 undo 路徑。
- `ReportSummaryStats` 的「今日餐點」新用語與獨立「退款」、淨現金公式「收現 − 支出 − 退款」。
- spec 內 U3／U2b 新用語及 U4 退款定義共存。
- 其餘合併項的 audit amount 標籤、refund validator、draft、ledger 算式與 props 傳遞亦核對，未見整合遺失。

---

## 二、完整 App 跨功能補測（外部 harness）

命令：
```sh
node frontend/node_modules/vitest/vitest.mjs run --config <review-harness>/integration.config.mts --reporter=verbose
```
結果：**exit 0，3/3 passed，無 skip**。

1. 完整 App 實際從 F3 編輯停用 `005`，輸入 `009`／理由並按「確認改號」；再直接點「退款 009」退款 120，初始 300 → 180，仍停用。退款框開啟時 Q/W/E/F1/F2/F3/F5/方向/Enter 不穿透。點「交易紀錄 009」進入 F5，精確帳戶摘要為 `009 整合甲`，不混入 `0090 整合乙`，退款理由可見；F1 離開後 F5 重入回到預設結帳歷史，無舊 target。
2. 改號後退款，切 F1 點實際「撤回」按鈕，交易移除、餘額恢復 300、成功 flash 清除。沒有直接呼叫 deleteTransaction 代替 UI。
3. 改號後退款，實際等待 countdown，撤回按鈕在 5 秒倒數結束後消失；退款及餘額 180 保留。測試耗時約 5.43 秒，並非只匯入 UNDO_REASON 或直接呼叫 store。

### 真實 persist 與 App 重載證據

第一案並非只跑 validatePersistedState：

- 讀取 App 使用的真實 storage（namespace `pos-storage`），確認 saved students／refund／student_code_changed 存在。
- 用新的 `createStore(persist(..., createPosPersistenceConfig()))` reader，空 students／transactions／auditEvents 作初始資料，執行 `reader.persist.rehydrate()`；載入後上述三組資料與 writer 完全相等，舊號／新號稽核查詢保留，沒有回填範例帳戶。
- 卸載 App，暫停寫入後將原 singleton 的記憶體重設為 initial state（確認整合甲不在記憶體），恢復原 storage，實際呼叫 `persist.rehydrate()`，再掛載完整 App。從 F3「交易紀錄 009」進 F5，仍顯示現在餘額 $180 及整合離班退款。
- **限制：這是 jsdom 的真實 localStorage fallback pipeline 與 remount，不是 Chromium 的 IndexedDB reload／人工瀏覽器驗收。** 新 reader 的 actions 只為 initializer 保留，沒有拿其閉包進行任何 mutation；重載後 UI 則使用實際 singleton 與 handlers。

原新增 `crossFeatureIntegration.test.tsx` 的 4 cases 通過，但其所稱 reload 是 validator、undo 是直接 store delete；本收據不將該四案單獨當成 reload／5 秒 UI 證據，而以上述外部實測補足。

---

## 三、全量、原獨立回歸與建置（ac 於 3bfa4d6 執行結果）

- `npm --prefix frontend exec -- vitest run --root frontend` → **exit 0；159 files passed／7 skipped；1532 tests passed／248 skipped**。248 skipped 不算通過。
- 原 U3 外部回歸：**10/10 passed**；含多次改號、他人重用舊號、presenter 目前歸戶、數字搜尋、snapshot／完整 persist。
- 原 U4 外部回歸：**17 passed／1 skipped**。skip 為舊 Firebase-connected helper 不適用本機 F3 的 fixture，另有完整 local App 的成功退款／失敗留框兩案，以及本輪改號退款完整 App 取代覆蓋；沒有將 skip 當 pass。
- 原 U2b 外部回歸：**5/5 passed**；source／built manifest 品牌、snapshot format、使用者品名與 vendor、CSV 欄位、實際 App 滑鼠／鍵盤支出與 Q/E。
- `npm --prefix frontend run lint && npm --prefix frontend run build` → **exit 0**。保留 Vite 既有 `__dirname`／未來 native loader 相容性警告。
- `git diff --check 15de317 HEAD` → **exit 0**；最終工作樹 clean。
- 首次誤用不存在的 npm `test` script 回傳 exit 1（無測試執行），已改用上列真正 Vitest 命令；第一版外部 harness 使用錯誤 prototype storage namespace 得到 null，也已改為與 App 完全相同的 config.name，最終三案全過。兩者均屬 harness／命令問題，不報為產品缺陷。

---

## 四、TypeScript：仍有既有錯誤，不宣稱通過（ac 比對）

以 git archive 匯出已審 U4 `b38563c`，兩版共用同一 node_modules，各跑 `tsc -b --pretty false` 做比對：

- base／整合版均 **exit 1，211 diagnostics**。
- 移除行列號，按檔案＋TS code＋訊息做 multiset 比較：**210 完全相同，ADDED 1／REMOVED 1**。
- 唯一差異為既有 `App.tsx` TS2345 的支出理由字面量由「付便當錢」變「付餐費給廠商」；兩者都是原本 union callback 不能賦予 `(r: string) => void`，沒有新的診斷種類或錯誤路徑。
- 不以不讀 project references 的空檢查來宣稱 tsc clean。

---

## 五、獨立本地 Playwright／Emulator（reviewer 獨立執行）

```sh
npm --prefix frontend run test:e2e
```
本次由 reviewer 在同 SHA（`3bfa4d6`）獨立執行，**exit 0**。

- 啟動 Auth／Firestore demo-easyorder emulators（執行前相關連接埠未被占用）。
- Cloud Chromium：**15 passed**。
- Prototype Chromium：**7 passed**。
- emulators:exec 顯示 `Script exited successfully (code 0)`，並正常停止 emulators。
- log 有 access lease 競爭的 permission-denied／403，以及模擬快慢時鐘的 future update time console 訊息；對應測試通過，不隱藏這些 console 輸出。
- 此組既有 E2E 不含本輪改號→退款→reload 新瀏覽器流程；該跨功能路徑證據來自上面的完整 App jsdom 補測，兩種證據分開列示。

**結論：U3／U2b／U4 本地整合 PASS，可交 coordinator 決定後續 PR 處理。本收據初稿保留在本地 review 環境，未發布 GitHub comment／Artifact。**

---

## 六、Implementer 增量保存與驗證（後續提交）

在 `3bfa4d6df86f595287bf529fb9cfa825a905daaa` 獲 ac 審查 PASS 後，依協調者指示進行增量保存：

1. **外部測試永久化移植**：
   - 將上述第二節 ac 外部 harness 的 3 個端到端測試案例移植為 repo 永久測試：`frontend/src/__tests__/integrationApp.test.tsx`。
   - 保持完整 App 掛載、F3 停用改號、退款、modal guard、F5 查詢與離頁清除、真實 storage reader 與重載、F1 實體撤回按鈕與真實 5 秒倒數時窗邏輯，無新增外部相依或 temporary config。
2. **模組測試層級校正**：
   - 修正 `frontend/src/__tests__/crossFeatureIntegration.test.tsx` 名稱與註解，明確標註其為 validator / store-delete / presenter 等單元層級，避免過度宣稱端到端 App 與 persist 重載。
3. **文件維護更新**：
   - 於 `docs/ops/integration-review-3bfa4d6.md` 保存匿名化相對路徑之審查收據。
   - 更新 `docs/superpowers/plans/2026-10-15-operator-feedback-plan.md` 交付狀態。
4. **增量審查驗證**：
   - ac 已對精確 SHA `0ec9c9f8d6cc907ebccc9f895dda49e4ff64ab31` 執行 scoped 審查：永久 App 3 案 ＋ 模組 4 案共 7/7 passed（無 skip）、lint／links／diff check 通過、無產品差異。
