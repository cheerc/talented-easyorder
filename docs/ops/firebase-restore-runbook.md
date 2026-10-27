# EasyOrder 備份還原 Runbook

> **狀態（2026-10-27）：** 獨立 Spark 空庫已以合成備份完成還原、對帳、登入與合成繳費；完整用量與正式 RTO 尚未驗證。步驟與限制見 [P17 live evidence](free-production-evidence.md#p17-user-authorized-live-verification-2026-10-27)。備份檔本身不是「還原已被測試」的證據。

本文件是 [備份 runbook](firebase-backup-runbook.md) 的還原篇。契約來源是 [後端 spec §9.3](../superpowers/specs/2026-10-13-free-production-backend-spec.md)，CLI 的設計裁決在 [P15 計畫](../superpowers/plans/2026-10-13-free-production-backend-plan.md) 的 P15 段。

首次安裝且沒有備份鏈的空白啟用，改用 [P17 部署指南](DEPLOYMENT-GUIDE.md) 的 init／activate-empty；本篇只處理既有備份鏈復原。

## 1. 何時用、誰核准

- 核准：director/admin。開發者或支援人員只能在 director/admin 核准後協助。
- **一般營運不會用到。** F3 不提供任何還原或覆蓋功能；不得把備份包匯入正在使用的資料庫、手動修改 Firestore、或刪除正式資料當作復原手段。
- **CLI 只寫入全新、乾淨、維護中的隔離專案**：目標必須已 `init`（`dataHead.maintenance=true`、seq 0）且沒有任何業務文件。同專案清空後原地復原，CLI **不支援**，需要另立計畫。
- 兩種用途：Emulator 演練（第 3 節，任何人、任何時候）與獨立 Spark 空專案演練／真實事故（第 4、5 節，只有 director/admin 核准後，在自己的電腦）。**不要**把這個工具指向 payroll 或正式 EasyOrder 專案。

## 2. 前置

- Node 22.18 以上（建議 24；演練證據在 Node 22.22 上取得）。在 repo 的 `frontend/` 執行一次 `npm ci`；launcher 不需要其他依賴。
- 備份鏈：F3 匯出、已存到核准位置的加密增量包，由第一包到最後一包完整、依序、中間沒有缺口。整條鏈用同一組密碼，只問一次；密碼**另外保管**，只從標準輸入讀取（終端機不回顯；管線讀第一行），不接受命令列參數，也不寫入報告或 log。
- 鏈檔 `chain.json`（放在備份包所在的資料夾，檔名相對於它）：

  ```json
  {
    "format": "easyorder-restore-chain",
    "version": 1,
    "datasetId": "<資料集 ID，與備份包相同>",
    "packages": [
      { "file": "第一包檔名.easyorder-backup", "sha256": "<64 位小寫十六進位；可整個省略此欄位，不可寫 null>" },
      { "file": "第二包檔名.easyorder-backup", "sha256": "<...>" }
    ]
  }
  ```

  有填 `sha256` 時 CLI 會先比對檔案摘要，不符就拒絕。順序錯、缺包、跨資料集、被改動的包都會在 `validate` 就 fail closed。
- `--help` 列出全部子命令與選項：`node scripts/easyorder-data-maintenance.mjs --help`。
- 結束碼：`0` 完成、`2` 檢查失敗（資料、備份鏈或目標不可接受）、`64` 用法錯誤、`75` 達到寫入上限而暫停（用 `resume` 繼續）、`1` 非預期錯誤（含連不上目標）、`69` 環境不符（Node 版本或沒做 `npm ci`）。

## 3. Emulator 演練（任何人可照做）

只用合成資料與 `demo-` 專案，不需要任何帳號或憑證。以下指令在乾淨 clone 上逐字跑過。以下在 repo root 或 `frontend/` 執行，標示的地方會寫明。

**3.1 產生合成備份鏈**（`frontend/`；約 25 秒）：

```bash
cd frontend
EASYORDER_P15_FIXTURE_DIR=/tmp/easyorder-drill/chain npm run restore:drill-fixture
```

預期：`Tests  1 passed (1)`。`/tmp/easyorder-drill/chain/` 有 `chain.json` 與 `r02-package-1/2/3.easyorder-backup`（另有一個故意接錯上一包的 `r02-package-3-wrong-previous.easyorder-backup`，不在 `chain.json` 內，用來示範鏈驗證會拒絕）。合成鏈的備份密碼固定為 `p15-fixture-password`，資料集 `anonymous-p15-r02`，go-live 日 `2026-10-01`，共 37 筆命令、3 包、2 位合成學生。

**3.2 啟動 Firestore Emulator**（另開一個終端機，`frontend/`，保持執行）：

```bash
cd frontend
npx firebase emulators:start --only firestore --project demo-easyorder-restore --config ../firebase.json
```

看到 `All emulators ready!` 後繼續。

**3.3 還原到 Emulator 的乾淨專案**（repo root；`FIRESTORE_EMULATOR_HOST` 讓 CLI 只寫 Emulator，並要求 `--project` 以 `demo-` 開頭）。下面用 `printf` 把合成密碼接到標準輸入；**真實備份時不要這樣做，直接執行指令，在提示時輸入密碼**。

```bash
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
CH=/tmp/easyorder-drill/chain/chain.json
PW() { printf '%s\n' p15-fixture-password; }
echo '[{"uid":"drill-operator","email":"drill@example.test"}]' > /tmp/easyorder-drill/operators.json
```

| 步驟 | 指令（都接在 `PW \|` 之後） | 預期 |
|---|---|---|
| 驗包、解密、重播（離線、唯讀） | `node scripts/easyorder-data-maintenance.mjs validate --manifest $CH --report /tmp/easyorder-drill/validate.json` | exit 0；`驗證通過…重播到 seq 37（共 3 個備份包）`；`預估還原寫入 64 次` |
| 試算 init | `node scripts/easyorder-data-maintenance.mjs init --project demo-easyorder-restore --dataset anonymous-p15-r02 --go-live-date 2026-10-01` | exit 0；`試算（不寫入）`；沒有 `--execute` 什麼都不寫 |
| init | 同上加 `--execute` | exit 0；建立維護模式的 `system/dataHead`（seq 0），印出 bootstrap manifest |
| 試算還原 | `node scripts/easyorder-data-maintenance.mjs restore --project demo-easyorder-restore --manifest $CH --dry-run` | exit 0；`文件 64 份（命令 37、投影 24、學生代號 2、dataHead 1），分 2 批`；`目標檢查通過` |
| 還原 | `node scripts/easyorder-data-maintenance.mjs restore --project demo-easyorder-restore --manifest $CH --execute` | exit 0；`累計 64/64，批 2/2`；`還原完成，目標仍在維護模式` |
| 對帳 | `node scripts/easyorder-data-maintenance.mjs verify --project demo-easyorder-restore --manifest $CH --report /tmp/easyorder-drill/verify.json` | exit 0；`對帳通過`；各集合預期＝實際；`命令 seq：連續`；`每日合計：相符`；`學生餘額重算：檢查 2、不符 0`；`日結版本：連續` |
| 試算 finalize | `node scripts/easyorder-data-maintenance.mjs finalize --project demo-easyorder-restore --manifest $CH --operators /tmp/easyorder-drill/operators.json` | exit 0；先印 verify 結果，再 `試算（不寫入）：verify 通過。操作員：新建 1、已存在 0；空租約 epoch 7；最後解除維護` |
| finalize | 同上加 `--execute` | exit 0；`finalize 完成`；之後 `verify` 會顯示 `維護 已解除` |
| 再 finalize（重複） | 同上加 `--execute` | **exit 2**；`目標已經解除維護…finalize 不重做`；不改動目標 |

`finalize` 預設只試算；它先跑一次完整 `verify`，通過才動手，順序是先建立 operators 與空租約，**最後**才用 `updateTime` 前置條件解除維護。中途當掉可以重跑：已存在且內容相同的 operator 與租約沿用，內容衝突則拒絕。

**額度中斷與續跑的示範**（用另一個 `demo-` 專案，才有乾淨目標）：

```bash
P="--project demo-easyorder-restore-2"
PW | node scripts/easyorder-data-maintenance.mjs init $P --dataset anonymous-p15-r02 --go-live-date 2026-10-01 --execute
PW | node scripts/easyorder-data-maintenance.mjs restore $P --manifest $CH --execute --max-writes 30 --batch-size 10   # exit 75
PW | node scripts/easyorder-data-maintenance.mjs resume  $P --manifest $CH --execute --batch-size 10                  # exit 0
```

第一次寫 30 筆（3 批）後在批界停下，exit 75，`累計 30/64，批 3/8`；`resume` 讀進度檔（`<備份包資料夾>/.easyorder-restore-<project>-<datasetId>-<H>.json`，只有計數與計畫摘要，沒有業務資料）、再以目標實況核對，寫入剩下的 34 筆。`--batch-size` 與 `--to-seq` 必須與原來相同，否則計畫摘要不同，`resume` 拒絕。

**3.4 收尾：** 停掉 Emulator（Ctrl-C），刪除 `/tmp/easyorder-drill/`。合成鏈不含真實資料，但仍不要提交到 repo。

## 4. 獨立 Spark 空專案演練（經使用者授權，在本機執行）

目的：在**真實 Firestore** 上實測一次，補上 Emulator 無法證明的部分（真實 token 路徑、終端機確認、額度、RTO）。各項是否完成依實際證據分別標記，不以部分演練證明完整驗收。

1. 在 Firebase console 建一個**新的**專案（例如 `easyorder-restore-drill-<日期>`）：確認是 Spark、沒有綁計費，**不是** payroll，也不是未來的正式 EasyOrder 專案。
2. 建立 Firestore（Native 模式）。在 repo root 部署 Rules 與 indexes，**先確認 CLI 目標是 drill 專案**：

   ```bash
   npx firebase deploy --only firestore:rules,firestore:indexes --project <drill-id>
   ```

   啟用 Google 登入，只加自己的帳號。
3. 準備**合成資料**的備份鏈（用第 3.1 節的產生器，或在 Emulator 以測試資料產生；P18 之前沒有正式資料，不要用真實學生資料）。
4. 登入 gcloud 並取短期 access token（一小時有效，只放在環境變數，不寫檔）：

   ```bash
   gcloud auth login
   export EASYORDER_ACCESS_TOKEN="$(gcloud auth print-access-token)"
   unset FIRESTORE_EMULATOR_HOST     # 沒有 Emulator 變數時才會連真實 Firestore
   ```

   CLI 在真實目標上：`--project` 不得以 `demo-` 開頭；`init`、`restore`、`resume`、`finalize` 的 `--execute` 必須在**終端機**執行，並輸入確認字串（`INIT <project> <dataset>`、`RESTORE <project> <dataset> <H>`、`FINALIZE <project> <dataset> <H>`）；非終端機（管線、CI）會被拒絕。密碼在提示時輸入，不要用管線。
5. 依序執行，並記下開始與結束時間：`validate` → `init --execute` → `restore --dry-run`（看寫入數）→ `restore --execute` → `verify` → `finalize --operators <本機檔> --execute`。`--operators` 檔放自己的 Firebase Auth UID 與 email，只留在本機：

   ```json
   [{ "uid": "<你的 Firebase Auth UID>", "email": "<你的 Google 帳號>" }]
   ```

6. 把本機前端指向 drill 專案（`frontend/.env.example` 列出需要的 `VITE_FIREBASE_*` 變數，`VITE_FIREBASE_USE_EMULATOR=false`，`VITE_FIRESTORE_ENDPOINT=https://firestore.googleapis.com`，網域限制 `VITE_ALLOWED_EMAIL_DOMAIN` 依自己的帳號調整）。登入、取得使用權，確認看得到還原的學生與日結，送一筆測試繳費成功。登入失敗時請連同錯誤畫面文字（不含 token）回報。
7. 在 Firebase console 的 Usage 看當日寫入／讀取量。
8. 回報（匿名）：H、文件數、寫入數、console 寫入／讀取量、RTO（開始到能登入收款）、各階段秒數、任何錯誤訊息。之後可刪除 drill 專案。回報後由後續 PR 記入 evidence。

## 5. 真實事故流程（spec §9.3 順序）

1. 保留現況備份（能匯出就先匯出一包，確認第二份副本）。
2. 維護模式停止業務（停止使用現有專案的寫入）。
3. 建立新的隔離 Spark recovery project，部署 Rules 與 indexes（同第 4 節 2）。
4. `validate`（驗包、解密、重播）→ `init --execute` → `restore --execute`（分批、可續跑）。
5. `verify`：缺少／多出／內容不同、命令 seq、每日合計、學生餘額、日結版本逐項對帳；有任何不符就停止，不 finalize。
6. `finalize --operators <新 UID 的本機檔> --execute`：Auth UID 可能因新專案而不同，**重新核准**白名單；歷史 actor 的 UID／email 快照保留來源，不改。空租約 epoch 取「既有租約、`accessEvents` 最大編號、命令鏈最大 `leaseEpoch`」的最大值（spec §4.2 下限）。`accessEvents` 不屬於備份鏈，不還原。
7. 重新登入 smoke（第 4 節 6）。
8. 切換前端配置／網域（P17 範圍，由 CheerC 本機操作）。

## 6. 寫入額度與分日

`validate` 與 `restore --dry-run` 會印「預估寫入 N 次，以每日 18000 次計約 D 天」；每日預設上限 18000（Spark 每日 20,000 寫入額度留 10% 餘裕，給重試與當日營運）。N 超過一天就分日：`--max-writes` 在批界停下（exit 75），隔天 `resume --execute`（同一個 `--manifest`、`--to-seq`、`--batch-size`）。也可以先在本機查帳／紙本營運。**不得為了趕 RTO 而升級 Blaze**。`verify` 會讀回全部文件，讀取數約等於文件數（報告列出）；大量資料的讀取外推屬 P16。

## 7. 記錄 RPO 與 RTO

- RPO：最後一包的 `committedAt`（鏈上最後一筆命令）到事故發生時間。
- RTO：事故宣告到操作員能登入收款。CLI 報告的各階段計時（解密、重播、寫入、讀回）只是其中一部分；人工步驟（建專案、部署、登入）要自己記。
- 目標 RPO ≤ 1 營業日、RTO ≤ 4 小時是**設計目標，不是服務保證**。演練前沒有實測值，P18 不宣稱達標；未能在演練容量達 4 小時就如實記錄。

## 8. 報告與隱私

CLI 的報告與輸出只有計數與計時：沒有姓名、學生代號、餘額、文件路徑、UID、email、密碼或 token。處理方式仍照常：備份包與密碼不進 repo、不貼進 issue 或 log；演練回報只回匿名數字。
