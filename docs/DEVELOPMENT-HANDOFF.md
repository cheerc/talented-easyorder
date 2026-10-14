# 正式後端逐 PR 開發交接

此頁是正式後端每次 PR 的續作入口；規格／計畫／執行證據只在下列來源更新，避免多份副本互相漂移。PR body 記錄當次 base、head SHA 與 RED/GREEN／CI 結果，作為該 PR 的版本權威；本文不自行抄錄當次 head SHA，避免檔案內自引用。

## 權威文件

- [正式後端規格](superpowers/specs/2026-10-13-free-production-backend-spec.md)：營運契約與資料安全邊界。
- [P00–P18 完整計畫](superpowers/plans/2026-10-13-free-production-backend-plan.md)：phase scope、依賴、驗收及 receipts。
- [現況與執行證據](ops/free-production-evidence.md)：baseline、每 phase emulator／CI 證據及未解阻擋。
- [P00 完整 TypeScript app baseline](ops/baselines/75e7a96-tsc-app.txt)：完整 diagnostics，保留重複項。

## 已合併與目前接手點

- 最近已合併：PR [#471](https://github.com/cheerc/talented-easyorder/pull/471)，P00 文件與 diagnostics baseline；merge commit `1da09039ab57f2b13f965ce98277bd1d41ce8e5e`。
- P00 base 是 `75e7a96e6cad722a41076df66e5b2cf9014e9d47`；完整紀錄見 P00 receipt 與 evidence，不把舊前端本人驗收改寫成後端驗收。
- 目前 phase：P01 Rules 可行性 proof。分支 `codex/backend-p01-rules-proof`，base `1da09039ab57f2b13f965ce98277bd1d41ce8e5e`。Draft PR [#472](https://github.com/cheerc/talented-easyorder/pull/472)，RED scaffold head `6ca1545a8e97df4a96c8a75c5429f35f5438a2a9`；目前 Actions run [38514043015](https://github.com/cheerc/talented-easyorder/actions/runs/38514043015) 執行中。RED/GREEN SHA、CI run 與可確認的測試數以 PR body 及其後更新的 P01 receipt 為準。
- P01 到目前交付 test-only fixture 與行為 RED scaffold；RED run 尚未完成，GREEN 尚未開始。P01 review／required CI 尚未通過，尚無正式後端功能部署。
- 未完成／阻擋：本地 Emulator binary 下載的 `storage.googleapis.com` 被環境回應 403；下載 GitHub Actions log 的 `results-receiver.actions.githubusercontent.com` 亦遇 403。這不妨礙 GitHub runner 執行 demo Firestore Emulator；CI gate 將解析 Vitest JSON 並拒絕零測試、全部 skip 或失敗。未讀到日誌前不得猜測測試數。只可用 `demo-easyorder` 與匿名合成資料；不可把 CI artifact 下載回 cloud 環境繞過網域限制。
- Production Firebase keys／設定／管理憑證只由使用者保存在自己的電腦；所有正式資源、部署與正式 smoke test 由使用者本機執行。Cloud agent 僅可用 demo Emulator，Spark 不開 billing／Blaze、不接 payroll、不改 Android。後端尚未實作或部署。

## 接手時的第一步

先確認最新遠端與工作區，保留使用者或前一位 implementer 尚未提交的內容；不要用 reset、checkout 覆寫或清除它：

```bash
git fetch origin
git status --short --branch
git branch --show-current
git log -1 --oneline --decorate
```

若目前 PR 未完成，先在原分支完成修正、重跑失敗的 CI、取得 review 並等 coordinator merge；不可跳到 P02。若交接時已有未提交變更，先檢視並和當前 PR 對齊，勿覆蓋。

## 下一個 PR：P02（僅在 P01 review 通過並由 coordinator merge 後）

- 計畫入口：[P02 — 雲端 command／投影介面與模式隔離](superpowers/plans/2026-10-13-free-production-backend-plan.md#p02--雲端command投影介面與模式隔離)；契約來源為 spec §5–§8。
- 目標範圍：建立 typed business command／result/error 與 ledger projection math；切出 prototype 與 cloud mode 的 storage／dispatch 邊界；未完成 cloud UI 保持鎖住。本 phase 不接正式 Firebase 寫入，不開放雲端 kind。
- 計畫產物：`frontend/src/domain/cloudCommands.ts`、`frontend/src/domain/cloudLedgerProjection.ts`、`frontend/src/domain/__tests__/cloudLedgerProjection.test.ts`，及 plan 指定的最小 mode/persistence 接點。不得改超出 P02 的 UI 或開始 P03 Auth。
- 驗收：先對 L01–L04、expense 雙方向、void 零貢獻、同毫秒排序及缺頁不可精算 afterBalance 建立可觀察 RED，再實作至 GREEN；prototype 現有測試不退化；缺 Firebase config 不可悄悄降為 local-only；跑計畫中的 tsc baseline comparison、lint、Vitest、build 並記錄實際結果。P01 未 review 通過、required checks 未綠及 coordinator 未 merge前，P02 不得啟動。

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
