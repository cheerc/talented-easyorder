# 正式後端逐 PR 開發交接

此頁是正式後端每次 PR 的續作入口；規格／計畫／執行證據只在下列來源更新，避免多份副本互相漂移。PR body 記錄當次 base、head SHA 與 RED/GREEN／CI 結果，作為該 PR 的版本權威；本文不自行抄錄當次 head SHA，避免檔案內自引用。

## 權威文件

- [正式後端規格](superpowers/specs/2026-10-13-free-production-backend-spec.md)：營運契約與資料安全邊界。
- [P00–P18 完整計畫](superpowers/plans/2026-10-13-free-production-backend-plan.md)：phase scope、依賴、驗收及 receipts。
- [現況與執行證據](ops/free-production-evidence.md)：baseline、每 phase emulator／CI 證據及未解阻擋。
- [P00 完整 TypeScript app baseline](ops/baselines/75e7a96-tsc-app.txt)：完整 diagnostics，保留重複項。

## 已合併與目前接手點

- **目前工作：P04，PR [#475](https://github.com/cheerc/talented-easyorder/pull/475) 尚未 merge；rework 候選已完成本地驗證，等待新 immutable head 的獨立 review 與 required CI。** 分支 `codex/backend-p04-active-lease`，base 為 #474 實際 merge SHA `fd8cba1b84c0b2146c1f450192e2c99739193e46`。原 CI lease suite 11 個案例在一般 Vitest 全部 skipped，原始 E2E 對 A02–A04 僅做 UI smoke；review 指出的授權與 heartbeat 邊界已納入本輪修正。全套 Vitest 為 1291 passed、65 skipped、0 failed；獨立 Emulator lease 19/19、A01 Rules 10/10、P01 Rules proof 36/36；system Chromium 154 下 Cloud 11/11＋隔離 prototype 7/7，18/18、0 skipped（含 A08 同 UID 兩頁跨兩次 60 秒 heartbeat 與 leader handoff）。ESLint/build 通過。app TypeScript baseline 為 295→290，保留重複項的 normalized diff 新增 0、移除 5 項舊錯；app tsc 仍 exit 2。P01 25 個負向測試有 expression-cap 診斷限制，詳見[ops evidence](ops/free-production-evidence.md)。Pinned Chromium CDN 在本環境回 403，故本地 E2E 是 system Chromium 診斷；新 immutable head 的 GitHub required CI 與獨立 review 尚未完成。P05 不得開始，業務 command/write path 尚未實作，也未部署。
- 最近已合併：PR [#474](https://github.com/cheerc/talented-easyorder/pull/474)，P03 Google 登入與等權白名單；實際 merge SHA `fd8cba1b84c0b2146c1f450192e2c99739193e46`。
- 前次已合併：PR [#473](https://github.com/cheerc/talented-easyorder/pull/473)，P02 雲端 command／投影介面與模式隔離；實際 merge SHA `bc5bb2588e616f40a605ea8cd682b1d1642bbc71`。
- 更早已合併：PR [#472](https://github.com/cheerc/talented-easyorder/pull/472)，P01 Rules 可行性 proof；實際 merge SHA `e7c406c93af197cda0bedaa220a4575728612f0f`。
- 最早已合併：PR [#471](https://github.com/cheerc/talented-easyorder/pull/471)，P00 文件與 diagnostics baseline；實際 merge SHA `1da09039ab57f2b13f965ce98277bd1d41ce8e5e`。
- Emulator 工具鏈已可用：本地 Node `v24.19.0`、Java `21.0.12.1`、Firebase CLI `14.27.0`、Firestore Emulator `1.19.8`，官方 JAR SHA-256 `9d43599ed6151199e8d604dc87fac51218e49e5f3a48519b1ae560bbe5e3382d` 已核對。
- Production Firebase keys／設定／管理憑證只由使用者保存在自己的電腦；所有正式資源、部署與正式 smoke test 由使用者本機執行。Cloud agent 僅可用 demo Emulator，Spark 不開 billing／Blaze、不接 payroll、不改 Android。P00–P03 已合併、P04 尚在 review/rework；業務 command/write path 尚未實作，沒有正式部署。

## 接手時的第一步

先確認最新遠端與工作區，保留使用者或前一位 implementer 尚未提交的內容；不要用 reset、checkout 覆寫或清除它：

```bash
git fetch origin
git status --short --branch
git branch --show-current
git log -1 --oneline --decorate
```

若目前 PR 未完成，先在原分支完成修正、重跑失敗的 CI、取得 review 並等 coordinator merge；不可跳到 P05。若交接時已有未提交變更，先檢視並和當前 PR 對齊，勿覆蓋。

## 下一個 PR：P05（僅在 P04 review 通過並由 coordinator merge 後）

- 計畫入口：[P05 — 正式原子寫入器與冪等收據](superpowers/plans/2026-10-13-free-production-backend-plan.md#p05--正式原子寫入器與冪等收據)；契約來源為 spec §6.2。
- 目標範圍：`cloudCommandRepository.ts`、`cloudCommands.spec.ts`、production `firestore.rules`／schema；dataHead bootstrapping 與 maintenance guard。首批只啟用 `EnsureDay`、`CreateOrder`、`CreatePayment`，不接 UI；其餘 command kinds 一律 deny。
- 產物與驗收：P01 proof/P02 型別/P04 lease → 唯一 commitCommand/readCommand。各 kind 在啟用前都要以 Emulator 重驗正向、拒絕與 atomic unchanged；22-kind targets/budget 靜態盤點不能替代逐 kind 實測。P04 未 review 通過、required checks 未綠及 coordinator 未 merge 前，P05 不得啟動。

## 每個 PR 的協作與交接要求

- 每次只開一個小 phase PR；implementer 做程式／文件與自我驗證，SOL medium review，Coordinator 是唯一 merge 人。Review 與 required CI 通過後，使用者已授權 coordinator 單人開發分支以 `--admin` merge。作者不能自行 merge。
- 使用者指定實作 GPT-6 LUNA、effort xhigh；review GPT-6.1 SOL、effort medium。這是續作協作設定，不放入 commit message 或 PR body。
- commit 與 PR body 用中文，不寫模型名稱或真實個資。可在交接提示記錄使用者指定的 implementer／review effort，但不複製到 commit／PR 描述。
- 每次開 PR 後即向使用者回報 URL、當前 SHA、當批完成內容、review／CI 狀態與接續第一步。更新本 handoff 的 PR URL及狀態、plan receipt、evidence；不把未知標成已完成。
- PR body 至少記錄 base/new head SHA、對應 spec／案例、精確命令／exit／測試數、RED 與 GREEN 證據、CI run、三分鐘 demo、known limitations、是否部署（本專案實作 PR 固定未部署）。Rules suite 不能用 Vitest skip 冒充成功；部署／production 操作由使用者本機執行。

## 可複製的續作提示

```text
請先讀 docs/DEVELOPMENT-HANDOFF.md，再讀其中連結的正式後端 spec、P00–P18 plan 與 ops evidence。先 git fetch origin / status / branch / log，不覆蓋任何既有使用者或未提交變更。只續作 handoff 指定的目前 PR：完成修正、實際測試與 required CI、SOL review；由 Coordinator 唯一 merge。若目前 PR 尚未完成，不可啟動下一 phase。完成後更新 handoff、plan receipt、evidence，開下一個小 PR 並立即回報 URL、SHA 與接手事項。Production secrets/resources/deploy 只由使用者本機操作；Cloud 僅 demo Firestore Emulator／合成資料，禁止碰 payroll、Blaze 與 Android。
```
