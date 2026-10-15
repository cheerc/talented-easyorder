# 正式後端逐 PR 開發交接

此頁是正式後端每次 PR 的續作入口；規格／計畫／執行證據只在下列來源更新，避免多份副本互相漂移。PR body 記錄當次 base、head SHA 與 RED/GREEN／CI 結果，作為該 PR 的版本權威；本文不自行抄錄當次 head SHA，避免檔案內自引用。

## 權威文件

- [正式後端規格](superpowers/specs/2026-10-13-free-production-backend-spec.md)：營運契約與資料安全邊界。
- [P00–P18 完整計畫](superpowers/plans/2026-10-13-free-production-backend-plan.md)：phase scope、依賴、驗收及 receipts。
- [現況與執行證據](ops/free-production-evidence.md)：baseline、每 phase emulator／CI 證據及未解阻擋。
- [P00 完整 TypeScript app baseline](ops/baselines/75e7a96-tsc-app.txt)：完整 diagnostics，保留重複項。

## 已合併與目前接手點

- **目前接手點：P06 source 已 push，phase acceptance 待完成。** Branch `codex/backend-p06-students`；PR [#478](https://github.com/cheerc/talented-easyorder/pull/478) 唯一實際 base 為 `b53423aa71ed4cfac2428f290c648e5a999a0cae`，包含 P05 merge `41cd08715c435bc5d72ee38985fccd40e0ee4dd1` 與 #477 receipt（41cd 是 P06 base 前的 merge，不是 PR base）。已驗證的 P06 source SHA 為 `7494b521098080f719d7c59a09536667eb942591`，已 push；此次後續 tracked 文件 checkpoint 不更動 app source。範圍只含學生 server list/read、`CreateStudent`／`EditStudent`／`SetStudentStatus` 與獨立學生管理 UI。Prescribed-order production Rules Emulator 在 `demo-easyorder` 全階段通過：A01 10、P01 36、P04 lease 19、command/failure 103、P06 command/list 112，全部 0 fail／0 skip；後兩階段重跑 `cloudCommands.spec.ts`，不能重複加總。Full Vitest 1,329 passed／179 Emulator-only skipped／0 failed；full lint/build exit 0；app TSC exit 2，base/current 均 290 headers／542 normalized lines、完整 normalized diff 0。system Chromium 154 的 demo-only E2E Cloud/auth 13/13、prototype 7/7 通過；本機 pinned-browser cache 空，此結果不能替代 official CI。最多 500 名完整名單、501 人 `INCOMPLETE_SNAPSHOT` fail-closed。獨立 reviewer 對前一 source SHA `ccd625db68f58e8acac8267c3fedb4af26839463` review PASS；最後 source SHA 的一行 regex selector 差異亦已獨立 review PASS，報告見 [P06 review](ops/p06-source-review.md)。GitHub API 現受 network policy `Forbidden` 阻擋，PR body 尚未更新，official GitHub/P06 JSON skip/pinned-browser CI 尚未核實；不可稱 phase acceptance、merge ready 或 P07 ready。
- 已合併 P05：PR [#476](https://github.com/cheerc/talented-easyorder/pull/476)，base `837a1e871468db217463e9799480beeb6d7b0ab0`，source head `0fe7ac738c8495def1c9fdc19580745ff4b4e33f`，實際 merge SHA `41cd08715c435bc5d72ee38985fccd40e0ee4dd1`，合併時間 2026-10-14 16:22:05Z。獨立 [review PASS](https://github.com/cheerc/talented-easyorder/pull/476#pullrequestreview-5521098252)；required CI [run 38596486712](https://github.com/cheerc/talented-easyorder/actions/runs/38596486712) 兩個 jobs 均 SUCCESS，使用官方 pinned Chromium 148.0.7778.96／Playwright v1223。
- P04：PR [#475](https://github.com/cheerc/talented-easyorder/pull/475)，base `fd8cba1b84c0b2146c1f450192e2c99739193e46`，source `cf0cd10af4171f24cf5faa6dff0814393cb71340`，merge SHA `837a1e871468db217463e9799480beeb6d7b0ab0`；review comment `5519480848` pass、CI run [38579765651](https://github.com/cheerc/talented-easyorder/actions/runs/38579765651) 成功。當時全套 Vitest 1291 passed／65 skipped；lease Emulator 19/19、A01 10/10、P01 36/36；Cloud 11＋prototype 7 E2E；app TSC baseline 295→290，exit 2。完整歷程見 [ops evidence](ops/free-production-evidence.md)。
- 最近已合併：PR [#474](https://github.com/cheerc/talented-easyorder/pull/474)，P03 Google 登入與等權白名單；實際 merge SHA `fd8cba1b84c0b2146c1f450192e2c99739193e46`。
- 前次已合併：PR [#473](https://github.com/cheerc/talented-easyorder/pull/473)，P02 雲端 command／投影介面與模式隔離；實際 merge SHA `bc5bb2588e616f40a605ea8cd682b1d1642bbc71`。
- 更早已合併：PR [#472](https://github.com/cheerc/talented-easyorder/pull/472)，P01 Rules 可行性 proof；實際 merge SHA `e7c406c93af197cda0bedaa220a4575728612f0f`。
- 最早已合併：PR [#471](https://github.com/cheerc/talented-easyorder/pull/471)，P00 文件與 diagnostics baseline；實際 merge SHA `1da09039ab57f2b13f965ce98277bd1d41ce8e5e`。
- Emulator 工具鏈已可用：本地 Node `v24.19.0`、Java `21.0.12.1`、Firebase CLI `14.27.0`、Firestore Emulator `1.19.8`，官方 JAR SHA-256 `9d43599ed6151199e8d604dc87fac51218e49e5f3a48519b1ae560bbe5e3382d` 已核對。
- Production Firebase keys／設定／管理憑證只由使用者保存在自己的電腦；所有正式資源、部署與正式 smoke test 由使用者本機執行。Cloud agent 僅可用 demo Emulator；Spark 不開 billing／Blaze、不接 payroll、不改 Android。P00–P05 已合併；目前沒有正式部署或開放正式帳務操作。

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
- **P06 WIP 契約／範圍：** 三個學生 command kind 使用唯一 `commitCommand`。`businessDate` 固定 `null`、`studentId` 固定為目標 ID；字串 ID（含 `001`）不得數字化。期初日期只接受 `head.goLiveDate` 或 Rules server 當前台北日期，並須非未來；goLive baseline 與今天新建都需有正向 Emulator 證據，Rules 不識別 roster 分類，也不宣稱強制分類。Edit 僅開 `displayName`／`aliases`；不可修改 ID、餘額或 opening，`note` 不屬 Edit。狀態命令的理由本實作定為必要 literal 1–500 字，Rules／adapter／normalizer／receipt 一致；這是實作定案，不宣稱舊 spec 已明文逐項要求。期初更正留 P10。P05 三種 kind 必須保留；P06 啟用三種、剩餘 16 種 deny，真 Rules regression 已驗。
- **P06 ownership：** 本 phase implementer 完成 source/test 並 push；文件收尾期間 implementer 與 reviewer 遇到用量限制，Coordinator 接手保存文件，不修改程式。Coordinator 是唯一 merge 人。獨立 review report 已就 `ccd625db68f58e8acac8267c3fedb4af26839463` PASS，final `7494b521098080f719d7c59a09536667eb942591` 只多 test locator regex delta，亦已獨立 review PASS；本次文件 checkpoint 尚未獨立複審。
- **P06 local gates：** prescribed-order production `firestore.rules` Emulator sequence 的階段計數是 A01 10、P01 36、P04 19、command/failure 103（`cloudCommands.spec.ts` 101 + failure 2）、P06 students 112（同一 command suite 101 + repository list 11）；0 fail／0 skipped，後兩階段的重複 command suite 不重複加總。Focused student page/schema unit 32/32；full Vitest 1,329/179/0、full lint/build pass。app TSC exit 2、base/current 290 headers／542 normalized lines，保留多行與順序的全內容 normalized diff 0，不是 clean pass。system Chromium 154＋Playwright 1.60 demo E2E Cloud/auth 13/13、prototype 7/7；此 system-browser diagnostic 不取代官方 pinned Chromium CI。500 人為本 phase 完整名單上限，501 以上 fail closed；更大 roster UX 留待後續容量 phase。
- **P06 尚未完成：** 最後文件 checkpoint 的獨立複審、GitHub review 發佈、P06 JSON skip gate 的 GitHub CI、official pinned-browser required CI、PR body update；GitHub API 因 network policy `Forbidden` 尚未可用。GitHub review/CI 狀態未核實，未 merge、不得稱 phase acceptance 或 P07 ready。不得使用正式 keys／resources/bootstrap/deploy，也不宣稱 SDK persistent cache 已改為 memory-only（P13）。

## P06 恢復後的第一個任務

1. 讀取 [P06 source review](ops/p06-source-review.md) 與 [本次證據](ops/free-production-evidence.md#p06-wip-checkpoint--2026-10-15)，先確認本地／遠端分支與 PR #478 的完整 head SHA。最後已驗程式版本是 `7494b521098080f719d7c59a09536667eb942591`；之後的文件 checkpoint 只改 Markdown。
2. 環境設定草稿已新增 `api.github.com`；需使用者在環境設定 review／儲存並 Publish 後，重新確認 runtime policy 及 `gh api repos/cheerc/talented-easyorder/pulls/478` 可用。原生 Git fetch/push 已可用，不需索取 token，不繞過 proxy。
3. 取得可用的獨立 reviewer 複審最後文件差異；發布精確 SHA 的 review，更新 PR body，將 Draft 轉 Ready，核對最新 head 的 required CI（包含 P06 JSON zero-skip gate 與官方 pinned Chromium E2E）。若 CI 失敗，依日誌修復後重審；不得使用舊 head 的綠燈合併。
4. Coordinator 通過最後 merge gate 後，依使用者既有授權 admin squash merge；記錄實際 merge SHA／時間／CI／review URL，再以文件收據更新本頁、plan、evidence。現在 **P06 未 merge、P07 未開始**。
5. P06 合併與收據完成後才開 P07：日期設定、供應商、菜單與開帳。先釐清未來預排菜單與目前 EnsureDay 日期限制、沿用來源／供應商快照、SetOpeningCash 明確 0 與未確認 null、供應商 tombstone／revision 及新增 Rules 讀取預算；依 plan D02 驗收，不恢復整個 legacy POS。

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
