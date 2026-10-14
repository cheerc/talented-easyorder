# 零費用正式後端：現況與證據

狀態截至 2026-10-14。此頁是 P00 基線；新正式後端**尚未實作、部署或通過上線驗收**。規格是目標契約，不代表功能、雲端資源或部署狀態已成立。前端原本人驗收紀錄仍以 [PROJECT-STATUS](../PROJECT-STATUS.md) 為準。

## 範圍與正式操作界線

- 規格：[零費用正式後端 spec](../superpowers/specs/2026-10-13-free-production-backend-spec.md)。交付順序與每 phase 驗收條件：[19 階段計畫](../superpowers/plans/2026-10-13-free-production-backend-plan.md)。
- 目標為 EasyOrder 獨立 Firebase Spark 專案、`(default)` Firestore、傳統 Firebase Hosting、Google Auth 精確白名單。多個白名單 UID 權限相同，無 RBAC，同時只允許一個 UID 使用；帳務 online-only，成功須有雲端 receipt 與冪等保護；以完整 command／稽核及關帳版次保存帳務；由維護者人工做增量備份與復原。
- 正式 Web 設定、production project／DNS／Auth／Hosting／Rules／indexes、Admin／復原憑證及正式部署和 smoke test，均由使用者在自己的電腦執行。Cloud agent 限 emulator、匿名合成資料、範本及 runbook；不接收 production secrets、不操作正式資源、不改 payroll、不改 Android repo。
- 本次只記錄來源程式與文件，不建立／變更雲端資源，亦未核實任何現存 Firebase/Vercel production 資源或部署。

## 文件分類

| 分類 | 本次記錄位置 |
|---|---|
| Architecture | 本文件「舊寫入路徑盤點」界定 cloud-auth、瀏覽器 store、Firestore repository 及新 command 邊界；目標設計仍以 spec 為準。 |
| ADR | [spec §2](../superpowers/specs/2026-10-13-free-production-backend-spec.md) 記錄獨立 Spark、Firestore、傳統 Hosting 的選擇及成本界線。 |
| Area：Auth／ledger／ops | 本文件依 AuthGate／operator、交易與結帳寫入、local persistence／舊部署操作分區列出依賴和後續 phase。 |

## 舊寫入路徑盤點

分類表示程式與 UI 可達性，不推斷正式環境是否設定或曾部署。Cloud 登入只表示 Auth 路徑已連線；它**不表示帳務寫入雲端**。

Repo-wide search also found references in tests, mocks and archived planning documents. Direct calls in store/component unit tests and [`firestoreRules.spec.ts`](../../frontend/src/firebase/__tests__/firestoreRules.spec.ts) are test-only; archived plan references are historical. They do not demonstrate a production write path or successful production deployment.

| 路徑 | 分類與觀察 | 後續處理方向 |
|---|---|---|
| [`firebaseApp.ts`](../../frontend/src/firebase/firebaseApp.ts)、[`FirebaseProvider.tsx`](../../frontend/src/providers/FirebaseProvider.tsx)、[`authService.ts`](../../frontend/src/firebase/authService.ts)、[`AuthGate.tsx`](../../frontend/src/auth/AuthGate.tsx) | **正式 UI 可達、目前唯一有實際雲端資料操作的路徑：** Firebase 初始化、Google 登入及讀取操作者白名單 `operators/{uid}`。尚無新規格的 access lease。登出會呼叫 `clearSensitiveData()` 刪除本機帳務資料庫。 | P03–P04 以白名單與單活躍 UID 取代舊授權流程；依新契約處理登入、失權、清除快取。 |
| [`posPersistence.ts`](../../frontend/src/store/posPersistence.ts)、[`indexedDBStorage.ts`](../../frontend/src/storage/indexedDBStorage.ts)、[`App.tsx`](../../frontend/src/App.tsx) | **正式 UI 可達但只寫瀏覽器：** Zustand persist 將帳戶、交易、供應商、菜單、稽核、開帳與結帳等狀態存入 IndexedDB，失敗時有 localStorage fallback。配置 Firebase 並登入時，F1–F5 仍操作同一份本機 store；登出會清除此本機資料。不是 Firestore 帳務保存。 | P02 建明確 storage adapter 邊界；P05–P13 逐項改為雲端 receipt 確認後才回成功。 |
| [`transactionActions.ts`](../../frontend/src/store/posActions/transactionActions.ts)、[`editActions.ts`](../../frontend/src/store/posActions/editActions.ts)、[`sessionActions.ts`](../../frontend/src/store/posActions/sessionActions.ts)、[`menuActions.ts`](../../frontend/src/store/posActions/menuActions.ts)、F1/F2/F3/F4 screens | **正式 UI 可達但只寫本機：** 訂餐、繳費、櫃台收支、更正／取消、關帳／重開、開帳金額／菜單、供應商都以 Zustand `set` 改記憶體狀態，再由 persist 寫 IndexedDB。有效日期與部分更正檢查是舊 prototype 行為，不能當成 Firestore Rules 保護。 | P06–P12 分別改接單筆 command 與讀取投影；不能保留第二條直接 set 寫入。 |
| [`AdminScreen.tsx`](../../frontend/src/components/screens/AdminScreen.tsx) 的 `resetData`、[`menuActions.ts`](../../frontend/src/store/posActions/menuActions.ts) | **目前 cloud-auth UI 可達的危險本機重設：** Firebase 未配置時畫面顯示練習資料面板；配置 Firebase 時則顯示「重置系統數據」。確認後 `resetData()` 將 local store 重置為初始範例，並清掉稽核、關帳與開帳狀態；它沒有刪 Firestore 文件，卻會破壞目前唯一帳務副本。 | 新正式 UI 不得提供 reset／seed；在 P02–P13 隨正式 mode 入口與本機持久層隔離一併移除。 |
| [`sessionActions.ts`](../../frontend/src/store/posActions/sessionActions.ts) 的 `setBusinessDateStatus`、[`posTypes.ts`](../../frontend/src/store/posTypes.ts)、[`selectors.ts`](../../frontend/src/store/selectors.ts) | **裸 setter，未連 UI：** `setBusinessDateStatus(date,status)` 無條件直接改日期狀態，雖經 selector 暴露，repo 搜尋沒有非測試畫面呼叫。`setTodayMenu` 亦保留舊單菜單 setter，未見目前畫面呼叫。測試會直接呼叫這些 API。它們不得成為雲端命令或授權入口。 | P05 起 Rules 僅允許已定義 command；P11 只以關帳／重開命令轉換日期狀態。 |
| [`menuActions.ts`](../../frontend/src/store/posActions/menuActions.ts) 的 `setVendors`、[`VendorsScreen.tsx`](../../frontend/src/components/screens/VendorsScreen.tsx) | **正式 UI 可達的整份清單覆寫：** F4 每次新增／編輯／停用／恢復／移除後以 `setVendors(vendors[])` 取代整份陣列；沒有逐筆雲端 revision／衝突控制。 | P07 改為逐筆 Vendor command，保留刪除 tombstone 與歷史。 |
| [`practiceDataActions.ts`](../../frontend/src/store/posActions/practiceDataActions.ts)、[`PracticeDataPanel.tsx`](../../frontend/src/components/screens/PracticeDataPanel.tsx)、[`FaceTabletSimulator.tsx`](../../frontend/src/components/screens/FaceTabletSimulator.tsx) | **本機 prototype／local-only UI：** 空白／範例資料、snapshot restore、只清練習交易、模擬刷臉、裝置狀態及註冊更新，僅在 `!fb` 時顯示；`prototype` mode 即使有 Firebase env 也不初始化 Firebase，且使用獨立 port 與 storage namespace。 | 保留 prototype 訓練用途；P02/P13 確保正式 UI 不掛載、不呼叫這些動作。 |
| [`studentRepository.ts`](../../frontend/src/firebase/studentRepository.ts)、[`firebaseActions.ts`](../../frontend/src/store/posActions/firebaseActions.ts) | **未接 UI 的 Firestore 寫入程式，另有單元測試：** store 暴露 `addStudent`／`disableStudent`，但目前畫面沒有呼叫。 | P05–P06 以新 schema command 替代；不可當正式學生寫入流程。 |
| [`ledgerRepository.ts`](../../frontend/src/firebase/ledgerRepository.ts) | **未接 UI 的舊 Firestore 寫入程式：** `commitLedgerOnline` 以 transaction 直接新增舊 schema 交易並增量更新學生餘額；`commitLedgerOfflineBatch` 用 `writeBatch` 將交易與餘額更新寫入佇列。沒有目前 UI 呼叫端。 | P05 起以單筆 immutable command 原子更新全部受控投影；P08–P10 逐項驗收冪等與重送。移除舊離線補送語義。 |
| [`settlementRepository.ts`](../../frontend/src/firebase/settlementRepository.ts)、[`realtimeSubscriptions.ts`](../../frontend/src/firebase/realtimeSubscriptions.ts) | **未接業務 UI 的舊程式，部分有測試：** settlement repository 提供 offline close attempt、online promotion、cash adjustment 寫入；realtime subscription 可訂閱舊集合。除 `authService` 的白名單訂閱外，業務訂閱與寫入無畫面呼叫端。 | P11–P13 依新命令／讀取投影重做；不沿用舊 pending/offline 關帳。 |
| [`firebaseApp.ts`](../../frontend/src/firebase/firebaseApp.ts) 的 `persistentLocalCache`／`persistentMultipleTabManager` | **設定已接入 cloud 模式；業務程式目前未用：** Firestore persistent cache 可快取本機資料；Firestore SDK 對離線寫入具排隊行為。舊 `writeBatch`／offline close functions 同樣未被 UI 呼叫，不能宣稱它們是正在同步的正式帳務。 | 新規格是 PC online-only；P13 移除正式帳務離線佇列與本機未確認成功狀態。 |
| [`faceActions.ts`](../../frontend/src/store/posActions/faceActions.ts)、[`ipadHandoff.ts`](../../frontend/src/domain/ipadHandoff.ts)、iPad 舊 handoff／FaceOrder 計畫 | **模擬／歷史程式，沒有正式雲端入口：** `FaceTabletSimulator` 僅 local-only；舊 iPad handoff 不應接入新 PC 正式資料流程。交易來源字串 `ipad_handoff` 仍須保留作歷史來源辨識。 | R7 對應 spec §5、§12；Android 另案，不改 Android repo、不開舊 iPad 雲端寫入。 |
| [`deploy.sh`](../../deploy.sh)、[`workflow-lib.sh`](../../workflow-lib.sh)、[`docs/ops/DEPLOYMENT-GUIDE.md`](DEPLOYMENT-GUIDE.md) | **舊部署依賴，非本輪部署依據：** deploy script 透過 `PAYROLL_DIR` 讀 payroll `firestore.rules`，合併後部署 rules；缺 `.env` 時有從 payroll 複製 Firebase config 的流程；舊 guide 寫明共用 payroll project，也含由 payroll 側再部署 rules 的命令。這些只證明 repo 內存在舊依賴，**不能證明曾部署、目前 project ID、production 資料或帳單狀態**。 | P17 改為固定獨立 EasyOrder Spark 目標與使用者本機部署流程。勿執行本舊流程；本次未讀取／複製任何 `.env` 或 credential，未改 payroll 資源。 |
| [`firestore.rules`](../../firestore.rules)、[`firestore.indexes.json`](../../firestore.indexes.json)、Firestore rules tests | **舊 schema 與測試：** rules 只含 operators、students、transactions、daily settlements 等既有結構；tests 使用 emulator/fixture，不能證明新 Rules 或 production 資料安全。 | P01 先以 emulator 證明新 Rules 關鍵交易；P05 後才把經證明的規則搬入正式檔案。 |

## #469 決策項目對應

下表說明已決定的需求落在新 spec 哪裡；**不是實作狀態**。完整契約見 spec §13。

| 項目 | 新 spec 對應 | 目標／現況註記 |
|---|---|---|
| R1、R2、U11 | §2 | 獨立 Spark、Hosting、不共用 payroll、不新增付費依賴；尚未建立／核實正式 project。 |
| R3、R6 | §5–§7 | immutable command 與帳務投影；不用舊 queued／close-attempts。尚未實作。 |
| R4、U7 | §8、§10 | PC online-only，失聯走紙本故障流程；容量採可明確驗證的使用假設。尚未實作／驗證。 |
| R5、U8 | §4 | 多個精確白名單、等權、單一 active UID；Android identity 另 spec。尚未實作。 |
| R7 | §5、§12 | 不啟用舊 iPad 雲端入口，保留歷史 `sourceDevice` 值。尚未實作。 |
| U4 | P00–P18、§1 | 所有 phase 與本人試營運完成後才可稱正式可用。 |
| U9 | §9 | 支援空白起始及人工輸入期初，保留本機 prototype 訓練模式。尚未上雲。 |
| U10、U13 | §9、§3 | 人工增量備份／復原；匯出與列印發起有稽核。尚未實作。 |
| U15 | §7 | 差異記原因，不自動平帳，不新增呆帳／借支分類。尚未實作。 |
| U1–U3、U5–U6、U12、U14 | §12 | Android 與裝置議題另 spec，不阻擋 PC；本輪不改 Android。 |

## P00 執行基線

### Source 與 TypeScript diagnostics

- 接手 base 是 `75e7a96e6cad722a41076df66e5b2cf9014e9d47`，與當時 `origin/main` 相同；本 PR 從該 SHA 建立 `codex/backend-p00-baseline`。P00 診斷以此 base 的既有原始碼執行，文件變更不改變其輸入。
- 工作目錄 `frontend/`，命令 `npx --no-install tsc -p tsconfig.app.json --noEmit`；Node `v24.19.0`，TypeScript `Version 6.0.3`；真實 exit status **2**，診斷 **279** 筆。這是擷取既有失敗基線，不是本 P00 修復項目或應用功能驗收。
- 完整多行 diagnostics 已保存於 [75e7a96 tsc app baseline](baselines/75e7a96-tsc-app.txt)。檔案移除 source line／column 以便比較，保留相對路徑、code、完整訊息、原順序及重複項，未去重。內容檢視為 repo 診斷資訊，未包含 production keys 或個人帳務資料。
- 重跑方式（在 repo root）：

  ```bash
  cd frontend
  node --version
  npx --no-install tsc --version
  set +e
  npx --no-install tsc -p tsconfig.app.json --noEmit > /tmp/easyorder-tsc-app.raw.txt 2>&1
  tsc_status=$?
  set -e
  diagnostic_count=$(grep -c -E '^.+: error TS[0-9]+:' /tmp/easyorder-tsc-app.raw.txt || true)
  sed -E 's/^(.+)\([0-9]+,[0-9]+\): error /\1: error /' /tmp/easyorder-tsc-app.raw.txt > /tmp/easyorder-tsc-app.normalized.txt
  printf 'exit=%s diagnostics=%s\n' "$tsc_status" "$diagnostic_count"
  ```

  將 normalized 檔與 baseline `--- diagnostics ---` 之後的內容逐筆比較；不可只比數量，不能排序或去重。後續若消除舊錯誤，應更新 baseline 並說明差異；新增雲端模組須無 TS diagnostics。

### 文件與 emulator 準備

- README、PROJECT-STATUS、此 evidence 與舊部署指南皆連至同一 spec/plan/evidence；本次只補 P00 狀態，不重述 schema 或歷史前端本人驗收。
- 2026-10-14 coordinator 回報：本 Cloud runtime 的 Firebase Emulator binary 下載由 `storage.googleapis.com` 回 HTTP 403 `Domain forbidden`。環境網域設定 draft 已加該 host，但需使用者保存／發布後 runtime 才會套用；目前 local Firestore Emulator prerequisite **未就緒**。Coordinator 另確認現有 GitHub Actions runner 是可嘗試的獨立 emulator 驗證路徑；P01 尚待建立 proof suite 並實際執行該路徑。此回報不等同 Rules 測試通過。
- P00 沒有跑 app tests、build、Firestore emulator、Rules suite、production smoke/deploy；因此不宣稱 P01–P18 任一雲端驗收已通過。

## P01 Rules 可行性 proof（進行中）

### 邊界與目前狀態

- P01 base：`1da09039ab57f2b13f965ce98277bd1d41ce8e5e`（P00 #471 merge）；實作分支 `codex/backend-p01-rules-proof`；draft PR [#472](https://github.com/cheerc/talented-easyorder/pull/472)。RED scaffold head `6ca1545a8e97df4a96c8a75c5429f35f5438a2a9`，Actions run [38514043015](https://github.com/cheerc/talented-easyorder/actions/runs/38514043015) 執行中。GREEN SHA、最終 CI run 與結果待完成後回填；目前 handoff、phase receipt 與 PR body 連結見[開發交接入口](../DEVELOPMENT-HANDOFF.md)。
- 新的 [cloud Rules proof suite](../../frontend/src/firebase/__tests__/cloudRulesProof.spec.ts) 只透過 `initializeTestEnvironment` 載入 [`cloudRulesProof.rules`](../../frontend/src/firebase/__tests__/fixtures/cloudRulesProof.rules)；fixture 不在 `firebase.json` 或 production rules 部署路徑。production [`firestore.rules`](../../firestore.rules) 本 phase 不改，沒有部署。
- Cloud Firestore 僅允許 GitHub runner 的 `demo-easyorder` Emulator 與匿名 synthetic fixtures；沒有連線到 production、payroll、Android 或任何真實資料。此 proof 不是正式功能部署或本人營運驗收。
- 當前 scaffold 是**行為 RED**：匿名五文件 CreateOrder 同批附加不受 command 管理的 extra transaction；寬鬆 fixture 先讓它成功作為負例見證，隨後同樣寫入以 `assertFails` 斷言拒絕並檢查 batch 原子性。它目前還不含完整對抗矩陣，且寬鬆 fixture 預期會令第二個 `assertFails` 測試真實失敗；尚無 RED GitHub run 證據，因此不能稱 RED 已跑過。
- Emulator CI 已加 Java 21、明確 `--project demo-easyorder --only firestore`、`EASYORDER_REQUIRE_CLOUD_RULES_PROOF=true` 與 Vitest JSON gate；runner exit code 優先保留，另拒絕缺報告、測試數為零、全 skipped、失敗或計數欄位無效。一般本機 Vitest 無 emulator 時可明確 skip；CI 必須因缺 host 而 fail closed。
- 本 cloud runtime 下載 Firebase Emulator binary 曾回 `storage.googleapis.com` HTTP 403 `Domain forbidden`；GitHub Actions job metadata 可讀，但下載 log 的 `results-receiver.actions.githubusercontent.com` 也曾遇 HTTP 403。Coordinator 已新增該網域的環境 draft；runtime 套用狀態未確認。這些限制不等於 emulator 測試成功。禁止用 artifact 搬運繞過網域白名單；可由 Actions metadata確認 workflow／job／step conclusion，但未讀到原始日誌前不猜測測試 counts。

### 本階段本地診斷

- 於 P01 base 上，在 `frontend/` 重跑 `node --version`、`npx --no-install tsc --version` 及 `npx --no-install tsc -p tsconfig.app.json --noEmit`：Node `v24.19.0`、TypeScript `Version 6.0.3`、真實 exit **2**、diagnostic headers **279**。將去行號後的完整輸出逐筆與 P00 [baseline](baselines/75e7a96-tsc-app.txt) 比較，順序／重複項相同，無新增診斷；新 suite 使用 Vite `?raw` fixture import，避免本檔增加 app TypeScript baseline errors。這個既有 compiler failure 不是 P01 Rules failure，也不是此 phase 修 bug 範圍。
- `npx --no-install eslint src/firebase/__tests__/cloudRulesProof.spec.ts` exit 0。未在無 emulator 環境把 skip 當 Rules pass；初始本地 Vitest JSON 為 2 total、0 passed、0 failed、2 skipped，僅確認 skip 行為，不算 Rules 證據。
- P01 完整 RED／GREEN 和其他 required checks 未完成；不得稱 P01 已通過。具體 run SHA、URL、command exit、可核對的實際 test counts、Rules access graph 和 expression limit 評估，待真 Emulator suite tight fixture 通過後回填。
