# 零費用正式後端：現況與證據

狀態截至 2026-10-15。此頁保留 P00 基線、P01–P05 已合併證據與 P06 WIP checkpoint。P04 #475、P05 #476 已合併；P06 尚未完成 phase acceptance，新的正式後端未部署、未通過上線驗收。規格是目標契約，不代表功能、雲端資源或部署狀態已成立。前端原本人驗收紀錄仍以 [PROJECT-STATUS](../PROJECT-STATUS.md) 為準。

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

## P06 WIP checkpoint — 2026-10-15

- Phase branch：`codex/backend-p06-students`；唯一 actual PR base `b53423aa71ed4cfac2428f290c648e5a999a0cae`，包含 P05 code merge `41cd08715c435bc5d72ee38985fccd40e0ee4dd1` 與 #477 receipt（41cd 是 merge commit，不是 P06 PR base）。本文件不抄錄 PR head SHA，commit 建立後以 PR body 為版本權威。本節記錄已完成的局部 evidence 與未完成項目，不代表 phase acceptance。
- 範圍：server-only complete student list/read、學生建立／編輯／狀態切換與獨立 cloud page。production command kinds 為 `CreateStudent`、`EditStudent`、`SetStudentStatus`。P05 `EnsureDay`、`CreateOrder`、`CreatePayment` 必須保留；其餘 16 kinds 必須保持拒絕。不得恢復 prototype POS/local business store、開 P07/P08/P10 功能或部署正式環境。
- Contract：所有 student command `businessDate=null`，`studentId` 為固定 target；學生 ID 是字串（`001` 保留前導零），create 不生 transaction/payment/day effect。Create opening 日期只允許 metadata `head.goLiveDate` 或 Rules server 當前台北日期，且不能為未來；這是允許的日期集合，不代表 Rules 能強制辨識 baseline roster 與今天新學生。Edit 只允許 display name／aliases；opening、ID、balance 的更正留 P10。
- **已完成的真 production Rules Emulator 局部證據（2026-10-15，demo-easyorder，production `firestore.rules`）：** unfiltered `cloudCommands.spec.ts` 97/97 + `cloudStudentRepository.spec.ts` 11/11 = 108 passed、0 failed、0 skipped，exit 0；JSON `/tmp/p06-unfiltered-cloud.json`。`cloudCommandRepository.failure.spec.ts` 2/2，exit 0，真 commit 後注入 `unavailable` 與換 lease 的 `permission-denied` 均回 `UNKNOWN_RESULT`，同 ID recovery 取得既有 receipt：JSON `/tmp/p06-p05-failure.json`。A01 `firestoreRules.spec.ts` 10/10、P01 `cloudRulesProof.spec.ts` 36/36、P04 `activeAccountLease.spec.ts` 19/19 也分別以 Emulator sequential 執行；JSON `/tmp/p06-a01.json`、`/tmp/p06-p01.json`、`/tmp/p06-p04-lease.json`。所選 suites 共 175 個 production Emulator tests 分別真跑通過，尚未組成規定順序的單輪 regression。
- 先前 P06 focused filter `cloudCommands.spec.ts -t P06` 為 40 passed、57 not-selected；57 是未執行測試，不能標成通過或完整 command suite gate。完整未篩選 suite 另以 97/97 通過；repository list 另 11/11。此前曾遇到 max-1000 expression 診斷，修正為中央 receipt 與實際 projection 相等、由 student leaf 一次執行 student schema 驗證後，合法 positive／最大 10 個 100 字 alias 的 raw SDK 路徑目前通過。P05 舊負例及 P06 omission/forgery deny 仍可出現 cap 訊息；測試 assert deny+atomic unchanged，不將未隔離 case 說成每一個 guard 的獨立 cap-free 證明。細節依 source case names 與 [P06 rules budget](p05-rules-budget.md#p06-student-write-budget-wip) 查閱。
- server list 使用 `getDocsFromServer`、依 document ID 有序 cursor pages、strict 完整 DTO/path 驗證及讀取前後 `dataHead` seq/dataset/goLiveDate 比對；真 Emulator 500 人跨頁完整通過，501 人明確回 `INCOMPLETE_SNAPSHOT`，不發布部分結果。這個 phase 的已驗上限為 500，不宣稱 501 或無上限名單可完整瀏覽；如需超過 500，完整 pagination UX／容量處理要在後續 phase 解決。
- 完整 Vitest exit 0：1,322 passed／175 Emulator-only skipped／0 failed（JSON `/tmp/p06-full-vitest.json`）；這 175 個 skip 與上方 175/175 個已由真 Emulator 執行的案例一致。`npm run lint`、`npm run build` 均 exit 0（保留 Vite config `__dirname` warning）。App TSC exit 2、290 diagnostic headers／542 normalized lines，與 `/tmp/p06-base-app-tsc.normalized.txt` 比較 diff 0 行；raw/normalized/diff 為 `/tmp/p06-current-app-tsc.{raw.txt,normalized.txt,diff}`。這不是 clean TSC pass。
- Browser：標準 `npm run test:e2e` 因本機缺 Playwright pinned headless Chromium executable，在瀏覽器 launch 階段失敗；沒有把 launch failures 當 assertion failures。使用 `/tmp` config 指定 system `/usr/bin/chromium` 的診斷執行，P04/Auth 與其他 Cloud cases 12 pass；D01 在「新增學生」名稱輸入定位器因搜尋欄同樣含「姓名」造成 strict-mode ambiguity 而失敗，已在本 checkpoint 收斂為 exact textbox locator，但尚未重跑此修正。prototype 7 cases 尚未執行。此診斷不取代官方 pinned Chromium CI。
- **尚未完成的 gate：** prescribed-order A01/P01/P04/P05/P06 全量 regression（以上 suite 雖已分別以 Emulator 通過，還未按正式順序重跑成一組）；D01 修正後的 three-student empty-fixture browser E2E、non-holder masking/auth loss/stale-result browser coverage；prototype 7 cases；P06 JSON skip gate 的 GitHub CI、官方 pinned-browser required CI、獨立 source review。不可把局部 Emulator 結果寫成 P06 acceptance。
- displayName 與 alias 的 current schema 在 Rules、normalizer、receipt decoder、list decoder 統一採 literal non-empty string 長度 1–100（alias 最多 10 個）；UI 可額外修整輸入，但讀寫安全判定不使用 JS trim/Rules whitespace regex 以免 Unicode whitespace 不一致。Emulator 覆蓋 ASCII whitespace、NBSP、BOM、含換行文字合法與空字串拒絕。
- 僅使用 `demo-easyorder` Firestore/Auth Emulator 和合成 operator/student fixtures；不讀取／建立 production credentials、Firebase project、Admin bootstrap 或部署。Firestore SDK `persistentLocalCache` 尚未修改；memory-cache 生命週期限制仍屬 P13。

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
| [`studentRepository.ts`](../../frontend/src/firebase/studentRepository.ts)、[`firebaseActions.ts`](../../frontend/src/store/posActions/firebaseActions.ts)、[`posStore.ts`](../../frontend/src/store/posStore.ts)、[`selectors.ts`](../../frontend/src/store/selectors.ts) | **存在非測試的舊 Firestore writer，但未接目前畫面：** `createFirebaseActions()` 已接入 store，selectors 也暴露 `addStudent`／`disableStudent`；它們會呼叫舊 `studentRepository` 寫入舊 schema。repo 搜尋未找到 screen/component 呼叫端，所以目前不是 active Cloud UI 流程，但不能稱為沒有非測試 caller。 | P05–P06 以新 schema command 替代並移除／明確隔離舊 writer；不得讓它成為第二條正式學生寫入路徑。 |
| [`ledgerRepository.ts`](../../frontend/src/firebase/ledgerRepository.ts) | **未接 UI 的舊 Firestore 寫入程式：** `commitLedgerOnline` 以 transaction 直接新增舊 schema 交易並增量更新學生餘額；`commitLedgerOfflineBatch` 用 `writeBatch` 將交易與餘額更新寫入佇列。沒有目前 UI 呼叫端。 | P05 起以單筆 immutable command 原子更新全部受控投影；P08–P10 逐項驗收冪等與重送。移除舊離線補送語義。 |
| [`settlementRepository.ts`](../../frontend/src/firebase/settlementRepository.ts)、[`realtimeSubscriptions.ts`](../../frontend/src/firebase/realtimeSubscriptions.ts) | **未接業務 UI 的舊程式，部分有測試：** settlement repository 提供 offline close attempt、online promotion、cash adjustment 寫入；realtime subscription 可訂閱舊集合。除 `authService` 的白名單訂閱外，業務訂閱與寫入無畫面呼叫端。 | P11–P13 依新命令／讀取投影重做；不沿用舊 pending/offline 關帳。 |
| [`firebaseApp.ts`](../../frontend/src/firebase/firebaseApp.ts) 的 Firestore SDK cache 設定 | **Firestore SDK cache 與 Zustand store persistence 是兩層設定。** P02 的 cloud store 記憶體 persistence 不代表 `firebaseApp.ts` 已把 Firestore SDK 改成 `memoryLocalCache`；SDK cache 遷移仍是 P13 planned。Firestore SDK 的離線寫入排隊語義也未因此移除。舊 `writeBatch`／offline close functions 同樣未被 UI 呼叫，不能宣稱它們是正在同步的正式帳務。 | 新規格是 PC online-only；P13 驗收 SDK memory cache、移除正式帳務離線佇列與本機未確認成功狀態。 |
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
- P00 當時沒有本地 emulator，原因是下載 `storage.googleapis.com` 曾回 HTTP 403 `Domain forbidden`；該歷史阻擋在 P01 期間已解除。P00 當時尚無 P01 proof suite 或任何新 Rules 驗證。
- P00 沒有跑 app tests、build、Firestore emulator、Rules suite、production smoke/deploy；因此不宣稱 P01–P18 任一雲端驗收已通過。

## P01 Rules 可行性 proof（已合併 #472；以下保留歷史 checkpoint）

### 邊界與目前狀態

- P01 base：`1da09039ab57f2b13f965ce98277bd1d41ce8e5e`（#471 實際 merge SHA）；PR [#472](https://github.com/cheerc/talented-easyorder/pull/472) 已合併，GitHub API 實際 merge SHA `e7c406c93af197cda0bedaa220a4575728612f0f`。以下 run/source 是開發期間的歷史 checkpoint，不等同最終合併狀態。初版行為 RED source `6ca1545a8e97df4a96c8a75c5429f35f5438a2a9` 的 Actions run [38514043015](https://github.com/cheerc/talented-easyorder/actions/runs/38514043015) 真實日誌為 2 tests、1 passed、1 failed、0 skipped；預期的額外未命令交易 `assertFails` 因交易實際成功而失敗，證明寬鬆 fixture 的行為 RED。
- 歷史 tight WIP source `520dd2de75ede44d41becbb9617a872aea9d4d25` 的真 Emulator run 為 26 tests、18 passed、8 failed、0 skipped，exit 1；當時日誌包含 1000-expression-limit 訊息。歷史調查亦發現，這段 WIP 修正迭代有 command `reason`／`cashEffect` schema 未對齊、合法 helper 缺 seed operators／lease 前置資料、`withSecurityRulesDisabled` callback 回傳值未正確取得，以及零收款 delta 遇到 `-Number(0)` 等缺陷。這些是該迭代的混合診斷，不能據此推論 schema 正確的合法模型也不可行。checkpoint 摘要保留於[歷史 expression-limit 記錄](diagnostics/p01-rules-expression-limit-wip.txt)，其當時結論不代表目前結論。
- 後續 source `5c55936fc0a0cbc82da3058b4a466364a0d0da1f` 的真 Emulator proof 為 exit 0、30 passed、0 failed、0 skipped；正向鏈包含 Close → Reopen → 新訂單 → 再 Close，settlement revision 到 3。這只是當時工程 checkpoint，不是最終 GREEN：SOL review 後續仍找到必要 head／student／transaction writer 可省略、command snapshot 可偽造成未變 server map、settlement revision 硬編碼、新交易 `studentNameSnapshot` 未比對，以及部分負測 actor 不匹配等缺口。這些當時確實阻擋合併；歷史狀態已在 #472 合併前處理，不能把此 checkpoint 的 30 pass 說成 P01 最終通過依據。後續 source、合併 SHA 與最終結果以 GitHub PR body／merge 狀態為準；phase receipt 見[開發交接入口](../DEVELOPMENT-HANDOFF.md)。
- Actions 的 CI checkpoint commit `b4201b9c99520a821250dec5f087e097c1bf0d13`、run [38519397752](https://github.com/cheerc/talented-easyorder/actions/runs/38519397752) 對應上述 `5c55936` proof 狀態。Coordinator 讀取原始 Actions logs：build-and-test 與 e2e jobs 成功；一般 Vitest 為 1232 passed／38 skipped（其中 30 個 proof 測試與 8 個舊 Rules 測試在無 emulator 的一般 job 中 skip），獨立舊 Rules Emulator suite 為 8 passed，獨立 proof JSON 為 30 tests／30 passed／0 failed／0 skipped，e2e 為 10 passed。這仍是有上述 review 缺口的中間 checkpoint，不是最終 SHA 的 merge gate。
- 新的 [cloud Rules proof suite](../../frontend/src/firebase/__tests__/cloudRulesProof.spec.ts) 只透過 `initializeTestEnvironment` 載入 [`cloudRulesProof.rules`](../../frontend/src/firebase/__tests__/fixtures/cloudRulesProof.rules)；fixture 不在 `firebase.json` 或 production rules 部署路徑。production [`firestore.rules`](../../firestore.rules) 本 phase 不改，沒有部署。
- Cloud agent 僅使用本地／GitHub runner 的 `demo-easyorder` Emulator 與匿名 synthetic fixtures；沒有連線到 production、payroll、Android 或任何真實資料。此 proof 不是正式功能部署或本人營運驗收。
- RED scaffold 的行為已由上述 Actions run 驗證：匿名五文件 CreateOrder 同批附加不受 command 管理的 extra transaction；寬鬆 fixture 先讓它成功作為負例見證，隨後 `assertFails` 的拒絕斷言因交易實際成功而失敗。此 RED 僅證明該攻擊在寬鬆 fixture 被放行，不代表 tight Rules 或正式 Rules 的狀態。
- Emulator CI 已加 Java 21、明確 `--project demo-easyorder --only firestore`、`EASYORDER_REQUIRE_CLOUD_RULES_PROOF=true` 與 Vitest JSON gate；runner exit code 優先保留，另拒絕缺報告、測試數為零、全 skipped、失敗或計數欄位無效。一般本機 Vitest 無 emulator 時可明確 skip；CI 必須因缺 host 而 fail closed。
- Emulator prerequisite 已就緒：Node `v24.19.0`、Java `21.0.12.1`、Firebase CLI `14.27.0`；官方 Firestore Emulator `1.19.8` JAR 安裝完成，SHA-256 `9d43599ed6151199e8d604dc87fac51218e49e5f3a48519b1ae560bbe5e3382d` 與鎖定 firebase-tools metadata 相符。先前 GitHub Actions log host 的 403 亦已解除，本次讀取 RED run 真實日誌；沒有用 artifact 搬運。
- P01 最終合併 SHA `e7c406c93af197cda0bedaa220a4575728612f0f` 的 test-only proof 覆蓋所選合法正向案例、Rules 靜態閉合檢查、拒絕後 atomic unchanged 與已列 lease/日期 guard。歷史負例中共同 builder 當時未成立，rules 見證只是一個 fixture/一次 call-graph 導致的 1000-expression-cap 診斷；它不是 corrected schema 的合法交易也不可行的結論。合併 proof 有 positive cases 通過，但範圍只限選定操作，並非完整 22-kind，也不宣稱每個 guard 都有一個完全隔離的測試。呼叫預算仍須在後續正式 command kinds 啟用時按實際 Rules path 重算並用 Emulator 驗證；設計數字與契約見 spec §7 及計畫 P01。

### 本階段本地診斷

- 於 P01 base 上，在 `frontend/` 重跑 `node --version`、`npx --no-install tsc --version` 及 `npx --no-install tsc -p tsconfig.app.json --noEmit`：Node `v24.19.0`、TypeScript `Version 6.0.3`、真實 exit **2**、diagnostic headers **279**。將去行號後的完整輸出逐筆與 P00 [baseline](baselines/75e7a96-tsc-app.txt) 比較，順序／重複項相同，無新增診斷；新 suite 使用 Vite `?raw` fixture import，避免本檔增加 app TypeScript baseline errors。這個既有 compiler failure 不是 P01 Rules failure，也不是此 phase 修 bug 範圍。
- `npx --no-install eslint src/firebase/__tests__/cloudRulesProof.spec.ts` exit 0。未在無 emulator 環境把 skip 當 Rules pass；初始本地 Vitest JSON 為 2 total、0 passed、0 failed、2 skipped，僅確認 skip 行為，不算 Rules 證據。
- 上述 `reason`／`cashEffect` 未對齊、fixture helper 前置資料、callback return、`-0` 等是歷史 WIP 診斷，不是目前 P01 待辦。PR #472 已於 2026-10-14 合併；當時 required checks／SOL review gate 通過後才啟動 P02。此節保留早期 checkpoints 供追溯，遇到矛盾以最終 GitHub merge 狀態與本段結果為準。

## P02 雲端 command／投影介面與模式隔離（已合併 #473）

- 已於 2026-10-14 由 Coordinator 完成 review 並 merge 至 main（GitHub API 實際 merge SHA `bc5bb2588e616f40a605ea8cd682b1d1642bbc71`）。
- 驗收成果：L01–L04 與投影數學全數通過；Zustand cloud store 的記憶體 persistence 與 prototype 分離。這不代表 Firestore SDK cache 已改用 memory cache；SDK cache 遷移仍列 P13。

## P03 Google 登入與等權白名單（已合併 #474）

- 已於 2026-10-14 由 Coordinator 完成 review 並 merge 至 main（實際 merge SHA `fd8cba1b84c0b2146c1f450192e2c99739193e46`）。
- 驗收成果：A01 等權白名單測試全數通過，未核准畫面、browserSessionPersistence 與 operators 規則就緒。

## P04 全公司單一活躍 Google 身分使用權租約（已合併 #475）

### 範圍與狀態

- PR：[#475](https://github.com/cheerc/talented-easyorder/pull/475)，P04 branch `codex/backend-p04-active-lease`，base `fd8cba1b84c0b2146c1f450192e2c99739193e46`，final source head `cf0cd10af4171f24cf5faa6dff0814393cb71340`，實際 squash merge SHA `837a1e871468db217463e9799480beeb6d7b0ab0`。固定版本獨立 review comment `5519480848` pass；required CI run [38579765651](https://github.com/cheerc/talented-easyorder/actions/runs/38579765651) 已 completed/success，build-and-test 與 E2E 兩個 jobs 均成功；Coordinator 已 merge。上一個候選 `4c1aeb196ca94d7da14d12ba832c050783b2227c` 的 P1/P2 review blockers 在最終 source head 修正並由以上 review/re-run 接受。
- 原始候選包含 `activeAccountLease.ts`、`activeAccountLease.spec.ts`、`firestore.rules`、`AuthGate.tsx`、`FirebaseProvider.tsx`、`cloud-production.spec.ts`。這份清單描述 PR 的範圍，不是每個行為都已驗收。
- P04 完成的是 Google operator lease 與登入/失權邊界，不等於業務 UI／歷史 business data hydrate 或正式營運。P05 目前已獲授權並正在進行；P05 code/tests/CI 仍不可標 pass。

### 原始 CI run 與已知缺口

- GitHub Actions 原始 CI [run 38541150763](https://github.com/cheerc/talented-easyorder/actions/runs/38541150763) 有 `build-and-test` 與 `e2e` 兩個綠色 job。原始完整日誌另保存在執行工作區 `/tmp/easyorder-pr475-inherited-ci.log`；這是 rework 前的 checkpoint，不是目前 PR 的通過證據。
- 一般 `npx vitest run`：138 個 test files passed、3 skipped；1328 個 tests 中 1271 passed、57 skipped。P04 `activeAccountLease.spec.ts` 的 11 個案例全數在此一般 job skipped，沒有在這個 job 中驗租約 Emulator 行為。
- 獨立 P03 `firestoreRules.spec.ts` Emulator suite：A01 共 10 passed；獨立 P01 test-only proof suite：36 passed、0 skipped。這些是其各自的測試證據，不是 P04 租約 suite 通過的替代品。
- E2E 共 14 passed。A02–A04 只檢查畫面 strip/button smoke，沒有驗證完整雙帳戶互斥、租約期限、renew/release 或失權契約；因此不能記為 A02–A04 contract pass。
- 原始 GREEN CI 不能抵銷原始 review 未通過。缺模組／compile failure 只證明程式未能載入，不算行為 RED。本輪另有 exact-email password-provider 行為 RED/GREEN 證據，並完成 lease／Rules Emulator 與 Cloud/prototype E2E；新候選仍須跑 GitHub required checks，並由獨立 review 對 immutable head 重審。

### P04 最終本地與 GitHub 證據

- 定向核心 Vitest：修正後 full `npx vitest run` 為 140 個 test files passed、3 skipped；1291 passed、65 skipped、0 failed；log `/tmp/easyorder-p04-full-vitest-r9.log`。一般 Vitest 的 skipped 含需 Emulator 才執行的 Rules tests，因此不能代替下列獨立 gates。
- 獨立 Emulator gate：在 `demo-easyorder` 以同一個 Firestore Emulator 順序執行 P04 lease 19/19、A01 `firestoreRules.spec.ts` 10/10、P01 `cloudRulesProof.spec.ts` 36/36，三者均 0 failed、0 pending/skipped；合併 log `/tmp/easyorder-p04-emulator-gates-r9.log`，lease JSON `/tmp/active-account-lease-proof-p04-rework.json`、P01 JSON `/tmp/cloud-rules-proof-p04-rework.json`。新增 P04 Emulator 案例涵蓋 90 秒有效餘裕／逾期窗、兩 UID 同 epoch acquire 競爭僅一方成功、renew/release race 最終為 null holder/new epoch、expired renew deny 且文件不變；Rules 等號界線由靜態 `<= request.time`／`> request.time` 檢查證明，不把網路往返時間附近的 Emulator 結果稱為精確 equality 實測。
- Web Locks 與 pending snapshot：unit test 驗證 cache/pending metadata observation 不回呼、不授權也不撤銷已確認狀態；server ack 才發布，authoritative missing/malformed/error 仍 fail closed。Provider 測試確認該非權威 observation 不清除 cloud POS memory，server-confirmed holder/epoch 變更才 stop heartbeat 並清資料。test-only lock manager 驗證兩個 starter 只有一個 leader、leader 退出後排隊頁接手、queued abort 與 inflight completion after stop 均不呼叫 stale loss callback。
- P01 budget 診斷限制：本輪 P01 JSON 中 36/36 tests passed，合法 positive assertions 通過，原子未變斷言亦通過；同一 run 的 Rules log 在 25 個預期拒絕測試案例名稱下出現一次或多次 `maximum of 1000 expressions` diagnostics。部分拒絕由 `assertFails` 驗收時，expression cap 本身可能是拒絕原因，因此不能稱這些目標 guard 已各自 cap-free 證明。這不否定合法 positive 用例，也不把靜態契約稱為 Emulator 驗收；P05 每個 kind 開放前仍須重算並驗證其 Rules path。
- 行為 RED/GREEN：針對 `A01.7: exact legacy test email with matching active UID is still denied for password provider`，暫時載入 immutable PR #475 初始 head `6264660974d4c678f897d5734201bbd842655442` 的舊 Rules。精確 test email、matching active operator UID 的 password identity 成功讀取 lease，預期的 `assertFails` 真正失敗，訊息為 `Expected request to fail, but it succeeded.`；該 target 1 failed、9 filtered，log `/tmp/easyorder-p04-rules-A01-7-old-head-behavior-red.log`。現行 Rules 已 byte-for-byte 恢復（SHA-256 `cf2f72a9948022daf448d7f4d9d8262efff3f898bc7839cdd7f1a153492df35c`），恢復後完整 A01 為 10/10，log `/tmp/easyorder-p04-rules-A01-current-after-red.log`。因此禁止 password-provider exact-email 例外有可重現行為 RED/GREEN 證據。
- E2E phase 邊界：舊 Cloud POS order/deposit 因 `/students/**` 在 base/current Rules deny、P05 尚無 read/hydrate adapter，無法找到 Cloud student suggestions。沒有放寬 Rules 或讓 Cloud 回退 prototype seed；四個純 POS specs 的原有 7 個 cases 由 no-Firebase、no-auth、無 Emulator/global setup 的 genuine prototype config 執行，並要求出現「本機練習 · 僅此瀏覽器」標示。最終 frozen-source 合併命令為 `npx firebase emulators:exec --project demo-easyorder --only auth,firestore "npx playwright test --config /tmp/p04-playwright-cloud-system-chromium.config.mjs && npx playwright test --config /tmp/p04-playwright-prototype-system-chromium.config.mjs"`；Cloud 11/11、prototype 7/7，合計 18/18、0 skipped、exit 0，log `/tmp/p04-e2e-final-heartbeat-system-chromium-2026-10-14.log`。Cloud 含 auth／smoke、A01–A08；A08 同 BrowserContext 兩個同 UID 頁面以 page clock 推進兩次 60,001 ms，驗證 server `updatedAt` 兩次前進、holder/epoch/UI 保持，關閉 leader 後 follower 接手並續約。Prototype 7 項只驗本機練習流程，**不表示 Cloud POS、P05 student reads 或雲端業務資料完成**。
- 本機瀏覽器限制：Playwright pinned Chromium shell 下載因 CDN HTTP 403 `Domain forbidden`，見 `/tmp/p04-playwright-install-2026-10-14.log`。上述最終 E2E 使用可啟動的 system Chromium 154 與 `/tmp` 診斷 config，不改官方 tracked config；此結果不是 pinned-browser GitHub Actions gate。推送後仍需看實際 required GHA run。
- 靜態／build：`npm run lint` exit 0，log `/tmp/easyorder-p04-eslint-r9.log`；`npm run build` exit 0，log `/tmp/easyorder-p04-build-r9.log`（Vite 保留既有 `__dirname` warning）；`npx --no-install tsc --noEmit` exit 0，log `/tmp/easyorder-p04-tsc-r9.log`；`git diff --check` exit 0。Cloud package runner與兩條 workflow 在 demo emulator 先跑 Cloud suite、再跑隔離 prototype suite；本地 pinned Chromium CDN 下載回 403，故上述 E2E 用 system Chromium 154 與 `/tmp` 診斷 configs，仍須由 GitHub pinned-browser run 驗證。
- app TypeScript config `npx --no-install tsc -p tsconfig.app.json --noEmit` 仍因 inherited diagnostics exit 2；保留完整順序與重複項的 normalized multiline diff 為 base 295、current 290、新增 0、移除 5 項既有 Provider test typing errors。diff `/tmp/easyorder-p04-r8-normalized.diff`，normalized current `/tmp/easyorder-p04-current-r8-normalized.txt`，raw current `/tmp/easyorder-p04-app_tsc-r8.log`；兩個本輪觸及的 lease/provider modules 無 diagnostics。P00 的 279 與 P04 base 295 是不同 source 觀察，不可混為同一基線。
- P04 source head、獨立 review、required CI 與 merge 已全部完成；這些 P04 數據不是 P05 測試證據。P05 的目前 branch 從 merge SHA `837a1e871468db217463e9799480beeb6d7b0ab0` 起始。本地 Chromium 154 只屬診斷 run；正式 pinned-browser 的 GitHub E2E job 已在 run 38579765651 成功。

## P05 正式原子寫入器與冪等收據（#476 已合併）

- PR #476：base／P04 merge SHA `837a1e871468db217463e9799480beeb6d7b0ab0`；source head `0fe7ac738c8495def1c9fdc19580745ff4b4e33f`；實際 merge SHA `41cd08715c435bc5d72ee38985fccd40e0ee4dd1`，於 2026-10-14 16:22:05Z 合併。獨立 [review PASS](https://github.com/cheerc/talented-easyorder/pull/476#pullrequestreview-5521098252)；required CI [run 38596486712](https://github.com/cheerc/talented-easyorder/actions/runs/38596486712) 兩個 jobs SUCCESS，E2E 使用官方 pinned Chromium 148.0.7778.96／Playwright v1223。
- 只開啟 `EnsureDay`、`CreateOrder`、`CreatePayment` 三種 production command writes，其餘 19 個 kind 由 production Rules deny。Cloud mode 僅呈現 Google／lease shell 與「業務功能暫未開放」，不掛載本機 POS hooks；只有明確 prototype mode 可掛舊 `AppContent`。Firebase 正式模式缺 config 時呈設定錯誤，不降級成 local POS。P05 不接 business hydration、P06 student management、settlement、backup 或 production setup。
- Schema/repository：完整 22-kind target/payload/revision union 與前三 kind runtime validator 在 merged source；strict persisted receipt decoder 檢查 kind-specific full before/after schema、path/commandId、timestamps、revisions/linkage，重新正規化 stored semantic input 並驗 fingerprint。semantic identity 包 commandId/kind/targets/payload/expected revisions，不包含 actor 或 leaseEpoch；current operator/lease 每次仍須成立，歷史 actor/epoch 留作 audit。CreatePayment 可補繳 inactive student；CreateOrder 需 active student。由於 CreateOrder／CreatePayment payload 無歷史補登理由，repository/Rules 將兩者限制為當前 Asia/Taipei 營業日；`P05.26` 真 Rules 測試拒絕昨日 order 與 payment，逐件核對 head、student、day、transaction、receipt 全不變。EnsureDay 依既有日期/goLive/未來日規則另行處理。
- Commit/write invariant：所有 transaction reads 完成後才寫；repo 由 Auth 與 server-read operator/lease/head/targets 推導 actor、seq、server timestamp、完整 before/after、cashEffect 及 canonical fingerprint。Same ID／same semantics 回原 receipt，不增加 seq；不同 payload/kind/target/revision 明確拒絕；new lease epoch 的 current holder 可讀舊 epoch receipt。SDK retry 固定 command ID 和 caller expected revisions；head/revision 衝突不自動以新 revision 覆蓋重送。P05.28 failure suite 使用真 Firestore transaction/Rules，僅包裝 post-commit `getDocFromServer`：一次 synthetic `unavailable`、一次先由 Admin 換 lease 後真 Rules `permission-denied`；都回 `UNKNOWN_RESULT`，Admin 驗證五文件已寫，原 command ID 由合法 holder retry 回到同一 receipt/seq 且無重複 effect。`readCommand` 只用 server-only read，只有 server 確認不存在回 `null`，合法現任 holder 可讀歷史 actor/epoch receipt。
- Rules/closure：command central gate 強制固定 targets 的必要寫入確實 revision +1、lastCommandId/server updatedAt 相符，完整 snapshot 與 server map 相等；head、command、學生、日、交易五文件同筆完成，EnsureDay 三文件完成。raw SDK 測試逐一拒絕省略 head/student/day/transaction writer，另測 after 沿用未改 server map、extra tx、dual command、replay、偽造 before/after、bad UUID、forged actor/time/seq/epoch、expired/non-holder lease、closed day、金額負數/小數/超界及 inactive order，並對每次拒絕核對涉及文件完全未變。P05.25 透過 raw SDK 驗證其餘 19 kind production Rules deny。P05 r7 log 在 31 個 negative case names 中出現一個或多個 1000-expression-cap diagnostics；31 是案例名稱數，不是 diagnostic 事件總數。相關 `assertFails`/atomic unchanged assertions 通過，但不能稱每個拒絕 guard 已 individually cap-free isolated。review 另指出 numeric upper-bound builder（含 `afterBalance`）與其他 projection 未同步，因此 malformed-batch denial／atomic unchanged 不能單獨歸因為 numeric-bound guard；fixture hardening 可提高因果隔離。這不阻擋此次 P05 review／CI／merge。三種合法正向路徑通過 Emulator，無 expression-cap failure。P01 舊 proof 的 expression-cap 限制保留在前節，不移除合法正向或安全檢查。
- Access-call budget：完整 22-kind target union 與未開 kinds 的 target/write/expression-risk 估值見[獨立盤點](p05-rules-budget.md)。對三種已開 kind，static no-cache commit request closure 為 EnsureDay 11/20，CreateOrder/CreatePayment 19/20；command create write operation 最大 10。此數已含 SDK 對 read-but-unwritten operator（Rules dependency 0）及 accessLease（approvedOperator dependency 1）的 VerifyMutation。每筆 SDK transaction 的 5/7 個 BatchGet server reads Rules dependency 另為 7/11 次，逐個 read RPC 計且不假設 cache；post-commit read/error recovery 另計。上列呼叫數為精確 source 靜態圖，Emulator 正向路徑通過但沒有提供 runtime numeric counter；其他 19 kind 不得稱已證明。
- 舊 writer／bootstrap：舊 `studentRepository` 有 `firebaseActions.ts` 非測試 caller；這不等於已證明 active Cloud UI 可達。舊 student/ledger/settlement repositories 現皆 immediate fail-closed，不呼叫 Firestore SDK／queue；針對性 suite 3 files／13 passed，且 current full Vitest 含其 regression。`docs/ops/p05-datahead-bootstrap-manifest.schema.json` 只描述 IAM/Admin 維護者可建立的 dataHead 空 metadata、seq 0、maintenance true；沒有財務初值，沒有可執行 production bootstrap，也未執行。Firestore `persistentLocalCache` 尚未改；memory-only 是 P13 項目。
- P05 production Rules Emulator checkpoint：在 `demo-easyorder` 使用真 production `firestore.rules`，同時執行 `cloudCommands.spec.ts` 與 `cloudCommandRepository.failure.spec.ts`，77 + 2 = 79 passed／0 failed／0 skipped，exit 0；JSON `/tmp/easyorder-p05-commands-r7.json`、log `/tmp/easyorder-p05-commands-r7.log`。含三種 enabled kind 正向、same-ID replay/collision、跨 epoch recovery、concurrent expected-revision conflict、inactive payment、19 disabled kinds、strict receipt corruption、四種 required-writer omission（含 after 沿用未變 server map）、raw SDK actor/time/seq/epoch/expired lease/non-holder/closed day/amount/schema attacks、歷史日期 deny 與兩種 post-commit failure injection。A01/P01/P04/P05 sequential Emulator regression 合計 144/144、0 failed／0 skipped；JSON/log: A01 `/tmp/easyorder-p05-a01-r7.{json,log}`、P01 `/tmp/easyorder-p05-p01-r7.{json,log}`、P05 `/tmp/easyorder-p05-commands-r7.{json,log}`、P04 lease `/tmp/easyorder-p05-lease-r7.{json,log}`。
- P01 日期修正：同檔 `CreateOrder` 與 `CorrectTransaction` 的兩個拒絕測試先前將 transaction date 固定寫成 `2026-10-15`。Asia/Taipei 進入該日後 mutate 成了 no-op，導致當時 34/36（2 個 false-negative test failures），不是 Rules 放行日期漏洞。改用 `shiftDate(dayId, 1)`，保留原拒絕與 atomic unchanged assertions；更新後 Emulator 36/36。搜尋同檔／fixture 後，其餘固定日期是 impossible calendar date 或 2020 historical time，不會隨當日推進變為 no-op。
- Full Vitest：1,297 passed／144 skipped／0 failed，141 test files passed、5 Emulator-only files skipped，JSON `/tmp/easyorder-p05-full-vitest-r8.json`、log `/tmp/easyorder-p05-full-vitest-r8.log`；144 skips 僅在一般無 Emulator 執行：A01 10、P01 36、P04 lease 19、P05 command 77、P05 failure 2，已在前述 sequential Emulator 回歸逐項跑過，不把 skip 當 pass。`npm run lint` exit 0（`/tmp/easyorder-p05-lint-r7.log`）、`npm run build` exit 0（`/tmp/easyorder-p05-build-r7.log`）；build 有既存 Vite `__dirname` config-loader warning。App TypeScript `npx tsc -p tsconfig.app.json --noEmit --pretty false` exit 2，base/current 各 290 項 inherited diagnostics；完整 normalized output 為 542 行，base/current 逐行比較無差異、零新增診斷。base `/tmp/easyorder-p05-base-app-tsc.normalized.txt`、raw `/tmp/easyorder-p05-current-app-tsc-r7.raw.txt`、normalized `/tmp/easyorder-p05-current-app-tsc-r7.normalized.txt`、diff `/tmp/easyorder-p05-app-tsc-r7.diff`。不是 clean TSC pass。
- Cloud＋prototype E2E final source 19/19、0 skipped：Cloud 12/12、prototype 7/7，log `/tmp/easyorder-p05-e2e-final-r8.log`。使用同一個 demo auth/firestore Emulator 順序跑 Cloud then prototype，system Chromium 154 與 `/tmp` browser configs；A01–A09 包括 A08 heartbeat／leader takeover，以及 A09 cloud business closed shell。此為本機診斷執行，不是 pinned-browser gate；最終 required CI run 38596486712 已使用官方 pinned Chromium 148.0.7778.96／Playwright v1223 通過。prototype 7 個本機 POS cases 未 skip、未混入 cloud business pass。
- Review／歷史：前一 immutable candidate 因 review NOT PASS；3cb review comment `5520752222` 的 P1/P2 findings 後續在 #476 source 修正，舊 head CI run 38591372284 不適用最終 source。PR #476 的 immutable review comment `5521098252` 最終 PASS，required CI run 38596486712 兩個 jobs 成功，coordinator 已於 2026-10-14 16:22:05Z merge 為 `41cd08715c435bc5d72ee38985fccd40e0ee4dd1`。P06 已排定為學生名單與期初手動建檔，尚未開始；只逐項開啟已接上 `commitCommand`、server read/hydrate、receipt confirmation 並通過 Rules/review 的學生功能，不可整批恢復舊 `AppContent`／POS。本次文件收據不啟動 P06。未部署或連接正式資源；部署與任何真實資料操作仍由使用者本機執行。`persistentLocalCache` 未改，Firestore SDK memory cache 仍屬 P13。

### TypeScript 診斷基線

- P00 的 `75e7a96` 歷史 baseline 為 exit 2、279 diagnostics；P04 base 另以 `npx --no-install tsc -p tsconfig.app.json --noEmit` 擷取為 exit 2、295 diagnostics，原始輸出在目前執行環境 `/tmp/easyorder-p04-base-tsc.raw.txt`。
- 279 與 295 是不同 base 的不同觀察。原始報告稱 P04 base/head 都是 295，不能由相同數量推論逐筆 diagnostics 完全相同或零新增。本輪最終有 295→290 的逐筆 multiline normalized 比較、0 新增／5 項舊錯移除；後續 code/merge candidate 若再變動，仍需重新比對並以當前 PR body 記錄。

### 更新規則

新 RED/GREEN、Emulator/E2E 數量、lint/build、TypeScript diagnostic diff、CI run、review 與 merge 結果只在實際執行並確認後追加；PR head／base 與完整 receipt 以該 PR body 為版本權威。本節中 P05 #476 merge 狀態已於 2026-10-14 核實；未來尚未發生的 merge／未驗證 SHA 不預錄。


