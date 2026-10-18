# 零費用正式後端：現況與證據

狀態截至 2026-10-15。此頁保留 P00 基線、P01–P06 合併證據、P06 開發期間 checkpoint 與 P07 WIP checkpoint。P04 #475、P05 #476、P06 #478 已合併；P06 merge receipt 在下方。P07 契約已凍結、implementation 與驗證進行中，尚未 acceptance。新的正式後端未部署、未通過正式上線驗收。規格是目標契約，不代表雲端資源或部署狀態已成立。前端原本人驗收紀錄仍以 [PROJECT-STATUS](../PROJECT-STATUS.md) 為準。

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

- Phase branch：`codex/backend-p06-students`；唯一 actual PR base `b53423aa71ed4cfac2428f290c648e5a999a0cae`，包含 P05 code merge `41cd08715c435bc5d72ee38985fccd40e0ee4dd1` 與 #477 receipt（41cd 是 merge commit，不是 P06 PR base）。本節記錄已驗 source SHA；文件 checkpoint 的 head 請核對 Git／PR，即時 PR body 因 API 阻擋尚未更新。本節記錄已完成的局部 evidence 與未完成項目，不代表 phase acceptance。
- 範圍：server-only complete student list/read、學生建立／編輯／狀態切換與獨立 cloud page。production command kinds 為 `CreateStudent`、`EditStudent`、`SetStudentStatus`。P05 `EnsureDay`、`CreateOrder`、`CreatePayment` 必須保留；其餘 16 kinds 必須保持拒絕。不得恢復 prototype POS/local business store、開 P07/P08/P10 功能或部署正式環境。
- Contract：所有 student command `businessDate=null`，`studentId` 為固定 target；學生 ID 是字串（`001` 保留前導零），create 不生 transaction/payment/day effect。Create opening 日期只允許 metadata `head.goLiveDate` 或 Rules server 當前台北日期，且不能為未來；這是允許的日期集合，不代表 Rules 能強制辨識 baseline roster 與今天新學生。Edit 只允許 display name／aliases；opening、ID、balance 的更正留 P10。
- Status 理由：本 phase 將 UI 要求的停用／恢復原因定為必要 command payload，限 1–500 個 literal 字元；adapter、normalizer、receipt 與 Rules 一致拒絕缺漏或空字串，UI 可先 trim。此為本次實作定案，非 spec 舊文已逐項明定。
- 早期局部 Emulator 結果（2026-10-15，`demo-easyorder`、production `firestore.rules`）保留作歷史：`cloudCommands.spec.ts` 97/97、`cloudStudentRepository.spec.ts` 11/11、`cloudCommandRepository.failure.spec.ts` 2/2、A01 10/10、P01 36/36、P04 19/19，分別通過；原 JSON 在 `/tmp/p06-*.json`。這些已被下方較新的 prescribed-order 單輪結果重跑，不把舊計數與新計數相加。
- **本次 prescribed-order 真 Rules Emulator regression（2026-10-15，`demo-easyorder`）：** 單一 Emulator session 依序執行 A01、P01、P04、P05 command/failure、P06 command/list；各階段全為 0 failed、0 skipped，session exit 0。階段計數依序為 A01 10、P01 36、P04 19、command/failure 103（`cloudCommands.spec.ts` 101 + failure suite 2）、P06 students 112（同一 `cloudCommands.spec.ts` 101 + `cloudStudentRepository.spec.ts` 11）。後兩階段重跑 command suite，階段計數不可加總作唯一測試數。新增的缺少／空字串 SetStudentStatus reason Rules denial 與原子不變案例在 101 個 command tests 內通過；status 1–500 字理由的合法 raw command 亦通過。報告：`/tmp/p06-resume-a01.json`、`/tmp/p06-resume-p01.json`、`/tmp/p06-resume-p04.json`、`/tmp/p06-resume-p05-p06-commands.json`、`/tmp/p06-resume-p06-students.json`；完整 console log `/tmp/p06-resume-emulator-regression.log`。
- Cloud student page 與 status-command normalizer focused unit tests 32/32（page 13、schema 19）通過；涵蓋授權撤銷後的 command/list 舊 flight、receipt semantic replay 與缺漏／空字串 reason。相關修改檔 ESLint 與 `git diff --check` 通過。後續全量 source gates 結果見下列 current source verification。
- 早期 P06 focused filter `cloudCommands.spec.ts -t P06` 為 40 passed、57 not-selected；57 是未執行測試，不是通過證據。此前曾遇到 max-1000 expression 診斷，修正為中央 receipt 與實際 projection 相等、由 student leaf 一次執行 student schema 驗證後，合法 positive／最大 10 個 100 字 alias 的 raw SDK 路徑目前通過。P05 舊負例及 P06 omission/forgery deny 仍可出現 cap 訊息；測試 assert deny+atomic unchanged，不將未隔離 case 說成每一個 guard 的獨立 cap-free 證明。細節依 source case names 與 [P06 rules budget](p05-rules-budget.md#p06-student-write-budget-wip) 查閱。
- server list 使用 `getDocsFromServer`、依 document ID 有序 cursor pages、strict 完整 DTO/path 驗證及讀取前後 `dataHead` seq/dataset/goLiveDate 比對；真 Emulator 500 人跨頁完整通過，501 人明確回 `INCOMPLETE_SNAPSHOT`，不發布部分結果。這個 phase 的已驗上限為 500，不宣稱 501 或無上限名單可完整瀏覽；如需超過 500，完整 pagination UX／容量處理要在後續 phase 解決。
- **Current source verification**（source SHA `7494b521098080f719d7c59a09536667eb942591`；base `b53423aa71ed4cfac2428f290c648e5a999a0cae`）：full Vitest exit 0，1,329 passed／179 Emulator-only skipped／0 failed，149 files；JSON `/tmp/p06-resume-full-vitest-final-r2.json`，log `/tmp/p06-resume-full-vitest-final-r2.log`。179 個 skip 對應 A01 10、P01 36、P04 lease 19、command failure 2、`cloudCommands.spec.ts` 101、`cloudStudentRepository.spec.ts` 11；這些 suites 均在上方真 Emulator regression 跑通。Full `npm run lint`、`npm run build` exit 0；build 保留 Vite `__dirname` config-loader warning。final source 的 focused student page/schema tests 32/32，相關 files ESLint pass。
- App TSC 不是 clean pass：base/current 都 exit 2、290 diagnostic headers／542 normalized lines。base 由 `git archive b53423aa71ed4cfac2428f290c648e5a999a0cae` 解出到 `/tmp/p06-resume-tsc-base`，共用安裝依賴；只正規化診斷位置，保留多行內容、順序與重複項，normalized diff 為 0 行。raw、normalized、diff、exit 記錄於 `/tmp/p06-resume-{base,current}-app-tsc.{raw.txt,normalized.txt,exit}` 與 `/tmp/p06-resume-app-tsc.diff`。首次比較曾發現一個 test selector `exact` 型別診斷，改為精確 regex 後重跑，最終完整內容相同。
- Browser：以 Playwright 1.60.0、system Chromium 154.0.8037.57、`/tmp` config 指向 `/usr/bin/chromium`，在 demo-only Auth／Firestore Emulator sequential 跑 Cloud/auth 13/13 與 isolated prototype 7/7，exit 0；含修正後 D01 three-student empty-dataset browser flow。log `/tmp/p06-resume-system-e2e.log`。本機 pinned Playwright browser cache 為空，這是 system-browser diagnostic，不能替代 official pinned-browser required CI。
- **Independent review checkpoint：** 獨立 reviewer 對固定 source SHA `ccd625db68f58e8acac8267c3fedb4af26839463` 給予 source review PASS；審查涵蓋同步授權撤銷／舊 flight invalidation、PII 清除與同 identity gate、confirmed receipt list retry、unknown receipt semantic replay、SetStudentStatus required reason 與 Rules/adapter 一致性，未發現該 SHA 的 blocker。reviewer 同時核對 Emulator JSON：A01 10、P01 36、P04 19、command/failure 103、command/list 112，重複 command suite 去重 179 cases，均零失敗／pending；reviewer 未自行啟動 Emulator 或重跑測試。報告原檔 `/tmp/p06-review-ccd625d.md`；審查摘要已保存於此文件。最終 source SHA `7494b521098080f719d7c59a09536667eb942591` 僅在 unit test 中把 testing-library 不接受的 `exact` option 改為 `/^姓名$/`，focused test、TSC 與所有 source verification 均已重跑；最終 source SHA 的獨立 delta review 已 PASS，且核對下列完整執行證據；兩份報告已保存於 [tracked review](p06-source-review.md)。review 尚未發佈到 GitHub。
- **當時尚未完成的 gate（歷史狀態）：** 在此 source checkpoint 寫成時，最後文件 checkpoint 的獨立複審、GitHub review 發佈、P06 JSON skip gate 的 GitHub CI、official pinned-browser required CI、PR body publication 尚未完成；後續全部狀態以本頁 [P06 merge receipt](#p06-merge-receipt--2026-10-15) 為準。舊的 GitHub API network-policy blocker 描述只適用於該 checkpoint，不代表目前 PR 未合併。
- displayName 與 alias 的 current schema 在 Rules、normalizer、receipt decoder、list decoder 統一採 literal non-empty string 長度 1–100（alias 最多 10 個）；UI 可額外修整輸入，但讀寫安全判定不使用 JS trim/Rules whitespace regex 以免 Unicode whitespace 不一致。Emulator 覆蓋 ASCII whitespace、NBSP、BOM、含換行文字合法與空字串拒絕。
- 僅使用 `demo-easyorder` Firestore/Auth Emulator 和合成 operator/student fixtures；不讀取／建立 production credentials、Firebase project、Admin bootstrap 或部署。Firestore SDK `persistentLocalCache` 尚未修改；memory-cache 生命週期限制仍屬 P13。

## P06 merge receipt — 2026-10-15

- PR [#478](https://github.com/cheerc/talented-easyorder/pull/478) 由使用者在 GitHub normal web 手動合併；頁面內嵌 JSON receipt 狀態為 `MERGED`，merge SHA `b518eca5fdc2b2d2d3e9197c30b29d6a5f74ce10`，時間 `2026-10-15T05:32:37Z`（台北時間 13:32:37）。PR base 是 `b53423aa71ed4cfac2428f290c648e5a999a0cae`，final source head 是 `17da94f3ffea7b116c0ce157fb784011e0b00c89`；GitHub 採 rebase 整合 5 commits。GitHub API 仍回 `Forbidden`，本 receipt 狀態來源是 normal web，不稱 API 核實，也不稱 squash merge。
- merge 後 fetch `origin/main`，驗證 `git diff 17da94f3ffea7b116c0ce157fb784011e0b00c89..origin/main` exit 0，source 與 main tree 完全一致。官方 GitHub Actions run [38685129628](https://github.com/cheerc/talented-easyorder/actions/runs/38685129628) 對 exact source head 成功：build-and-test job `116258195493`、E2E job `116259321882`。狀態由允許的 GitHub 網頁核實；raw logs 要求登入，因此本收據不聲稱見過其 pinned-browser 版本或 raw log test counts。
- P06 獨立 source review 與 final source-delta review 均 PASS，報告見 [P06 source review](p06-source-review.md)；最後 4-doc 差異 review PASS，摘要曾保存於 `/tmp/p06-final-docs-review.md`。使用者在完成其核對後手動 merge；此收據不回溯聲稱所有 merge gate 均 PASS。
- 本機 production Rules Emulator 使用 `demo-easyorder` 與合成資料，按 prescribed order 的 A01 10、P01 36、P04 lease 19、command/failure 103、P06 command/list 112 均為 0 failed／0 skipped；command suite 去重後 179 passed。Full Vitest 1,329 passed／179 Emulator-only skipped／0 failed；完整 lint/build exit 0。System Chromium 154＋Playwright 1.60 的 demo Cloud/auth 13/13、isolated prototype 7/7，共 20/20。App TSC exit 2；base/current 都為 290 diagnostic headers、542 normalized lines，保留順序與重複項的完整 diff 0，不是 clean TSC pass。
- 名單完整讀取只驗證至 500 人；501 人 fail closed 為 `INCOMPLETE_SNAPSHOT`。沒有建立／部署 production resources，沒有用正式 keys；`persistentLocalCache` 尚未改，memory-only cache 仍列 P13。
- 後續 P07 從 merge SHA `b518eca5fdc2b2d2d3e9197c30b29d6a5f74ce10` 開始；該階段目前狀態見下節 [P07 WIP checkpoint](#p07-latest-source-checkpoint--2026-10-15)。

## P07 WIP checkpoint — 2026-10-15

- Branch `codex/backend-p07-day-vendors` 起於 P06 merge SHA `b518eca5fdc2b2d2d3e9197c30b29d6a5f74ce10`。本 checkpoint 記錄 P07 implementation WIP，不是 source acceptance；P07 contract 已由 Coordinator 凍結並追蹤於 [cloud day/vendor contract](../superpowers/specs/2026-10-15-cloud-day-vendors-contract.md)。P08 尚未開始；沒有 P07 PR、CI、merge 或 production 驗收收據。
- Source WIP 範圍包含既有 `commitCommand` 的四種新 kind、strict server-only day/vendor repository、AuthGate 下獨立 Cloud day/vendor UI 與四個 kind 的 Rules branches；EnsureDay 沿用既有 future-empty-day 行為。Primary 對 normalizer、mocked repository reads、Forms、Page 四個 focused suites 的統一執行為 65/65 pass；P07 TS/TSX source/test ESLint pass。這些 focused／mock 結果不取代真 Rules／read Emulator gate 或完整 UI E2E。
- 第一次早期 filtered `cloudCommands.spec.ts -t P07` Emulator 啟動因 Rules compile error 退出，139 個測試全部未執行／skip；log `/tmp/p07-early-rules-smoke.log`。Rules 修正後第二次與第三次 smoke 均使用 `EASYORDER_REQUIRE_CLOUD_COMMANDS=true`、`demo-easyorder` Auth/Firestore Emulator、JSON reporter；r2 選中 55 個案例為 46 passed、9 failed、84 not-selected，六個 raw closure 案例遇到 Firestore 1,000-expression ceiling，三個 opening negative fixtures 因前序 day setup 未成立而 cascade-fail。r3 為 49 passed、6 failed、84 not-selected；RemoveVendor 與 SetOpeningCash positives 已過，SaveVendor 及兩條 SetDayMenu positives 仍 hit 1,000-expression ceiling，三個 opening negative fixtures仍因 target day setup cascade-fail。這些是早期修正診斷，不能解讀為獨立驗收；報告 `/tmp/p07-early-rules-smoke-r2.json`、`/tmp/p07-early-rules-smoke-r3.json`，console 同 stem 的 `.log`。Rules owner 仍在整理預讀／branch 評估圖；未完成 unfiltered rerun 前不得稱 P07 Rules 通過。
- True server-read `cloudDayVendorRepository.spec.ts` 已由 Rules owner 編寫，含 server-only/cap/source/head cases；尚未由 primary 在 Emulator 執行。Mocked negative/bounds coverage 位於 `cloudDayVendorRepository.read.test.ts`，不可替代該 server gate。Full Vitest、lint/build、app TSC normalized baseline comparison、required CI、system-browser Cloud+prototype E2E、source review、final review 均未在此 checkpoint 完成。
- **第一個程式 WIP source checkpoint：** 僅收錄穩定的 command schema/core command repository/path、server-only day/vendor repository、其 domain/mock read tests、及 Cloud page/forms＋focused UI tests；不含 `App.tsx`、Playwright config／P07 E2E、`firestore.rules`、raw Rules tests、true server-read Emulator spec 或 Rules budget appendix。這些分線檔仍各自 WIP、未整合成 phase gate；known Rules expression-cap blocker 尚未解除。該 snapshot 只供 exact-SHA source review 與恢復開發，不是 P07 acceptance、CI／PR／merge-ready 或 production receipt；後續完成的 integration files 須另 checkpoint。
- 無 production credentials/resources/bootstrap/deploy；不宣稱任何 demo/P07 production rollout。SDK `persistentLocalCache` 仍屬 P13。

## P07 continuation checkpoint — 2026-10-15

- 本 checkpoint 的實作 branch 為 `codex/backend-p07-day-vendors`，上一個已推送 integration checkpoint 為 `43d51dab9a141dc76c65b5ad9c20ef78014f5c6f`；基於 P06 merge `b518eca5fdc2b2d2d3e9197c30b29d6a5f74ce10`。本次 checkpoint 保留完整 P07 程式與 Rules source、P2 classification regression、文件及 gate 證據；它仍是 WIP，不是 acceptance、CI、PR 或 merge receipt。Coordinator 是唯一 merge 人。
- **Rules positive 仍未通過。** 當時 r9 在 `validTotals`、`validMenu`、`validVendor`、`validDay` 以 exact map-size 與原有必要欄位 predicate 表示 7/8/10/10 key schema，其他 validation、`validDayNonMenu`、writer/auth guards 保留。Rules source SHA-256 `ff6f91f0019c2450f8e3343bf256dc06851841da488bcf2ff4e6a647d5547955`。r9 `P07.9: raw SetDayMenu inherits the immediate source menu with a frozen snapshot` 單例仍因 1,000-expression ceiling 失敗，JSON/log `/tmp/p07-rules-ours-r9.json`、`/tmp/p07-rules-ours-r9.log`；同一 unfiltered command suite 139/140 passed，唯一失敗仍是該 positive。診斷列 dataHead update L1092、command create L1100、day update L1120、wildcard L1175；同一 write closure 的 diagnostics 不能隔離單一 predicate 或將拒絕歸因為獨立 guard。歷史 r7 RuleCoverage `/tmp/p07-rulecov-r7.json` 僅有 1 rules file、80 top-level AST nodes、1,742 evaluated AST positions，P07 節點 L603–L612／L655–L674；它是累積 AST 覆蓋，不是每 request expression/access counter。後續 exact source 結果見 [latest P07 checkpoint](#p07-latest-source-checkpoint--2026-10-15)。
- **P07 靜態 no-cache access estimate（非 expression 數、非 Emulator 計數）：** r9 direct SetDayMenu commit closure 為 14/20 Rules access calls、max 7/write；inherited closure 為 17/20、max 6/write，含 Rules write evaluations與 read-but-unwritten `VerifyMutation` dependencies，不計 cache 抵扣。Inherited central retains actual target/head revision +1, command/time/lease guards；mandatory day leaf validates full source day/menu/vendor and exact 8-key target menu. 見 [P07 Rules budget appendix](p05-rules-budget.md#p07-dayvendor-write-budget--current-wip-not-accepted)。這些靜態 calls 不表示 Rules expression-cap positive 已通過。
- **七個 Emulator suites，依序、全數 unfiltered，無 skipped：** A01 `firestoreRules.spec.ts` 10/10；P01 proof 36/36；P04 lease 19/19；P05/P07 `cloudCommands.spec.ts` 139/140（唯一 `P07.9` cap failure）；post-commit failure 6/6；P06 student reads 11/11；P07 server reads 4/9（五項被底層 document-ID DESC query 的 `failed-precondition` 包成 `UNKNOWN_RESULT`）。合計以 file+full test name 去重 231 cases：225 passed、6 failed、0 skipped。各 suite JSON/log/exit 與 aggregate summary 在 `/tmp/p07-{a01-rules,p01-rules-proof,p04-lease-proof,p05-p07-commands,p05-postcommit,p06-student-read,p07-day-vendor-read}-unfiltered-r1.{json,log,exit}` 及 `/tmp/p07-emulator-unfiltered-r1.{log,summary,exit}`。失敗數包含同一未解 Rules positive 與 5 個 server-read query 案例。
- **True read / Emulator version blocker:** production read suite 是真 server-only SDK query，不以 mocks 代替。installed Firebase CLI 14.27.0 pins Firestore Emulator 1.19.8，JAR SHA-256 `9d43599ed6151199e8d604dc87fac51218e49e5f3a48519b1ae560bbe5e3382d`；document ID `DESC` query（含無 filter、single `<target`、雙日期界線、合併界線）會回 `Firestore does not support descending key scans`，而 ASC document ID 與普通欄位 DESC 可跑。isolated firebase-tools 15.34.0 official package pins Emulator 1.22.0、官方 metadata expected JAR SHA-256 `9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c`，但 Emulator 下載被 proxy 回 HTTP 403 (`CONNECT tunnel failed`)，無法在 1.22 runtime 驗證矩陣或 P07.9；不得宣稱新版已修復，也不改 contract 為跳過 null menu 或全量 ASC 掃描。
- **P2 與完整前端 gates:** `cloudCommandSchema.dayVendor.test.ts` 24/24 passed，含 forged `expectedRevisions.headSeq` 與重新 fingerprint 的 receipt fail-closed case。`cloudCommandRepository.failure.spec.ts` unfiltered 6/6 passed，含四 kind 的 current-holder server diagnosis（contents → `INVALID_INPUT`、stale head/day → `REVISION_CONFLICT`、closed day → `DAY_CLOSED`、non-holder → `LEASE_LOST`），另保留真 post-commit unknown receipt/recovery。完整 `npx vitest run` exit 0：147 files passed／7 skipped，1,395 passed／231 skipped（Emulator-gated suites在未啟 Emulator的一般 Vitest 下 skip，已由上述七-suite session另外 unfiltered 執行）；JSON/log/exit `/tmp/p07-vitest-r1.{json,log,exit}`。ESLint `/tmp/p07-lint-r1.log` exit 0；Vite production build `/tmp/p07-build-r1.log` exit 0（僅既有 configLoader `__dirname` warning）。App `tsc` exit 2；current/base 比對只把 diagnostic prefix 的 `(line,column)` 正規化，完整 path 與其餘內容保留；542 normalized lines byte-identical，diff empty。完整基線與當前檔 `/tmp/p07-base-app-tsc.normalized.txt`、`/tmp/p07-current-app-tsc-r2.normalized.txt`、`/tmp/p07-app-tsc-r2.normalized.diff`。
- **Browser evidence:** 新增 P07 spec 被 Playwright `testMatch` 選中，實際執行兩例時以 system Chromium 154 開頁；兩例因真 server read 未載入而顯示「伺服器結果目前無法確認」與「雲端資料未載入」，日期欄位未顯示；logs/exit `/tmp/p07-e2e-day-vendor-system-r1.{log,exit}`，DOM snapshot 在 `frontend/test-results/cloud-day-vendors-*/error-context.md`。此結果與 1.19.8 DESC query blocker 一致；它不是兩個功能端到端通過。舊 13 Cloud browser cases 13/13、prototype 7/7 通過，system Chromium 154 diagnostics JSON/log/exit `/tmp/p07-e2e-cloud-legacy-system-r1.*`、`/tmp/p07-e2e-prototype-system-r1.*`；pinned Playwright Chromium binary 未安裝，官方 `npx playwright install chromium` 下載被 cdn.playwright.dev HTTP 403 `Domain forbidden` 擋下，安裝 log `/tmp/p07-playwright-install-chromium.log`。system-browser結果不是 pinned CI proof。
- **Review findings at the 5e7362d checkpoint:** the exact prior report is preserved at [P07 review of checkpoint 43d51da](p07-review-43d51dab9a141dc76c65b5ad9c20ef78014f5c6f.md), result NOT PASS. The D02 document-path/receipt assertions were corrected in source. The navigation-unmount P2 was then addressed with the Cloud page recovery/navigation lock in the latest checkpoint. The D02 flow still cannot reach the Admin assertions because the true server-read query fails in the current Emulator. Required GitHub CI, pinned-browser E2E, fresh exact-SHA review, P07 PR, merge and production receipt remain incomplete. Work stops at P07 merge/receipt closeout; after that, wait for user direction and **do not start P08**.

## P07 r11 source checkpoint — 2026-10-15

- This pushed checkpoint is still P07 WIP. It includes the authorized Rules receipt/type fixes, Cloud navigation recovery lock, raw Rules regression cases, tracked review reports and this evidence update. P07 remains unaccepted; no PR, required CI, merge, production configuration or deployment receipt exists. P08 remains unopened.
- Rules SHA-256 is `0392052e3a1f80d51bf8344e954f294b2170511911a2c070762de024bcfb6f39`, recorded in the [P07 Rules budget](p05-rules-budget.md#p07-dayvendor-write-budget--current-wip-not-accepted). The exact-source Rules review closes the SaveVendor create receipt/status and SetOpeningCash stored-number findings at source SHA `9923a0385bfec572ae1ae7f8f6eedc0ba8c436dd`. Six SaveVendor malformed-create cases and three REST integer/double cases passed, including a legal integerValue control and atomically denied doubleValue projections. The six SaveVendor negative logs still contain max-1000 expression diagnostics: atomic denial/unchanged state plus static source predicate analysis support closure, but do not establish isolated cap-free guard proofs. REST integerValue returned HTTP 200; doubleValue `openingCash` and `revision` each returned HTTP 403 with head/day/command unchanged. See the [Rules findings closure report](p07-rules-finding-closure-9923a038.md).
- Cloud tab navigation now stays locked while either page has a pending/UNKNOWN command or is refreshing a confirmed receipt. Authorization revocation is sticky for the same UID:leaseEpoch, including when no pending command ID exists; it clears only after the identity scope changes. The D02 document-path ID and EnsureDay receipt assertions are corrected in source, but the browser flow does not reach them because true day/vendor reads fail.
- Seven unfiltered `demo-easyorder` Firestore Emulator suites ran sequentially with no skips: A01 10/10, P01 36/36, P04 lease 19/19, P05/P07 command 148/149, post-commit recovery 6/6, P06 student reads 11/11, and P07 day/vendor reads 4/9. Across the 240 unique file/test-name cases, 234 passed, 6 failed and 0 skipped. The command failure is the legal inherited-menu P07.9 positive hitting the 1,000-expression ceiling. The five read failures are server-only document-ID DESC queries rejected by Firestore Emulator 1.19.8. JSON/log/exit files use `/tmp/p07-{a01-rules,p01-rules-proof,p04-lease-proof,p05-p07-commands,p05-postcommit,p06-student-read,p07-day-vendor-read}-r11.{json,log,exit}`; the sequential summary is `/tmp/p07-emulator-sequential-r11.summary`.
- **The Rules expression-cap blocker remains unresolved.** Nine rounds of equivalent expression optimizations have not made the legal raw inherited `SetDayMenu` positive pass. Current diagnostics do not isolate one predicate or establish pure Rules infeasibility. Do not weaken complete source/vendor/before-invalid checks or required writers. The exact current run remains one cap failure, `/tmp/p07-p05-p07-commands-r11.{json,log,exit}`.
- **The true server-read blocker remains unresolved.** Firebase CLI 14.27.0 uses Firestore Emulator 1.19.8, whose document-ID DESC scan fails even without a filter. ASC scans do not satisfy the frozen contract's exact reverse-source and 2,000-scan behavior. Isolated official firebase-tools 15.34.0 metadata points to Emulator 1.22.0, but its verified official JAR download returned proxy HTTP 403; no result is claimed for 1.22.0. No emulator contract/query workaround was accepted.
- Full frontend gates on this source: `npx vitest run` exit 0, 147 files passed / 7 Emulator-only files skipped, 1,398 passed / 240 skipped / 0 failed; `npm run lint` and `npm run build` exit 0. Fresh logs/JSON/exit: `/tmp/p07-checkpoint-full-vitest-r11.{json,log,exit}`, `/tmp/p07-checkpoint-lint-r11.{log,exit}`, `/tmp/p07-checkpoint-build-r11.{log,exit}`. App TypeScript `npx tsc -p tsconfig.app.json --noEmit --pretty false` exits 2 with 290 inherited diagnostic headers; after normalizing only diagnostic `(line,column)`, all 542 lines match the saved base byte-for-byte. This check is not a clean TSC pass. The previous new `Buffer` diagnostic in the REST JWT test helper is gone after using DOM `btoa`; normalized/diff/exit are `/tmp/p07-checkpoint-app-tsc-r11.{normalized,diff,exit}`.
- System-browser diagnostics used `/usr/bin/chromium` 154 with temporary config overrides and a fresh preview build; tracked Playwright pins were not changed. The 13 legacy Cloud cases passed 13/13, and isolated prototype cases passed 7/7. Both P07 Cloud day/vendor browser cases failed: initial date/vendor loading timed out before the businessDate input appeared; D02 then failed its businessDate value assertion before reaching its corrected document-path Admin assertions. This matches the Emulator DESC blocker; it is not a P07 feature pass. JSON/log/exit: `/tmp/p07-e2e-cloud-legacy-r11.*`, `/tmp/p07-e2e-day-vendor-r11.*`, `/tmp/p07-e2e-prototype-r11.*`.
- The exact-source closure reports are now tracked: [Rules findings closure](p07-rules-finding-closure-9923a038.md) and [navigation, D02 and evidence closure](p07-review-9923a038.md). The Rules review marks both targeted findings CLOSED; the navigation review's scoped closure verdict is PASS and found no new blocker. Their scoped findings closure does not change the overall P07 NOT PASS result. Required GitHub CI, pinned Chromium install, P07 PR/merge and production receipt remain outstanding. Official browser/artifact downloads are blocked by HTTP 403 in this environment; Git fetch/push works. The current executor has the P01 stash; `/tmp/easyorder-preserved-p01-before-p05.patch` was absent, so it was not reconstructed or overwritten.
- Production Firebase keys, resources, bootstrap and deploy remain user-local. Emulator tests use only `demo-easyorder` synthetic data. Work stops after P07 closeout and receipt; do not start P08.

## P07 documentation-only review receipt — 2026-10-15

- This documentation checkpoint has parent source SHA `9923a0385bfec572ae1ae7f8f6eedc0ba8c436dd`; it records exact-source review outcomes and does not modify program files or rerun tests. See both tracked closure reports above.
- The Rules architecture review closes the two targeted findings at that exact source SHA. The navigation/D02 review also closes its scoped findings and reports no new blocker. Overall P07 remains NOT PASS: the legal inherited-menu Rules positive still hits the 1,000-expression ceiling, five document-ID DESC server-read cases still fail on Emulator 1.19.8, and both P07 browser cases still fail before the intended page assertions. No required CI, PR, merge, production configuration, or deployment receipt exists. Do not start P08.

## P07 latest source checkpoint — 2026-10-15

- Continued in a new cloud environment from `6780cfd2045eb63b4fee430821d9bf70167cf6e7` on `codex/backend-p07-day-vendors`. The previous executor's local stash and `/tmp` files are not available here; nothing on the remote branch was rewritten. Environment check: Git fetch/push and the GitHub API return 200; official Firestore Emulator JARs download (1.22.0 verified against the official SHA-256 `9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c`); Playwright CDN downloads still return HTTP 403, so local browser runs use the preinstalled Chromium 141 through a temporary config. That run is not the pinned CI browser proof.
- **Server-read blocker, root cause:** a direct probe shows document-ID DESC queries fail with `failed-precondition: Firestore does not support descending key scans` on **both** Emulator 1.19.8 (firebase-tools 14.27.0) and 1.22.0 (firebase-tools 15.34.0), with or without filters. Upgrading the Emulator does not fix it. With CheerC's approval, `readLatestEarlierMenu` now reads backward calendar-date windows in ascending document-ID order and processes each window newest-first. The window width is capped by the remaining scan budget, and a probe below each window confirms exhaustion. Ordering, the 2,000 cap, overflow, and strict decoding semantics are unchanged; see the [contract note](../superpowers/specs/2026-10-15-cloud-day-vendors-contract.md). The mocked read suite now rejects DESC document-ID queries the same way the Emulator does, and adds sparse-window and malformed-newer-row cases (23/23). The true server-read suite adds a sparse source across a 900-day gap, and the 2,000-day probe case now has a 60 s timeout for cold runners.
- **Rules expression-cap blocker, root cause and fix:** the ceiling is per document rule evaluation (see [P07 per-document ceiling](p05-rules-budget.md#p07-per-document-expression-ceiling-and-inherited-source-split--2026-10-15)). With CheerC's approval, `validDay(sourceDay)` moves from the day update rule to `headInheritedMenuSourceDay` on the mandatory dataHead write of the same commit. No check was removed. A new worst-case positive, `P07.9a` (re-inherit over an existing target menu from a reopened source with confirmed opening and nonzero totals), passes. Rules SHA-256 `e06d11add203dc253ad66d699d0592bfbb9f1511086610477f214e3df91a3fab`; static inherited closure 18/20, max 6/10 per write.
- **Browser blocker, root cause and fix:** D02 failed because of the Rules cap above. It also had a loose `getByText` locator that matched both the saved menu and the earlier-source line (now `exact`). Separately, the P07 suite's `afterEach` left an isolated dataHead (`goLiveDate` yesterday), which broke P06 D01 when the whole Cloud suite ran in order. It now restores the global-setup empty head.
- **Exact-source gates in this environment:**
  - Seven sequential unfiltered `demo-easyorder` Emulator suites with no skips: A01 10/10, P01 36/36, P04 19/19, P05/P07 commands 156/156, post-commit 6/6, P06 student reads 11/11, P07 day/vendor reads 10/10 — 248 passed, 0 failed, 0 skipped. The 156 include six `P07.9b` negatives added after review.
  - Full `npx vitest run`: exit 0, 147 files passed / 7 Emulator-only skipped, 1,400 passed / 242 skipped / 0 failed.
  - `npm run lint` and `npm run build`: exit 0.
  - Root `npx tsc --noEmit`: exit 0.
  - App `tsc -p tsconfig.app.json`: exit 2 with 290 diagnostic headers / 542 lines. After normalizing `(line,column)`, it is byte-identical to `b518eca`, so this is not a clean TSC pass.
  - Chromium 141 diagnostic E2E: Cloud 15/15 (auth, P06, both P07 cases) and prototype 7/7.
  - Raw logs stayed in this session's scratch directory and are not tracked.
- **Review follow-up (PR #480):** the reviewer showed that the relocated `headInheritedMenuSourceDay` check had no negative test. Six `P07.9b` cases now cover it. Each seeds a source day with a legal menu plus one defect: an extra top-level field, incomplete totals, `openingCash` without opener, a menu `businessDate` that is not the source day, an invalid status, or an extra menu key. On the current Rules all six deny atomically with head, target day and receipt unchanged. On a mutant where the check returns `true`, all six commits succeed, so the suite now catches removal of the check.
- Still outstanding: required GitHub CI on the pushed head, an independent exact-SHA review, the PR and merge receipt. No production configuration or deploy. Do not start P08.

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

## P08 雲端訂餐 merge receipt — 2026-10-16

- PR [#491](https://github.com/cheerc/talented-easyorder/pull/491)（取代 #490）：base `5ff889a8c7dc9a411383c8f1a37e23f243e0ce8d`；source head `452edd5abce63f1eda329d90dcae245984104721`；squash merge SHA `889c75c`（2026-10-16）。獨立複審 PASS（review `5545234938`）；required CI [38875033302](https://github.com/cheerc/talented-easyorder/actions/runs/38875033302) build-and-test 與 e2e 均成功，其中 P08 Emulator 步驟 10/10。
- 後續注意（不阻擋）：正式部署 Rules 時要一併 `firebase deploy --only firestore:indexes`（新複合索引），否則交易清單讀取會 fail closed，由 CheerC 本機處理；`reconcileDayTotals` 目前要求 `cashierIncome`／`cashierExpense` 為 0，P09 開放櫃台收支時要同步調整。

### 合併前 checkpoint

- 起點：PR #490 head `bca7d048f9743be0b2026938a3f3831ccafdf624`（已含 `origin/main` `5ff889a8c7dc9a411383c8f1a37e23f243e0ce8d`）。審查列出 B1–B8 必修；修正版在分支 `claude/backend-p08-ps4e3x` 以新 PR 取代 #490。最終 head SHA 與 CI run 以該 PR body 為準。
- Rules 變更只有 `transactions` 的 `allow get, list: if currentHolder();`（`update, delete` 仍拒絕）；寫入 Rules、`days` 規則與 p05 存取次數盤點未改。新增複合索引 `transactions (businessDate, createdAt, __name__)`。
- RED：新 `cloudOrderRepository.spec.ts` 在 main 的 Rules 上 10/10 失敗。GREEN：同一 spec 在修正版 Rules 上 10/10 通過。
- demo-easyorder Emulator 全序列 281/281、0 skipped：firestoreRules 10、cloudRulesProof 36、activeAccountLease 19、cloudCommands 178、failure 6、students 12、dayVendor 10、orders 10。
- Vitest 1,573 passed／281 Emulator-only skipped／0 failed；`npm run lint`、`npm run build` exit 0；app tsc 208 個 `error TS` 診斷，與 base 相同。
- E2E：Cloud 16＋prototype 7 通過，使用本機 Chromium 1194（pinned headless shell 不在本環境），不取代 CI。
- 無 production 部署、無正式金鑰；SDK `persistentLocalCache` 仍屬 P13。

### TypeScript 診斷基線

- P00 的 `75e7a96` 歷史 baseline 為 exit 2、279 diagnostics；P04 base 另以 `npx --no-install tsc -p tsconfig.app.json --noEmit` 擷取為 exit 2、295 diagnostics，原始輸出在目前執行環境 `/tmp/easyorder-p04-base-tsc.raw.txt`。
- 279 與 295 是不同 base 的不同觀察。原始報告稱 P04 base/head 都是 295，不能由相同數量推論逐筆 diagnostics 完全相同或零新增。本輪最終有 295→290 的逐筆 multiline normalized 比較、0 新增／5 項舊錯移除；後續 code/merge candidate 若再變動，仍需重新比對並以當前 PR body 記錄。

### 更新規則

新 RED/GREEN、Emulator/E2E 數量、lint/build、TypeScript diagnostic diff、CI run、review 與 merge 結果只在實際執行並確認後追加；PR head／base 與完整 receipt 以該 PR body 為版本權威。本節中 P05 #476 merge 狀態已於 2026-10-14 核實；未來尚未發生的 merge／未驗證 SHA 不預錄。

## P09a 雲端繳費與櫃台收支 checkpoint — 2026-10-16

- 依 CheerC 2026-10-16 指示推進 P09。branch `claude/project-thread-uaazo9`，base `fc7943970a5ceb86d841eeca8be6a75d3ba75dec`；PR、head SHA 與 CI 以 PR body 為準。契約：[P09a contract](../superpowers/specs/2026-10-16-cloud-payments-cash-contract.md)。
- Rules：新增 `CreateCashMovement` 的指令、day 與 transaction 分支（都放在各 `||` 鏈最後）；`CreatePayment` Rules 未改。存取次數 15/20、單寫最多 8；探測餘裕見 [P09a 預算附錄](p05-rules-budget.md#p09a-cloud-payments-and-counter-cash-movement--budget-and-probe-receipt)。
- RED：新 `cloudCashMovement.spec.ts`（37 項）在 main 的 Rules 上 7 項失敗。GREEN：同一 spec 37/37 通過。逐項負例都做過移除對應檢查的 mutant 確認。
- demo-easyorder Emulator 一次跑完 `src/firebase/__tests__` 與 `src/rules` 全部 20 個檔案（所有 `EASYORDER_REQUIRE_*` 旗標開啟）：395/395、0 skipped。
- Vitest 1,594 passed／317 Emulator-only skipped／0 failed；`npx tsc --noEmit`、`npm run lint`、`npm run build` exit 0；app tsc 208 個 `error TS` 診斷，與 base 相同。
- Cloud E2E 14/14（auth、P07 日期供應商、P04、P06、P08 D03、新 P09a D04：繳費 200、收入 50、支出 80，reload 後應有現金與伺服器文件一致），使用本機 Chromium 1194，不取代 CI pinned Chromium。
- 無 production 部署、無正式金鑰。

## P09b 帳戶退款 checkpoint — 2026-10-16

- P09a 已合併（#493，squash `c444621`）。P09b branch `claude/project-thread-uaazo9`，base `c444621`；PR、head SHA 與 CI 以 PR body 為準。契約：[P09b contract](../superpowers/specs/2026-10-16-cloud-refund-contract.md)。
- Rules：新增 `CreateRefund` 的指令、day、student 與 transaction 分支（都放在各 `||` 鏈最後）；`day.totals` 加 `accountRefunds`（7→8 欄）。`validDayAdvance` 的不變欄位改成一次 map 比較來補回 day 規則餘裕。存取次數 19/20、單寫最多 10；探測餘裕與 mutant 結果見 [P09b 預算附錄](p05-rules-budget.md#p09b-account-refund--budget-and-probe-receipt)。
- RED：新 `cloudRefund.spec.ts`（43 項）在 main 的 Rules 上 8 項失敗。GREEN：43/43 通過。`cloudCashMovement.spec.ts` P09.9 依 P09a 審查補上交易文件多欄、少欄、改固定欄位與連帶改動 `accountRefunds` 的拒絕案例。
- demo-easyorder Emulator 一次跑完 `src/firebase/__tests__` 全部 21 個 Emulator 檔案（所有 `EASYORDER_REQUIRE_*` 旗標開啟，含新 `EASYORDER_REQUIRE_CLOUD_REFUND`）：444/444、0 skipped。
- Vitest 1,602 passed／365 Emulator-only skipped／0 failed；`npm run lint`、`npm run build` exit 0；app tsc 208 個 `error TS` 診斷，與 base 相同。畫面測試新增退款流程、退款與櫃台收支的結果不明同 commandId 重試。
- Cloud E2E 18/18（新 D05：學生期初 150、W 面板退款 100，應有現金只扣一次，reload 後與伺服器文件一致），使用本機 Chromium 1194，不取代 CI pinned Chromium。
- 無 production 部署、無正式金鑰。正式部署 Rules 時，既有 7 欄日統計的營業日會被拒；目前沒有正式資料。
- 合併收據：PR #494 source head `f82a5afed689d0b793fcc8c45e2d52fe24cc60c5`，CI [38905988081](https://github.com/cheerc/talented-easyorder/actions/runs/38905988081)（build-and-test、e2e）成功，獨立審查 PASS（無必修項；審查者重跑 Vitest 1,601 passed／366 skipped、`cloudRefund.spec.ts` 43/43），squash merge `5b6f9a495244c2a800a64ce0677bb1645b33f0a6`。P09 完成，P10 未開始。

## P10a 交易更正、作廢、取消與 5 秒撤回 checkpoint — 2026-10-16

- P09b 已合併（#494，squash `5b6f9a4`）；收據 #495（`e01ebdff5e784522b15a6f16278ef303a9c63110`）。P10a branch `claude/project-thread-iq5n8l`，base `e01ebdff5e784522b15a6f16278ef303a9c63110`；PR、head SHA 與 CI 以 PR body 為準。契約：[P10a contract](../superpowers/specs/2026-10-16-cloud-transaction-mutations-contract.md)。
- Rules：
  - 新增 5 種修改的指令分支，營業日、學生與交易的投影分支都放在各 `||` 鏈最後；`transactions` 新增只透過命令的 `allow update`，`allow delete: if false`。
  - 指令建立改由 `validCommandCreate` 分派（`kind` 只讀一次），並省去已由既有不變量保證的檢查；新指令分支餘裕由 +1 回到 +19，既有 kind 的指令規則餘裕也增加 4–5。
  - 存取次數 19/20、單寫最多 10。見 [P10a 預算附錄](p05-rules-budget.md#p10a-transaction-mutations--budget-and-probe-receipt)。
- RED：新 `cloudTransactionMutation.spec.ts`（47 項）在 main 的 Rules 上 21 項失敗。GREEN：47/47。mutant 18 個：13 個被殺；4 個是由其他規則保證的重複檢查；1 個（櫃台收支方向）在拒絕路徑碰到運算上限，無法單獨證明。見預算附錄。
- demo-easyorder Emulator 一次跑完 `src/firebase/__tests__` 全部 22 個 Emulator 檔案（所有 `EASYORDER_REQUIRE_*` 旗標開啟，含新 `EASYORDER_REQUIRE_CLOUD_MUTATIONS`）：491/491、0 skipped。
- Vitest 1,634 passed／411 Emulator-only skipped／0 failed；`npm run lint`、`npm run build`、`npx tsc --noEmit` exit 0；app tsc 208 個 `error TS` 診斷，與 base 相同，觸及的檔案沒有診斷。
- 畫面測試新增 8 項（撤回、5 秒消失、更正預覽、取消退款／留款、作廢列、櫃台收支更正、退款更正負餘額、版本衝突）；單元測試 `cloudTransactionMutation.test.ts` 25 項。
- Cloud E2E 19/19（新 D06：繳費 200 在 5 秒內撤回；其他餐點 80／實收 100 更正為 70，再取消並退款；reload 後兩筆都是已作廢，命令保留前值與理由），使用本機 Chromium 1194，不取代 CI pinned Chromium。
- 無 production 部署、無正式金鑰。
- 審查後合併 main `b33fc6b3015d277664a47dba86d8ccde5cf4ed44`（P14 #496、#498）：`validCommandCreate` 加入 `RecordBackup`（已啟用 19、拒絕 5）；備份 decoder／replay 接受 5 種 P10a kind，`cloudBackup.spec.ts` 新增真實 P10a 命令的匯出→解密→replay 案例（17/17）。合併後重量：指令規則 P10.17／P10.12／P09b.9 仍 +19；`CreateStudent` 指令規則只有 +3（main 上就是 +2～+3，不是 P10a 造成）。驗證數字以 PR body 為準。
- **合併**：PR #497 squash `1d61a475109c6642c20c56cbb9ae8e9180491e46`（2026-10-16），source head `4cd2286c84643cad97200cff9e4d1642883f03fb`。獨立複審 review `5551115175` 通過；CI run 38935317478 build-and-test 與 e2e 成功。複審本機重跑：`cloudTransactionMutation.spec.ts` 47/47、`cloudBackup.spec.ts` 17/17、Vitest 1,636 passed／430 skipped。

## P10b 期初更正 checkpoint — 2026-10-17

- P10a 已合併（#497，squash `1d61a47`）；收據 #499（`95b7695`）。P10b branch `claude/project-thread-iq5n8l`，base `a694b321b17cc0c5c6c80c23ff1ff8d9da41976e`（另含 CLAUDE.md 指引 #500）；PR、head SHA 與 CI 以 PR body 為準。契約：[P10b contract](../superpowers/specs/2026-10-17-cloud-opening-correction-contract.md)。
- Rules：
  - 新增 `CorrectOpening` 指令分支（`validCommandCreate` 最後）與學生投影分支；營業日改用獨立的 `allow update`（`dayOpeningCorrectionCommand`），訂餐的營業日餘裕維持 +11（與 main 相同）。
  - 學生 update 欄位白名單加入 `openingBalance`；只有 `CorrectOpening` 分支能改期初。
  - 存取次數 15/20、單寫最多 8。見 [P10b 預算附錄](p05-rules-budget.md#p10b-opening-correction--budget-and-probe-receipt)。
- RED：新 `cloudOpeningCorrection.spec.ts`（42 項）在 main 的 Rules 上 8 項失敗（所有正向路徑）。GREEN：42/42。mutant 21 個：16 個被殺；5 個是由其他規則保證的重複檢查。見預算附錄。
- demo-easyorder Emulator 一次跑完 `src/firebase/__tests__` 全部 24 個 Emulator 檔案（所有 `EASYORDER_REQUIRE_*` 旗標開啟，含新 `EASYORDER_REQUIRE_CLOUD_OPENING`）：551/551、0 skipped（在補上第二輪 mutant 的 3 個案例前；P10b 檔案之後單獨重跑 42/42）。
- Vitest 1,652 passed／469 Emulator-only skipped／0 failed；`npm run lint`、`npm run build`、`npx tsc --noEmit` exit 0；app tsc 208 個 `error TS` 診斷，與 base 相同。
- 備份：`cloudBackup.spec.ts` 新增真實 `CorrectOpening` 命令的匯出→解密→replay 案例，竄改餘額的收據被拒（18/18）。
- 畫面測試新增 2 項（更正金額與備註、原因必填與預覽；缺營業日先建立、已關帳不出表單）；schema 單元測試新增 13 項。
- Cloud E2E 20/20（新 D07：學生 009 期初 100；期初日沒有營業日時先建立；更正為 70 須填原因，預覽 NT$ 100 → NT$ 70；營業日統計與開帳現金不變；命令保留原期初與理由；重新登入後仍是 70），使用本機 Chromium，不取代 CI pinned Chromium。
- 無 production 部署、無正式金鑰。
- **合併**：PR #501 squash `a92d1390c79900688bb36e0e1e6df910bce5b670`（2026-10-17），source head `b6b8cf4460ea23e16872bb0626c6ce28c3512d2c`。獨立審查 review `5555660163` 通過；CI run 38995746934 build-and-test 與 e2e 成功。審查本機重跑：`cloudOpeningCorrection.spec.ts`＋`cloudBackup.spec.ts` 60/60、`CloudStudentsPage.test.tsx`＋`cloudCommandSchema.student.test.ts` 67/67。不擋合併：F3 補建的過去日期營業日在 P11 啟用關帳時需決定處理方式。P10 完成，P11 未開始。

## P11a 正式關帳與重開（後端）checkpoint — 2026-10-17

- CheerC 於 2026-10-17 指示續作 P11。branch `claude/project-thread-7m93at`，base `32e90c6b7347f6c299036df5fe521cf07bc27cac`（P10b 收據 #502）；PR、head SHA 與 CI 以 PR body 為準。契約：[P11 contract](../superpowers/specs/2026-10-17-cloud-day-close-contract.md)。P11 拆成 P11a（本 checkpoint：Rules、寫入器、讀取、備份）與 P11b（雲端日結頁、P14 備份區塊、E2E）。
- Rules：
  - 新增 `CloseDay`／`ReopenDay` 指令檢查，巢狀放在 `validCommandCreate` 最後一個 operand 裡（與 `CorrectOpening` 共用），既有 kind 的餘裕不變；營業日用獨立的 `allow update`（`dayCloseCommand`）；日結版本 `days/{dayId}/settlements/{n}` 有自己的 `match`，只能由命令建立，不能改、刪。
  - 應有現金由 Rules 依 §7.1 從營業日 totals 算出；差額須填原因；重開須有原因。
  - 存取次數 14/20、單寫最多 8。新錨點最小餘裕 +53（指令）；既有最緊的錨點與 main 相同（訂餐營業日 +11、更正與退款指令 +19、`CreateStudent` +3）。見 [P11 預算附錄](p05-rules-budget.md#p11-day-close--budget-and-probe-receipt)。
- RED：新 `cloudDayClose.spec.ts`（48 項）在 main 的 Rules 上 16 項失敗（所有正向路徑）。GREEN：48/48。mutant 26 個：第一輪 9 個存活，其中 3 個補上攻擊案例後被殺，6 個是由其他規則保證的重複檢查。
- demo-easyorder Auth＋Firestore Emulator 一次循序跑完整個 Vitest（`--maxWorkers=1`，所有 `EASYORDER_REQUIRE_*` 旗標開啟，含新 `EASYORDER_REQUIRE_CLOUD_DAY_CLOSE`）：179 個檔案、2,178/2,178、0 skipped。前一輪（分派仍用三元運算時）出現過 `CloudStudentsPage.test.tsx` 一次時序失敗，單獨重跑 3 次都通過；該檔案本 PR 沒有改。
- 無 Emulator 的一般 Vitest：1,657 passed／521 Emulator-only skipped／0 failed；`npm run lint`、`npm run build`、`npx tsc --noEmit` exit 0；app tsc（`tsc -p tsconfig.app.json`）208 個 `error TS` 診斷，與 base 逐行相同。
- 備份：`npm run test:cloud-backup` 19/19。新案例以真實 close → 第一段匯出 → reopen → 作廢 → re-close → 第二段增量匯出 → 解密 → replay，版本 1／2／3 與 totals 相符；竄改差額、前一版快照或缺少前包版本都被拒。
- schema 單元測試新增 5 項（§7.1 算式、差額需原因、負數與小數、版號綁定、重開原因）。
- 沒有畫面、沒有 E2E（P11b）。無 production 部署、無正式金鑰。
- **合併**：PR #503 squash `91b5909d960ba14cb6e448dad3d3c99292fba6f7`（2026-10-17），source head `ad701ef1b86368bf2b934e504292f9540f190563`。獨立審查 review `5557244382` 通過、無必修；審查本機重跑 `cloudDayClose.spec.ts`＋`cloudBackup.spec.ts`＋`cloudCommandSchema.dayClose.test.ts` 72/72。CI run 39020987035 build-and-test 與 e2e 成功。不擋合併：已關帳日的 P10a 更正類只實測 `VoidTransaction`（P11b 補測）；差額說明／重開原因純空白會過 Rules（畫面 trim）；期初日關帳後要先重開才能更正期初。P11b 進行中。

## P11b 雲端日結頁 checkpoint — 2026-10-17

- base 為 P11a 收據合併後的 main；PR、head SHA 與 CI 以 PR body 為準。契約第 9 節：[P11 contract](../superpowers/specs/2026-10-17-cloud-day-close-contract.md#9-p11b-雲端日結頁)。沒有改 Rules，Rules 餘裕不變。
- 新增：雲端「日結」頁與導覽、`readCloudDayCloseOverview`（未關帳清單，超過 200 天或讀取期間 head 變動 fail closed）、P14 備份區塊掛在日結頁。已關帳日的菜單／開帳與期初更正提示改指向日結頁。
- 審查備註處理：已關帳日 P10a 四種更正類（`CorrectTransaction`、`CancelKeepDeposit`、`CancelRefund`、`Undo`）以寫入器實測都回 `DAY_CLOSED`（`P11.6`，原有的作廢、建立、退款、櫃台收支、菜單、開帳、期初更正也改成斷言 `DAY_CLOSED`）；說明與重開原因送出前 trim，純空白不送。
- demo-easyorder Auth＋Firestore Emulator 循序完整 Vitest（所有 `EASYORDER_REQUIRE_*`）：180 個檔案，2,013 passed，`cloudCommands.spec.ts` 的 `beforeAll` 在冷啟時逾時（10 秒）而跳過 177 項；該檔單獨重跑 177/177。合計 2,190/2,190。這個 `beforeAll` 逾時是既有現象（P10a 收據已記錄），本 PR 沒有改該檔。
- `cloudDayClose.spec.ts` 49/49（新增 `P11.13`）；`CloudDayClosePage.test.tsx` 11/11；`src/components/cloud` 全部 89/89。
- `npm run lint`、`npm run build`、`npx tsc --noEmit` exit 0；app tsc 208 個 `error TS` 診斷，與 base 逐行相同。
- Cloud E2E（本機 Chromium 1194，不取代 CI pinned Chromium）：21 項中 20 過；新 D08 通過（關帳少 10 元需原因 → 櫃台不能入帳 → 重開需原因 → 相同金額再關帳成第 3 版 → 重新登入仍在）。A08（P04 同帳號雙頁租約心跳）整套跑時失敗一次，單獨重跑通過；本 PR 沒有改租約程式。
- 無 production 部署、無正式金鑰。
- **合併**：PR #505 squash `5a030caec2345b7d322a4f32a12f05bf014fc1d2`（2026-10-17），source head `77d272add0780184815c0a72b47df548d6deeb13`，base `d46287dee3a001c4d854c3a6e6a8e574b9aa8b85`。CI 第一次（run 39023652853）`CloudDayClosePage.test.tsx` 有一項導覽狀態回報的時序失敗，`77d272a` 改用 `waitFor` 等待 effect 回報、斷言內容不變。獨立審查 review `5557388299` 通過、無必修；審查本機重跑 `cloudDayClose.spec.ts`＋`cloudBackup.spec.ts` 68/68、`src/components/cloud` 89/89、lint／build exit 0。CI run [39024055068](https://github.com/cheerc/talented-easyorder/actions/runs/39024055068) build-and-test 與 e2e 成功。不擋合併的備註：過去某天有交易但全部作廢時 `activeTransactionCount` 回到 0，也會標成「無營業，不需關帳」（帳務已回沖、不影響金額，只是用語不完全準確，若 CheerC 改選「允許補開帳」再一併處理）；「今天」取自租約 `updatedAt`（心跳），跨午夜而心跳未更新時會短暫顯示前一天（與日期與供應商頁相同的既有設計）；未關帳查詢上限 200 天也算入未來預排日；「以相同命令編號重試」按鈕靠 `actionError` 含「尚未找到」判斷（與既有頁面同模式），改文案時要一併改。P11 完成。

## P11 補開帳（`BackfillOpeningCash`）checkpoint — 2026-10-17

- CheerC 2026-10-17：「避免網路問題造成一整天無法使用，應該要可以補開帳再關帳」。base `71ee1bc887c1ce03b5fa2250280963f336ccc874`（P11b 收據 #506）；PR、head SHA 與 CI 以 PR body 為準。契約 §10：[P11 contract](../superpowers/specs/2026-10-17-cloud-day-close-contract.md#10-補開帳backfillopeningcash)。
- 新 kind `BackfillOpeningCash`（25 種，已啟用 23 種）。只限早於台北今天、不早於上線日、未關帳、沒有開帳現金的既有營業日；原因必填；不放寬 `SetOpeningCash` 與交易 Rules，不補登交易。
- Rules 餘裕：既有錨點全部與 main 相同（訂餐營業日 +11、更正與退款指令 +19、`CreateStudent` +3）；補開帳指令 +70、dataHead +95、營業日 +96。突變 15 個：每項單獨的檢查拿掉都被殺；只有兩組在指令與營業日規則重複的檢查（狀態、開帳欄位為 null）單邊拿掉存活，兩邊同時拿掉被殺。見 [補開帳預算附錄](p05-rules-budget.md#p11-backfill-opening--budget-and-probe-receipt)。
- demo-easyorder Auth＋Firestore Emulator 循序完整 Vitest（所有 `EASYORDER_REQUIRE_*`）：180 個檔案，2,044 passed；`cloudCommands.spec.ts` 的 `beforeAll` 冷啟逾時（10 秒，既有現象）跳過 178 項，同一個 Emulator 暖機後單檔重跑 178/178。合計 2,222/2,222。
- `cloudDayClose.spec.ts` 76/76（新增 `P11.14`–`P11.19` 共 27 項）；`cloudBackup.spec.ts` 20/20（新增補開帳 round-trip 與 3 種偽造）；`CloudDayClosePage.test.tsx` 13/13；`cloudCommandSchema.dayClose.test.ts` 6/6。一般 Vitest 1,671 passed／551 skipped（Emulator-only，已由上方循序全套執行）。
- `npm run lint`、`npm run build` exit 0；app tsc 208 個 `error TS` 診斷，與 base 相同。
- Cloud E2E（本機 Chromium 1194 暫時設定，不取代 CI pinned Chromium，設定未提交）：21/21。沒有新增 E2E：E2E 上線日是當天，沒有可補開帳的過去營業日。
- 無 production 部署、無正式金鑰。
- **合併**：PR #507 squash `2792ba2606c89d54818457136aabfbe7fc1ef913`（2026-10-17），source head `dffed1c22f3af558723864ae1f7f82d4adf3271a`，base `71ee1bc887c1ce03b5fa2250280963f336ccc874`。獨立審查 review `5557963146` 通過、無必修；審查本機重跑 lint 通過、一般 Vitest 166 檔通過／14 檔 skip（Emulator-only）、`cloudDayClose.spec.ts` 76/76、`test:cloud-backup` 20/20、`cloudCommands.spec.ts` 178/178（`beforeAll` 冷啟逾時與備份 P10a case 合併跑時 5 秒逾時各一次，單獨重跑通過）。CI run [39030734055](https://github.com/cheerc/talented-easyorder/actions/runs/39030734055) build-and-test 與 e2e 成功。不擋合併的備註：網路斷一整天時伺服器上可能根本沒有那天的營業日，目前不提供補開帳（Rules 的 `EnsureDay` 其實允許建立過去日期，要不要讓日結頁先建立再補開帳，與「是否補登交易」一起由 CheerC 決定）；補開帳只補現金，斷線當天沒送上去的交易不會算進應有現金；正式部署 Rules 要和前端一起上，舊版前端遇到 `BackfillOpeningCash` 會 fail closed。

## P11c1 帳務異常與警示 checkpoint — 2026-10-17

- CheerC 2026-10-17 規劃 P11c（帳務斷層與異常處理），本批只做 P11c1：唯讀異常計算、警示與開帳差額原因。base `8cd8dc35578144f620475fd930eccb2862b85cc4`（補開帳收據 #508）；PR、head SHA 與 CI 以 PR body 為準。契約 §11：[P11 contract](../superpowers/specs/2026-10-17-cloud-day-close-contract.md#11-p11c1-帳務異常與開帳差額原因)。
- 兩種異常：`opening-mismatch`（開帳現金不等於前一已關帳日的點算現金）與 `unclosed-past-day`（過去未關帳）。伺服器讀取依文件編號遞增、不新增索引；超過 400 天回 `INCOMPLETE_SNAPSHOT`、前後 head 不同回 `STALE_SNAPSHOT`，一律 fail closed。導覽「帳務異常（n）」、異常頁、開帳區與日結頁警示、開帳表單差額原因（必填）。
- Rules 只改 `validSetOpeningCash`：`SetOpeningCash` payload 可帶選填 `reason`（1–500 字）並與指令 `reason` 綁定；改用 `cashCommandEnvelope`（`p07CommandEnvelope` 不動）。「有差額必須填原因」由畫面與寫入器強制，Rules 不知道前一已關帳日。舊前端不帶原因的 `SetOpeningCash` 仍合法。
- Rules 餘裕：既有錨點全部不低於 main（訂餐營業日 +11、更正與退款指令 +19、`CreateStudent` +3）；一般 `SetOpeningCash` 指令 +68→+70；帶最長原因 +62。突變 5 個全部被殺。見 [P11c1 預算附錄](p05-rules-budget.md#p11c1--setopeningcash-optional-reason--budget-and-probe-receipt)。
- demo-easyorder Auth＋Firestore Emulator 循序 `src/firebase/__tests__`（所有 `EASYORDER_REQUIRE_*`）：26 檔 659/659。`cloudDayClose.spec.ts` 96/96（新增 `P11c1.1`–`P11c1.12`）；`test:cloud-backup` 21/21（新增偽造原因 round-trip）。
- 一般 Vitest（Emulator-only 測試 skip）：170 檔通過／14 檔 skip，1,733 passed／572 skipped。`npm run lint`、`npm run build` exit 0；app tsc 208 個 `error TS` 診斷，與 base 相同。
- E2E（本機 Chromium 1194 暫時設定，不取代 CI pinned Chromium，設定未提交）：cloud 21/21、prototype 7/7。**沒有新增 E2E**：E2E 上線日是當天，沒有過去營業日可產生異常；以 Emulator、備份與畫面測試涵蓋。
- 未做：P11c2–c4 修復工具；異常頁尚未顯示 `SetOpeningCash` 差額原因（等修復工具一併）。
- 無 production 部署、無正式金鑰。
- **合併**：PR #509 squash `fb2fc11a7f6271ded1495d27af6a1e99300ebb12`（2026-10-17），source head `a16afa4a4fd6dbc1327a1b8e60dc8430a96e190a`，base `8cd8dc35578144f620475fd930eccb2862b85cc4`。獨立審查 review `5558759097` 通過、無必修；審查本機重跑 `cloudDayClose.spec.ts` 全檔 98/98（96 個原有案例，2 個暫時探測案例未提交）、突變複測（拿掉 `command.reason == command.payload.reason` 與改弱 `validMutationReason` 都被殺）、Rules 餘裕複測（`P08.8` +11、`P10.17` +19、`CreateStudent` +3、`P11c1.8` command +62／dayWrite +80，與預算附錄一致）。CI run [39047364483](https://github.com/cheerc/talented-easyorder/actions/runs/39047364483) build-and-test 與 e2e 成功。
- 不擋合併的備註（已記入 handoff 為 P11c2 待辦）：400 天掃描上限會在營業日文件超過 400 份後擋住開帳，P11c2 第一項改為只找上一個已關帳日；每次開帳約讀三輪營業日、寫入器不共用快取；STALE 只有 mock 測試，P11c2 補 Emulator 案例；純空白原因通過 Rules（契約 §11.4 已寫明）；handoff 完整 head SHA 補在本收據。

## P11c2a 解除 400 天上限、回填斷層日 checkpoint — 2026-10-18

- CheerC 2026-10-17 規劃 P11c2，本批只做 P11c2a（後端）。base `f7cfc452971c05303d8cf60963cb6aec3b33c6c6`（#510 合併後 main）；PR 與 head SHA 以 PR body 與 handoff 為準。契約 §12：[P11 contract](../superpowers/specs/2026-10-17-cloud-day-close-contract.md#12-p11c2a-回填斷層日startbackfill)。
- 400 天上限：異常掃描改每頁 200 筆、`startAfter`、每頁之後比對 head，讀取次數約等於營業日數；開帳表單與 `SetOpeningCash` 寫入器共用 `findPreviousClosed`（每次 31 天往回找上一個已關帳日）。Emulator `P11c2a.1`–`.3`：451 份營業日分三頁讀完且晚找到的異常照報、400 天前的已關帳日仍找得到、讀取中真實寫入使 head 變動回 `STALE_SNAPSHOT`。
- 回填：`StartBackfill`（第 26 種、已啟用 24 種）寫 `system/dataHead`、`commands/{id}`、不可改的 `backfillDays/{dayId}`；營業日文件不動。`CreateOrder`／`CreatePayment`／`CreateCashMovement` 在「有標記且 `lastSettlementRevision == 0`」的過去日合法；`CreateRefund`／`Undo`／`CancelRefund` 不開放；交易不加欄位。P14 decoder／replay 接受並驗證標記與回填交易。
- Rules 餘裕（main `fb2fc11` 與本 PR 同案例）：既有錨點 `P08.8` 營業日 +11→+11、指令 +20→+20、交易建立 +34→+43（移除重複日期檢查）、`P07.8` +19→+19、`P09.8` 指令 +30→+29、`P09b.9` +19→+19、`P10.17` +19→+19、`CreateStudent` +3→+3；新路徑最緊為回填訂餐交易建立 +16（移除重複檢查前 +2）。突變 6/6 殺死。見 [P11c2a 預算附錄](p05-rules-budget.md#p11c2a-gap-day-backfill--budget-and-probe-receipt)。
- demo-easyorder Auth＋Firestore Emulator 循序 `src/firebase/__tests__` 全部 `*.spec.ts`（所有 `EASYORDER_REQUIRE_*`）：14 檔 609/609、0 skipped。`cloudDayClose.spec.ts` 131 項（`P11c2a.*` 36 項）；`test:cloud-backup` 22/22（新增真實 EnsureDay → 補開帳 → 開始回填 → 回填訂餐／繳費／收支 → 關帳 → 匯出 → 解密 → replay，偽造標記、標記前的交易、竄改原因被拒）。
- 一般 Vitest（Emulator-only 測試 skip）：171 檔通過／14 檔 skip，1,769 passed／609 skipped。`npm run lint`、`npm run build` exit 0；app tsc 與 main 逐行相同（行號不計）。畫面測試 `CloudDayVendorsPage.test.tsx` 多處改為 `waitFor`，原因是上一個已關帳日改為非同步查找，時序不穩（連跑 10 次穩定）。
- E2E（本機 Chromium 1194 暫時設定，不取代 CI pinned Chromium，設定未提交）：cloud 21/21、prototype 7/7。**沒有新增 E2E**：E2E 上線日是當天，沒有過去營業日可回填。
- 未做：P11c2b 回填模式畫面、P11c3、P11c4、角色權限。無 production 部署、無正式金鑰。
- 合併收據：#511 squash `35ac95bd3f4f98a378fd01803f6c3a6beafae794`；獨立審查 review `5561303976` 無必修，審查者在 Emulator 另跑受影響 suite（`cloudDayClose` 133/133 含 2 個未提交的探測案例、`cloudCommands` 179/179、`cloudTransactionMutation` 47/47、`cloudCashMovement` 42/42、`cloudOrderRepository` 10/10、`cloudRefund` 43/43、`cloudBackup` 22/22、`cloudDayVendorRepository` 10/10），Rules 餘裕複測與預算附錄一致（回填訂餐交易建立 +16）。最終 head `f857b10bc10be92976dc7904a5b31d1aeca12f47` 的 CI [39094019150](https://github.com/cheerc/talented-easyorder/actions/runs/39094019150) build-and-test 與 e2e 成功。審查後續待辦（P11c2b）：開帳表單查上一個已關帳日失敗後的重試按鈕、`isBackfilled` 台北午夜（UTC 16:00:00）邊界測試。未部署。

## P11c2b 回填模式畫面 checkpoint — 2026-10-18

- 範圍：只改前端與讀取端；Rules 與 `firestore.indexes.json` 都沒改，所以 P11c2a 的 Rules 餘裕（回填訂餐交易建立 +16 最緊）不變。契約 §13：[P11 contract](../superpowers/specs/2026-10-17-cloud-day-close-contract.md#13-p11c2b-回填模式畫面)。base `35ac95bd3f4f98a378fd01803f6c3a6beafae794`；PR 與 head SHA 以 PR body 與 handoff 為準。
- demo-easyorder Auth＋Firestore Emulator 循序 `src/firebase/__tests__` 全部 `*.spec.ts`（所有 `EASYORDER_REQUIRE_*`）：14 檔 615/615、0 skipped（P11c2a 為 609）。新增 `cloudDayClose.spec.ts` `P11c2b.1`（repository 三步與回填中清單）、`cloudOrderRepository.spec.ts` `P11c2b.R1`–`R3`（有標記的過去日可載入、無標記／上線日前／未來日 `INVALID_INPUT`、非持有人 `LEASE_LOST`）；`P11c1.1` 的異常物件帶 `gapDays`／`gapDayCount`；`P11c2a.7` 依新行為改為 `DAY_CLOSED` 並檢查訊息。
- 一般 Vitest：171 檔通過／14 檔 skip，1,798 passed／615 skipped（P11c2a 為 1,769／609）。`npm run lint`、`npm run build` exit 0；app tsc 與 main 診斷逐行相同（行號不計）。
- E2E（本機 Chromium 1194 暫時設定，不取代 CI pinned Chromium，設定已刪未提交）：cloud 22/22、prototype 7/7。新增 `D09`：Admin REST 種下過去未關帳的營業日與學生（只在 demo Emulator，測後清掉，上線日暫調前三天後復原），再由 UI 走異常頁 → 標為回填（原因必填）→ 日結頁確認 → 訂餐頁橫幅 → 登記其他餐點 → 「回填」標籤 → 退款停用 → 離開回填；並用 Admin 讀取確認標記與交易的 `businessDate`。**「營業日文件不存在」的三步沒有 E2E**（需要種下已關帳的前一日才會出現斷層日），由元件測試與 `P11c2b.1` 涵蓋。
- 元件測試注意：`CloudDayClosePage.test.tsx` 回填案例的 repository mock 必須回傳「與送出的 command ID 相同」的 receipt，否則頁面會拒收回執；每個 describe 各自 `vi.resetAllMocks()`。
- 未做：P11c3、P11c4、角色權限、P12。無 production 部署、無正式金鑰。
- 合併收據：#513 squash `797b23e5cff43e7fe0692817dc64e90c03b56d74`（base `0871f9ba9873cd5f2f2bfc447d569bf9bce65b64`，source head `750026db45bcfc7b52c6e8c20d8b716c78d76eef`）；獨立審查 review `5561472938` 程式碼無必修，唯一必修是 PR body 署名（已補）。審查者在 Emulator 另跑受影響 suite：`cloudDayClose` 132/132、`cloudOrderRepository` 15/15、`cloudCommands` 179/179、`cloudCashMovement` 42/42、`cloudTransactionMutation` 47/47、`cloudRefund` 43/43、`cloudBackup` 22/22、`cloudDayVendorRepository` 10/10；畫面與單元 9 檔 180/180；`firestore.rules` 與 `firestore.indexes.json` 無差異。CI run 39097170105：build-and-test 綠；e2e 第一次失敗在 P04 `A05`（租約與假時鐘，本 PR 沒碰租約或 auth），重跑失敗的 job 一次通過（D09 兩次都通過）。
- 審查備註與待辦：P11c3 — 訂餐頁每次 `loadSnapshot` 多跑一次日結 overview（每筆操作約多 3–4 次讀取，可快取）、`D09` 清理沒刪 `commands` 也沒還原 `dataHead.seq`、補「營業日文件不存在」三步的 UI E2E、「沒有標記但關過帳又重開」的診斷訊息措辭；P12 — 回填日關帳後雲端畫面看不到那天的交易與「回填」標籤。

## P11c3 回填日關帳對齊 checkpoint — 2026-10-18

- 範圍：有 `backfillDays/{dayId}` 標記的日子，`CloseDay` 必須差額為 0，且 payload 帶 `alignWithDayId`（`null`，或晚於本日、開帳現金等於實點的日子）；一般日子的關帳不變。契約 §14：[P11 contract](../superpowers/specs/2026-10-17-cloud-day-close-contract.md#14-p11c3-回填日關帳對齊)。base `797b23e5cff43e7fe0692817dc64e90c03b56d74` 之後的 main（含 #514）；PR 與 head SHA 以 PR body 與 handoff 為準。沒有新 command kind、沒有新 collection、`firestore.indexes.json` 沒改。
- Rules 的極限（已寫入契約）：Rules 證明不了「本日與 `alignWithDayId` 之間沒有其他已開帳的日子」，也證明不了傳 `null` 時之後真的沒有已開帳的日子；這兩點由寫入器（`findNextOpened` 分段往後掃、與 head 比對）負責，異常頁 `opening-mismatch` 是安全網。標記與 payload 形狀的連動放在 `dayCloseCommand`（日文件更新與命令同一個 batch 提交，原子成立）。
- Rules 餘裕（`/mnt/project-files/tools/rules-probe`，main 與本分支同案例；數字為 單一 / 批次）：

| 錨點 | main | 本 PR |
| --- | --- | --- |
| `P11.9` CloseDay 指令 | +53 / +54 | +52 / +53（−1） |
| `P11.9` dayClose | +96 / +97 | +96 / +97 |
| `P11.9` settlement | +96 / +97 | +96 / +97 |
| `P11.9` dataHead | +95 / +96 | +95 / +96 |
| `P08.8` 營業日 | +11 / +12 | +11 / +12 |
| `P08.8` 指令 | +20 / +21 | +20 / +21 |
| P14 `CreateStudent` | +3 / +4 | +3 / +4 |
| `P11c2a.14` 回填訂餐交易 | +16 / +17 | +16 / +17 |
| `P11c3.8` 對齊關帳最大 payload（指令） | — | +36 / +37 |
| `P11c3.10` 重開後再關（指令） | — | +20 / +21 |

  沒有既有錨點 ≤ +5，最大退步 −1（未超過停止條件的 3）。
- demo-easyorder Auth＋Firestore Emulator 循序 `src/firebase/__tests__` 全部 `*.spec.ts`（所有 `EASYORDER_REQUIRE_*`）：14 檔 638/638、0 skipped（P11c2b 為 615）。`cloudDayClose.spec.ts` 154 項（新增 `P11c3.1`–`P11c3.10`，並依新行為更新 `P11c2a.4`／`.7`、`P11c2b.1`），`cloudBackup.spec.ts` 23 項（新增斷層日案例與「對齊關帳」round-trip：EnsureDay → 補開帳 → StartBackfill → 補登 → 對齊關帳 → 匯出、解密、replay；偽造對齊金額被拒）。
- Rules mutant（拿掉差額為 0、拿掉對齊金額、對齊日不晚於本日、對齊日沒有開帳、標記連動等）與 client mutant 的結果見 [預算附錄](p05-rules-budget.md#p11c3--aligned-close-of-a-back-filled-day--budget-and-probe-receipt)；兩個等價 mutant（replay 的「不晚於」被 schema 先擋、路徑守衛重複）已在附錄說明。
- 一般 Vitest：171 檔通過／14 檔 skip，1,823 passed／638 skipped（P11c2b 為 1,798／615）。`npm run lint`、`npm run build` exit 0；app tsc 與 main 診斷逐行相同。
- E2E（本機 Chromium 1194 暫時設定，不取代 CI pinned Chromium，設定已刪未提交）：cloud 23/23、prototype 7/7。`D09` 補齊清理（刪測試期間的 `commands` 並還原 `dataHead.seq`）；新增 `D10`：種下已關帳的前一天、「營業日文件不存在」起點，UI 走完整三步（`EnsureDay` → 補開帳 → 標記）→ 補登 → 對齊關帳。
- #513 審查遺留：(a) 訂餐頁改為共用已讀到的回填日清單（`knownBackfillDays`），不再每次 `loadSnapshot` 多跑一次 overview；(b) `D09` 清理已補；(c) 「沒有標記、關過帳又重開」診斷訊息明說是沒有回填標記（`DAY_REOPENED_NO_MARKER`）；(d) 三步 UI E2E 即 `D10`。
- 未做／未驗：P11c4（已關帳日補記）、角色權限（重開仍人人可用）、P12 查帳頁；沒有 production 部署、沒有正式金鑰；pinned Chromium 1223 在此環境沒有，CI 的 E2E 以 CI 結果為準。部署（CheerC 本機）：Rules、前端、`firestore.indexes.json` 一起上。
- 合併收據：#515 squash `a23177fc211354261f84dbe5411d8690a8af41fc`（source head `2edeae2168d6630304a0fbcddde2c86dbae14a29`）；獨立審查 review `5561736953` 程式碼無必修。審查者在 Emulator 另跑 `src/firebase/__tests__/` 全部 27 檔循序（12 個 `EASYORDER_REQUIRE_*` 全開）757/757、0 skipped；畫面與單元 4 檔 140/140；Rules 餘裕用 rules-probe 重測（每個錨點量 +lo 通過、+hi 失敗），與本節表格逐項相同；另以原始 SDK 抽測（少營業日更新或結算文件、偽裝 kind、路徑型對齊值、重開後再關）都被拒，抽測為臨時測試已刪。兩個等價 mutant 的說法成立。CI run 39103196075：build-and-test 與 e2e 一次通過。
- 審查備註與待辦（不擋合併）：replay 對沒帶 `alignWithDayId` 的標記日關帳刻意放寬（契約 §14.4），確認正式環境後可收緊；訂餐頁明確被拒後沿用回填日清單，日期選單可能暫列已被關帳的日子（不影響帳務）。P11c4、P12 尚未開始。

## P11c4a 關帳後補記 checkpoint — 2026-10-18

- 範圍：新 command kind `RecordPostCloseEntry`（第 27 種，25 種啟用）與新集合 `postCloseEntries/{entryId}`；已關帳的日子可補記一筆有方向（收入／支出）、金額 1–20,000、原因必填的不可修改補記，營業日、日結版本、交易與學生都不動。有效關帳現金 = 最新日結實點 + 補記收入 − 補記支出（只計 `settlementRevision == lastSettlementRevision` 的補記），帳務異常的 `opening-mismatch` 與開帳預設值改用它。P14 備份 decoder／replay 接受新 kind。契約 §15：[P11 contract](../superpowers/specs/2026-10-17-cloud-day-close-contract.md#15-p11c4-關帳後補記recordpostcloseentry)。base 為 #516 收據合併後的 main `e824492`；PR 與 head SHA 以 PR body 與 handoff 為準。畫面（P11c4b）、P12、角色權限未做；`firestore.indexes.json` 沒改。
- 設計重點：一次 commit 寫 `system/dataHead`、`commands/{id}`、`postCloseEntries/{commandId}`（形狀同 `StartBackfill`，營業日 `size() == 10` 與 `revision` 不變，所以 `P08.8` 營業日餘裕不受影響）。`expectedRevisions = {day, settlement}` 分別綁營業日目前的 `revision` 與 `lastSettlementRevision`，重試沿用同一個 command ID，補記落在同一份文件，不會重複。讀取只用 `where dayId == x` ＋文件 ID 排序，只靠單欄位索引；Emulator 不檢查索引，**正式環境的索引行為沒有在本批驗證**。
- Rules 餘裕（`/mnt/project-files/tools/rules-probe`，main 與本分支同案例，新增錨點 `postClose`；數字為 單一 / 批次）：所有既有錨點與 main 完全相同，沒有任何一個退步（`P11.9` 指令 +52、`P08.8` 營業日 +11、指令 +20、`CreateStudent` +3、回填訂餐交易 +16、`P11c3.8` +36、`P11c3.10` +20、dataHead +95、`dayCloseCommand` +96、settlement +96）。新路徑 `P11c4.3`（金額 20,000、500 字原因）：指令 +64 / +65、dataHead +95 / +96、`postCloseEntries` create +96 / +97。完整表格、寫入預算與 mutant 見[預算附錄](p05-rules-budget.md#p11c4a--post-close-entry--budget-and-probe-receipt)。
- Mutant：Rules 11 個全部被測試抓到，其中一個（`postCloseEntryCommand` 不檢查 `entryId == commandId`）第一版測試漏抓，補了「同一筆補記複製到另一個 ID」的案例（`P11c4.5`）後被抓到；備份 replay 的「營業日已關帳」與「日結版本相同」第一版也漏抓，補了 replay 層的案例後被抓到；其餘備份 manifest 層的單一檢查因有兩層以上的重複防線而單獨移除抓不到，屬刻意的重複（細節見附錄）。
- demo-easyorder Firestore Emulator 循序 `src/firebase/__tests__` 全部 `*.spec.ts`（所有 `EASYORDER_REQUIRE_*`）：14 檔 684/684、0 skipped（P11c3 為 638）。`cloudDayClose.spec.ts` 新增 `P11c4.1`–`P11c4.9`（補記與冪等重試、被拒情境、含只有空白原因在內的 37 種原始 SDK 攻擊、最大 payload、不可修改刪除、Q2 例子、重開再關後舊補記不計入、超過一頁的補記讀取與指向不存在版本的補記 fail closed）；`cloudBackup.spec.ts` 新增真實 關帳 → 補記 → 重開 → 重新關帳 → 補記 → 匯出 → 解密 → replay 與偽造被拒，以及 Unicode 空白原因不被備份擋下；`cloudCommands.spec.ts` 的 kind 清單測試依 27 種更新。
- 一般 Vitest：172 檔通過／14 檔 skip，1,852 passed／684 skipped（P11c3 為 1,823／638）。新增 `postCloseEntries.test.ts`、`cloudLedgerReader.test.ts` 的補記讀取案例（含 head 比對、分頁、schema fail closed）、`ledgerAnomalies.test.ts`、`CloudLedgerAnomaliesPage.test.tsx`、`CloudDayClosePage.test.tsx`、`CloudDayVendorForms.test.tsx`、`CloudOrdersPage.test.tsx`。`npm run lint`、`npm run build` exit 0；app tsc 與 main 診斷逐行相同。
- E2E（本機 Chromium 1194 暫時設定，不取代 CI pinned Chromium，設定已刪未提交）：cloud 23/23、prototype 7/7。**沒有新增 P11c4a 的 UI E2E**：輸入補記的畫面屬 P11c4b，沒有它 E2E 只能用管理員種資料，等於重複 Emulator 的 `P11c4.7`；Q2 例子目前由 Emulator `P11c4.7`（repository 層）與異常頁元件測試證明，P11c4b 補 E2E。
- 順手處理 P11c3 審查遺留 (2)：訂餐頁被伺服器明確拒絕後，回填日清單改為重讀而不是沿用（`CloudOrdersPage.test.tsx` 有對應案例，把修正拿掉會失敗）。遺留 (1)（備份 replay 對標記日關帳放寬）仍等 CheerC 確認正式環境，**沒有收緊**。
- 未做／未驗：補記畫面與列表（P11c4b）、P12 查帳頁需顯示回填與關帳後補記標記、角色權限；沒有 production 部署、沒有正式金鑰；pinned Chromium 1223 在此環境沒有，CI 的 E2E 以 CI 結果為準；正式環境的單欄位索引行為沒驗證。部署（CheerC 本機）：Rules、前端、`firestore.indexes.json` 一起上（indexes 不變）。
