# EasyOrder P17：獨立 Spark 本機部署

新正式後端的部署入口：本機第 3–4 節，或第 9 節由本人觸發並核准的 GitHub Actions。版本與 gate 見[交接](../DEVELOPMENT-HANDOFF.md)及[phase plan](../superpowers/plans/2026-10-13-free-production-backend-plan.md)。獨立測試專案的實際部署與部分 smoke 已執行，逐項結果以 [P17 live evidence](free-production-evidence.md#p17-user-authorized-live-verification-2026-10-27) 為準；未列證據者仍未驗證。不貼憑證或真名單到聊天／PR。

## 分工與順序

| Agent 先完成 | 本人才能處理 |
|---|---|
| release 工具、固定 project、Rules/index/前端雜湊配對、Hosting SPA／安全標頭／快取 | 自己的 Google 帳號、獨立 Spark project、no billing、Firestore region |
| Web config 範本、CLI、空白啟用工具與 demo 演練 | Google provider、OAuth／authorized domains、公開設定的本機輸入、CLI 登入 |
| 本機 build／lint／unit、Emulator CLI、Hosting CSP smoke | 正式 deploy、index READY、Google 登入與正式 smoke 匿名回報 |
| 部署／回退／quota／備份指引、匿名結果表 | DNS 與空閒子網域、核准 UID/email、備份密碼／第二副本、真實期初、本人簽收 |

順序：工程準備 → **本人建立帳號資源** → 部署預設 HTTPS domain → 合成 smoke → 自訂 domain → 獨立空 Spark 復原演練 → P18 三日真實試營運。P17 smoke 使用獨立驗證 Spark project；正式營運另用全新空庫，避免合成交易留在營運備份鏈。不得刪除合成 command 來假裝空庫。

## 0. 2026-10-25 官方資料重查

- [Firebase pricing](https://firebase.google.com/pricing)：Spark 不需 payment method。本案用 Google Auth、Firestore Standard、傳統靜態 Hosting，**不是 App Hosting**。Firestore 免費 1 GiB，每日 reads 50,000／writes 20,000／deletes 20,000。
- [Hosting quota](https://firebase.google.com/docs/hosting/usage-quotas-pricing)：10 GB 儲存、每月 10 GB 傳輸。Spark 傳輸耗盡可能在寬限後停站至下月；儲存耗盡不能新增 release。清舊 release 時保留目前與前一相容版。
- [Firestore locations](https://firebase.google.com/docs/firestore/locations)：首選 asia-east1（Taiwan），建立 (default) 前由本人確認 Console 可選。建立後不藉部署換 region。
- [Hosting config](https://firebase.google.com/docs/hosting/full-config)：SPA rewrites、headers、cache 依 repo；reserved /__/auth/ 由 Firebase 服務。
- [Google sign-in](https://firebase.google.com/docs/auth/web/google-signin)、[same-origin authDomain](https://firebase.google.com/docs/auth/web/redirect-best-practices)：先用 project.firebaseapp.com，自訂 domain 時補 authorized domain 和 OAuth redirect。app 使用 popup；被擋會提示允許 popup 後明確點擊重試，不自動轉址或背景重試。
- [Custom domain](https://firebase.google.com/docs/hosting/custom-domain)：依該 project Console 的 DNS 值驗證，等憑證 Ready 再切換，不複製範例 IP。

以上不代表讀取了本人 project 的方案／計費／IAM。quota 與 P16 容量限制見[備份 runbook](firebase-backup-runbook.md)；budget alert 不是硬上限，不藉 Blaze／試用金解決超額。

## 1. 本人的第一個接手：建立空白 Firebase project

開 [Firebase Console](https://console.firebase.google.com/)，用有管理權的核准 Google 帳號：

1. 建全新獨立 EasyOrder project，選 Spark，不連 billing，不用 payroll project；記下可用的 project ID，不可為 demo- 開頭。
2. Firestore 選 **Standard edition／Native mode** 的 (default) database、asia-east1、production／locked mode，不選 test mode。
3. 建 Web app，使用傳統 **Hosting**。不啟用 App Hosting、Functions、Storage bucket、Extensions、Analytics 或計費產品。Web config 的 storageBucket 是公開識別字；app 不呼叫 Storage，保留提供的字串，不為這個欄位啟用 Storage／Blaze。
4. Authentication → Sign-in method 開 Google provider，選支援 email。先保留預設 project.firebaseapp.com authorized domain。
5. 本機私有記錄 project、region、Spark／no linked billing、Google provider enabled。只需回報「獨立驗證專案已建、Spark/no billing、asia-east1、Google provider 已開」，不傳 UID、email、key 或截圖。

尚未部署前保持資料庫鎖定。這是下一個本人 gate；後面可等協作時逐步執行。

## 2. 本機工具與設定

需要 Node 24、鎖定 dependencies、Firebase CLI（隨 frontend 安裝）及 [Google Cloud CLI](https://cloud.google.com/sdk/docs/install)：

~~~bash
cd /path/to/talented-easyorder/frontend
npm ci
./node_modules/.bin/firebase login
gcloud auth login
~~~

Firebase CLI 與 gcloud 分別登入，兩者須有目標 project 權限。部署建議使用 --account 指定 Firebase CLI 帳號：release 在獨立目錄，該目錄的預設帳號可能不同於 repo。以下均在 repo root，尖括號先替換成本機實值：

~~~bash
mkdir -p "$HOME/.easyorder-private"
chmod 700 "$HOME/.easyorder-private"
cp docs/ops/firebase-web-config.example.json "$HOME/.easyorder-private/web-config.json"
chmod 600 "$HOME/.easyorder-private/web-config.json"
~~~

只在本機填 JSON 六個公開 Web config 欄位。authDomain 先用自己 project 的 firebaseapp.com，projectId 須與 --project 一致。工具拒絕 Admin JSON／私鑰等額外欄位。release build **不讀 frontend .env、不繼承 VITE 設定**。舊 deploy.sh p1-p5、Vercel／payroll 合併入口已移除。

## 3. 建立並核對 release

先完成適用檢查，記 exact revision／CI；未提交工作目錄會標 sourceDirty=true，不能稱 upstream CI 已驗本地版本。

~~~bash
./deploy.sh prepare --project <easyorder-project-id> \
  --web-config "$HOME/.easyorder-private/web-config.json" \
  --region asia-east1 --out "$HOME/.easyorder-private/releases/release-01"
./deploy.sh check --release "$HOME/.easyorder-private/releases/release-01"
~~~

輸出 public/、firebase.json、Rules、indexes、release.json（source SHA、dirty、tracked diff 摘要、每檔 SHA-256），不含管理憑證、真名單或 .env。已有目錄不覆寫；半成品不能部署，換新目錄重建。完整性檢查防意外改動／混版，不是簽章或獨立 approval。

## 4. indexes → READY → rules → hosting

本人核對 gcloud／Firebase CLI 帳號與 project 歸屬。每步再次指定 project，輸入 DEPLOY project step，工具先查 billingEnabled=false、Firestore Native mode／region；無法確認即停，不自動啟用 billing／API 或改 alias。

~~~bash
unset FIRESTORE_EMULATOR_HOST FIREBASE_AUTH_EMULATOR_HOST
./deploy.sh deploy --project <easyorder-project-id> --release "$HOME/.easyorder-private/releases/release-01" --step indexes --account <Firebase-CLI-email>
~~~

到 Firestore → Indexes 確認 **6 個 composite indexes 均 READY／Enabled**，single-field exemptions 與 firestore.indexes.json 一致。CLI 成功不代表 building 完成，Emulator 也不驗 composite index。舊 index 刪除提示不盲目 --force，先核對是全新 EasyOrder project。

~~~bash
./deploy.sh deploy --project <easyorder-project-id> --release "$HOME/.easyorder-private/releases/release-01" --step rules --account <Firebase-CLI-email>
./deploy.sh deploy --project <easyorder-project-id> --release "$HOME/.easyorder-private/releases/release-01" --step hosting --account <Firebase-CLI-email>
~~~

同 release 私有 deploy-receipt.json 記成功步驟，缺先前步驟拒絕往後。每步本人仍核對 index READY。先開 https://project.firebaseapp.com，app 與 authDomain 同源。未初始化不能進帳務，不手填財務文件繞過 gate。

## 5. 首登與空白啟用

本人預設站 Google 首登應顯示「尚未取得使用權」與 UID，Firebase Auth Users 也可查 UID。不給全網域使用權。在本機私有 operators.json 填核准名單：

~~~json
[{"uid":"<實際 Auth UID>","email":"<Auth 顯示的完整小寫 email>","displayName":"<本機顯示名稱>"}]
~~~

只在本人終端取短期 token，不下載 service account key、不印 token。cloud IAM 只給核准維護者，日常 POS 操作者不給 IAM：

~~~bash
export EASYORDER_ACCESS_TOKEN="$(gcloud auth print-access-token)"
node scripts/easyorder-data-maintenance.mjs init --project <easyorder-project-id> \
  --dataset <new-dataset-id> --go-live-date <YYYY-MM-DD> \
  --out "$HOME/.easyorder-private/bootstrap.json"
# 核對試算後加 --execute，終端輸入 INIT project dataset。
node scripts/easyorder-data-maintenance.mjs init --project <easyorder-project-id> \
  --dataset <new-dataset-id> --go-live-date <YYYY-MM-DD> \
  --out "$HOME/.easyorder-private/bootstrap.json" --execute
node scripts/easyorder-data-maintenance.mjs activate-empty --project <easyorder-project-id> \
  --dataset <new-dataset-id> --operators "$HOME/.easyorder-private/operators.json"
# 核對後啟用，終端輸入 ACTIVATE project dataset。
node scripts/easyorder-data-maintenance.mjs activate-empty --project <easyorder-project-id> \
  --dataset <new-dataset-id> --operators "$HOME/.easyorder-private/operators.json" --execute
unset EASYORDER_ACCESS_TOKEN
~~~

init 建 schema 1、seq 0、維護中的 head。activate-empty 只接受空白業務庫、唯一 dataHead，沒有既存 operators／lease／accessEvents；同一原子提交建立白名單、空 lease（epoch 0）及條件式 maintenance=false，不建學生、餘額、現金或 command。啟用後不可再跑；提交回應不明先唯讀核對，不清庫或覆寫。需要備份鏈的 finalize 不用於初次啟用。

重新登入取得使用權。合成資料也從 UI command 建立，不在 Console 填財務文件。

## 6. P17 smoke（獨立驗證 Spark，合成資料）

下表為原始驗收清單，最新實際結果與尚未驗證的項目見 [P17 live evidence](free-production-evidence.md#p17-user-authorized-live-verification-2026-10-27)。

| 編號 | 通過條件 | 匿名結果 |
|---|---|---|
| S01 | Spark／billing disabled、獨立 project、asia-east1、Standard Native (default) | 已查證；見 live evidence |
| S02 | index 6 個 READY／exemptions、Rules/index/Hosting release hash 配對 | 索引與部署已有證據；逐版配對見 live evidence |
| S03 | HTTPS 首頁／深連結／重載／PWA 更新；index/sw 不長快取、hash assets 長快取、無 CSP error | 部分已驗；各條件與版本見 live evidence |
| S04 | 核准 Google 可登入、未知／停用帳號看不到帳務；popup 阻擋有允許並重試指引 | 登入及拒絕帳號已驗；popup 錯誤恢復有工程測試，現場未強制觸發，見收尾證據 |
| S05 | 兩核准 UID 互斥與交接；登出／重載雲端資料保留、本機業務快取清理 | 互斥、交接與資料讀回已驗；其餘條件見 live evidence |
| S06 | 學生／期初、菜單／開帳、訂餐、繳費、更正／取消、關帳、帳戶歷史、學生稽核、F2 首次開頁無 requires-an-index | 基本合成操作已驗；未列證據的情境仍待驗 |
| S07 | CSV／列印、加密備份重新選檔驗證／第二副本；斷線未知結果保留原 ID、不重複入帳 | CSV、列印及本機備份重新選檔已驗；未知結果有 Emulator E2E 證據，現場補測依本人決定留後續。獨立媒體副本延期，本機第二資料夾不算獨立媒體 |
| S08 | 自訂 domain TLS、authorized domain、authDomain、OAuth redirect、Google 登入與 popup recovery | 自訂網域 Chrome 登入已驗；Safari 依本人決定跳過，popup 現場強制阻擋未驗 |
| S09 | 相容 Hosting rollback 後登入／讀取正常；資料不倒退，不刪 command／關帳版次 | 已在獨立演練專案切回相容舊版再恢復新版；重載保有登入並讀回資料，dataHead 不變，見收尾證據 |
| S10 | P15 獨立空 Spark 復原：verify／finalize、文件量／時間／quota、重新登入 | 基本獨立復原、對帳與重新登入已驗；完整 RTO 依使用者決定延期，用量為專案整體近似值 |

本次結案範圍及延期項目統一見 [P17 收尾證據](free-production-evidence.md#p17-closeout-boundary-and-compatibility-drill-2026-10-28)。

回報例：S01 PASS、S02 PASS（6 ready）；S04 FAIL auth/unauthorized-domain。不要附 token、真名單、餘額、截圖或完整 Console log。P18 正式延遲以送單 20 次、首頁冷載 5 次取 P95，記設備／網路，不能用 Emulator 時間代替。完整三日 A/L/D/R 驗收以 spec §11 為準。

## 7. 自訂 domain

已使用本人指定的 `eo.talented.com.tw`；DNS、Hosting、TLS 與 Chrome 登入的實際證據見 [自訂網域紀錄](free-production-evidence.md#p17-custom-domain-follow-up-2026-10-27)。其他新網域須先核對占用狀態，不覆寫既有服務；依 Hosting Console 的 DNS 記錄驗證並保留 ownership TXT，等 TLS Ready 再切。

先加 Auth authorized domain，再於 Google OAuth web client 加 https://新主機/__/auth/handler。只改本機 Web config authDomain，重建新 release 並依相同順序部署，其餘 config 不變。release 的 HTTP 與 HTML CSP 只額外允許該設定的 authDomain 作為 iframe 來源，以支援由預設 Hosting 網址使用自訂驗證網域；不放行任意網域。已記錄 Chrome 登入；本人決定跳過 Safari 補測，popup 現場強制阻擋未驗，工程錯誤指引測試通過。

## 8. 回退、quota 與 P18

- 留 manifest、產物、私有 receipt，來源 revision／dirty 不混淆。首次部署無上一版新後端可回退；失敗保持停寫／維護，不能改回舊 prototype／payroll。
- 後續前端 rollback：本人在 Hosting release history 選 schema 1 且與現有 Rules/index 相容的已驗 release，重驗登入／讀取。不回滾帳務，不刪 command 取消交易；Rules/index 另核對相容性，不盲目一起回退。
- 確認 service worker 更新，關舊分頁重開。不以重建 dataset、清真 command 或載 prototype 快照修帳。
- 每日 Usage／儲存門檻、100 筆日常容量裁定與重評觸發見[備份 runbook](firebase-backup-runbook.md)。超額先停寫／備份／紙本，不升級 billing、不刪歷史換容量。
- P17 通過後，全新空正式營運 project 依同流程建置；P18 本人核對真實資料再從 UI 輸入。三日對帳、還原／第二副本、鍵盤／IME／視窗與本人簽收完成前，不稱正式可用。

## 9. GitHub Actions 部署（本人觸發並核准）

本機第 3、4 節之外的另一個入口（信任範圍：部署 job 有 OIDC 權限，job 內執行的依賴與 build 程式理論上也能要 token；workflow 以 `--ignore-scripts` 安裝依賴，但 build 本身的風險與本機部署相同）：`.github/workflows/deploy.yml` 從 main 建 release，依序部署 indexes → 等 composite index 全部 READY → rules → hosting。取代本機 `DEPLOY project step` 確認的是 GitHub Environment 的核准；仍先檢查 billing 未啟用、Firestore 為同 region 的 Standard Native free-tier。repo 不存任何金鑰，Google 端只信任本 repo 指定 Environment 的 OIDC token。agent 只能在本人於當次對話明確要求部署時觸發 `firebase-test`（`gh workflow run deploy.yml --ref main -f target=firebase-test`），不觸發 `firebase-production`；Review deployments 一律由本人核准，agent 不呼叫 pending_deployments API，也不以本人的 token 代為核准。

測試與正式 project 各做一次以下設定（`<ENV>` 分別是 `firebase-test`、`firebase-production`）。Google Cloud 設定都在 Spark 免費範圍內，不需要 billing。

### 9.1 Google Cloud：Workload Identity Federation 與部署用 service account

先在本機取得 repo 的數字 ID（綁 ID 而不是名稱，避免 repo 改名或被他人取用同名）：

~~~bash
gh api repos/cheerc/talented-easyorder --jq .id
~~~

在 repo root 外的終端執行，尖括號換成實值；`<PROJECT_NUMBER>` 用 `gcloud projects describe <PROJECT_ID> --format='value(projectNumber)'` 查。

~~~bash
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com cloudbilling.googleapis.com --project <PROJECT_ID>

gcloud iam workload-identity-pools create github --project <PROJECT_ID> --location global --display-name "GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc talented-easyorder --project <PROJECT_ID> --location global \
  --workload-identity-pool github --issuer-uri https://token.actions.githubusercontent.com \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.ref=assertion.ref,attribute.environment=assertion.environment" \
  --attribute-condition "assertion.repository_id == '<REPO_ID>' && assertion.ref == 'refs/heads/main' && assertion.environment == '<ENV>' && assertion.workflow_ref == 'cheerc/talented-easyorder/.github/workflows/deploy.yml@refs/heads/main'"

gcloud iam service-accounts create github-deploy --project <PROJECT_ID> --display-name "EasyOrder GitHub deploy"
~~~

只給部署需要的角色。不要給 Viewer、Editor、Owner 或 Firebase Admin：這些角色能讀 Firestore 帳務資料。

~~~bash
SA=github-deploy@<PROJECT_ID>.iam.gserviceaccount.com
for role in roles/firebasehosting.admin roles/firebaserules.admin roles/datastore.indexAdmin roles/browser roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding <PROJECT_ID> --member "serviceAccount:${SA}" --role "${role}" --condition None
done

gcloud iam service-accounts add-iam-policy-binding "${SA}" --project <PROJECT_ID> --role roles/iam.workloadIdentityUser \
  --member "principal://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github/subject/repo:cheerc/talented-easyorder:environment:<ENV>"
~~~

第一次執行若某一步回報缺少權限，錯誤訊息會列出權限名稱；只補該權限所屬的最小角色，並記在 evidence。

### 9.2 GitHub：Environment

repo Settings → Environments → New environment，名稱 `<ENV>`：

- **Required reviewers**：自己。單人開發不要勾 Prevent self-review，否則無法核准自己觸發的部署。
- 不勾 **Allow administrators to bypass configured protection rules**。
- **Deployment branches and tags**：Selected branches and tags，只加 `main`。
- **Environment variables**（不是 secrets）：這些值本來就會出現在已部署站台的前端程式裡，但公開 repo 的 Actions run log 任何人都看得到，會顯示 project ID、Web config 與 service account email。

| 名稱 | 值 |
|---|---|
| `EASYORDER_DEPLOY_PROJECT` | Firebase project ID |
| `EASYORDER_REGION` | Firestore region，例如 `asia-east1` |
| `EASYORDER_WEB_CONFIG` | 第 2 節六個公開 Web config 欄位的單行 JSON |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github/providers/talented-easyorder` |
| `GCP_SERVICE_ACCOUNT` | `github-deploy@<PROJECT_ID>.iam.gserviceaccount.com` |

### 9.3 部署、核對與停用

1. 確認要部署的 commit 已在 main，且該 commit 的 Frontend CI（push）成功；workflow 會再檢查一次，沒有就停。
2. Actions → **Deploy to Firebase** → Run workflow，branch 選 `main`，target 選 `<ENV>`。`firebase-test` 也可由本人要求 agent 以上述 `gh workflow run` 觸發；`firebase-production` 只由本人觸發。
3. 等 run 顯示 Waiting，本人按 **Review deployments** 核對 commit 後 Approve（不論由誰觸發）。
4. 完成後在 evidence 記 run URL 與 commit（run log 會印出各步結果）；workflow 不上傳 release／receipt artifact，因為公開 repo 的 artifact 任何登入使用者都能下載。照第 6 節做 smoke 並匿名回報。CI 部署成功不等於 smoke 通過。

任一步失敗會停在該步，後面的步驟不執行；修正後重跑整個 workflow（從新 release 重部署，不跳步）。index 30 分鐘內未 READY 會停在 rules 之前。回退依第 8 節，在 Hosting release history 由本人操作。

停用：刪除 Environment，或刪除 service account 上的 `roles/iam.workloadIdentityUser` binding，或停用 identity pool；三者任一都會讓 workflow 拿不到 Google 授權。

## Agent 可重跑的 demo 驗證

~~~bash
node --test scripts/__tests__/release.test.mjs
./deploy.sh prepare --project demo-easyorder --web-config docs/ops/firebase-web-config.demo.json \
  --out /tmp/easyorder-p17-demo-release --emulator
./frontend/node_modules/.bin/firebase emulators:exec --project demo-easyorder \
  --config /tmp/easyorder-p17-demo-release/firebase.json --only auth,firestore,hosting \
  "node scripts/p17-hosting-smoke.mjs --release /tmp/easyorder-p17-demo-release"
~~~

demo release 只在生成產物 CSP 允許本機 Emulator origin；正式 repo CSP 不允許 Emulator。demo release 禁止正式 deploy。Hosting smoke 不 bypass CSP，只證明本機 SPA／headers／cache／signed-out app，不證明正式 OAuth、index、quota 或計費。
