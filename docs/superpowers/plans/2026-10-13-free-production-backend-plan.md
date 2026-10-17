# EasyOrder 零費用正式後端分階段實作計畫

日期：2026-10-17。狀態：**P00–P07 與 P06b 已合併至 main（P06b 隨整合 PR #488 合併）；P08 雲端訂餐已合併（#491）；P09a 繳費與櫃台收支已合併（#493）；P09b 退款已合併（#494）；P14 每日增量備份已平行實作並合併（#496）；P10a 交易更正／作廢／取消／撤回已合併（#497）；P10b 期初更正已合併（#501）；P11 正式關帳與重開已完成（P11a #503、P11b #505）；P12–P13、P15–P18 尚未開始或驗收**。

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
→ P06 學生名單 → P07 日期菜單與供應商 → P06b 學生內部鍵與可改編號 → P08 訂餐
→ P09（P09a）繳費與櫃台收支 → P09b 退款 → P10 更正取消與期初更正
→ P11 關帳重開 → P12 完整查帳與報表
→ P13 故障與操作完整性 → P14 增量備份 → P15 復原
→ P16 容量與安全整合驗證 → P17 部署準備 → P18 本人試營運
```

每phase receipt：base/current完整SHA、實際變更檔、對應spec節／案例ID、測試指令和結果、三分鐘demo、已知限制、docs-check、下一phase可消費的介面。只用匿名fixture；reviewer只review，由coordinator檢查結果與CI再依團隊規則合併。不得自動把後續phase標完成或把本人驗收代簽。

### Phase receipts

| Phase | 狀態 | 交付摘要與證據 |
|---|---|---|
| P00 | 已合併 #471 | Base：`75e7a96e6cad722a41076df66e5b2cf9014e9d47`；PR head：`7a7128f14cf32268808de4e0a57f6986a0ca806e`；實際 merge SHA：`1da09039ab57f2b13f965ce98277bd1d41ce8e5e`。新增[現況與證據](../../ops/free-production-evidence.md)，含完整 279 筆 TypeScript diagnostics、舊寫入／部署路徑分類及 R/U 對照。docs links／diff check pass；基線 tsc exit 2；PR CI 識別 docs-only 並跳過 app steps。 |
| P01 | 已合併 #472 | Base：#471 實際 merge SHA `1da09039ab57f2b13f965ce98277bd1d41ce8e5e`；GitHub API 實際 merge SHA：`e7c406c93af197cda0bedaa220a4575728612f0f`。合併的是 test-only proof，僅覆蓋所選 command/lease/日期路徑；合法正向案例、Rules 靜態閉合檢查及拒絕後 atomic unchanged 通過。歷史 RED/WIP/review 限制見 ops evidence；不代表完整 22 kind 或 production rules 已驗收。 |
| P02 | 已合併 #473 | Base：#472 實際 merge SHA `e7c406c93af197cda0bedaa220a4575728612f0f`；GitHub API 實際 merge SHA：`bc5bb2588e616f40a605ea8cd682b1d1642bbc71`。新建 `cloudCommands.ts`、`cloudLedgerProjection.ts`；修改 `appMode.ts`、`posPersistence.ts`、`firestoreSchema.ts`。Vitest 1259 passed，tsc app baseline 零新增錯誤，lint 與 build 通過。 |
| P03 | 已合併 #474 | Base：#473 實際 merge SHA `bc5bb2588e616f40a605ea8cd682b1d1642bbc71`；GitHub API 實際 merge SHA：`fd8cba1b84c0b2146c1f450192e2c99739193e46`。修改 `firestore.rules`、`authService.ts`、`AuthGate.tsx`、`FirebaseProvider.tsx`、`operatorAdmin.ts`。A01 測試通過，全套 Vitest 1268 passed，tsc baseline 零新增錯誤，lint 與 build 通過。 |
| P04 | 已合併 #475 | Base `fd8cba1b84c0b2146c1f450192e2c99739193e46`；最終 PR head `cf0cd10af4171f24cf5faa6dff0814393cb71340`；獨立 review comment `5519480848` 通過；required GitHub Actions run [38579765651](https://github.com/cheerc/talented-easyorder/actions/runs/38579765651) 的 build-and-test 與 E2E 兩個 jobs 均成功；實際 squash merge SHA `837a1e871468db217463e9799480beeb6d7b0ab0`。本地全套 Vitest 1291 passed／65 skipped；獨立 Emulator lease 19/19、A01 Rules 10/10、P01 proof 36/36；Cloud E2E 11/11＋prototype-only 7/7，18/18。app tsc normalized baseline 295→290，新增 0、移除 5 項既有診斷，command/backend相關新增檔零診斷。P01 負向案例的 expression-cap 限制、期限 equality 靜態證據及 system Chromium 本機診斷限制見 [ops evidence](../../ops/free-production-evidence.md)。未部署。 |
| P05 | 已合併 #476 | Base `837a1e871468db217463e9799480beeb6d7b0ab0`；PR source head `0fe7ac738c8495def1c9fdc19580745ff4b4e33f`；實際 merge SHA `41cd08715c435bc5d72ee38985fccd40e0ee4dd1`（2026-10-14 16:22:05Z）。[獨立 review PASS](https://github.com/cheerc/talented-easyorder/pull/476#pullrequestreview-5521098252)；required CI [38596486712](https://github.com/cheerc/talented-easyorder/actions/runs/38596486712) 兩個 jobs SUCCESS，官方 pinned Chromium 148.0.7778.96／Playwright v1223。production Rules 79/79；A01/P01/P05/P04 lease Emulator sequential 144/144、0 skipped；Cloud E2E 12/12＋prototype 7/7；full Vitest 1,297 passed／144 Emulator-only skipped、lint/build pass。App TSC exit 2，290 inherited diagnostics，完整 542 行 normalized output 與 base 相同。只啟用三 kind，其餘 19 kind deny；expression-cap 與 negative-test causality 限制、未部署等見 [ops evidence](../../ops/free-production-evidence.md)。 |
| P06 | 已合併 #478 | PR base `b53423aa71ed4cfac2428f290c648e5a999a0cae`；source head `17da94f3ffea7b116c0ce157fb784011e0b00c89`；merge SHA `b518eca5fdc2b2d2d3e9197c30b29d6a5f74ce10`，2026-10-15 05:32:37Z；GitHub 以 rebase 整合 5 commits。官方 Actions run [38685129628](https://github.com/cheerc/talented-easyorder/actions/runs/38685129628) 對 exact source head 的 build-and-test `116258195493`、E2E `116259321882` 均成功（以正常 GitHub 網頁核實；raw logs 需登入，故不聲稱其內部版本／計數）。本機真 demo Rules Emulator 去重 179/179、0 fail／skip；full Vitest 1,329 passed／179 Emulator-only skipped／0 failed；system Chromium Cloud/auth 13/13、isolated prototype 7/7；lint/build 通過。App TSC exit 2，base/current 均 290 diagnostic headers／542 normalized lines，完整 diff 0。source/final delta 與最後文件 review 均 PASS。完整收據及邊界見 [ops evidence](../../ops/free-production-evidence.md#p06-merge-receipt--2026-10-15)。名單完整快照上限 500，超額 fail closed；未部署，SDK memory-only cache 仍屬 P13。 |
| P07 | 已合併 #480 | PR #480 合併 SHA `436b119`；日期菜單與供應商、SaveVendor／RemoveVendor／SetDayMenu／SetOpeningCash 啟用；Rules 存取次數與單文件 expression 預算已覆蓋；Full Vitest、lint、build 通過。 |
| P06b | 已合併 #488 | PR #487（source `2a03953b90a3cd477a7918ebea6741675ac2e428`）經獨立 review PASS 後，隨操作回饋前端 U3/U4/U2b 於整合 PR #488（source `58191718e2388bfbf954314128f5357370e65123`，squash merge SHA `6ae1909639f56aa6d36524406e700554891f6328`）合併至 main。分離穩定 UUID studentId 與畫面 studentCode（001–999999）；studentCodes 唯一索引集合；ChangeStudentCode 命令與舊索引刪除授權閉合；Emulator tests 全 pass；Rules 預算 20/20、單 write 10/10；整合收據見 [P06b＋前端整合審查收據](../../ops/integration-p06b-review-5819171.md)。 |
| P08 | 已合併 #491 | PR [#491](https://github.com/cheerc/talented-easyorder/pull/491)（取代 #490）：base `5ff889a8c7dc9a411383c8f1a37e23f243e0ce8d`；source head `452edd5abce63f1eda329d90dcae245984104721`；squash merge SHA `889c75c`（2026-10-16）。獨立複審 PASS（review `5545234938`）；required CI [38875033302](https://github.com/cheerc/talented-easyorder/actions/runs/38875033302) build-and-test 與 e2e 均成功，其中 P08 Emulator 步驟 10/10。CreateOrder 雲端入帳、交易清單讀取（分頁、對帳、新鮮度檢查、fail closed）、未知結果同編號重試、失權遮罩；transactions 只開放目前持有者 get／list；本機 demo Emulator 281/281、Vitest 1,573 passed／281 skipped、lint／build 通過。契約見 `2026-10-16-cloud-orders-contract.md`，證據見 [ops evidence](../../ops/free-production-evidence.md)。未部署；正式部署 Rules 時須一併部署 `firestore.indexes.json`。 |
| P09a | 已合併 | PR #493，squash `c444621`，base `fc7943970a5ceb86d841eeca8be6a75d3ba75dec`。`CreateCashMovement` 啟用、F1 W 繳費與 A 櫃台收支、應有現金；本機 Emulator 395/395、Vitest 1,594 passed、Cloud E2E 14/14；獨立審查 PASS。契約 `2026-10-16-cloud-payments-cash-contract.md`。未部署。 |
| P09b | 已合併 | PR #494，squash `5b6f9a4`，base `c444621`；獨立審查 PASS。`CreateRefund` 啟用、`day.totals.accountRefunds`（7→8 欄）、F1 W 面板退款、應有現金扣退款一次；本機 Emulator 444/444、Vitest 1,602 passed、Cloud E2E 18/18。契約 `2026-10-16-cloud-refund-contract.md`。未部署。 |
| P10a | 已合併 #497 | squash `1d61a475109c6642c20c56cbb9ae8e9180491e46`，source head `4cd2286c84643cad97200cff9e4d1642883f03fb`，base `b33fc6b`（審查後合併 main）；獨立複審通過（review `5551115175`）；CI [38935317478](https://github.com/cheerc/talented-easyorder/actions/runs/38935317478) 兩 job 成功。本機 Emulator 508/508、Vitest 1,637 passed。啟用 `CorrectTransaction`／`VoidTransaction`／`CancelKeepDeposit`／`CancelRefund`／`Undo`；F1 5 秒撤回與 E 明細、今日現金列的更正／作廢／取消；指令建立改 `validCommandCreate` 分派（含 `RecordBackup`）；P14 備份 decoder／replay 同步支援 5 種新 kind。契約 `2026-10-16-cloud-transaction-mutations-contract.md`。未部署；正式部署 Rules 須與 `firestore.indexes.json` 一起。 |
| P14 | 已合併 #496 | Base `e01ebdff5e784522b15a6f16278ef303a9c63110`；source head `9df7926ac7f8670452f659ed7e0462d78a07fa3d`；squash merge `4b4425c3f6c5f5b1423b94d6aad3216c2c67397c`。獨立 subagent review 在四輪修正後對 exact head PASS；同 GitHub 帳號無法為自己 PR 提交 approving review，coordinator 記錄審查證據並以 admin gate 合併。CI [38929526636](https://github.com/cheerc/talented-easyorder/actions/runs/38929526636) `build-and-test` 成功；E2E 首跑遇 P04 A05 timing fail，failed-job rerun 18/18 成功，最終兩 job 均成功。真 Emulator P14 16/16、serial full Vitest 1,985/1,985、UI 2/2、lint/build 通過；app TSC 與 base 460 行 diagnostics byte-identical。固定 H 增量匯出、加密封包、F3 重新選檔驗證後 `RecordBackup` 已實作；只支援當前啟用的 command kinds。P10/P11 開啟新 kind 前，必須同步擴充 P14 replay validator 與相容性測試，否則備份會 fail closed。完整證據見 [P14 receipt](../../ops/p14-receipt.md)；未部署、未做 P15 復原演練。 |
| P10b | 已合併 #501 | squash `a92d1390c79900688bb36e0e1e6df910bce5b670`，source head `b6b8cf4460ea23e16872bb0626c6ce28c3512d2c`，base `a694b32`；獨立審查通過（review `5555660163`）；CI [38995746934](https://github.com/cheerc/talented-easyorder/actions/runs/38995746934) 兩 job 成功。本機 Emulator 551/551、P10b 42/42、Vitest 1,652 passed、Cloud E2E 20/20。啟用 `CorrectOpening`（F3 期初更正）：鎖定原期初日，只改金額與備註，原因必填；結餘加期初差額，期初日營業日只增 revision，零現金。期初日沒有營業日時先 `EnsureDay`，已關帳拒絕。F3 學生頁「更正期初」表單與預覽；P14 備份 decoder／replay 同步支援。契約 `2026-10-17-cloud-opening-correction-contract.md`。未部署；P11 啟用關帳時要決定 F3 補建的過去日期營業日如何處理。 |
| P11a | 已合併 #503 | squash `91b5909d960ba14cb6e448dad3d3c99292fba6f7`，source head `ad701ef1b86368bf2b934e504292f9540f190563`，base `32e90c6`；獨立審查通過、無必修（review `5557244382`）；CI [39020987035](https://github.com/cheerc/talented-easyorder/actions/runs/39020987035) 兩 job 成功。本機 Emulator 循序全套 2,178/2,178、P11 48/48（RED 16/48）、備份 19/19。啟用 `CloseDay`／`ReopenDay`：每個命令新增不可改、不可刪的日結版本 `days/{dayId}/settlements/{n}`；應有現金依 §7.1 由 Rules 計算，差額須填原因；重開須有原因；已關帳日業務寫入一律拒絕。寫入器、日結讀取 repository、P14 備份 decoder／replay 同步支援。契約 `2026-10-17-cloud-day-close-contract.md`。沒有畫面（P11b）。未部署。 |
| P11b | 已合併 #505 | squash `5a030caec2345b7d322a4f32a12f05bf014fc1d2`，source head `77d272add0780184815c0a72b47df548d6deeb13`，base `d46287d`；獨立審查通過、無必修（review `5557388299`）；CI run [39024055068](https://github.com/cheerc/talented-easyorder/actions/runs/39024055068) 兩 job 成功。雲端「日結」頁：未關帳清單（過去無營業日標成不需關帳）、全日點現金、關帳、版本回查、重開；P14 備份區塊掛在日結頁下方；原因 trim；已關帳日提示指向日結頁。Rules 不變。Emulator 循序全套 2,190/2,190（含一次既有 `beforeAll` 冷啟逾時後單檔重跑）、畫面 11 項、Cloud E2E D08。未部署。 |
| P11 補開帳 | 已合併 #507 | squash `2792ba2606c89d54818457136aabfbe7fc1ef913`，source head `dffed1c22f3af558723864ae1f7f82d4adf3271a`；獨立審查通過、無必修（review `5557963146`）；CI [39030734055](https://github.com/cheerc/talented-easyorder/actions/runs/39030734055) 兩 job 成功。CheerC 2026-10-17 指示。新增 `BackfillOpeningCash`：過去、未關帳、缺開帳現金的既有營業日可填開帳現金與必填原因補開帳，再照常關帳；不放寬既有開帳與交易 Rules，不能補登交易。日結頁表單、P14 decoder／replay 同步支援。契約 `2026-10-17-cloud-day-close-contract.md` §10。base `71ee1bc`。Emulator 循序全套 2,222/2,222、補開帳 Emulator 27 項、Cloud E2E 21/21。未部署。 |
| P12–P13、P15–P18 | 尚未開始／未驗 | 不代表任何後續雲端功能已實作或通過。 |

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

`npx tsc -p tsconfig.app.json --noEmit` 必須額外跑：P00歷史基線為279筆，P04實際base另有295筆 diagnostic；這些數字是不同時間／source 的觀察，數量相同或不同都不能代替逐筆 normalized diagnostic 比較。後續不得只靠計數宣稱零新增錯誤；本次新增／修改的雲端模組必須無錯。若消除既有錯誤，更新 baseline 附差異，不必恢復舊錯來湊數。

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

**Acceptance and historical outcome：** no-cache 計數每 write≤10／每 transaction≤20，不依賴 SDK 重複存取快取；計畫預算為 Create／Correct／Void 各 18 calls、首次 Close 14、後續 Close／Reopen 15，需逐 operation 記 `get`／`exists`／`getAfter` 呼叫圖。歷史 source `5c55936fc0a0cbc82da3058b4a466364a0d0da1f` 曾有 30 passed／0 failed／0 skipped，但 SOL review 發現必要 writer 可省略、snapshot 可偽造為未變 map、settlement revision 硬編碼及新交易學生姓名未比對等 blockers；那是未接受的中間 checkpoint。更早 WIP `520dd2de75ede44d41becbb9617a872aea9d4d25` 有 26 cases、18 passed／8 failed／0 skipped 並記錄 1000-expression-limit，且混有 fixture/schema/callback/`-0` 缺陷；expression cap 是該 WIP 的限制，不證明符合 schema 的合法模型不可行。P01 最終經 #472 merge 的 proof 驗證所選合法正向案例、Rules 靜態閉合及拒絕後 atomic unchanged；測試只覆蓋選定路徑，不能宣稱完整 22 kind 或每個 guard 都由單獨案例隔離。保留完整 schema、安全檢查與 typed before/after，不得刪安全檢查、假稱通過或開 Blaze；詳見 ops evidence 中的歷史 checkpoint 與邊界。

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

**RED/GREEN：** `activeAccountLease.spec.ts` 實際 Emulator gate 涵蓋有效／逾期安全窗、A/B 同 expected epoch acquire race（唯一成功 holder）、renew/release race、expired renew deny、停用帳號、stale epoch 與原子不變。本輪 active lease gate 19/19；一般 Vitest skip 不計通過。Rules 的期限 predicate 用 `updatedAt + 5 分鐘 <= request.time` 判 acquire expiry，續約要求嚴格 `>`；精確 equality 以靜態 Rules source assertion 證明，Emulator 只測離界線 90 秒的 active 與 expired 狀態，不把 request/response RTT 當 equality 測試。Acquire／Renew／Release transaction 都比對 server-read lease 的 mandatory `expectedEpoch`，過期 snapshot／stale epoch 必須在寫入前中止；Rules 不接受 client `expectedEpoch` 作授權依據，而驗舊 holder／epoch 與新狀態。client 只能以 `serverTimestamp()` 更新 `updatedAt`；調快／調慢本機時鐘不得取得、延長或保留 Rules 授權。Web Locks unit gate 驗證同源頁面單一 heartbeat leader、排隊 abort、stop 後不發布 inflight stale result；Cloud E2E A08 實際用兩個同 UID 頁面驗證兩次 60 秒 heartbeat、server timestamp 更新、holder/epoch/UI 保持，以及 leader 關閉後 follower 接手。Cloud E2E 共 11/11，另有 7 個 prototype-only POS regression；兩組分開執行，不以skip通過。

**Acceptance/demo：** A使用時B只能等待；A釋放或 Rules 判定 `updatedAt + 5 分鐘 <= request.time` 後B可取得新epoch；不得靠localStorage鎖或本機時鐘冒充全域互斥；沒有活租約強制踢人功能。Cache/pending snapshot 不得取消已確認 holder 狀態或清 cloud memory；initial unknown、server-confirmed UID/epoch change、missing/malformed/server error 仍 fail closed。UI的期限提示取自 server-confirmed `updatedAt`，是否可讀寫一律由 Rules 依伺服器時間決定。P04 PR 需新 immutable head 的 required CI 與獨立 review 通過並由 Coordinator merge，才能開始 P05。

### P05 — 正式原子寫入器與冪等收據

**Scope/files：** `cloudCommandRepository.ts`、`cloudCommands.spec.ts`、strict command DTO／receipt decoder、production `firestore.rules`、dataHead IAM bootstrap manifest 與 maintenance guard。首批只有 `EnsureDay`、`CreateOrder`、`CreatePayment` 可由正式 Rules 寫入；不接業務 UI。其餘 19 個 union kind、舊 student/ledger/settlement writer、`close_attempts` 與 `cash_adjustments` 一律拒絕。完整 22-kind typed targets/schema/no-cache call／expression-risk matrix 是靜態盤點；未開 kind 不計入 P05 Emulator pass，日後開放前須逐項重新證明。

**Consumes/produces：** P01 proof／P02 kind inventory／P04 operator 與 current lease→唯一 `commitCommand`／server-only `readCommand`。Caller 傳 UUID、kind、固定 targets、payload、expectedRevisions、leaseEpoch；actor 由 Auth、seq/head、before/after、cashEffect、committedAt 與 canonical fingerprint 由 repo/server state 推導。Rules 共用 current operator + lease + `request.time` + `maintenance=false` 條件，head 只准 seq+1／lastCommandId／server updatedAt 變更。

**RED/GREEN：** 真實 Firestore Emulator 載入 production `firestore.rules`：三種 enabled kind 正向；maintenance／schema mismatch／偽 actor、時間、seq、revision、before-after／少 writer、多餘 writer／雙 command／replay／legacy paths／19 個 disabled kinds 等拒絕。raw SDK 每次拒絕逐文件核對 head、receipt、day、student、transaction 原子未變。完整交易為五份文件（head、receipt、transaction、student、day）；EnsureDay 為 head、receipt、day。相同 ID 相同 canonical 語義只提交一次且回原 receipt；同 ID 不同 payload/target/kind/revision 回 `INVALID_INPUT` 且 seq 不增；head 衝突按 SDK 有限次 retry，保留 commandId 與 caller expectedRevisions；目標 revision 改變回 `REVISION_CONFLICT`。目前合法日期限當前 Asia/Taipei 營業日，因 payload 未提供歷史補登理由；歷史 order/payment 真 Rules 測試拒絕且全文件不變。回應不明回 `UNKNOWN_RESULT`，同 ID 用 server read 查明，不可換 ID 盲重送；兩個 post-commit receipt read failure injection 均已驗證 `UNKNOWN_RESULT` 與同 ID recovery。Rules no-cache budget 靜態按 Firestore SDK commit VerifyMutation closure 算 EnsureDay 11/20、CreateOrder/CreatePayment 19/20；7／11 個 BatchGet read authorization dependencies 另列，詳 [budget report](../../ops/p05-rules-budget.md)。部分 raw multi-write negative log 出現 1000-expression ceiling；其 assertFails 與原子未變仍通過，但不宣稱相關拒絕 guard 已 cap-free isolated。合法正向路徑未出現 expression-cap failure。Rules 精確 expiry 比較以 source assertion 證明；Emulator active/expired/at-or-after 測試含 request/response RTT，不宣稱精確 equality。

**Acceptance：** `readCommand` 使用 server-only read；只有 server 成功確認缺件才回 `null`。既有 receipt fast path 仍要求當下合法 operator/current holder；目前合法 holder 可讀其他 actor、歷史 leaseEpoch receipt。receipt decoder 要求精確 schema、path/ID 與 fingerprint 重驗，且真正 Firestore Timestamp；不使用 timestamp fallback。Rules 每一 write 最多 10、transaction/batch 最多 20 access calls，按未快取的每次 `get`／`exists`／`getAfter` 逐 write 計數並把已讀未寫的 SDK VerifyMutation 另列。合法 positive 不得因 expression cap 失敗；negative 如有 cap 診斷如實標記限制，仍提供靜態 contract 與 atomic unchanged 證據。bootstrap 僅以 IAM/Admin 建空白 dataHead manifest，不建立學生、交易或財務初值；不執行正式環境 bootstrap。舊裸 writer fail-closed，prototype 不連 Firebase、不建立第二個 cloud writer。Cloud mode 只呈現 Google／lease shell 與「業務功能暫未開放」，不掛載本機 POS hooks；只有明確 prototype mode 可掛舊 AppContent，正式 Firebase 設定錯誤不得降級為本機模式。後續 phase 僅能開啟已逐項接上 commitCommand、server read/hydrate、receipt confirmation 並通過 review 的功能，不可整批恢復舊 POS；此 PR 不實作 cloud hydrate/UI。

**已合併驗收收據：** P05 PR #476 在上述 base/source 上完成，合併 SHA 為 `41cd08715c435bc5d72ee38985fccd40e0ee4dd1`。獨立 review [PASS](https://github.com/cheerc/talented-easyorder/pull/476#pullrequestreview-5521098252)；required GitHub Actions run [38596486712](https://github.com/cheerc/talented-easyorder/actions/runs/38596486712) 的兩個 jobs 均 SUCCESS，E2E 使用官方 pinned Chromium 148.0.7778.96／Playwright v1223。本地 production Rules command suite 79/79、0 skipped；A01/P01/P05/P04 lease Emulator sequential regression 144/144、0 skipped。full Vitest 1,297 passed／144 Emulator-only skipped，完整 lint/build 通過；Cloud E2E 12/12＋prototype 7/7，共 19/19。App TSC exit 2；290 項 inherited diagnostics 的完整 normalized output 為 542 行，與 base 比較無差異。P05 僅允許 `EnsureDay`、`CreateOrder`、`CreatePayment`，其餘 19 kinds 仍 deny；完整 22-kind targets／budget 是靜態盤點，不是未開 kinds 的 Emulator 證據。31 個 negative case names 出現一個或多個 1000-expression-cap 診斷；案例數不等於診斷事件數。拒絕與 atomic unchanged assertions 通過，但 numeric upper-bound builder（含 `afterBalance`）與其他 projection 未同步的情況，使這些結果不能單獨證明 numeric-bound guard 是拒絕原因；後續可加強 fixture 隔離，這項限制未阻擋本次 P05 review／CI／merge。舊 candidate NOT PASS 歷程保留於 [ops evidence](../../ops/free-production-evidence.md)。未部署、未使用正式 keys／Admin bootstrap；Firestore SDK `persistentLocalCache` 仍是 P13 工作。

### P06 — 學生名單與期初從零建檔

**Scope/files：** `studentRepository.ts`→新 command adapter；strict server-only student list/read；isolated Cloud student page 與 `App.tsx` wiring。不得 mount `legacyAppContent`、POS hooks 或 local business store；Firebase config 缺失時 fail closed。

**Consumes/produces：** `commitCommand`→`CreateStudent`／`EditStudent`／`SetStudentStatus`、server讀回完整名單與搜尋。三種命令 `businessDate=null`，固定 target `studentId`；ID 維持字串，含 `001`。Edit 僅修改 `displayName`／`aliases`；status 分別切換 active/inactive，不碰歷史或餘額，並要求 1–500 字理由。

**RED/GREEN：** D01：從真空集合建立三名學生，`001` 字串不變、重複 ID 拒絕、同名允許、明確 0／負期初、±1e9 邊界合法、超界／fraction／負零拒絕、直接改 balance/ID/opening/date 拒絕、停用／恢復保留歷史與餘額、重登後 server 一致。Rules 需證明新 command+head+student projection 原子閉合與其餘 16 kind 仍 deny。期初日期只可為 `head.goLiveDate` 或 Rules `currentTaipeiDate` 且非未來；前者用於既有 roster baseline，後者用於今天新增，Rules 不知道 roster 類別且不宣稱強制分類。Create 不新增 transaction/payment/day effect。

**Acceptance/demo：** 從 empty valid metadata head 開始，server list 明確區分 ready-empty／unavailable/error；目前 phase 的完整快照契約上限是 500，501 或更多人回 `INCOMPLETE_SNAPSHOT`、不發布部分結果，不宣稱超過 500 可完整瀏覽；需更大 roster 的全分頁 UX／容量工作另追後續 phase。建立、修改、停用／恢復，登出後第二瀏覽器一致；非 holder denied/masked；失去 UID/token/lease 立即遮罩清空，舊 in-flight result 不可回填。成功只在 receipt confirmed 後回報；list refresh 失敗保留同 command ID recovery。prototype 7 cases 保持。期初不新增付款；更正期初入口留 P10。 |

**P06 合併收據：** PR [#478](https://github.com/cheerc/talented-easyorder/pull/478) base `b53423aa71ed4cfac2428f290c648e5a999a0cae`、source head `17da94f3ffea7b116c0ce157fb784011e0b00c89`、merge SHA `b518eca5fdc2b2d2d3e9197c30b29d6a5f74ce10`，於 2026-10-15 05:32:37Z 由使用者手動 merge；GitHub normal web 顯示 `MERGED`，採 rebase 整合 5 commits。merge 後 fetch `origin/main` 再比對，source tree 相同。官方 Actions run [38685129628](https://github.com/cheerc/talented-easyorder/actions/runs/38685129628) exact source 的 build-and-test job `116258195493` 與 E2E job `116259321882` 成功，狀態由允許的 GitHub 網頁核實；raw logs 要求登入，所以不記其 pinned-browser 版本或 raw log count。真 demo Emulator 依 A01→P01→P04→command/failure→command/list，階段 10／36／19／103／112 全通過、0 fail／skip，command suite 去重 179 cases。Full Vitest 1,329 passed／179 Emulator-only skipped／0 failed；lint/build pass；app TSC exit 2、290 headers／542 normalized lines，完整 baseline diff 0。system Chromium 154＋Playwright 1.60 的 Cloud/auth 13/13、isolated prototype 7/7 通過。source/final source-delta review PASS、最後 4-doc 差異 review PASS；使用者於完成核對後手動 merge；不宣稱所有 merge gate 均 PASS。詳見 [P06 review](../../ops/p06-source-review.md) 與 [ops evidence](../../ops/free-production-evidence.md#p06-merge-receipt--2026-10-15)；開發時 WIP 數字與歷程保留於 [歷史 checkpoint](../../ops/free-production-evidence.md#p06-wip-checkpoint--2026-10-15)。500 人為已驗完整名單上限，501 fail closed；沒有 production deploy，`persistentLocalCache` 未改（P13）。

### P07 — 日期設定、供應商與開帳

**Scope/files：** P06 唯一 `commitCommand` 新增 SaveVendor、RemoveVendor、SetDayMenu、SetOpeningCash；新 server-only `cloudDayVendorRepository.ts` 與獨立 `CloudDayVendorsPage`，接入 AuthGate 並不掛 legacy AppContent／POS；Firestore Rules 開放四種 kind、days list 與完整 vendors list。`EnsureDay` 已啟用且本來就允許 goLiveDate 以後的 future empty day，本 phase 沿用其既有契約。

**凍結契約：** [P07 cloud day/vendor contract](../specs/2026-10-15-cloud-day-vendors-contract.md)。命令合計 10 種 enabled、12 種維持 deny。菜單可為未來日期直接預排；inherit source 必須早於 target 且不晚於可信 `selectionDate`，來源掃過 null-menu pages，來源、vendor 與 query headSeq 保持一致；新 assignment 僅接受 active、未刪除且名稱未變的 vendor。`selectionDate` 由 server-read active lease `updatedAt` 換算台北日期，Rules 以 commit request time 日期核對；跨午夜不重寫 frozen input。Vendor 逐筆 revisions、不可重用 tombstone ID；opening 限台北今日、未關帳、明確整數 0–20,000，null 與 0 不同，第一次 actor/time 後續保留。

**RED/GREEN：** source list 必須全 collection 嚴格 decode（含 tombstones）後才過濾 UI 清單；500 筆 vendors 與 2,000 筆 source days 都需 exact-cap probe，超上限、錯誤或資料頭變更 fail closed。對每個 SDK transaction read graph 靜態計算 no-cache Rules budget，驗證原始合法命令正向通過、12 kinds deny、source/vendor/revision/date/closed/tombstone/first-open metadata 邊界拒絕且 atomic unchanged。Emulator 不提供 runtime expression counter，報告靜態閉合推導與 exact positive path 通過，不寫成 runtime 測量值。

**Acceptance/demo：** P07 isolated UI server reload 後仍見遠端供應商、當日開帳與 future menu；失權清空並使舊 request 無法回填；receipt confirmed 前不顯示成功，讀取刷新失敗只重試讀取。closed-day guard 不變；完整 close UI 留 P11。此契約不開 P08、不部署 production。

**Current WIP checkpoint (2026-10-15):** Rules review findings for SaveVendor create receipts and stored SetOpeningCash integer types are fixed and covered by nine passing raw cases. Navigation recovery lock and sticky same-UID/epoch authorization latch are implemented. However, the legal inherited-menu Rules positive still hits the 1,000-expression ceiling; five true server-read tests fail on Emulator 1.19.8 document-ID DESC queries; both P07 browser cases fail before their functional assertions. Seven sequential Emulator suites total 234 passed / 6 failed / 0 skipped; full Vitest, lint and build pass, and TSC remains exit 2 with no new baseline diagnostics. **Update:** the latest checkpoint fixes all three blockers: the per-document Rules ceiling split, the backward date-window source scan, and the E2E fixes. Results: 248/248 Emulator (including six `P07.9b` negatives for the relocated source check), Vitest 1,400/0 failed, E2E 15+7. See [exact checkpoint evidence](../../ops/free-production-evidence.md#p07-latest-source-checkpoint--2026-10-15). P07 已合併（PR #480，merge SHA `436b119`）。

### P06b — 學生穩定內部鍵與可改編號

**Scope/files：** `docs/superpowers/specs/2026-10-16-cloud-student-keys-and-codes-contract.md`；`firestore.rules`、`firestoreSchema.ts`、`cloudCommandSchema.ts`、`cloudCommands.ts`、`cloudCommandRepository.ts`、`cloudStudentRepository.ts`、`CloudStudentsPage.tsx` 與對應測試。

**Consumes/produces：** 內部鍵 `studentId`（UUID）取代原使用者輸入編號成為穩定鍵；新增畫面編號 `studentCode`（唯一正規形式 `001`–`999999`）；新增唯一索引集合 `studentCodes/{studentCode}`；`CreateStudent` 同步建索引；新增命令 `ChangeStudentCode`（含 spec §6.3 唯一 client delete 授權）；名冊數值排序與缺號列；供 P08 訂餐使用穩定 `studentId`。

**RED/GREEN：** 重複編號被拒；非正規編號（`000`、負數、小數、文字）被拒；停用帳戶改號成功並讓出號碼；兩帳戶搶號僅一成功；Rules access budget ≤10/write、≤20/transaction，expression limits 安全；舊索引 delete 授權 closure；缺號列正確計算與填入；搜尋時隱藏缺號列。

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

**Acceptance/demo：** 本人可全日點現金、關帳、回查並重開修正；日結不受F2搜尋或週月範圍影響，不能直接setBusinessDateStatus。過去日子因斷網沒確認開帳現金時，可填原因補開帳再關帳（`BackfillOpeningCash`，CheerC 2026-10-17）；不補登當天交易。

**P11c 帳務斷層與異常處理（CheerC 2026-10-17）：** 分四批。P11c1（本批）只算出並顯示帳務異常：導覽列「帳務異常（n）」與異常頁、開帳與日結頁的未關帳橫幅、開帳現金與上次關帳實點不同時的差額原因（`SetOpeningCash` 選填 `reason`，唯一的 Rules 變更）。契約見 [P11 契約 §11](../specs/2026-10-17-cloud-day-close-contract.md#11-p11c1-帳務異常與開帳差額原因)。P11c2–c4（回填中間日子、關帳對齊、關帳後補記有標記的收支）是之後的修補工具，不在 P11c1。

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

## 6. 2026-10-15 操作回饋插入項

CheerC 2026-10-15 的 10 項操作回饋排程見[操作回饋排程計畫](2026-10-15-operator-feedback-plan.md)。它在 P07 之後插入 P06b（學生內部鍵與可改編號，P08 前完成）和 P09b（退款），並在 P08、P09a、P10–P13 增加範圍與驗收（該文件 §6）。介面行為先在 prototype 定稿（U1–U4），雲端 phase 照定稿實作。各 phase 開工時把對應項目併入該 phase 的 scope 與 receipt；需要 CheerC 確認的事項見該文件 §5，未確認前不得自行定案。
