# 後端交接文件：前端完成盤點與後端起手清單

日期：2026-10-13。程式基準：main `8cbf5f9`（#468 合併後）。

這份文件給**之後要寫後端 spec／plan 的 session**。目的是讓你快速知道：

1. 前端已經做完、驗收過什麼（第 1 節），以及哪些行為後端必須原樣保留（第 2 節）；
2. 現在的程式和雲端到底接了多少，答案是「幾乎沒有」（第 3 節）；
3. 從哪些文件、程式開始讀（第 4 節）；
4. 後端要滿足的需求（第 5 節）與平台選型（第 6 節）；
5. 已決定、要重新評估、還沒決定的事（第 7 節）。**標「要跟 CheerC 討論」的，不能自己定案；**
6. 刷臉平板（Android，talented-faceorder）接上後端的影響（第 8 節）；
7. 建議從哪裡開始、第一次要跟 CheerC 確認什麼（第 9 節），以及協作規則（第 10 節）。

**這份文件不是開工授權。** 後端的 spec 與 plan 由 CheerC 另外處理，定案後才回這個 repo 實作。

---

## 0. 一句話現況

**前端的練習模式（單機、資料存在瀏覽器）已經完成並通過本人驗收；正式的雲端帳務還沒有接上。** repo 裡的 Firebase 程式只有「Google 登入＋操作人白名單」真的在用，訂餐、繳費、更正、關帳都只寫進瀏覽器的 IndexedDB。所以「後端」不是接幾條線，而是要把整套帳務模型搬上雲（下面稱 **B0**）。

---

## 1. 前端已完成的工作

### 1.1 里程碑與驗收

計畫：[2026-09-29-frontend-prototype-refocus](superpowers/plans/2026-09-29-frontend-prototype-refocus.md)。狀態總表：[PROJECT-STATUS](PROJECT-STATUS.md)。驗收清單：[operator checklist](superpowers/verification/2026-09-29-operator-prototype-checklist.md)。

| 批次 | 目標 | PR | 本人驗收 |
|---|---|---|---|
| M0 本機練習環境 | 練習入口（`npm run dev:prototype`，port 5174，不連 Firebase）、空白／範例起點、手動建帳戶與期初、匯出／還原快照、只清交易、練習營業日、別名、停用帳戶、按日期存的菜單 | #441–#445 | PROJECT-STATUS 仍寫「未驗」（S01–S06 沒有單獨簽收）；這些功能在 M4 實際使用時涵蓋（空白建檔、快照、只清交易；M4 驗收步驟 P01–P06 在 CheerC 手上，不在 repo） |
| M1 F1 鍵盤操作 | 搜尋候選可見、輸入法 Enter 不選人、換人清草稿、重複訂餐預設不加訂、長按／連按不穿過、回搜尋自動 focus、可見的送出／取消鍵、小視窗重排、收款負數擋下 | #446–#449、#452 | 2026-10-12：K01–K06、K08、K09 通過；K07 修正後待重測；Windows 輸入法、Shift+Tab、實機 MacBook 13 吋略過 |
| M2 帳務正確性 | 改帳後從期初逐筆重算餘額、各畫面一致；更正／刪除／取消都要理由並寫稽核；關帳日擋所有寫入；F2 報表口徑；稽核看得懂；時間一律台北時間；送出後 5 秒內可撤回 | #450、#451、#453–#455、#458 | 2026-10-13：L01–L06 全部通過 |
| M3 每日閉環 | 開帳金額只認當天確認；關帳差額必填原因；重開與版次；F4 供應商停用／永久刪除；F2 日末點現金；F5 交易查詢與「看原單」；跨日沿用菜單提醒；份數拆成「今日便當＋其他餐點」 | #456、#457、#459–#462 | 2026-10-13：D01–D06 全部通過（`8f64027`） |
| M4 自建資料多日模擬 | 本人用自己的 12 個帳戶、3 家供應商連續跑 3 個晚餐日 | 不需新程式；摩擦點在 #468 修掉 | 2026-10-13：P01–P06 全部通過（`0ae43ea`） |
| 人臉連線（本機模擬） | 刷臉事件自動入帳／取消、重送只入帳一次、F1「刷臉訂餐」動態、頂部平板在線／離線、F3 人臉欄、練習用「模擬刷臉平板」 | #463、#464、#466 | 2026-10-13：FA01–FA10 通過（AI 代為操作 `bbedd2f`，FA08 窄視窗在 #466 修正後由 reviewer 重測），CheerC 接受為本輪驗收 |
| M4 摩擦點與已知限制 | 成功畫面 Enter 要放開再按；收支提示放大；清除確認寫明刷臉動態；F2 摘要依現在類型計數 | #468 | 程式已合併；實體鍵盤長按、400ms 連按保護尚未由本人實測 |

文件類 PR：#440（方向與分批計畫）、#465／#467（[刷臉後端計畫](superpowers/plans/2026-10-13-faceorder-backend-plan.md)，只寫計畫）。

測試基線（#468）：vitest 134 個檔案、1232 個測試通過、8 個 skipped；`tsc -p tsconfig.app.json` 有 **279 個既有型別錯誤**（main 上本來就有，CI 用的 `tsc --noEmit` 不會報；每個 PR 都要確認數量和內容沒變）。

### 1.2 各畫面現在能做什麼

| 畫面 | 功能 |
|---|---|
| **F1 櫃台** | 用編號／姓名／別名找人；Q 訂便當、W 繳費、E 看當日狀況；訂購其他餐點（品項＋價格）；重複訂餐確認；成功畫面與 5 秒撤回；新增櫃台收支（收入／支出＋原因）；最近帳戶；「刷臉訂餐」動態；沿用前一天菜單時提醒；關帳日鎖定 |
| **F2 報表／日結** | 今日／本週／本月；合併模式（依帳戶）與原始模式；份數「今日便當 N ＋ 其他 M」與其他餐點清單；收現、支出、淨現金、筆數；日末點現金（開帳、應有、實點、差異、原因）；關帳、重開；CSV 匯出、列印 |
| **F3 今日設定／帳戶／練習資料** | 當天晚餐（品項、價格、供應商）與開帳現金；帳戶新增、編輯、別名、停用／恢復、期初；人臉註冊欄（唯讀）；練習營業日、匯出／還原快照、只清交易、從空白開始；模擬刷臉平板 |
| **F4 供應商** | 新增、編輯、停用、恢復；停用後才能永久刪除（先確認）；顯示用過的菜單天數 |
| **F5 歷史** | 交易查詢（帳戶、日期區間，含已刪除的原單、更正紀錄、現在餘額／這筆之後／區間結束時餘額）；稽核軌跡（看原單、看當天）；結帳歷史（每個版次） |
| 頂部、📊 今日營運概覽 | 營業日、今日便當份數、本機／雲端標示、平板在線／離線；今日概覽取最後一版結帳 |

### 1.3 前端還沒做、或刻意不做的

- **正式雲端模式**：見第 3 節。
- **跨日菜單**：某天沒設菜單時沿用較早日期的，F1 只提醒、不擋訂餐（本人決定）。
- **小視窗**：1280×680 時 F2 統計卡片佔不少高度。
- **其他小字提示**（例如「備註（必填）」）沒有放大。
- **#467 review 留下的 5 個建議**：寫進 B2 實作計畫（見刷臉後端計畫 §4 與 #467 的 review 紀錄）。
- **本輪範圍外**：F6 概覽與主題微調、掃碼擴充、菜單圖片／完整品項目錄、多商品購物車、進階統計、權限系統擴充（見 [FRONTEND-PROTOTYPE-HANDOFF](FRONTEND-PROTOTYPE-HANDOFF.md)「範圍收斂」）。

---

## 2. 後端必須原樣保留的帳務規則

這些是本人驗收過的行為。後端換了儲存方式，**結果必須和練習模式一樣**。最權威的定義在 [frontend-prototype-workflow-spec](superpowers/specs/frontend-prototype-workflow-spec.md) §5–§6 和 [faceorder-handoff-spec](superpowers/specs/faceorder-handoff-spec.md)。

**帳戶與餘額**
- 目前餘額＝期初＋有效收款−有效餐費（±明確更正）。期初是獨立的資料（有日期、備註），**不是一筆收款交易**，不算當天收現。
- 未收錢可以是負餘額。金額都是整數新台幣；餐費、收款不能是負數；繳費必須大於 0。**注意**：「繳費大於 0」「收款不能是負數」目前只在畫面層檢查（`CustomerCard` 的 `canConfirm`、`parsePaidAmount`），store 的 `processTransaction`／`commitPosTransactionDraft` 不擋；上雲後要在伺服器端強制。
- 改任何一筆，就**從期初逐筆重算這個帳戶**每筆的「交易後餘額」和目前餘額（`domain/ledger.ts` 的 `rebalanceAccounts`）。
- **排序**：spec 要求依營業日、建立時間、穩定 ID 排序，不靠陣列順序。**目前程式沒有做到第三個排序鍵**：`sortLedgerChronologically` 只比營業日和 `createdAt`，同一毫秒的兩筆依 store 陣列的先後。雲端沒有陣列順序可依靠，B0 必須定出固定的第三排序鍵（例如 `transactionId`），並說明 `createdAt` 用誰的時鐘（櫃台 PC、平板或伺服器）。

**交易與更正**
- 交易類型只有三種：`order`（訂餐）、`payment`（繳費）、`expense`（櫃台收支，帳戶是 `__cashier__`）。
- 收款欄記「實際留存並入帳的金額」：餐費 90 找零後記 90，留 10 元記 100。
- 更正、刪除、取消訂餐、撤回**都要理由**，原單整筆與前後值寫進稽核（`LedgerAuditEvent`），和交易**在同一次保存**。正常畫面不硬刪。
- 取消已收款的訂餐有兩種：「款項留在帳戶」（原單改成同金額繳費）或「退還這筆收款」（原單刪除、整筆存稽核）。
- 「訂購其他餐點」的品項記在交易的 `otherItemName`，不算今日便當份數。

**日結**
- 應有現金＝當天開帳現金＋實際收款＋其他現金收入−現金支出−實際退款。總餐費不是現金支出。
- 開帳金額只認當天確認的設定；沒設不能關帳。
- 點算差異要寫原因，**不自動產生一筆收支把帳平掉**。
- 關帳後該營業日**所有**新增、更正、刪除都擋下（store 層，不只畫面）。重開要理由；再關帳產生新版次，舊版保留。

**刷臉（平板）**
- 平板只訂餐、不繳費，**自動入帳**。這是對「PC 是帳務權威」原則的明確例外。
- 同一個 `eventId` 只處理一次。
- 取消時取消當天最後一筆訂餐；錢留在帳戶；需要時提醒「退餐費請到櫃台。」
- 平板只讀得到帳戶名稱、是否啟用、當天份數，**讀不到餘額、交易、價格**。

**時間與顯示**
- 儲存用 UTC ISO（`…Z`），顯示一律台北時間；營業日是 `YYYY-MM-DD`，另成一欄。

---

## 3. 程式與雲端的現況（後端要接的東西）

### 3.1 前端架構

React 19、Vite 8、TypeScript 6、Zustand 5（persist 到 IndexedDB，失敗時退到 localStorage）。PWA（`vite-plugin-pwa`）。Node 24。

三種執行模式（`frontend/src/appMode.ts`、`App.tsx`）：

| 模式 | 怎麼進入 | 資料在哪 | 狀態 |
|---|---|---|---|
| `prototype` 練習 | `npm run dev:prototype` | 瀏覽器 IndexedDB（獨立命名空間 `*-prototype`） | **本人驗收的就是這個** |
| `local-only` | 沒設 Firebase 環境變數 | 瀏覽器 IndexedDB | 可用，無登入 |
| `cloud` | 有 Firebase 環境變數 | 登入走 Firebase，**帳務仍然存在瀏覽器 IndexedDB** | 只有登入是雲端的。**不能放真實資料**：「登出」會呼叫 `clearSensitiveData()`，刪掉整個本機帳務；F3 以 `isLocal = !fb` 控制，cloud 模式沒有新增／編輯帳戶與練習資料面板，只剩「危險區域：重置系統數據」（`resetData`，見 3.3） |

### 3.2 要搬上雲的資料（store 的實體）

型別都在 `frontend/src/domain/`；store 在 `frontend/src/store/posTypes.ts`、`posPersistence.ts`；快照格式在 `domain/practiceSnapshot.ts`。

| 實體 | 型別 | 舊 Firestore 設計有沒有 | 說明 |
|---|---|---|---|
| 帳戶 | `StudentAccount`（含 `openingBalance` 物件、`aliases`、`faceEnrollmentStatus`、`faceCount`） | 有 `students`，但期初是數字、沒有人臉張數 | 餘額是投影，要和交易一致 |
| 交易 | `LedgerTransaction`（`transactionId`、`mealPrice`、`paidAmount`、`amount`、`afterBalance`、快照、`sourceDevice`、`operatorId`、`otherItemName`…） | 有 `transactions`，但**欄位和類型都不同**（見 3.4） | 練習模式會**就地修改**原交易 |
| 稽核 | `LedgerAuditEvent` | **沒有** | 目前只記交易的更正、刪除（含取消訂餐、撤回），原單與理由都存著。關帳、重開不寫稽核，軌跡在 `DailySettlement` 的版次裡（含理由、操作人、時間）。`business_date_closed`／`business_date_reopened`／`csv_exported`／`report_printed` 這四種型別有定義、也有顯示標籤，但沒有任何地方產生 |
| 菜單 | `TodayMenu`、`menusByDate` | **沒有** | 依營業日保存；沒設時沿用較早日期 |
| 供應商 | `Vendor` | **沒有** | 停用後才可永久刪除 |
| 開帳 | `DailyCashSession`（`cashSessions`） | **沒有** | 當天確認的開帳現金 |
| 結帳 | `DailySettlement`（版次、重開欄位） | 有 `daily_settlements` 與 `close_attempts`，**設計不同** | 一天可以多版 |
| 營業日狀態 | `businessDateStatuses` | 沒有獨立欄位 | `open`／`closed`／`reopened` |
| 刷臉事件、平板 | `FaceOrderEvent`、`FaceDeviceStatus` | **沒有** | 雲端結構見刷臉後端計畫 §2 |
| 練習營業日 | `simulationDate` | 不需要 | 只給練習模式 |

### 3.3 會改帳的動作（後端要逐一對應）

`frontend/src/store/posActions/`：

| 類別 | 動作 | 現在的檢查與寫入 |
|---|---|---|
| 新增交易 | `commitPosTransactionDraft`、`processTransaction` | `checkNewLedgerEntry`（關帳鎖）→ `rebalanceAccounts`；**不寫稽核** |
| 改交易 | `editTransaction`、`deleteTransaction`、`deleteOrderWithRefundCheck`（含 `keepPaymentAsDeposit`）；撤回走刪除 | `checkLedgerMutation`（關帳鎖＋理由必填）→ `rebalanceAccounts` → 交易、稽核、帳戶同一次寫入 |
| 日結 | `openCashSession`、`updateOpeningCash`、`closeBusinessDate`、`reopenBusinessDate` | `openCashSession`：當天已有開帳就不寫入；`updateOpeningCash`：已關帳的日子不寫入；`closeBusinessDate`：檢查開帳、差額原因、重複關帳；關帳／重開新增 `DailySettlement` 版次 |
| 營業日狀態 | `setBusinessDateStatus` | **沒有任何檢查的 setter**（`useSessionActions` 對外暴露，畫面沒用到）；伺服器端不能開放等價操作 |
| 菜單 | `setMenuForDate`、`setTodayMenu` | 畫面層驗證；不經關帳鎖 |
| 供應商 | `setVendors(vendors[])` | **整份陣列覆寫**；上雲後多台同時改會「最後寫入覆蓋前面」，要改成逐筆操作 |
| 帳戶 | `addLocalStudent`、`updateLocalStudent`（只能改姓名、別名）、`setLocalStudentStatus` | 期初只能在建立時設定；不經關帳鎖 |
| 刷臉 | `handleFaceEvent`、`applyFaceEnrollment`、`setFaceDeviceStatus` | 訂餐分支自己判斷 `=== 'closed'`；取消走 `deleteOrderWithRefundCheck` |
| 整體重設／練習資料 | `resetData`（重設成範例初始值，**連稽核都清空**；掛在 F3「危險區域：重置系統數據」，**只在 cloud 模式顯示**）；練習專用：`startBlankData`、`loadSampleData`、`restoreDataset`、`clearPracticeTransactions` | 正式版要移除 `resetData`，或只限管理者並留紀錄；練習動作不進正式版 |

### 3.4 雲端程式的現況

| 項目 | 位置 | 狀態 |
|---|---|---|
| Firebase 初始化、離線快取 | `frontend/src/firebase/firebaseApp.ts` | 有接：`cloud` 模式會初始化；用 `persistentLocalCache`，**Firestore SDK 預設會在離線時排隊寫入**（和 R4、U14 直接相關） |
| Google 登入、操作人白名單 | `authService.ts`、`auth/AuthGate.tsx`、`providers/FirebaseProvider.tsx` | **有接，唯一真的在用的雲端功能** |
| 帳戶寫入 | `studentRepository.ts`、`store/posActions/firebaseActions.ts` | store 有 `addStudent`／`disableStudent`，但**沒有任何畫面呼叫** |
| 交易寫入（含 `runTransaction`） | `ledgerRepository.ts` | 有程式、有單元測試，**沒有任何地方呼叫** |
| 結帳寫入 | `settlementRepository.ts` | 同上，沒接 |
| 即時訂閱 | `realtimeSubscriptions.ts`（含重試） | 同上，沒接 |

> **2026-10-23 更新（P13d3）：** 上表「帳戶寫入」「交易寫入」「結帳寫入」「即時訂閱」四列的舊模組（`studentRepository.ts`、`store/posActions/firebaseActions.ts`、`ledgerRepository.ts`、`settlementRepository.ts`、`realtimeSubscriptions.ts`）與 `firebase/syncStatus.ts`、`domain/syncStatus.ts` 已確認沒有 production 呼叫者並刪除，store 不再有 `addStudent`／`disableStudent`。本表其餘內容維持 2026-10-13 的歷史盤點。
| Firestore 規則 | `firestore.rules`（154 行）、`firestore.indexes.json` | 只有 `operators`、`students`、`transactions`、`daily_settlements`（含 `close_attempts`、`cash_adjustments`） |
| 規則測試 | `frontend/src/firebase/__tests__/firestoreRules.spec.ts` | CI 在 Firestore emulator 上跑 |
| e2e | `npm run test:e2e`（Auth＋Firestore emulator） | CI 有跑 |
| 前端託管 | `vercel.json`（SPA rewrite、CSP、安全標頭） | 設定在，正式部署狀態請向 CheerC 確認 |
| Cloud Functions | 無（`firebase.json` 沒有 functions） | — |
| 營運文件 | `docs/ops/`（Firebase＋Vercel 設定、備份 runbook、同步驗證矩陣、安全） | 以 2026-05 的設計寫的，未依 M0–M3 更新 |

舊 Firestore 設計和練習模式的**主要差異**（B0 要先解決）：

1. **交易可不可以改**：舊設計（[2026-05-16 Firebase 架構](superpowers/plans/archive/2026-05-16-firebase-sync-architecture.md)）是「交易只新增不修改」，更正另建一筆；現在的規則也只允許改 `status` 等欄位。練習模式是「就地改原交易＋稽核保存原值」，而且改一筆會重算後面每筆的 `afterBalance`。
2. **欄位**：舊設計用 `id`、`amount`、`balanceBefore`，類型有 6 種（`order`／`payment`／`refund`／`cancel`／`correction`／`void`）；練習模式用 `transactionId`、`mealPrice`／`paidAmount`，類型只有 3 種。而且**舊雲端程式本身就不一致**：`firebase/firestoreSchema.ts` 有 6 種類型，`firestore.rules` 的建立規則只允許 `order`／`payment`／`expense`。兩者都不能當 B0 的基準。
3. **帳戶餘額的規則**：舊規則要求每次改餘額都要「同時新增一筆對應交易，餘額＝舊餘額＋這筆金額」。練習模式改一筆舊交易，餘額會重算，這條規則擋不下也放不過。
4. **離線**：舊設計允許離線先寫、連線後補送，也允許離線關帳再處理衝突。刷臉後端計畫要求平板**只在連線時送出**。櫃台 PC 的離線政策要重新定（第 7 節 R4）。
5. **沒有的集合**：稽核、菜單、供應商、開帳、刷臉相關。

### 3.5 已知矛盾與技術債

- **Firebase 專案是否獨立：兩份 ops 文件互相矛盾**。
  - `docs/ops/firebase-vercel-setup.md` 和 2026-05-16 的架構計畫寫「EasyOrder 用獨立的 Firebase 專案」。
  - `docs/ops/DEPLOYMENT-GUIDE.md` 明寫 EasyOrder 和 talented-payroll **共用同一個 Firebase 專案**（Firestore 資料庫、Auth 都共用），規則檔要合併後才能部署，否則互相覆蓋；並警告 payroll 那邊部署規則時會把 easyorder 的規則蓋掉（文件寫「尚未修改」）。
  - `deploy.sh` 部署規則時確實會合併 `talented-payroll` 的規則，`.env.local` 範本也從 payroll 複製設定。
  - 也就是說，正式資料可能和薪資系統放在同一個專案、同一套登入。**要跟 CheerC 確認**（第 7 節 R2）。
- **舊的 iPad 方案還在**：`domain/ipadHandoff.ts`、[ipad-face-auth-handoff-spec](superpowers/specs/ipad-face-auth-handoff-spec.md)、[archive 的 phase-2 iPad 計畫](superpowers/plans/archive/2026-05-14-phase-2-ipad-face-handoff.md)，都已被 [faceorder-handoff-spec](superpowers/specs/faceorder-handoff-spec.md) 取代，但程式還沒清。**清的時候要保留 `sourceDevice: 'ipad_handoff'`**：刷臉交易沿用這個值（`FACE_SOURCE_DEVICE`），`isFaceTransaction` 靠它判斷；要改名就得連既有資料一起遷移。
- **本機機制上雲後的角色**（B0 要逐一決定保留、改寫或移除）：

  | 機制 | 位置 | 現況 |
  |---|---|---|
  | 同步佇列邊界 | `domain/ledgerSyncBoundary.ts` | append 佇列、`idempotencyKey = tx:{id}:v{revision}`；有匯出，但沒有非測試的呼叫端 |
  | 同步狀態 | `firebase/syncStatus.ts`、`LedgerTransaction.syncStatus`／`revision` | 練習模式沒有實際同步 |
  | 當機草稿 | `storage/crashDraft.ts` | F1 草稿復原 |
  | 儲存健康檢查 | `storage/storageHealth.ts` | `useTransactionCommit` 依它決定送出前要不要存當機草稿 |
  | 錯誤紀錄 | `errors/errorLogger.ts` | 存在 localStorage；以規則式遮蔽常見個資格式（「姓名：」「餘額：」、09 開頭電話等），屬 best-effort，不保證遮掉所有個資 |
  | 儲存退路 | `storage/indexedDBStorage.ts` | IndexedDB 失敗時退回 localStorage |
- **279 個既有型別錯誤**（見 1.1）。
- **`clearSensitiveData`**（`posPersistence.ts`）在登出時清掉 IndexedDB。上雲後，本機快取的角色要重新定義。

---

## 4. 入口：建議的閱讀順序

1. **本文件**。
2. [PROJECT-STATUS](PROJECT-STATUS.md)：各批狀態與驗收紀錄。
3. [frontend-prototype-workflow-spec](superpowers/specs/frontend-prototype-workflow-spec.md) §3、§5、§6：練習資料、帳務契約、日結。
4. [faceorder-handoff-spec](superpowers/specs/faceorder-handoff-spec.md)：刷臉規則與隱私邊界。
5. [刷臉後端計畫](superpowers/plans/2026-10-13-faceorder-backend-plan.md)：雲端集合、平板權限、事件轉交易（A′／B）、櫃台接手協定、B0–B4 分批。**#465、#467 的 review 紀錄**也要看，裡面有未收進文件的 B2 建議。
6. 程式：`frontend/src/domain/`（`ledger.ts`、`ledgerAudit.ts`、`cashClose.ts`、`cashSession.ts`、`menu.ts`、`student.ts`、`faceOrder.ts`、`practiceSnapshot.ts`）→ `frontend/src/store/posActions/` → `frontend/src/firebase/` → `firestore.rules`。
7. 歷史參考（不是現行決定）：
   - [2026-05-16 Firebase 架構](superpowers/plans/archive/2026-05-16-firebase-sync-architecture.md)：舊的平台決定、離線策略、集合設計；
   - [免費後端選型探索](superpowers/plans/archive/2026-05-15-free-backend-architecture-exploration.md)：當時比較過 Cloudflare D1、Supabase、Neon、Firebase Spark 等，目標是「第一個校區完全免費」；
   - [資料遷移策略](superpowers/plans/archive/2026-05-15-data-migration-strategy.md)、[使用者決策清單](superpowers/plans/archive/2026-05-15-user-decision-checklist.md)；
   - `docs/ops/`。
8. talented-faceorder：`CLAUDE.md`、`docs/PLAN.md` §3（同步規劃）、§1.3（進度）。**PLAN §3（2026-10-11）尚未依 2026-10-13 的決定更新**：仍寫「離線時事件留在本機佇列、恢復連線後重送」、「方案 A＝PC 人工確認」、平板帳號 `faceorder-kiosk-01@…`。有衝突時以本 repo 的[刷臉後端計畫](superpowers/plans/2026-10-13-faceorder-backend-plan.md)為準。

---

## 5. 後端需求

### 5.1 功能需求

1. **多台櫃台電腦看到同一份帳**：帳戶、交易、菜單、供應商、開帳、結帳、稽核，即時同步。
2. **第 2 節的規則全部成立**，而且在多台電腦同時操作時也成立：
   - 改帳時，帳戶的餘額與每筆交易後餘額要和交易一致；
   - 關帳鎖要在伺服器端（規則或後端）擋，不能只靠畫面；
   - 稽核和交易要同一次寫入，不能只寫一半。
3. **操作人身分**：每筆寫入記錄是誰做的。練習模式只有「本機操作員」標籤，正式版要對應到登入帳號。
4. **刷臉平板**：照刷臉後端計畫 B1–B3。
5. **資料搬遷**：從本人的練習快照（或 Excel 手動建檔）建立正式資料，期初正確。
6. **備份與還原**：至少等同練習模式的「匯出快照／還原」，另有正式的備份責任人與頻率。
7. **CSV 匯出、列印**：沿用現有欄位，不任意改格式。基準是 `domain/ledgerExport.ts`（合併、原始兩種模式的欄位，含 `bento_count`、`other_meal_items`）。

### 5.2 非功能需求（多數要跟 CheerC 確認數字）

| 項目 | 目前知道的 | 要確認 |
|---|---|---|
| 規模 | 本人模擬用了 12 個帳戶、3 家供應商；每天一餐（晚餐） | 正式帳戶數、每晚筆數、尖峰幾分鐘內幾筆 |
| 櫃台電腦 | 1920×1080 PC＋MacBook Pro 13 吋 | 同時開幾台、幾個人操作 |
| 網路 | 平板必須連線才能送出（刷臉後端計畫 §4） | 櫃台網路穩不穩、斷線時櫃台要不要能繼續收單 |
| 隱私 | repo 是 public；平板讀不到餘額；真實資料不進 repo | 正式資料的存放地區、誰能看全部帳 |
| 成本 | 2026-05 的目標是「第一個校區完全免費」 | 現在還是嗎？Cloud Functions 需要付費方案 |
| 稽核 | 本機版只承諾可追溯，**沒有宣稱防竄改或法定帳簿** | 正式版需不需要更強的保證 |

---

## 6. 平台選型

### 6.1 目前的選擇（2026-05-16）

Firebase（Firestore＋Auth，Google 登入，白名單）＋ Vercel 靜態託管。網域限制：規則裡寫死 `@talented.com.tw`；前端用環境變數 `VITE_ALLOWED_EMAIL_DOMAIN`，沒設定時預設 `example.com`。不用 Functions、不用 Apps Script／Google Sheets。已經有的投資：規則、規則測試、emulator CI、登入與白名單、repository 雛形，而且 talented-faceorder 的 Phase 2 規劃也是以 Firestore 為前提（`docs/PLAN.md` §3.3）。

### 6.2 為什麼要重新評估

- **帳務模型改了**（3.4 第 1–3 點）。練習模式的「就地更正＋整個帳戶重算」在 Firestore 上會變成：改一筆就要更新同帳戶後面每一筆的交易後餘額。這需要在 transaction 裡寫多份文件（有單次寫入上限），規則也很難驗證。
  - 替代做法之一：雲端不存每筆交易後餘額，改由前端計算。
  - 這是選型和資料模型要一起回答的問題。
- **自動入帳**：刷臉事件要在沒人確認的情況下變成交易。建議的 A′ 是由開著的櫃台電腦處理，不需要 Functions；B 方案要 Functions，也就要付費方案。
- **Firebase 專案歸屬不清**（3.5）。
- **成本前提**可能變了。

### 6.3 評估時要比較的面向

1. **帳務一致性**：
   - 多份文件能不能一起寫入、一起成功；
   - 關帳鎖能不能在伺服器端強制；
   - 重算餘額的成本。
2. **權限**：櫃台、管理者、平板三種角色。平板只能讀精簡的名冊投影。
3. **離線與多台電腦**：同時改同一個帳戶時，衝突怎麼處理。
4. **Android 平板的接法**：有沒有成熟的 SDK；能不能只在連線時寫入。
5. **成本與營運**：誰維護、備份、還原演練。
6. **已有投資能不能沿用**：規則、測試、登入、CI。

除非評估結果明顯不同，**建議沿用 Firebase**，並先在 B0 spec 裡回答 6.2 第一點。換平台的話，faceorder 的 Phase 2 規劃也要跟著改。**選型要跟 CheerC 討論後定案。**

---

## 7. 決策清單

### 7.1 已決策（不要重新討論，除非 CheerC 自己提）

| # | 決定 | 來源 |
|---|---|---|
| D1 | 每天只有晚餐，不做餐次切換 | FRONTEND-PROTOTYPE-HANDOFF |
| D2 | 收款欄記實際留存金額，不做找零介面 | 同上 |
| D3 | 期初由本人輸入確認，不自動整份遷移 Excel（**範圍是本輪 prototype**；正式上線怎麼建資料見 U9） | 同上 |
| D4 | 點算差異保留原因，不自動沖平 | M3、workflow spec §6 |
| D5 | 歷史唯讀；要改就重開該日，在帳務頁更正 | M3 |
| D6 | 份數顯示「今日便當 N ＋ 其他 M」；其他餐點另列清單 | 2026-10-13 |
| D7 | 櫃台收支成功畫面不顯示櫃台累計，現金在日末核對 | 2026-10-13 |
| D8 | 供應商先停用，已停用的才可永久刪除 | M3 |
| D9 | 沿用較早日期菜單時只提醒、不擋訂餐 | M3 |
| D10 | 平板只訂餐、不繳費，自動入帳 | faceorder-handoff-spec §1 |
| D11 | 第二次刷臉：「加訂一份」或「取消訂餐」；同帳號可以多份 | 同上 |
| D12 | 取消時餐費留在帳戶，需要時提醒「退餐費請到櫃台。」 | 同上 |
| D13 | 共用帳戶用「陳小明/陳大強」命名，不另設別名；平板端可以讓多張臉對應同一個訂餐編號 | 同上 |
| D14 | 平板註冊有異動就主動回報；F3 人臉欄唯讀 | 同上 |
| D15 | 櫃台只多「刷臉訂餐」動態與平板在線／離線，不拆刷臉統計 | 同上 |
| D16 | 刷臉的人不打字；取消理由由系統填「平板取消訂餐」 | 同上 |
| D17 | 誤掃時用右上角圓圈 ✕ 或點面板外關閉，拿掉「離開」按鈕 | CheerC 2026-10-13 在 coordinator session 決定；寫在 faceorder 修改 brief（在 CheerC 手上，不在 repo） |
| D18 | 協作：reviewer 只 review、不合併；coordinator 檢查 review 結果後合併 | CheerC 2026-10-13 |

### 7.2 要重新評估（舊決定和現況衝突）：要跟 CheerC 討論

| # | 題目 | 衝突在哪 | 建議 |
|---|---|---|---|
| R1 | 平台：Firebase＋Vercel 是否沿用 | 帳務模型改了、自動入帳、成本前提 | 第 6 節評估後再定；傾向沿用 |
| R2 | Firebase 專案：獨立，或與 talented-payroll 共用 | `firebase-vercel-setup.md` 寫獨立；`DEPLOYMENT-GUIDE.md` 明寫共用（含 Auth），且 payroll 部署會蓋掉 easyorder 規則；`deploy.sh` 合併兩邊規則 | 帳務資料建議獨立專案，避免規則互蓋與權限混用；需確認現況與搬遷成本 |
| R3 | 帳務模型：只新增，或就地改＋稽核 | 舊 schema／規則 vs 練習模式 | 先定「正式版的更正長什麼樣」，再設計集合與規則 |
| R4 | 櫃台 PC 的離線政策 | 舊設計允許離線寫入與離線關帳；刷臉後端計畫要求平板只在連線時送出（U14）；Firestore SDK 預設會離線排隊寫入 | 先問櫃台網路狀況；若可接受，正式版改帳要求連線最簡單 |
| R5 | 操作人身分 | 舊設計記 uid＋email；練習模式只有標籤；刷臉計畫要求 `operatorId`＝處理的 PC 帳號、另存 `deviceId` | 每位櫃台人員各用自己的 Google 帳號？或一台電腦一個帳號？ |
| R6 | 舊同步狀態（`syncStatus`：`local`／`queued`／`synced`／`failed`／`conflict`）與 `close_attempts` 設計 | 練習模式沒有用到 | 依 R3、R4 的結果決定保留或移除 |
| R7 | 舊 iPad 方案的程式與文件 | 已被 faceorder 取代 | B0 前清掉或標成封存；保留 `'ipad_handoff'` 這個來源值（見 3.5） |

### 7.3 尚未決策：要跟 CheerC 討論

| # | 題目 | 現在的建議或預設 | 影響 |
|---|---|---|---|
| U1 | 刷臉事件誰轉成交易：A′（櫃台 PC 自動處理）或 B（Cloud Function） | A′ | B2 設計、成本；U14 的櫃台接手協定只在選 A′ 時成立 |
| U2 | 逾時秒數與文字 | 平板 10 秒、PC 2 分鐘 | 平板與櫃台文案 |
| U3 | 平板「在線」的判斷 | 3 分鐘內有回報 | 頂部狀態 |
| U4 | B0 什麼時候排；要不要先只做「單台 PC 上雲」 | 先寫 B0 spec 再定 | 全部排程 |
| U5 | 註冊照片要不要上雲（faceorder Phase 3） | 不上雲；要上雲須書面同意與保存期限 | 隱私與法遵 |
| U6 | 一個帳號一天最多加訂幾份 | 目前不設上限 | 平板與後台規則 |
| U7 | 正式規模、櫃台電腦數量、網路穩定度 | — | R4、選型 |
| U8 | 誰登入：櫃台人員、管理者、平板帳號的帳號類型與網域 | 平板用 `faceorder-01@talented.com.tw` 這類帳號 | 規則、Auth 設定 |
| U9 | 上線切換：從練習快照或 Excel 建正式資料；哪一天切換；練習模式之後要不要保留當訓練用 | — | 搬遷工具 |
| U10 | 備份、還原、保存期限、誰負責 | 舊文件：櫃台負責匯出，主任負責還原決定 | 營運文件 |
| U11 | 成本上限；能不能用付費方案 | — | U1、選型 |
| U12 | ArcFace R50 模型的授權（見 8.4） | — | 能不能正式上線 |
| U13 | 正式版的匯出、列印要不要記稽核 | 型別已定義，目前沒寫入 | 稽核集合設計 |
| U14 | 平板只在連線時送出、逾時後放棄事件不補送；櫃台接手協定（`lastCounterActivityAt`、「等它處理／改由櫃台處理」） | 已寫入刷臉後端計畫 §4 並經 #465／#467 review，**但 CheerC 還沒確認**；接手協定是 A′ 的設計，隨 U1 定案 | 平板 B3、櫃台 B2 |
| U15 | 點算差異的分類（呆帳、借支等） | prototype 只記原因，不分類（FRONTEND-PROTOTYPE-HANDOFF 決策表「差額」列） | 日結報表、會計 |

---

## 8. 刷臉平板（Android）的銜接影響

### 8.1 平板現況（talented-faceorder，Phase 1 完成）

- Kotlin＋Jetpack Compose。裝置是一台 Unisoc T616、Android 13 平板。
- 註冊、連續辨識、release APK 都完成，本人在平板上實測過。
- **完全不連網**：Manifest 刻意移除網路權限，也移除了 ONNX Runtime 帶進來的 telemetry。訂餐只在本機記一筆訊號，畫面只能說「訊號已記錄」。
- 訂餐編號（`orderCode`）＝easyorder 的 `studentId`。
- 一個編號可以有多張照片，資料模型和比對都已支援，但介面目前限制一個編號只能一張。

### 8.2 接上後端時平板要改的

依刷臉後端計畫 B3，以及給 local agent 的 faceorder 修改 brief：

- **重新加回網路權限**，並重新檢查合併後的 Manifest：telemetry 要繼續移除，備份排除規則不能被破壞。
- **加入雲端 SDK（若沿用 Firebase）**：登入平板專用帳號、讀名冊投影與當天訂餐狀態、建立事件、回報平板狀態與註冊異動。
- **只在連線時寫入**（刷臉後端計畫的設計，待 CheerC 確認，見 U14）：不用 SDK 的離線佇列；重送只用同一個 `eventId`、只能新建、不能覆寫；顯示「請到櫃台」後就放棄那筆事件。
- **畫面依後台結果顯示**：等後台回覆接受才說成功，退回就顯示原因；後台回傳 `notice` 時顯示「退餐費請到櫃台。」
- **事件格式**：`businessDate` 用台北時間的 `YYYY-MM-DD`；時間用 UTC ISO；`deviceId` 以 `faceorder-` 開頭。
- **放寬註冊**：一個編號可以註冊多張臉，每張可填成員名稱；送出事件時帶 `memberName`。

### 8.3 後端要為平板準備的

- 平板帳號（`role: 'kiosk'`、綁一個 `deviceId`）的建立流程。前端 `isValidOperatorDoc` 目前只接受 `counter`／`admin`，要擴充。
- 名冊投影（`faceRoster`）、當天訂餐狀態（`dailyOrderStatus`）的維護；刷臉入帳也要更新它（#467 review 建議 1）。
- 事件處理、逾時、櫃台接手、註冊回報套用、在線判斷（刷臉後端計畫 B2）。
- **平台若換掉 Firebase**，平板的 SDK、登入方式、離線行為都要重新設計。faceorder 的 PLAN §3 也要改。

### 8.4 風險與法遵（要跟 CheerC 討論）

- **模型授權**：ArcFace R50 授權**僅限非商業研究**。faceorder 的文件把它定位成「APK 自用、不上架、不給第三方」。正式在櫃台用來收單，算不算商業使用，要確認；必要時要取得商用授權或換模型。換模型等於重做數值驗證、所有人重新註冊。
- **生物特徵資料**：註冊照片與 embedding 現在只加密存在平板。照片上雲（U5）需要書面同意、保存期限；embedding 不離開裝置是既定原則。
- **辨識結果只是候選**：不是活體偵測或本人認證。後端與畫面都不能把它當作身分驗證。
- **一台平板**：目前只有 `faceorder-01`。之後要多台時，每台各綁一個帳號與 `deviceId`。

### 8.5 faceorder 端的待辦（不在本 repo）

已交給 CheerC 的 local agent 執行（faceorder 修改 brief），Phase 1 只改畫面與資料模型、不連網：

- 第二次刷臉顯示「今天已訂 N 份」，提供「加訂一份」「取消訂餐」；
- 誤掃時用右上角 ✕ 或點面板外關閉；
- 顯示後台提醒的機制；
- 一個編號註冊多張臉，並帶成員名稱；
- 註冊異動先存成本機佇列；
- 訊號欄位對齊 easyorder 的事件格式；
- PLAN 同步改成 A′ 方案，並寫入「只在連線時送出、不補送」（隨 U1、U14 定案）。

---

## 9. 給寫 spec／plan 的 session：建議從這裡開始

**第一次跟 CheerC 討論時要先定的**（會擋住 B0 spec）：

1. R1、R2：平台與 Firebase 專案歸屬；
2. R3：正式版的更正模型。這決定集合、規則和重算方式；
3. R4、U7：櫃台電腦幾台、網路穩不穩、斷線時要不要能收單；
4. R5、U8：誰用什麼帳號登入；
5. U11：成本上限；
6. U1、U14：刷臉事件誰處理、平板離線行為（不擋 B0，但會影響 B0 的帳戶文件設計，例如 `lastCounterActivityAt`）。

**B0 spec 建議包含**：

1. 練習模式和雲端的逐項差距表（從 3.2、3.3 展開）；
2. 集合／資料表、規則（或伺服器端檢查）；每個改帳動作怎麼做到「全部成功或全部不寫」；目前只在畫面層的驗證（繳費大於 0 等）、沒有檢查的 setter（`setBusinessDateStatus`）、整份覆寫的 `setVendors`，在伺服器端要怎麼處理；
3. 餘額與每筆交易後餘額存在哪裡、誰算；**固定的第三排序鍵**與 `createdAt` 用誰的時鐘（見第 2 節「排序」）；
4. 多台電腦同時操作與離線策略；
5. 從練習快照搬成正式資料的流程與驗證；
6. 驗收：把 M0–M3 的驗收步驟（S、K、L、D）在雲端版重跑，外加多台電腦的情境；
7. 分批，每批都能操作示範。

**順序**：B0 → B1（平板權限）→ B2（櫃台處理平板事件）→ B3（faceorder Phase 2）→ B4（試營運）。B1 和 B3 的規則設計可以和 B0 並行討論，但實作要等 B0。

---

## 10. 協作與資料規則

- **repo 是公開的**：真實姓名、餘額、快照檔、Excel、紙本照片、平板截圖（可能有臉）一律不進 repo、PR、留言。回報時用帳戶編號或「某學員」代稱。
- **分工**：
  - coordinator 分析、規劃、派工、寫 reviewer brief、檢查 review 結果、合併；
  - implementer 實作、開 PR、處理 CI；
  - reviewer 只用 COMMENT review，**不合併、不推 commit**；
  - 每批一個 PR；每個里程碑給 CheerC 驗收步驟。
- **PR 驗證**：
  - `tsc --noEmit`、lint、vitest、build 都要通過；
  - `tsc -p tsconfig.app.json` 去掉行號後，和 main 比對要一樣是 279 個；
  - 用 Playwright 在練習模式實際操作；Chromium 已預裝，用 `executablePath: '/opt/pw-browsers/chromium'`。
- **commit 與 PR 說明**：不寫模型名稱；介面文字和文件用繁體中文（台灣用語）。
- **跨 repo**：不直接改 talented-faceorder，需要它配合的事寫成 brief，由 CheerC 交給 local agent。
