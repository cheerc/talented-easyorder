# GitHub Actions 部署計畫

日期：2026-11-03。狀態：程式與文件已實作於本 PR；Google Cloud／GitHub Environment 設定與第一次實際部署由本人執行，尚未驗證。本計畫不推進 P18。

## 目標與依據

使用者授權：部署不必只在本機進行；GitHub Actions 部署要能部署測試與正式兩個 project，一次 run 依序完成 indexes → 等 READY → rules → hosting，本人核准一次。repo 為 public，Actions 標準 runner 與 Environment 核准規則免費；Workload Identity Federation 不需金鑰、不需 billing。

沿用 P17 release 工具的契約（見 `docs/ops/DEPLOYMENT-GUIDE.md` 第 3–4 節）：固定 project、release 完整性、Spark／Firestore provider 檢查、indexes → rules → hosting 順序。改變的只有「本人確認」的形式：本機互動終端輸入確認字串，或本人在 GitHub 觸發 workflow 並核准 Environment。

不處理：自動（push／schedule）部署、PR preview channel、bootstrap／空白啟用、正式 smoke、Hosting 回退自動化。

## 設計

- `.github/workflows/deploy.yml`：只有 `workflow_dispatch`，target 為 `firebase-test` 或 `firebase-production`；兩個 job 都要求 `github.ref == refs/heads/main`。先確認此 commit 在 main 上有成功的 Frontend CI push run；部署 job 使用 `environment: ${{ inputs.target }}`，核准後才拿到 OIDC token 與 Environment variables。action 全部釘 commit SHA；`concurrency` 依 target 排隊、不取消進行中的部署。
- 在取得 Google 授權前執行 `./deploy.sh prepare`，讓 release 來源為乾淨 checkout，build 不接觸憑證。
- `./deploy.sh deploy-ci`：`validateCiDeployment` 要求 GitHub Actions、workflow_dispatch、main、`EASYORDER_DEPLOY_PROJECT` 與 `--project`、release 三者一致、release SHA 等於 `GITHUB_SHA` 且 `sourceDirty=false`、無 Emulator 變數；接著做與本機相同的 provider 檢查；每步前重驗 release；Firebase CLI 加 `--non-interactive`、不帶 `--force`（遠端多出的 index 不刪）；indexes 後以 `gcloud firestore indexes composite list` 輪詢，`compositeIndexStatus` 確認設定中每個 composite index 都 READY，預設 30 分鐘上限，逾時停在 rules 之前。receipt 與 manifest 上傳為 artifact。
- Google 端：每個 project 各一個 identity pool／provider，attribute condition 綁 repo 數字 ID、`refs/heads/main` 與 Environment 名稱；部署用 service account 只給 Hosting Admin、Rules Admin、Index Admin、Browser、Service Usage Consumer，不給能讀 Firestore 資料的角色。
- 規則同步：`CLAUDE.md` 安全邊界改為「deploy 由本人在本機，或本人觸發並核准此 workflow；agent 不觸發、不核准」；`REVIEW.md` 第 8 條改為只允許這個 workflow 的形狀。

## 驗收

- 自動（本 PR）：`node --test ../scripts/__tests__/release.test.mjs`（frontend 目錄）涵蓋 CI guard 各拒絕情境、`--non-interactive` 且無 `--force`、index READY 判斷（含隱含 `__name__`、缺少、建立中、方向不符）、`deploy-ci` 入口在 Actions 外於任何 provider 動作前拒絕、workflow 只能手動觸發且 action 釘 SHA。RED `28a33a9`、GREEN `55221f1`。
- 本人（未執行）：依部署指南第 9 節設定 `firebase-test`；從 main 觸發並核准，三步成功、artifact 有 receipt；照第 6 節 smoke。確認無誤後再設定 `firebase-production`。任何正式結果在 evidence 補記前都是 UNVERIFIED。

## 風險與未知

- Firebase CLI 以 Workload Identity Federation 的 ADC 部署、`gcloud billing projects describe` 與 `firestore:databases:get` 在所列角色下是否足夠，需第一次實際 run 確認；缺權限時只補最小角色並記錄。
- single-field index exemptions 不在 READY 輪詢範圍內，仍依 CLI 結果與 Console 核對。
- 公開 repo：fork PR 不會觸發此 workflow，也拿不到 Environment 或 Google 授權；有寫入權限的人能觸發，但部署仍需 required reviewer 核准。
