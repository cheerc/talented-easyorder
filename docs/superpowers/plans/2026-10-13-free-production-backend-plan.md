# EasyOrder 零費用正式後端分階段實作計畫

日期：2026-10-13。狀態：**規劃已交付；P00 已合併；P01 正在縮減真 Emulator 發現的 expression-limit failure 並補齊 command schema；P02–P18 尚未開始或驗收**。

**Source of truth：** [正式後端 spec](../specs/2026-10-13-free-production-backend-spec.md)，包含使用者最新「多白名單、等權、同時單一Google帳號」修正；來源 [PR #469](https://github.com/cheerc/talented-easyorder/pull/469)。

**Goal：** 單一公司可用真實資料完成學生建檔、訂餐、繳費、更正、帳務統計、日結、備份還原，實際雲端服務費零元。

**Architecture：** 獨立Firebase Spark專案，Hosting靜態前端、Google Auth、Firestore Rules＋client transaction。每筆command與必要帳務投影原子提交，完整不可覆寫command序列支持稽核及本機備份；沒有Functions或常駐server。

**Tech stack：** 現有React/Vite/TypeScript/Zustand/Firebase Web SDK，Node24、Vitest、Firebase Emulator、Playwright。Android不在phase內。

## 1. 團隊交付規則與依賴

每個P編號是一個可獨立review／merge的PR單位，原則一次只啟動一個phase；P01 proof不能直接宣稱正式功能完成。若一phase出現兩個互不依賴的可觀察行為，拆成該phase的a／b PR，各自附驗收。禁止把P03–P12包成「一次接完後端」的大PR。

所有未完雲端入口預設關閉／清楚標示尚未提供，prototype持續可用。**P18以前正式真實資料不開放**；分phase可展示不等於可營運。不用假資料fallback或未完成rules讓中間版看似可用。新kind只能在對應Rules對抗測試通過後開放；尚未實作kind deny。

依賴順序：

```text
P00 文件與現況基線 → P01 Rules可行性proof → P02 雲端介面
→ P03 Google白名單 → P04 單活躍帳號 → P05 原子command核心
→ P06 學生名單 → P07 日期菜單與供應商 → P08 訂餐
→ P09 繳費與櫃台收支 → P10 更正取消與期初更正
→ P11 關帳重開 → P12 完整查帳與報表
→ P13 故障與操作完整性 → P14 增量備份 → P15 復原
→ P16 容量與安全整合驗證 → P17 部署準備 → P18 本人試營運
```

每phase receipt：base/current完整SHA、實際變更檔、對應spec節／案例ID、測試指令和結果、三分鐘demo、已知限制、docs-check、下一phase可消費的介面。只用匿名fixture；reviewer只review，由coordinator檢查結果與CI再依團隊規則合併。不得自動把後續phase標完成或把本人驗收代簽。

### Phase receipts

| Phase | 狀態 | 交付摘要與證據 |
|---|---|---|
| P00 | 已合併 #471 | Base：`75e7a96e6cad722a41076df66e5b2cf9014e9d47`；PR head：`7a7128f14cf32268808de4e0a57f6986a0ca806e`；main merge SHA：`1da09039ab57f2b13f965ce98277bd1d41ce8e5e`。新增[現況與證據](../../ops/free-production-evidence.md)，含完整 279 筆 TypeScript diagnostics、舊寫入／部署路徑分類及 R/U 對照。docs links／diff check pass；基線 tsc exit 2；PR CI 識別 docs-only 並跳過 app steps。 |
| P01 | RED 已由 Actions 確認；tight proof WIP 遇 expression limit | [PR #472](https://github.com/cheerc/talented-easyorder/pull/472)，base `1da09039ab57f2b13f965ce98277bd1d41ce8e5e`。RED source `6ca1545a8e97df4a96c8a75c5429f35f5438a2a9` 的 Actions run [38514043015](https://github.com/cheerc/talented-easyorder/actions/runs/38514043015)：2 tests，1 passed、1 failed、0 skipped，未命令 extra transaction 的 `assertFails` 預期失敗。Local tight Rules WIP source `520dd2de75ede44d41becbb9617a872aea9d4d25` 在真 Emulator 有 26 tests：18 passed、8 failed、0 skipped；多個有效 commit 觸發 1000 expression cap，細節見[evidence](../../ops/diagnostics/p01-rules-expression-limit-wip.txt)。WIP schema 尚缺 spec command 頂層 reason／cashEffect，未 GREEN、未 review、未部署。 |
| P02–P18 | 尚未開始／未驗 | 不代表任何新雲端功能已實作或通過。 |

## 2. 現有檔案與規劃新檔

以下現有路徑已檢視，接手時仍須在最新main確認；新路徑是本plan指定產物，尚不存在。若團隊調整檔案拆法，在該PR同步更新此表，不改業務契約。

| Existing：修改／對映位置 | 目的 |
|---|---|
| `frontend/src/appMode.ts`、`App.tsx`、`auth/AuthGate.tsx`、`providers/FirebaseProvider.tsx` | 正式模式入口、失權遮罩、資料hydrate |
| `frontend/src/firebase/{firebaseApp.ts,authService.ts,firestoreSchema.ts}` | 記憶體快取、Google session persistence、新雲端schema |
| `frontend/src/firebase/{studentRepository.ts,ledgerRepository.ts,settlementRepository.ts,realtimeSubscriptions.ts}` | 舊模型移除／adapter改接，不留第二寫路徑 |
| `frontend/src/store/{posTypes.ts,posPersistence.ts}`、`posActions/{transactionActions.ts,editActions.ts,sessionActions.ts,menuActions.ts,firebaseActions.ts,faceActions.ts}` | prototype/cloud dispatch、移除cloud裸setter／reset／離線persist |
| `frontend/src/domain/{student.ts,ledger.ts,ledgerAudit.ts,cashClose.ts,cashSession.ts,menu.ts,ledgerReport.ts,ledgerExport.ts,practiceSnapshot.ts}` | 既有模型／數學／輸出相容，afterBalance改為投影 |
| `frontend/src/firebase/__tests__/firestoreRules.spec.ts`、`frontend/e2e/*.spec.ts` | 既有rules與操作回歸 |
| `firestore.rules`、`firestore.indexes.json`、`firebase.json`、`deploy.sh`、`vercel.json` | 獨立Spark部署，Firebase Hosting，移除payroll合併部署依賴 |
| `frontend/package.json`、`.github/workflows/ci.yml` | 新增proof／cloud rules／復原測試的實際gate |
| `docs/ops/{DEPLOYMENT-GUIDE.md,firebase-vercel-setup.md,firebase-backup-runbook.md,firebase-sync-verification.md,security.md}` | 改成新正式後端實況，舊設計標歷史 |

新檔：

- `frontend/src/domain/cloudCommands.ts`：BusinessCommand型別、CommandResult/error、schema版本。
- `frontend/src/domain/cloudLedgerProjection.ts`：contribution、deriveBalances、兼容現有domain投影。
- `frontend/src/firebase/cloudCommandRepository.ts`：commitCommand/readCommand，唯一業務寫入器。
- `frontend/src/firebase/cloudReadRepository.ts`：限定查詢／分頁／一致性檢查／hydrate。
- `frontend/src/firebase/activeAccountLease.ts`：acquire/renew/release租約。
- `frontend/src/firebase/cloudBackupRepository.ts`：immutable command prefix匯出與manifest。
- `frontend/src/domain/cloudBackup.ts`：驗包、重播、加解密格式。
- `frontend/src/firebase/__tests__/cloudRulesProof.spec.ts`、`cloudCommands.spec.ts`、`activeAccountLease.spec.ts`、`cloudBackup.spec.ts`：各自設計的必要安全／一致性測試。
- `frontend/src/domain/__tests__/cloudLedgerProjection.test.ts`：固定數字和排序案例。
- `frontend/e2e/cloud-production.spec.ts`：A/L/D/R驗收案例，支持按標籤挑測。
- `scripts/easyorder-data-maintenance.mjs`：初始化／驗包／dry-run／resume復原CLI，禁止一般UI覆蓋。
- `docs/ops/free-production-evidence.md`：P01限制證明、P16容量、P17部署／免費檢查、P18逐項簽收紀錄；只記匿名evidence與資源代稱，不放實際個資。

## 3. 共用介面與驗證命令

`BusinessCommand` 為spec §6 kind的discriminated union；共用 `{commandId,kind,leaseEpoch,expectedRevisions,payload}`。repository注入actor與serverTimestamp；`CommandReceipt` 包含commandId/seq/committedAt/typed targets/結果。`commitCommand`回Promise，cloud actions不能再同步假裝成功。讀取器回帶 `complete` 與 `sourceSeq` 的projection，未完整不得給精確afterBalance／CSV完成狀態。

`acquireLease(expectedEpoch: number): Promise<LeaseResult>`、`renewLease(expectedEpoch: number): Promise<LeaseResult>`、`releaseLease(expectedEpoch: number): Promise<void>`；每個 client transaction 都先讀 server lease 並比對 `expectedEpoch`，stale view 即中止。LeaseResult區分 acquired/busy/lost，包含 server-confirmed `holderUid`／`epoch`／`updatedAt`，不保存或回傳 `expiresAt`。Rules 不接收 `expectedEpoch`，只驗文件舊狀態與合法轉移，並以 `updatedAt + duration.value(5, 'm')` 和 `request.time` 校驗期限；UI期限只供提示，不授權讀寫。`exportCommandRange(fromExclusive,toInclusive)` 與 `replayBackup(packages)` 按spec §9驗連續序號與before/after鏈。

以下命令工作目錄為 `frontend/`，新測試檔於對應phase建立後才執行：

```bash
npm ci
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
npx firebase emulators:exec --project demo-easyorder --only firestore "npx vitest run src/firebase/__tests__/firestoreRules.spec.ts src/firebase/__tests__/cloudRulesProof.spec.ts src/firebase/__tests__/cloudCommands.spec.ts src/firebase/__tests__/activeAccountLease.spec.ts src/firebase/__tests__/cloudBackup.spec.ts"
npm run test:e2e
```

每phase先建立其失敗案例、記錄RED，再最小實作至GREEN；不以刻意缺檔／compile error當行為RED。表中targeted命令之外，改動程式的PR跑上述已存在測試與build。Rules需要真emulator，skip不算通過；CI務必檢查suite實際執行。E2E以現有script啟動Auth／Firestore emulator；雲端suite必須驗證自己實際使用cloud adapter，而非prototype。

`npx tsc -p tsconfig.app.json --noEmit` 必須額外跑：#469記載279個既有錯誤，只是歷史資料。P00在接手HEAD擷取完整diagnostic（去行號作穩定比對），後續不得新增錯誤／用同數量不同錯誤過關；本次新增／修改的雲端模組必須無錯。若消除既有錯誤，更新baseline附差異，不必恢復舊錯來湊數。

## 4. 分階段PR

### P00 — 對齊文件與執行基線

**Scope/files：** 讀最新main的`docs/BACKEND-HANDOFF.md`／PROJECT-STATUS（#469已合併；若接手checkout未包含前者，使用spec §1固定合併SHA連結取得，勿把缺檔當不存在）、上述現有source；更新README、PROJECT-STATUS與`docs/ops/`適用狀態，建立`docs/ops/free-production-evidence.md`。完成project-docs-maintain分類：arch=Y（cloud寫入邊界）、adr=Y（Spark/Hosting）、area=Y（Auth/ledger/ops）。本spec作未實作設計source，不把ops寫成已部署。

**Consumes/produces：** PR469／本spec→固定base SHA、docs索引、型別錯誤baseline、雲端舊寫路徑清單。

**Acceptance：** R1–R7/U項均對應本spec；舊ops共用payroll說法不再可被當部署指令；不更動payroll資源。此documentation task是後續implementation blocking dependency。

**Evidence：** repo-wide搜尋`commitLedgerOnline|writeBatch|setBusinessDateStatus|resetData|persistentLocalCache|payroll`逐一分類；跑§3型別診斷與連結檢查。純文件不需造RED程式測試。

### P01 — 證明Spark Rules能守住最複雜改帳

**Scope/files：** 新`frontend/src/firebase/__tests__/cloudRulesProof.spec.ts`與同目錄`fixtures/cloudRulesProof.rules`，更新`.github/workflows/ci.yml`及`docs/ops/free-production-evidence.md`。Proof rules 只由 `initializeTestEnvironment` 載入，不能放入 `firebase.json`／部署設定；不改 production `firestore.rules`。CI 使用 Java 21、`--project demo-easyorder --only firestore`，固定 `FIRESTORE_EMULATOR_HOST` gate，並檢查 Vitest JSON 確實有通過測試且 skipped 為0。

**Consumes/produces：** spec §4–7→Google verified provider／精確 operator allowlist、lease/serverTimestamp/epoch、dataHead seq＋immutable command、完整 typed targets/before-after、revision+1、五文件帳務及 day contribution、`reason`／`cashEffect`、closed-day／maintenance proof、租約與 settlement 版本。產物含未快取 access-call graph、expression/call limit 評估及真 Emulator 結果。proof fixture 不能部署；後續 P05 才移入正式 rules/code。因 fixture 只覆蓋選定交易與日期 kind，未覆蓋學生／供應商設定、櫃台 expense、備份稽核；搬入 P05 前必須按正式 command union 對完整 kind 做一次 schema／expression／access budget 再證明。

**RED/GREEN：** 建立 L09/L10/A03 對抗案例：extra row、缺 student/day/command、雙 command、歷史 command 重放、偽造 seq/actor/serverTime、不同帳戶／日期篡改、schema 數值界線、負數／小數／超界／zero payment、非 holder／舊 epoch／過期 lease、closed／maintenance day、舊 settlement 改寫；拒絕後核對原子未寫。合法 CreateOrder／CorrectTransaction／zero-paid cancellation／CloseDay／ReopenDay 全通過。Lease 使用 server timestamp 驗 acquire／renew／release、拒絕 client timestamp 與過期 renew。CI 專用命令明確指定 `demo-easyorder`，並驗 JSON report 有通過測試且零 skipped；本機一般 Vitest 在 emulator 未設定時可清楚 skip。

**Acceptance：** 未快取計數每 write≤10／每 transaction≤20，不依賴重複 `get` 快取；五文件 commit 的設計 18 calls 須由 emulator 實際通過。逐 operation 記 get/exists/getAfter 呼叫圖，評估每 write expression 上限及 access budget。WIP source `520dd2de75ede44d41becbb9617a872aea9d4d25` 真 Emulator 實跑 26 cases（18 passed／8 failed／0 skipped）：五文件 CreateOrder 與其他有效 command 遇到 1000 expression cap，詳見 ops evidence diagnostic。緊接的修改需保留完整 schema、安全檢查與 typed before/after，並把頂層 `reason`／cashEffect 前後貢獻、delta、reasonKind、refundAmount 納入驗證；不得刪安全檢查、假稱通過或開 Blaze。若同一 Spark 模型仍超限，按規格停 P01 並提出可重現失敗與必要架構修正。

### P02 — 雲端command／投影介面與模式隔離

**Scope/files：** 新`cloudCommands.ts`、`cloudLedgerProjection.ts`與domain test；修改`appMode.ts`、`posPersistence.ts`及Firebase schema adapter，未完成cloud UI保持鎖住。

**Consumes/produces：** P01 schema→typed commands／errors、projection math、prototype與cloud分離。

**RED/GREEN：** `npx vitest run src/domain/__tests__/cloudLedgerProjection.test.ts`；L01–L04、expense雙方向、void貢獻0、同毫秒排序、缺頁不能算afterBalance先失敗再通過。

**Acceptance：** 標準便當與其他餐點分類保持、prototype原測試不退化；缺Firebase配置的正式build不得降級local-only，cloud無seed/reset入口。

### P03 — Google登入與等權白名單

**Scope/files：** `authService.ts`、`AuthGate.tsx`、`FirebaseProvider.tsx`、`firestore.rules`、既有rules suite；本地初始化工具僅加入bootstrap必要資料。

**Consumes/produces：** operators無role schema→verified Google UID驗證、未核准畫面、權限停用。此phase業務資料仍deny，供P04接續。

**RED/GREEN：** rules suite的A01：同網域未核准、改email、非Google provider、自建operators、inactive均拒絕；既有合法role假設更新為等權。直接run Firestore emulator suite。

**Acceptance/demo：** 兩核准Google測試身分都可進待取得使用權畫面、陌生身分不可；用browser-session Auth persistence；維護者核准流程可照runbook做，不需RBAC。

### P04 — 全公司單一活躍Google身分

**Scope/files：** 新`activeAccountLease.ts`／test；AuthGate、FirebaseProvider、rules與cloud e2e auth部分。

**Consumes/produces：** P03 allowlist→acquire/renew/release、epoch與失權遮罩。

**RED/GREEN：** `activeAccountLease.spec.ts`（emulator）對A02–A04；A/B同時acquire、`updatedAt + 5 分鐘`到期界線（小於／等於／大於）、renew/release races、停用帳號、同UID多頁登出。Acquire／Renew／Release transaction 都比對 server-read lease 的 `expectedEpoch`，過期 snapshot／stale epoch 必須在寫入前中止；Rules 不接受 client `expectedEpoch` 作授權依據，而驗舊 holder／epoch 與新狀態。client 只能以 `serverTimestamp()` 更新 `updatedAt`；調快／調慢本機時鐘不得取得、延長或保留 Rules 授權。E2E用`npx firebase emulators:exec --project demo-easyorder --only auth,firestore "npx playwright test e2e/cloud-production.spec.ts --grep A0"`，實際執行A01–A04，不以skip通過。

**Acceptance/demo：** A使用時B只能等待；A釋放或 Rules 判定 `updatedAt + 5 分鐘 <= request.time` 後B可取得新epoch；不得靠localStorage鎖或本機時鐘冒充全域互斥；沒有活租約強制踢人功能。UI的期限提示取自 server-confirmed `updatedAt`，是否可讀寫一律由 Rules 依伺服器時間決定。

### P05 — 正式原子寫入器與冪等收據

**Scope/files：** `cloudCommandRepository.ts`、`cloudCommands.spec.ts`、production`firestore.rules`／schema；dataHead bootstrapping與maintenance guard。

**Consumes/produces：** P01proof/P02型別/P04lease→唯一commitCommand/readCommand；此時只開EnsureDay與最小fixture業務kind給測試，未交付UI不開放。

**RED/GREEN：** emulator `cloudCommands.spec.ts`：L08/L09、同ID異payload、head衝突重試、expectedRevision衝突、時間不可信、maintenance deny；hook到現有rules suite避免舊schema漏放。

**Acceptance：** 五文件全部成功或全部失敗，command immutable、seq連續；client request成功前UI不當作入帳；type/error可供每個後續phase使用。不殘留舊直接cloud writes。

### P06 — 學生名單與期初從零建檔

**Scope/files：** `studentRepository.ts`→新command adapter，`firebaseActions.ts`、Auth後hydrate、`cloudReadRepository.ts`、F3現有帳戶表單呼叫端。

**Consumes/produces：** commitCommand→CreateStudent/EditStudent/SetStudentStatus、server讀回名單與搜尋。

**RED/GREEN：** D01：`001`不可變1、重複ID拒絕、同名允許、明確0／負期初、超界拒絕、直接改balance拒絕、停用／恢復後重登入還在。對應cloud e2e與rules suite。

**Acceptance/demo：** 從空庫手動建3名、修改／停用／恢復、登出換瀏覽器一致。期初不新增付款。更正期初入口待P10，不先留不安全任意更新。

### P07 — 日期設定、供應商與開帳

**Scope/files：** `menuActions.ts`、`sessionActions.ts`的設定部分、`cloudReadRepository.ts`、command/rules、F3/F4現有呼叫端；新index。

**Consumes/produces：** students/cloud core→days、vendors、EnsureDay/SetDayMenu/SetOpeningCash/SaveVendor/RemoveVendor。

**RED/GREEN：** D02；未確認opening不能等於預填；20,000上限、負／小數拒絕、沿用前日提醒、已停用供應商移除後舊快照仍在；日期邊界台北23:59/00:00及未來日僅預排菜單。

**Acceptance/demo：** 正式資料可設今日菜單／現金；供應商逐筆revision更新，不覆寫全清單；closed guard已有rules測試，完整close UI留P11。

### P08 — F1一般／其他餐點雲端入帳

**Scope/files：** `transactionActions.ts`、`ledgerRepository.ts`轉adapter、`cloudReadRepository.ts`、F1提交hook、rules。

**Consumes/produces：** P06學生＋P07day/menu→CreateOrder，交易／學生／day原子更新與即時UI投影。

**RED/GREEN：** L01訂餐部分、L08、停用學生、新菜單revision競賽、零收款欠款、其他餐點分類、多份須逐次確認；cloud e2e重載後驗遠端資料，不能只查store。

**Acceptance/demo：** Q與其他餐點確實存Firestore，recent/account/day各畫面餘額與份數一致；連按不多收單，5秒撤回到P10才開啟。

### P09 — 繳費與櫃台現金收支

**Scope/files：** transaction command/rules、`transactionActions.ts`、F1 W與現有cash movement呼叫端。

**Consumes/produces：** P08完整寫路徑→CreatePayment/CreateCashMovement。

**RED/GREEN：** L01完整、L05關帳前數字、payment0／負拒絕、expense兩方向恰一>0且理由、cashier不進學生餘額；rules與cloud e2e。

**Acceptance/demo：** 訂餐→繳費→收入50／支出80後應有金額與spec一致，支付輸入仍為實際留存；無找零／線上金流。

### P10 — 更正、取消、退款、撤回與期初更正

**Scope/files：** `editActions.ts`、`ledgerAudit.ts`投影、`cloudCommandRepository.ts`、rules、F3期初更正表單／F1 undo／F2修改呼叫端。

**Consumes/produces：** P09有效交易→所有mutation kinds與不可覆寫before/after稽核。

**RED/GREEN：** L02–L04/L07/L09/L11；zero-paid取消不可轉zero-payment；停用帳戶可補繳／更正不可新餐；跨日退款按spec拒絕；歷史更正不變建立時間／帳戶／日期；CorrectOpening差額不算現金。

**Acceptance/demo：** 更正理由缺少被rules拒絕；undo仍受鎖帳與revision控制；同時修改一筆不lost update；更正後F1/F2/F5一致、原單可追溯。

### P11 — 正式關帳與重開版次

**Scope/files：** `sessionActions.ts`、`settlementRepository.ts`、`cashClose.ts` adapters、F2日結區、rules／settlement index。

**Consumes/produces：** P09 totals/P10 audit→CloseDay/ReopenDay immutable版次。

**RED/GREEN：** L05/L06；缺opening、差額缺理由、重複close、交易與close競賽、closed日菜單／opening／期初／全部交易kind封鎖；重開→再關帳版號1/2/3且舊版沒改。

**Acceptance/demo：** 本人可全日點現金、關帳、回查並重開修正；日結不受F2搜尋或週月範圍影響，不能直接setBusinessDateStatus。

### P12 — 完整查帳、週月統計、CSV與列印

**Scope/files：** `cloudReadRepository.ts`、`realtimeSubscriptions.ts`、`ledgerReport.ts`／`ledgerExport.ts`／audit projection、F2/F5呼叫端與indexes。

**Consumes/produces：** 既有所有cloud entities→完整分頁／afterBalance、day head彙總、原始／合併輸出。

**RED/GREEN：** R01/L07；造超過200筆匿名同日資料和>100筆帳戶歷史，驗不截斷；週一／月邊界、改名／別名查詢、作廢原單、前綴不完整不能算afterBalance；CSV formula injection敏感字首安全轉義。

**Acceptance/demo：** 所有顯示與匯出沿用欄位、餘額和份數一致；export/print記發起而非保證完成；歷史查詢頁不接全庫即時訂閱。

### P13 — 斷線、重送與正式操作收尾

**Scope/files：** `firebaseApp.ts` memory cache、cloud error處理、`posPersistence.ts`、`storage/crashDraft.ts`呼叫端、App/PWA cache設定、F2紙本補登入口、舊cloud write路徑清理。

**Consumes/produces：** P03–P12→正式online-only體驗與紙本故障後補登。

**RED/GREEN：** L08/R03/R04：commit送達但回覆丟失、tab crash重查commandId、被B取得lease後A恢復、quota fail、缺config、logout/cache清理；檢查storage沒有正式帳務／個資，不把失敗顯示已同步。

**Acceptance/demo：** 網路失敗不丟確定已入帳資料也不重複；中文錯誤帶下一步；歷史補登要理由與紙本號，未重開不得補；cloud看不到reset/restoreDataset/seed/模擬平板。

### P14 — 每日增量備份與完整性檢查

**Scope/files：** `cloudBackupRepository.ts`、`cloudBackup.ts`與test、F3正式備份區、`firebase-backup-runbook.md`。

**Consumes/produces：** contiguous commands/dataHead→加密區間包、manifest、鏈結、經重新選取存檔驗證的H、RecordBackup。

**RED/GREEN：** emulator `cloudBackup.spec.ts`：匯出中同時新command仍以H為界、缺號／重複號／錯dataset拒絕、初次S=0與增量、錯密碼／毀損拒絕、解密重播回相同數值；超額、取消下載或未重新選取存檔驗證均不推進S；產生／發起下載不等於verifiedLocal。

**Acceptance/demo：** UI明確說手動下載與第二副本責任；AES-GCM nonce不重用、密碼不落storage；匿名包可由本機工具讀，無Cloud Storage/Functions依賴。

### P15 — 可續跑復原與災難演練

**Scope/files：** `scripts/easyorder-data-maintenance.mjs`、`cloudBackup.ts`、backup test、runbook；新增npm命令包裝CLI依repo既有Node依賴可執行方式。

**Consumes/produces：** P14 backup→初始化manifest、validate/replay/dry-run/restore/resume命令與對帳報告。

**RED/GREEN：** 對匿名R02 fixture輸入錯鏈、斷點、錯目標、未空庫／未maintenance都拒絕；正確重播保持seq/revision/原actor，半途停止再恢復無重複。CLI正式接口：`node scripts/easyorder-data-maintenance.mjs validate --manifest <local-file>`、`... restore --project demo-easyorder --manifest <local-file> --dry-run`；emulator restore需顯式`--execute`。CLI檔案位於repo root，命令從root執行。

**Acceptance/demo：** 別人照runbook在乾淨emulator與獨立Spark空庫恢復；比較帳戶、day totals、所有audit／settlement版本；測成本／寫額度，auth重新核准，記錄真實RPO/RTO。私密production restore只在日後事故由維護者操作，不藉本phase覆蓋正式資料。

### P16 — 容量、安全與查詢整合驗證

**Scope/files：** cloud tests、indexes、`free-production-evidence.md`、CI；必要最小讀取優化。

**Consumes/produces：** P01–P15→容量證據、rules全命令allow/deny矩陣、全鏈路e2e結果。

**RED/GREEN：** spec §10匿名500帳戶／500commands日／尖峰60筆／兩年外推、兩頁同UID；停用operator、query缺約束／偽造cmd、Rules呼叫上限與大小；掃描所有client writes僅command或lease。

**Acceptance：** 日read/write目標落額度50%內、儲存外推含indexes、P95正常網路送單<2秒／查詢首頁<3秒（網路與設備註記），contention失敗有明確處置。測不到的prod網路數據列未驗，P18補，不把emulator時間當雲端延遲。Rules tests不可skip；所有新code沒有TS新增診斷。

### P17 — 獨立Spark部署與網域準備

**Scope/files：** `firebase.json` Hosting SPA/headers、`deploy.sh`、Firebase config範例、README與所有相關`docs/ops/`；`free-production-evidence.md`。

**Consumes/produces：** P16驗證產物→可部署release、實際Spark／no billing證據、Google登入domain、清晰rollback與quota流程。

**Acceptance：** 明確EasyOrder project與region，非payroll；Hosting不是App Hosting；CLI目標固定且部署前再次核對；官方方案重查、自訂domain可登入、rules/index/前端版本配對；CI emulator使用demo project，無production credential。**所有正式環境變數、Admin／復原憑證、Firebase project／DNS／Auth／Hosting／Rules／indexes設定與正式部署／smoke test，均由使用者在其電腦上從本機repo執行；Cloud agent只處理Emulator、合成資料、設定範本與runbook，不接收正式keys、不操作或部署正式資源。**Firebase Web config是瀏覽器可見的project識別資訊、不是Admin私鑰，但正式值仍由使用者本機配置。先由使用者在預設HTTPS網域執行匿名smoke，再由使用者決定DNS切換。既有子網域若占用只選備選，不覆寫既有服務。

**Evidence：** Cloud agent可提供source／本機build產物／CSP檢查與部署範本；正式project、計費狀態、DNS/Auth/Hosting、Rules/index部署及smoke結果，只能由使用者操作後回報匿名證據，否則一律標`UNVERIFIED`，不得由Cloud agent猜測或聲稱已驗。正式命令按實際新project參數記在使用者本機私有部署紀錄；公共文件只用`<easyorder-project-id>`占位參數。正式環境變數與管理憑證不進repo、雲端任務或PR。資源名稱／帳號權限是部署輸入，不是待設計問題。cloud console收費狀態未讀到就寫UNVERIFIED，不能用budget alert當硬上限。

### P18 — 空白建檔與三日真實營運驗收

**Scope/files：** `free-production-evidence.md`匿名簽收、`PROJECT-STATUS.md`實際狀態、ops故障備份清單；只修驗收發現的阻擋，不新增Android。

**Consumes/produces：** P17可部署且安全gate通過→操作者輸入真實期初／現金、三日試營運與正式啟用結論。

**Acceptance：** spec A01–A04/L01–L11/D01–D02/R01–R05全通，真實操作只在正式系統／本機私有文件；兩位核准者交接但不並行。補K07／長按／實際視窗設備測試。至少一次加密備份從零還原與人工第二副本確認；紙本對帳差異逐項說明。明確本人簽收後才稱正式可用。

**Rollback：** 若帳務／權限不一致先停寫、備份、紙本記錄；回到相容前端不回滾財務資料，修復再對帳。若只是介面摩擦列小PR；若出現多記／漏記或安全失守，P18不通過。不得以延後備份、等權互斥或更正功能換取「先上線」。

## 5. 文件、測試與完成聲明

規劃本身的驗證：本spec／plan相互連結、existing paths可定位、新paths明確標示、每項使用者需求有phase與案例、#469議題有對應；本輪不執行app測試、不聲稱雲端功能通過。

實作各phase更新source of truth及ops，不在README重複完整schema。Android計畫只加本次scope的短pointer，不直接改`talented-faceorder`。同樣不修改`talented-payroll`。

團隊最後交付必須分開：① code/CI已通過；② Spark與DNS/Auth配置已驗；③ 故障／復原已演練；④ 本人三日營運已簽收。缺任一項，狀態為待完成，不能寫「可正式上線」。

需要本人提供的部署輸入、未證明的工程gate與未來enhancement，統一見[spec最後一節](../specs/2026-10-13-free-production-backend-spec.md)，不在此另建矛盾決策清單。
