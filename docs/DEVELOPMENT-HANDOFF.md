# 正式後端逐 PR 開發交接

此頁是正式後端每次 PR 的續作入口；規格／計畫／執行證據只在下列來源更新，避免多份副本互相漂移。PR body 記錄當次 base、head SHA 與 RED/GREEN／CI 結果，作為該 PR 的版本權威；本文不自行抄錄當次 head SHA，避免檔案內自引用。

## 權威文件

- [正式後端規格](superpowers/specs/2026-10-13-free-production-backend-spec.md)：營運契約與資料安全邊界。
- [P00–P18 完整計畫](superpowers/plans/2026-10-13-free-production-backend-plan.md)：phase scope、依賴、驗收及 receipts。
- [現況與執行證據](ops/free-production-evidence.md)：baseline、每 phase emulator／CI 證據及未解阻擋。
- [P00 完整 TypeScript app baseline](ops/baselines/75e7a96-tsc-app.txt)：完整 diagnostics，保留重複項。

## 已合併與目前接手點

- **目前工作：P05，分支 `codex/backend-p05-command-core`，base `837a1e871468db217463e9799480beeb6d7b0ab0`。** P04 PR [#475](https://github.com/cheerc/talented-easyorder/pull/475) 已由 coordinator squash merge，實際 merge SHA `837a1e871468db217463e9799480beeb6d7b0ab0`；合併前 source head 為 `cf0cd10af4171f24cf5faa6dff0814393cb71340`。固定版本獨立 review comment 5519480848 通過；required CI run [38579765651](https://github.com/cheerc/talented-easyorder/actions/runs/38579765651) 的 build-and-test 與 E2E jobs 均成功。P04 保留全套 Vitest 1291 passed、65 skipped、0 failed；獨立 Emulator lease 19/19、A01 Rules 10/10、P01 Rules proof 36/36；Cloud E2E 11/11＋隔離 prototype 7/7，18/18、0 skipped（含 A08 同 UID 兩頁跨兩次 60 秒 heartbeat 與 leader handoff）。app TypeScript normalized baseline 295→290，新增 0、移除 5 項既有診斷，app tsc 仍 exit 2。P01 部分負向案例的 expression-cap 診斷限制見[ops evidence](ops/free-production-evidence.md)。P05 現為 WIP，沒有宣稱 P05 測試、CI 或正式功能已通過；未部署。
- 最近已合併：PR [#474](https://github.com/cheerc/talented-easyorder/pull/474)，P03 Google 登入與等權白名單；實際 merge SHA `fd8cba1b84c0b2146c1f450192e2c99739193e46`。
- 前次已合併：PR [#473](https://github.com/cheerc/talented-easyorder/pull/473)，P02 雲端 command／投影介面與模式隔離；實際 merge SHA `bc5bb2588e616f40a605ea8cd682b1d1642bbc71`。
- 更早已合併：PR [#472](https://github.com/cheerc/talented-easyorder/pull/472)，P01 Rules 可行性 proof；實際 merge SHA `e7c406c93af197cda0bedaa220a4575728612f0f`。
- 最早已合併：PR [#471](https://github.com/cheerc/talented-easyorder/pull/471)，P00 文件與 diagnostics baseline；實際 merge SHA `1da09039ab57f2b13f965ce98277bd1d41ce8e5e`。
- Emulator 工具鏈已可用：本地 Node `v24.19.0`、Java `21.0.12.1`、Firebase CLI `14.27.0`、Firestore Emulator `1.19.8`，官方 JAR SHA-256 `9d43599ed6151199e8d604dc87fac51218e49e5f3a48519b1ae560bbe5e3382d` 已核對。
- Production Firebase keys／設定／管理憑證只由使用者保存在自己的電腦；所有正式資源、部署與正式 smoke test 由使用者本機執行。Cloud agent 僅可用 demo Emulator，Spark 不開 billing／Blaze、不接 payroll、不改 Android。P00–P04 已合併，P05 進行中；command-core 未完成驗收，沒有正式部署或開放正式帳務操作。

## 接手時的第一步

先確認最新遠端與工作區，保留使用者或前一位 implementer 尚未提交的內容；不要用 reset、checkout 覆寫或清除它：

```bash
git fetch origin
git status --short --branch
git branch --show-current
git log -1 --oneline --decorate
```

先續作 handoff 指定的目前 phase 與 branch。若交接時已有未提交變更，先檢視並和當前 PR 對齊，勿覆蓋。

## 目前 PR：P05（WIP）

- 計畫入口：[P05 — 正式原子寫入器與冪等收據](superpowers/plans/2026-10-13-free-production-backend-plan.md#p05--正式原子寫入器與冪等收據)；契約來源為 spec §6.2。
- 目標範圍：`cloudCommandRepository.ts`、`cloudCommands.spec.ts`、production `firestore.rules`／schema；dataHead bootstrap manifest 與 maintenance guard。首批只啟用 `EnsureDay`、`CreateOrder`、`CreatePayment`，不接 UI；其餘 19 command kinds 一律 deny。最新本地 WIP production Rules Emulator checkpoint 為 47/47 pass、0 fail、0 skipped；這不是 phase pass。
- 產物與驗收：P01 proof/P02 型別/P04 lease → 唯一 commitCommand/readCommand。完整 22-kind typed targets/schema 與 no-cache budget/expression-risk matrix 在[獨立預算盤點](ops/p05-rules-budget.md)中標示；只有三個 enabled kind 有實作及 Emulator pass。Enable 正向 Rules closure 算術為 EnsureDay 11 calls、CreateOrder／CreatePayment 19 calls（含已讀未寫 operator/accessLease 的 VerifyMutation；transaction writes 單獨最多 10）。SDK BatchGet reads 的 Rules dependency 另列 7／11 calls；不以 cache 折抵。其他 19 kinds 仍維持 deny，靜態估值不能寫成其 Emulator pass。尚未完成的 P05 gates 不得在文件／PR 中標成通過。
- `readCommand` 僅允許 server-only讀取且每次都檢查目前有效 Google operator／lease；合法目前 holder 可讀其他 actor、舊 leaseEpoch 的歷史 receipt。只有成功的 server read 確認不存在時回 `null`。
- 同 command ID 的語義完全一致才回既有 receipt；不同 kind/target/payload/expected revisions 一律 `INVALID_INPUT` 且不增 seq。呼叫端與 repository 對結果不確定時回 `UNKNOWN_RESULT`，保留原 ID 並查詢，不盲目換 ID 重送。
- 最近 P05 Emulator 命令：`EASYORDER_REQUIRE_CLOUD_COMMANDS=true npx firebase emulators:exec --project demo-easyorder --only firestore "EASYORDER_REQUIRE_CLOUD_COMMANDS=true npx vitest run src/firebase/__tests__/cloudCommands.spec.ts --no-file-parallelism --reporter=default --reporter=json --outputFile=/tmp/easyorder-p05-cloudcommands-r2.json"`；47/47、0 skipped。含三種 enabled kind 正向、同 ID replay/collision、raw SDK 四種省略 writer及額外／雙 command／重播／偽造 snapshot、併發 revision conflict、19 個 disabled kind、歷史日期 deny 和嚴格 receipt。仍待 post-commit receipt read failure 的獨立 failure-injection proof、full Vitest、A01/P01/P04 與 E2E 回歸、workflow/GHA 真跑、最終 normalized diagnostics／build、獨立 review。legacy writer fail-closed adapter 已有 targeted 13/13，bootstrap manifest/schema 僅本地靜態產物，沒有執行 bootstrap。完整數據、命令、限制與 evidence logs 見 [ops evidence](ops/free-production-evidence.md)。

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
