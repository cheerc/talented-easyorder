# 正式後端逐 PR 開發交接

此頁是正式後端每次 PR 的續作入口；規格／計畫／執行證據只在下列來源更新，避免多份副本互相漂移。PR body 記錄當次 base、head SHA 與 RED/GREEN／CI 結果，作為該 PR 的版本權威；本文不自行抄錄當次 head SHA，避免檔案內自引用。

## 權威文件

- [正式後端規格](superpowers/specs/2026-10-13-free-production-backend-spec.md)：營運契約與資料安全邊界。
- [P00–P18 完整計畫](superpowers/plans/2026-10-13-free-production-backend-plan.md)：phase scope、依賴、驗收及 receipts。
- [現況與執行證據](ops/free-production-evidence.md)：baseline、每 phase emulator／CI 證據及未解阻擋。
- [P00 完整 TypeScript app baseline](ops/baselines/75e7a96-tsc-app.txt)：完整 diagnostics，保留重複項。

## 已合併與目前接手點

- **目前接手點：P10b 期初更正（`CorrectOpening`，F3）PR 進行中**，branch `claude/project-thread-iq5n8l`，base `a694b32`（P10a 收據 #499 與 CLAUDE.md 指引 #500 合併後的 main）；PR、head SHA 與 CI 以 PR body 為準。P10a 已合併（#497，squash `1d61a475109c6642c20c56cbb9ae8e9180491e46`）。見下方「P10 交接狀態（進行中）」。P10 全部合併後停下，不開始 P11。P14 每日增量備份已平行實作並合併（#496，squash `4b4425c3f6c5f5b1423b94d6aad3216c2c67397c`；收據 #498，`b33fc6b3015d277664a47dba86d8ccde5cf4ed44`），P10a 已同步擴充其備份 decoder／replay。P09b 已合併（#494，squash `5b6f9a495244c2a800a64ce0677bb1645b33f0a6`）；P09a 已合併（#493，squash `c444621`）；P08 已合併（#491，merge SHA `889c75c`）。 P07 PR [#480](https://github.com/cheerc/talented-easyorder/pull/480) 已合併（merge SHA `436b119`）；P06b 學生穩定內部鍵與可改編號（PR #487，source `2a03953`）經獨立 review PASS 後，已隨操作回饋前端 U3/U4/U2b 於整合 PR [#488](https://github.com/cheerc/talented-easyorder/pull/488)（source head `58191718e2388bfbf954314128f5357370e65123`，由使用者授權 `--admin` squash merge SHA `6ae1909639f56aa6d36524406e700554891f6328`）合併至 main。審查收據見 [P06b＋前端整合審查收據](ops/integration-p06b-review-5819171.md)。P08 雲端訂餐的第一版 PR #490（`feat/p08-cloud-orders`，head `bca7d048f9743be0b2026938a3f3831ccafdf624`）經審查列出 B1–B8 必修項，已由 #491 修正並取代、合併（merge `889c75c`，見下方「P08 交接狀態（已合併）」），不開 P10+；前端 prototype 批次 U1–U4 均已合入 main，並提供使用者可操作之 [Prototype U1–U4 本人操作驗收步驟清單](superpowers/verification/2026-10-16-prototype-u1-u4-verification-checklist.md)。
- 已合併 P10a：PR [#497](https://github.com/cheerc/talented-easyorder/pull/497)，squash merge SHA `1d61a475109c6642c20c56cbb9ae8e9180491e46`，source head `4cd2286c84643cad97200cff9e4d1642883f03fb`，CI [38935317478](https://github.com/cheerc/talented-easyorder/actions/runs/38935317478) 成功，獨立複審通過（review `5551115175`）。
- 已合併 P14：PR [#496](https://github.com/cheerc/talented-easyorder/pull/496)，squash merge SHA `4b4425c3f6c5f5b1423b94d6aad3216c2c67397c`，CI [38929526636](https://github.com/cheerc/talented-easyorder/actions/runs/38929526636) 成功；收據 PR #498，`b33fc6b3015d277664a47dba86d8ccde5cf4ed44`。見 [P14 receipt](ops/p14-receipt.md)。
- 已合併 P09b：PR [#494](https://github.com/cheerc/talented-easyorder/pull/494)，squash `5b6f9a495244c2a800a64ce0677bb1645b33f0a6`；P09a：PR [#493](https://github.com/cheerc/talented-easyorder/pull/493)，squash `c444621`。
- 已合併 P08：PR [#491](https://github.com/cheerc/talented-easyorder/pull/491)（取代 #490），squash merge SHA `889c75c`，source head `452edd5abce63f1eda329d90dcae245984104721`，CI [38875033302](https://github.com/cheerc/talented-easyorder/actions/runs/38875033302) 成功，獨立複審 PASS。
- 已合併 P07：PR [#480](https://github.com/cheerc/talented-easyorder/pull/480)，merge SHA `436b119`，包含日期菜單與供應商管理。
- 已合併 P06：PR [#478](https://github.com/cheerc/talented-easyorder/pull/478)，merge SHA `b518eca5fdc2b2d2d3e9197c30b29d6a5f74ce10`。
- 已合併 P05：PR [#476](https://github.com/cheerc/talented-easyorder/pull/476)，base `837a1e871468db217463e9799480beeb6d7b0ab0`，source head `0fe7ac738c8495def1c9fdc19580745ff4b4e33f`，實際 merge SHA `41cd08715c435bc5d72ee38985fccd40e0ee4dd1`，合併時間 2026-10-14 16:22:05Z。獨立 [review PASS](https://github.com/cheerc/talented-easyorder/pull/476#pullrequestreview-5521098252)；required CI [run 38596486712](https://github.com/cheerc/talented-easyorder/actions/runs/38596486712) 兩個 jobs 均 SUCCESS，使用官方 pinned Chromium 148.0.7778.96／Playwright v1223。
- P04：PR [#475](https://github.com/cheerc/talented-easyorder/pull/475)，base `fd8cba1b84c0b2146c1f450192e2c99739193e46`，source `cf0cd10af4171f24cf5faa6dff0814393cb71340`，merge SHA `837a1e871468db217463e9799480beeb6d7b0ab0`；review comment `5519480848` pass、CI run [38579765651](https://github.com/cheerc/talented-easyorder/actions/runs/38579765651) 成功。當時全套 Vitest 1291 passed／65 skipped；lease Emulator 19/19、A01 10/10、P01 36/36；Cloud 11＋prototype 7 E2E；app TSC baseline 295→290，exit 2。完整歷程見 [ops evidence](ops/free-production-evidence.md)。
- 最近已合併：PR [#474](https://github.com/cheerc/talented-easyorder/pull/474)，P03 Google 登入與等權白名單；實際 merge SHA `fd8cba1b84c0b2146c1f450192e2c99739193e46`。
- 前次已合併：PR [#473](https://github.com/cheerc/talented-easyorder/pull/473)，P02 雲端 command／投影介面與模式隔離；實際 merge SHA `bc5bb2588e616f40a605ea8cd682b1d1642bbc71`。
- 更早已合併：PR [#472](https://github.com/cheerc/talented-easyorder/pull/472)，P01 Rules 可行性 proof；實際 merge SHA `e7c406c93af197cda0bedaa220a4575728612f0f`。
- 最早已合併：PR [#471](https://github.com/cheerc/talented-easyorder/pull/471)，P00 文件與 diagnostics baseline；實際 merge SHA `1da09039ab57f2b13f965ce98277bd1d41ce8e5e`。
- Emulator 工具鏈已可用：本地 Node `v24.19.0`、Java `21.0.12.1`、Firebase CLI `14.27.0`、Firestore Emulator `1.19.8`，官方 JAR SHA-256 `9d43599ed6151199e8d604dc87fac51218e49e5f3a48519b1ae560bbe5e3382d` 已核對。
- Production Firebase keys／設定／管理憑證只由使用者保存在自己的電腦；所有正式資源、部署與正式 smoke test 由使用者本機執行。Cloud agent 僅可用 demo Emulator；Spark 不開 billing／Blaze、不接 payroll、不改 Android。P00–P06 已合併；目前沒有正式部署或開放正式帳務操作。

## 接手時的第一步

先確認最新遠端與工作區，保留使用者或前一位 implementer 尚未提交的內容；不要用 reset、checkout 覆寫或清除它：

```bash
git fetch origin
git status --short --branch
git branch --show-current
git log -1 --oneline --decorate
```

先續作 handoff 指定的目前 phase 與 branch。若交接時已有未提交變更，先檢視並和當前 PR 對齊，勿覆蓋。

## P05 合併收據：#476

- 計畫入口：[P05 — 正式原子寫入器與冪等收據](superpowers/plans/2026-10-13-free-production-backend-plan.md#p05--正式原子寫入器與冪等收據)；契約來源為 spec §6.2。此次文件 PR 僅作合併狀態收據，沒有實作 P06。
- P05 首批僅啟用 `EnsureDay`、`CreateOrder`、`CreatePayment`；其餘 19 command kinds 保持 deny。Cloud mode 呈現 Google／lease shell 與「業務功能暫未開放」，不掛載本機 POS hooks；只有明確 prototype mode 可掛舊 `AppContent`，缺少正式 Firebase config 不得降級為本機模式。完整 22-kind typed targets/schema 與 no-cache budget/expression-risk matrix 在[獨立預算盤點](ops/p05-rules-budget.md)；未啟用 kind 的靜態估值不是 Emulator pass。
- P05 實際驗收：production Rules Emulator 79/79、0 fail／0 skipped；A01 10 + P01 36 + P05 79 + P04 lease 19 = sequential Emulator regression 144/144、0 skipped。完整 Vitest 1,297 passed／144 skipped／0 failed；144 skipped 屬五個 Emulator-only suites，已由上述獨立 Emulator regression 執行。full lint/build 通過。Cloud E2E 12/12、isolated prototype 7/7，共 19/19。GitHub CI run [38596486712](https://github.com/cheerc/talented-easyorder/actions/runs/38596486712) 兩個 required jobs 均 SUCCESS；官方 pinned Chromium 148.0.7778.96／Playwright v1223。
- App TypeScript `npx tsc -p tsconfig.app.json --noEmit --pretty false` exit 2：290 項 inherited diagnostics，完整 542 行 normalized output 與 base 相同、無新增診斷；不是 clean TSC pass。P05 source 檢查、測試命令、匿名合成案例及舊 RED/GREEN 歷程見 [ops evidence](ops/free-production-evidence.md)。
- `readCommand` 僅允許 server-only讀取且每次都檢查目前有效 Google operator／lease；合法目前 holder 可讀其他 actor、舊 leaseEpoch 的歷史 receipt。只有成功的 server read 確認不存在時回 `null`。
- 同 command ID 的語義完全一致才回既有 receipt；不同 kind/target/payload/expected revisions 一律 `INVALID_INPUT` 且不增 seq。呼叫端與 repository 對結果不確定時回 `UNKNOWN_RESULT`，保留原 ID 並查詢，不盲目換 ID 重送。
- 最近的 P05 production Rules command gate（demo-only）將 `cloudCommands.spec.ts` 與 post-commit failure suite sequential/no-file-parallelism 執行：77 + 2 = 79/79、0 failed、0 skipped；JSON `/tmp/easyorder-p05-commands-r7.json`、log `/tmp/easyorder-p05-commands-r7.log`。兩種 post-commit receipt-read failure 使用真 Firestore commit，一次注入 synthetic `unavailable`，一次由 Admin 換 lease 後確認真 Rules `permission-denied`；皆回 `UNKNOWN_RESULT`，當前合法 holder 同 ID／expected revisions recovery 到已提交原 receipt/seq，未重複 effect。完整 Emulator regression 依序執行 A01 10、P01 36、P05 79、P04 lease 19，共 144/144，0 skipped；各 JSON/log：`/tmp/easyorder-p05-a01-r7.{json,log}`、`/tmp/easyorder-p05-p01-r7.{json,log}`、`/tmp/easyorder-p05-commands-r7.{json,log}`、`/tmp/easyorder-p05-lease-r7.{json,log}`。P01 兩個日期負例原以 `2026-10-15` 為固定明日；在 Asia/Taipei 當天已變成 no-op，已改用 `shiftDate(dayId, 1)`，重跑後 P01 36/36。盤點同檔其餘硬編碼日期後沒有其他會隨日期推進變 no-op 的同類 mutation。31 個 P05 negative case names 出現一個或多個 1000-expression-cap 診斷；31 是案例名稱數，不是 diagnostic 事件數。對應拒絕與 atomic unchanged assertions 均通過，但不稱每個拒絕 guard 已 cap-free isolated；三種正向路徑無 expression-cap failure。
- Full Vitest：1,297 passed／144 skipped／0 failed（JSON `/tmp/easyorder-p05-full-vitest-r8.json`、log `/tmp/easyorder-p05-full-vitest-r8.log`）；141 test files passed、5 Emulator-only files skipped。144 skipped 均屬五個 suites：A01 10、P01 36、P04 lease 19、P05 command 77、P05 failure 2，以上另由前述 Emulator regression 真正執行並通過。Cloud＋prototype E2E final source 19/19、0 skipped（Cloud 12、prototype 7），log `/tmp/easyorder-p05-e2e-final-r8.log`；本機使用 system Chromium 154 與 `/tmp` configs；此診斷執行不是 pinned-browser gate。最終 GitHub required CI run 38596486712 已用 pinned Chromium 148.0.7778.96／Playwright v1223 通過。Cloud auth regression 檢查登入／lease controls 存在、business-closed shell 可見且 `.app`/tabs 不存在；prototype POS assertions 由隔離 prototype config 執行。
- Full lint `npm run lint` 與 `npm run build` 均 exit 0（build 有既存 Vite `__dirname` config-loader warning）；App TypeScript `npx tsc -p tsconfig.app.json --noEmit --pretty false` exit 2，base/current 各 290 項 inherited diagnostics；完整 normalized output 542 行，base/current 比較無差異：raw `/tmp/easyorder-p05-current-app-tsc-r7.raw.txt`、normalized `/tmp/easyorder-p05-current-app-tsc-r7.normalized.txt`、diff `/tmp/easyorder-p05-app-tsc-r7.diff`。舊 writer fail-closed adapter targeted 3 files／13 passed，log `/tmp/easyorder-p05-legacy-r1.log`；bootstrap manifest/schema 只描述 IAM/Admin 建空 metadata，無財務初值、沒有提供可執行 production bootstrap，也未執行。
- 舊 immutable candidate 曾因 review NOT PASS；3cb review comment `5520752222` 的 P1/P2 findings 後續在 PR #476 source 修正，並由上述最終 review／required CI 驗收。前一 source checkpoint run 38591372284 不適用最終 head。P06 學生功能須逐項接入 `commitCommand`、server read/hydrate、receipt confirmation 並通過 Rules/review；不可恢復整個 legacy `AppContent`／POS。
- P05 negative-case caveat：31 個 case names 出現一個或多個 1000-expression-cap 診斷（31 是案例名稱數，不是診斷事件數）；拒絕與 atomic unchanged assertions 通過，但不稱每個拒絕 guard 已 cap-free isolated。review 指出 numeric upper-bound builder（包括 `afterBalance`）及其他 projection 未同步，因此 malformed-batch deny／atomic unchanged 不能單獨證明某個 numeric bound 是拒絕原因。未來 fixture hardening 可改善因果隔離，這項限制未阻擋本次 review、required CI 或 merge。完整舊 candidate NOT PASS 歷程保留於 ops evidence。
- `persistentLocalCache` 尚未改；Firebase SDK memory cache 改造仍屬 P13。bootstrap manifest/schema 只描述 IAM/Admin 可建立的空 dataHead metadata，沒有財務初值；沒有執行 Admin bootstrap 或正式部署，也未使用正式 keys。
- **P06 merged 契約／範圍：** 三個學生 command kind 使用唯一 `commitCommand`。`businessDate` 固定 `null`、`studentId` 固定為目標 ID；字串 ID（含 `001`）不得數字化。期初日期只接受 `head.goLiveDate` 或 Rules server 當前台北日期，並須非未來；goLive baseline 與今天新建都需有正向 Emulator 證據，Rules 不識別 roster 分類，也不宣稱強制分類。Edit 僅開 `displayName`／`aliases`；不可修改 ID、餘額或 opening，`note` 不屬 Edit。狀態命令的理由定為必要 literal 1–500 字，Rules／adapter／normalizer／receipt 一致；這是實作定案，不宣稱舊 spec 已明文逐項要求。期初更正留 P10。P05 三種 kind 必須保留；P06 啟用三種、剩餘 16 種 deny，真 Rules regression 已驗。
- **P06 ownership：** implementer 完成 source/test 並 push；Coordinator 曾保存文件並作為唯一 merge 人。其後使用者已親自在 GitHub 網頁合併 PR #478；不得把本次 rebase merge 寫作 squash。獨立 source 與 final delta review 均 PASS，最後文件差異 review 亦 PASS；報告見 [P06 review](ops/p06-source-review.md)，final docs review 與 merge gate 摘要曾保存於 `/tmp/p06-final-docs-review.md`、`/tmp/p06-final-merge-gate.md`。
- **P06 local gates：** prescribed-order production `firestore.rules` Emulator sequence 的階段計數是 A01 10、P01 36、P04 19、command/failure 103（`cloudCommands.spec.ts` 101 + failure 2）、P06 students 112（同一 command suite 101 + repository list 11）；0 fail／0 skipped，後兩階段的重複 command suite 不重複加總。Focused student page/schema unit 32/32；full Vitest 1,329/179/0、full lint/build pass。app TSC exit 2、base/current 290 headers／542 normalized lines，保留多行與順序的全內容 normalized diff 0，不是 clean pass。system Chromium 154＋Playwright 1.60 demo E2E Cloud/auth 13/13、prototype 7/7；此 system-browser diagnostic 不取代官方 pinned Chromium CI。500 人為本 phase 完整名單上限，501 以上 fail closed；更大 roster UX 留待後續容量 phase。
- **P06 merge receipt：** PR #478 在 GitHub normal web 核實為 `MERGED`；merge SHA `b518eca5fdc2b2d2d3e9197c30b29d6a5f74ce10`、merge time `2026-10-15T05:32:37Z`。PR 以 rebase 整合 5 commits；source head `17da94f3ffea7b116c0ce157fb784011e0b00c89` 與 `origin/main` tree 完全一致（merge 後 fetch，再執行 `git diff 17da94..origin/main` exit 0）。官方 Actions run [38685129628](https://github.com/cheerc/talented-easyorder/actions/runs/38685129628) 對 exact source head 的 build job 116258195493、E2E job 116259321882 均成功；核實方式是允許的 GitHub 網頁，raw logs 要求登入，因此不記錄未見到的 pinned browser 版本或 log counts。source 與 final source-delta review PASS，最後 4-doc 差異 review PASS；使用者其後手動 merge。這些狀態不等同宣稱所有 merge gate 均 PASS。demo Rules Emulator 去重 179/179、完整 Vitest 1,329 passed／179 Emulator-only skipped／0 failed、system Chromium Cloud/auth 13/13＋isolated prototype 7/7、lint/build 通過；app TSC exit 2，base/current 完整比較為 290 diagnostic headers／542 normalized lines、diff 0。500 人完整名單上限、501 人 fail-closed。沒有 production deploy；SDK `persistentLocalCache` 尚未改，memory-only 仍為 P13。

## P10 交接狀態（進行中）

1. **P10a 交易更正、作廢、取消與 5 秒撤回（已合併 #497）**：squash `1d61a475109c6642c20c56cbb9ae8e9180491e46`（2026-10-16），source head `4cd2286c84643cad97200cff9e4d1642883f03fb`；獨立複審通過（review `5551115175`，前一輪 `5550757382` 的 B1／B2 已修）；CI run [38935317478](https://github.com/cheerc/talented-easyorder/actions/runs/38935317478) build-and-test 與 e2e 成功。branch `claude/project-thread-iq5n8l`，base `e01ebdff5e784522b15a6f16278ef303a9c63110`（P09b 收據 #495 合併後的 main），審查後合併 main `b33fc6b3015d277664a47dba86d8ccde5cf4ed44`（P14 每日增量備份 #496 與收據 #498）。契約見 [cloud transaction mutations contract](superpowers/specs/2026-10-16-cloud-transaction-mutations-contract.md)。
   - 啟用 `CorrectTransaction`、`VoidTransaction`、`CancelKeepDeposit`、`CancelRefund`、`Undo`（合併 P14 後已啟用 19 種、拒絕 5 種）。交易永不刪除，作廢只改 `status`。
   - 規則：理由必填；撤回理由固定「送出後立即撤回」且只限原建立者、revision 1、台北今天；取消退款只限台北今天；更正不改列的種類；退款更正調高時餘額不得變負；零收款訂餐取消後作廢。
   - F1：新增成功後 5 秒撤回列；E 付款明細與今日現金列上的「更正／作廢／取消」與預覽；作廢列顯示「已作廢」。雲端 F2 尚無頁面，repository `mutateTransaction` 已備妥。
   - Rules：指令建立改由 `validCommandCreate` 一次綁定 `kind` 後分派，並省去已由既有不變量保證的檢查；新指令分支餘裕 +1 → +19，見 [P10a 預算附錄](ops/p05-rules-budget.md#p10a-transaction-mutations--budget-and-probe-receipt)。
   - P14 相容（審查必修 B1／B2）：`validCommandCreate` 加入 `RecordBackup` 分支；`cloudBackup.ts` 的 decoder／replay 接受 5 種新 kind，形狀對齊本 PR（CorrectTransaction payload 含 `amount`；targets 一律含 `studentId`，櫃台收支為 `__cashier__`、沒有 student 投影）。`cloudBackup.spec.ts` 以真實 P10a 命令驗證匯出→解密→replay，totals 等於 `day.totals`；原本「P10 kind 一律拒絕」的案例改成驗證不合算式的 P10a 收據仍被拒絕。
   - F1 作廢預覽有現金影響時提示「作廢只更正帳本，不是今天退現金或收現金」。
   - 驗證數字與 RED 見 PR body 與 [ops evidence](ops/free-production-evidence.md)。
   - 審查不擋合併、留待之後：把櫃台收支方向檢查移到交易 update 規則（該處餘裕約 +96），讓 mutant 測試能單獨抓到。
   - 複審不擋合併的備註：`cloudTransactionMutation.spec.ts` 的 `beforeAll` 仍是預設 10 秒，與 P14 spec 同一次冷啟 Emulator 一起跑時逾時過一次（CI 分開跑不受影響），之後比照 P14 改 60 秒；正式部署 Rules 要和 `firestore.indexes.json` 一起上。
   - 下一步：P10b（`CorrectOpening`，F3 期初更正表單），另開 PR；P10b 合併（含收據）後停下，不開始 P11。
2. **P10b 期初更正（PR 進行中）**：branch `claude/project-thread-iq5n8l`，base `a694b321b17cc0c5c6c80c23ff1ff8d9da41976e`。契約見 [cloud opening correction contract](superpowers/specs/2026-10-17-cloud-opening-correction-contract.md)。
   - 啟用 `CorrectOpening`（已啟用 20 種、拒絕 4 種：`CloseDay`、`ReopenDay`、`RecordExport`、`RecordPrint`）。
   - 規則：期初日與期初建立時間不變，只改金額與備註；原因必填；結餘加期初差額；期初日營業日須存在且 open／reopened，只增 revision；零現金；停用學生也可更正。
   - F3：學生列「更正期初」，預覽期初與目前結餘；期初日沒有營業日時先按「先建立營業日」（`EnsureDay`），已關帳時只顯示提示。
   - Rules：指令分支放在 `validCommandCreate` 最後；學生與營業日的投影檢查放在各自規則，讓指令規則保持輕。預算見 [P10b 預算附錄](ops/p05-rules-budget.md#p10b-opening-correction--budget-and-probe-receipt)。
   - P14 相容：`cloudBackup.ts` decoder／replay 接受 `CorrectOpening`；`cloudBackup.spec.ts` 以真實命令驗證匯出→解密→replay。
   - 驗證數字與 RED 見 PR body 與 [ops evidence](ops/free-production-evidence.md)。
   - 下一步：審查通過並合併後開文件收據 PR；收據合併後停下，不開始 P11。
3. 測試只用 `demo-easyorder` Emulator 與合成資料；正式部署仍由 CheerC 本機處理。

## P09 交接狀態（已合併）

1. **P09a 雲端繳費與櫃台收支（已合併，#493，squash `c444621`）**：契約見 [cloud payments and cash contract](superpowers/specs/2026-10-16-cloud-payments-cash-contract.md)；base `fc7943970a5ceb86d841eeca8be6a75d3ba75dec`。PR、head SHA 與 CI 以 PR body 為準。
   - 啟用 `CreateCashMovement`（已啟用 12 種、拒絕 11 種）；F1 開放 W 繳費（停用帳戶仍可繳費）、A 櫃台收支（支出／收入、理由必填、付餐費給廠商快捷）、右欄「今日現金」與應有現金（spec §7.1）。
   - `reconcileDayTotals` 改為由交易重算櫃台收入／支出，不再假設為 0（P08 遺留項已處理）。
   - Rules 預算：15/20 存取、單寫最多 8；探測餘裕與量測方式見 [P09a 預算附錄](ops/p05-rules-budget.md#p09a-cloud-payments-and-counter-cash-movement--budget-and-probe-receipt)。
   - 本機驗證（demo-easyorder Emulator＋合成資料）：Emulator 20 個檔案 395/395、0 skipped（含新 `cloudCashMovement.spec.ts` 37 項，在 main 的 Rules 上 7 項失敗＝RED）；Vitest 1,594 passed／317 Emulator-only skipped；lint、build、`tsc --noEmit` 通過；app tsc 208 個診斷與 base 相同；Cloud E2E 14/14（含新 D04，本機 Chromium 1194，不取代 CI pinned Chromium）。
   - 合併後審查 PASS；審查者要求的「交易文件多欄、少欄、改固定欄位」Rules 測試與「櫃台收支結果不明以同 commandId 重試」畫面測試併入 P09b。
2. **P09b 帳戶退款（已合併，#494，source head `f82a5afed689d0b793fcc8c45e2d52fe24cc60c5`，squash `5b6f9a495244c2a800a64ce0677bb1645b33f0a6`）**：契約見 [cloud refund contract](superpowers/specs/2026-10-16-cloud-refund-contract.md)；base `c444621`；CI [38905988081](https://github.com/cheerc/talented-easyorder/actions/runs/38905988081) 成功，獨立審查 PASS。
   - 啟用 `CreateRefund`（已啟用 13 種、拒絕 11 種）；`day.totals` 由 7 欄改 8 欄（新增 `accountRefunds`），所有已啟用 kind 的投影都要求它不變。舊 7 欄日統計讀取回 `UNSUPPORTED_SCHEMA`、寫入被拒；目前沒有正式資料，不需搬移。
   - 規則（Q1）：金額 1 到目前餘額、理由必填、只記台北今天且未關帳、停用帳戶可退。應有現金 = 開帳 + 學生收款 + 櫃台收入 − 櫃台支出 − 帳戶退款，只扣一次（spec §7.1／§7.2 已改寫）。
   - F1：W 面板「退款」框（預設全額、確認框、退款後餘額）、右欄「帳戶退款」、E 明細退款列、最近帳戶「僅退款」；負數繳費改提示用退款。
   - Rules 預算：19/20 存取、單寫最多 10；最緊的是退款指令規則 +14，見 [P09b 預算附錄](ops/p05-rules-budget.md#p09b-account-refund--budget-and-probe-receipt)。
   - 本機驗證（demo-easyorder Emulator＋合成資料）：Emulator 21 個檔案 444/444、0 skipped（新 `cloudRefund.spec.ts` 43 項，在 main 的 Rules 上 8 項失敗＝RED）；Vitest 1,602 passed／365 Emulator-only skipped；lint、build 通過；app tsc 208 個診斷與 base 相同；Cloud E2E 18/18（含新 D05，本機 Chromium 1194）。
   - 審查不擋合併的備註（留給 P10 之後）：退款指令規則餘裕 +14，加檢查前先重量測；退款框開著時按 Q 會切到便當模式並隱藏退款框（`refundOpen` 仍為 true，切回 W 會再出現）；非今天日期由 Rules 擋下、回較籠統的 `INVALID_INPUT`（與 P09a 同）。
   - 部署（CheerC 本機）：Rules 與 `firestore.indexes.json` 一起上；7→8 欄後舊營業日文件讀不到也寫不進，目前沒有正式資料。
   - 下一步：已由 P10 接續（見上方「P10 交接狀態」）。
3. 測試只用 `demo-easyorder` Emulator 與合成資料；正式部署（Rules＋`firestore.indexes.json`）仍由 CheerC 本機處理。P09 全部合併後曾停下；CheerC 其後指示續作 P10。

## P08 交接狀態（已合併）

1. P07 日期菜單與供應商（PR [#480](https://github.com/cheerc/talented-easyorder/pull/480)，merge SHA `436b119`）與 P06b 學生穩定鍵與可改編號（PR #487，隨整合 PR [#488](https://github.com/cheerc/talented-easyorder/pull/488) 合併，merge SHA `6ae1909639f56aa6d36524406e700554891f6328`）均已正式合入 main。
2. **P08 雲端訂餐已合併**（#491，merge `889c75c`），契約見 [cloud orders contract](superpowers/specs/2026-10-16-cloud-orders-contract.md)。
   - PR #490（head `bca7d048f9743be0b2026938a3f3831ccafdf624`）審查未過，必修 B1–B8：未知結果重試與凍結 commandId、失去租約遮罩、伺服器營業日、交易清單讀取 fail closed（分頁、對帳、新鮮度）、transactions list Rule 與 Emulator 證明、明細不捏造品名、金額嚴格解析、文件同步。
   - 修正版從 #490 head 接續，以 #491 取代 #490（base `5ff889a8c7dc9a411383c8f1a37e23f243e0ce8d`，source head `452edd5abce63f1eda329d90dcae245984104721`），CI [38875033302](https://github.com/cheerc/talented-easyorder/actions/runs/38875033302) 成功，複審 PASS 後 squash merge `889c75c`；#490 已關閉。
   - 本機驗證（demo-easyorder Emulator＋合成資料）：Rules／Emulator 281/281（firestoreRules 10、cloudRulesProof 36、activeAccountLease 19、cloudCommands 178、failure 6、students 12、dayVendor 10、P08 orders 10）；P08 新 spec 在 main 的 Rules 上 10/10 失敗（RED）。Vitest 1,573 passed／281 Emulator-only skipped／0 failed；lint、build 通過；app tsc 208 個 `error TS` 診斷，與 base 相同（未新增）；E2E Cloud 16＋prototype 7 通過（本機 Chromium 1194，不取代 CI pinned Chromium）。
   - 已知限制：雲端模式沒有顯示偏好設定入口（沿用本機模式設定的主題與字級）；單日交易讀取上限 2,000 筆，超過 fail closed；5 秒撤回、W 繳費、A 櫃台收支仍關閉。
   - 後續注意：正式部署 Rules 時要一併部署 `firestore.indexes.json`（新交易查詢索引），由 CheerC 本機處理；`reconcileDayTotals` 目前假設櫃台收支為 0，P09 開放時要同步調整。
   - 下一步：P08 完成，停在這裡；P09 須由 CheerC 指示才開始。
3. 工作只推進到 P08 完成與收尾，**不得跨越開始 P09/P09b/P10+**。測試只用 `demo-easyorder` Emulator 與合成資料；production keys/resources/bootstrap/deploy 仍只由使用者本機處理；SDK `persistentLocalCache` 改造仍屬 P13。

`/tmp` 原始結果檔可能在環境恢復後消失；本頁／evidence／tracked review 保存狀態與摘要。需要重新驗證時依 CI 與 suite 執行，不將缺失的原始檔視為當次新執行證據。production keys／資源／部署仍只由使用者本機處理。

## 每個 PR 的協作與交接要求

- 每次只開一個小 phase PR；implementer 做程式／文件與自我驗證，SOL medium review，Coordinator 是唯一 merge 人。Review 與 required CI 通過後，使用者已授權 coordinator 單人開發分支以 `--admin` merge。作者不能自行 merge。
- 實作與獨立 review 依交接指定的角色／effort 執行；不放模型名稱到文件、commit message 或 PR body。
- commit 與 PR body 用中文，不寫模型名稱或真實個資。可在交接提示記錄使用者指定的 implementer／review effort，但不複製到 commit／PR 描述。
- 每次開 PR 後即向使用者回報 URL、當前 SHA、當批完成內容、review／CI 狀態與接續第一步。更新本 handoff 的 PR URL及狀態、plan receipt、evidence；不把未知標成已完成。
- PR body 至少記錄 base/new head SHA、對應 spec／案例、精確命令／exit／測試數、RED 與 GREEN 證據、CI run、三分鐘 demo、known limitations、是否部署（本專案實作 PR 固定未部署）。Rules suite 不能用 Vitest skip 冒充成功；部署／production 操作由使用者本機執行。

## 可複製的續作提示

```text
請先讀 docs/DEVELOPMENT-HANDOFF.md，再讀其中連結的正式後端 spec、P00–P18 plan 與 ops evidence。先 git fetch origin / status / branch / log，不覆蓋任何既有使用者或未提交變更。只續作 handoff 指定的目前 phase：完成修正、實際測試與 required CI、獨立 review；由 Coordinator 唯一 merge。不得略過未完成 phase 開始下一 phase。完成後更新 handoff、plan receipt、evidence，回報 URL、SHA 與接手事項。Production secrets/resources/deploy 只由使用者本機操作；Cloud 僅 demo Firestore Emulator／合成資料，禁止碰 payroll、Blaze 與 Android。
```
