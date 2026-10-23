# P15 可續跑復原 CLI 與災難演練：執行計畫

日期：2026-10-23。基準：main `5a074bf`（#544 合併後）。本檔是計畫分支文件，不進 main。

來源：

- 後端計畫 P15：`docs/superpowers/plans/2026-10-13-free-production-backend-plan.md` §4「P15 — 可續跑復原與災難演練」（scope／CLI 正式接口／acceptance）。
- 後端 spec：`docs/superpowers/specs/2026-10-13-free-production-backend-spec.md` §9.2 可重播備份、§9.3 復原、§4.2 租約與 `accessEvents` epoch 下限、§11 案例 R02。
- P14 備份格式：`frontend/src/firebase/cloudBackup.ts`（`BackupManifest`、`decryptBackup`、`validateBackupManifest`、`replayBackupProjections`、`recalculateBackupTotals`、`stableJson`、`sha256Hex`）、`frontend/src/firebase/cloudBackupRepository.ts`（`exportRange`）、`docs/ops/firebase-backup-runbook.md`。
- 初始化輸出契約：`docs/ops/p05-datahead-bootstrap-manifest.schema.json`。
- #544 審查小建議（reviewer r1 VERIFIED，兩項 nit）。

## 1. 目標、範圍與排除

### 目標

把 P14 的加密增量備份鏈，經由 repo root 的本機 Node CLI，**驗包 → 解密 → 重播到指定 H → 分批、可續跑地載入空的隔離專案 → 對帳 → 重建 operators 與空租約 → 解除維護**。全部在 Emulator（`demo-easyorder` 產生來源、`demo-easyorder-restore` 當還原目標）以合成資料證明；真實獨立 Spark 空專案演練是 CheerC 本機步驟，用 runbook 交接。

### 範圍內

1. CLI `scripts/easyorder-data-maintenance.mjs`，子命令 `validate`、`init`、`restore`（預設 dry-run）、`resume`、`verify`、`finalize`。
2. 不新增 npm 依賴：CLI 直接重用 `cloudBackup.ts` 的驗證／重播程式；寫入走 Firestore REST v1（Emulator 用 `Bearer owner`，正式用 CheerC 本機的短期 access token）。
3. Emulator 演練測試 `npm run test:cloud-restore`，並加進 CI。
4. 復原 runbook、spec §9.3 細節補齊、evidence、handoff。
5. #544 兩個 nit（獨立小 PR）。

### 排除

- 不改 Firestore Rules、indexes、command kind、P14 備份格式。`dataHead.maintenance` 仍只有維護者（IAM）能改，Rules 已拒絕 client 改它（`firestore.rules` `match /system/dataHead`：`affectedKeys().hasOnly(['seq','lastCommandId','updatedAt'])`）。
- 不提供 F3 或任何 UI 復原入口（spec §9.3「禁止在正常 F3 提供任意覆蓋」）。
- 不清空、不覆蓋任何既有專案。同一專案「停機清空後復原」只寫進 runbook 的未來事故流程，CLI 一律拒絕 seq>0 或非空的目標。
- 不碰正式專案、正式金鑰、Blaze。thread 不執行任何非 `demo-` 專案的指令。
- 不做每月 checkpoint 合併與舊增量刪除（runbook 已寫明保留完整鏈）。
- 容量（兩年 250,000 commands 的寫入／讀取外推）屬 P16；P15 只輸出「本次還原需要幾次寫入、需要幾天」的估算與實測。

## 2. 已驗證的事實與可行性 spike（planner 於 2026-10-23 實跑）

| 事實 | 證據 |
|---|---|
| `scripts/easyorder-data-maintenance.mjs` 尚不存在；root `scripts/` 只有 `preflight-worktree.sh`。 | `ls scripts` |
| CI 與 `frontend/package.json` 都是 Node 24；`tsconfig.app.json` 已開 `erasableSyntaxOnly`、`allowImportingTsExtensions`。 | `.github/workflows/ci.yml` line 72／489；`frontend/package.json` engines |
| Node 原生型別剝除 + 一個 15 行的 `module.register` resolve hook（相對路徑無副檔名時補 `.ts`），可以直接 `import` `frontend/src/firebase/cloudBackup.ts`（連同 `firebase/firestore`、`domain/cloudCommandSchema`），`encryptBackup`／`decryptBackup` 往返成功，600,000 次 PBKDF2 解密約 120 ms。 | spike：Node 22.22，`node run.mjs` 列出全部 export 並解密成功 |
| Firestore Emulator REST `POST .../documents:commit` 帶 `Authorization: Bearer owner` 可繞過 Rules 寫入任意專案（含 `demo-easyorder-restore`）；`currentDocument.exists=false` 前置條件讓重送同一批得到 409 `ALREADY_EXISTS` 而不是覆蓋；不帶 owner 讀取被 Rules 拒絕（證明 `firebase.json` 的 Rules 也套用在 restore 專案）；`timestampValue` 保留微秒。 | spike：`npx firebase emulators:exec --project demo-easyorder --config ../firebase.json --only firestore` 內 curl |
| 備份 record 欄位比 command 文件多 `datasetId`、`schemaVersion`；command 文件欄位固定為 `commandEnvelope` 的 16 個鍵。 | `firestore.rules` `commandEnvelope`（line ~250）；`cloudBackupRepository.ts` `recordFromSnapshot` |
| `projectionState` 涵蓋 `days/`、`days/{d}/settlements/{n}`、`students/`、`vendors/`、`transactions/`、`backfillDays/`、`postCloseEntries/`；**不含** `studentCodes/{code}` 索引、`system/dataHead`、`operators/`、`system/accessLease`、`accessEvents/`。 | `cloudBackup.ts` `resourcePath`；`firestore.rules` match 清單 line 2192–2354 |
| `studentCodes/{code}` 欄位固定 `studentId`、`lastCommandId`、`updatedAt`，`lastCommandId` 是最後一個設定此代號的 `CreateStudent`／`ChangeStudentCode`，`updatedAt` 等於該 command 的 `committedAt`。 | `firestore.rules` `studentCodeCreateCommand` line 2098 |
| 每筆 command 的 `after.head` 是完整 dataHead（含 `goLiveDate`、`maintenance`、`updatedAt`）。 | `cloudBackup.ts` 驗 `headAfter` 鍵；Rules `command.after.head == headAfter` |
| operator 文件格式由 `frontend/src/firebase/operatorAdmin.ts` `buildOperatorDoc` 產生（uid、email 小寫、displayName、active），加 `createdAt`／`updatedAt`。 | 檔案本身 |

## 3. 共用設計（Rulings）

- **Ruling R1：CLI 是零依賴 launcher + TS 核心。** `scripts/easyorder-data-maintenance.mjs` 只做：檢查 Node ≥ 22.18（建議 24）、`register('./lib/ts-extension-hook.mjs')`、`import('../frontend/src/maintenance/cli.ts')` 並把 `process.argv`、stdin、stdout、exit code 交給它。業務邏輯全在 `frontend/src/maintenance/*.ts`，可被 Vitest 直接測。— 理由：P15 計畫要求「依 repo 既有 Node 依賴可執行」且接口固定為 `node scripts/...mjs`；重用 `cloudBackup.ts` 才能保證 CLI 與 F3 用同一套驗證，不複製一份會漂移的驗證器。Vite 8／Vitest 4 已無 vite-node，`tsx` 不在依賴內。前提：`frontend/` 已 `npm ci`（`firebase/firestore` 從 `frontend/node_modules` 解析）；launcher 找不到時要給明確訊息。
- **Ruling R2：寫入只走 Firestore REST v1 `documents:commit`，不加 `firebase-admin`。** 目標由環境決定：有 `FIRESTORE_EMULATOR_HOST` 時打 `http://$HOST`，`Authorization: Bearer owner`，且 `--project` 必須以 `demo-` 開頭；沒有時打 `https://firestore.googleapis.com`，token 只從環境變數 `EASYORDER_ACCESS_TOKEN` 讀（runbook 教 CheerC 用 `gcloud auth print-access-token` 臨時設定），`--project` 不得以 `demo-` 開頭。token 不寫檔、不印出、不進報告。— 理由：spec §9.3「ADC／短期憑證、不內嵌 service account key」；REST 在 Emulator 與正式的語意相同，Emulator 測試即覆蓋正式路徑的資料編碼與前置條件。
- **Ruling R3：密碼只從 stdin 讀。** TTY 時隱藏輸入；非 TTY 時讀第一行（測試用）。不接受 `--password` 參數或環境變數（避免進 shell history／CI log）。整條鏈共用一個密碼；需要不同密碼時 chain 檔可為每包標 `passwordPrompt` 序號，CLI 依序詢問（實作者可視情況只做單一密碼，並在 runbook 寫明限制）。
- **Ruling R4：`--manifest` 指的是本機「還原鏈檔」。** 格式：

  ```json
  { "format": "easyorder-restore-chain", "version": 1, "datasetId": "<id>",
    "packages": [ { "file": "relative/or/absolute.easyorder-backup", "sha256": "<選填 64 hex>" } ] }
  ```

  `file` 以 chain 檔所在目錄解析；`sha256` 選填，填了就必須等於加密檔的 SHA-256（CheerC 可從 F3 `RecordBackup` 收據抄）。第一包必須 `fromSeq == 0` 且 `previousPackageSha256 == null`。— 理由：P15 接口寫的是單一 `--manifest <local-file>`，而復原需要整條增量鏈。
- **Ruling R5：鏈的驗證規則。** 每包先 `decryptBackup`（內含 `validateBackupManifest`）。相鄰包必須：`datasetId`、`commandSchemaVersion` 相同；`next.fromSeq == prev.toSeq`；`next.previousPackageSha256 == sha256(prev 加密檔位元組)`；`stableJson(next.baseState) == stableJson(prev.projectionState)`。`--to-seq H` 預設為最後一包 `toSeq`，可以是任何 `0..最後 toSeq` 的值；目標 projection 一律由 `replayBackupProjections(records[1..H], {})` 從 seq 1 重播，H 恰在包界時另外比對該包 `projectionState`／`totals`。
- **Ruling R6：還原計畫是確定性的文件清單。** 順序：① `commands/{id}` 依 seq；② projection 文件依路徑字典序；③ 由最終 `students/*` 與 command 歷程推導的 `studentCodes/{code}`；④ 最後一批單獨寫 `system/dataHead` 更新為 `records[H].after.head` 但 `maintenance: true`。command 文件 = record 去掉 `datasetId`、`schemaVersion`，序列化 timestamp 還原為 `timestampValue`。整數一律 `integerValue`；遇到非安全整數的 number 直接 fail closed。每批 ≤ 100 份且 ≤ 8 MiB（REST 單次上限 500 寫入／10 MiB）。計畫 digest = 所有批次 `stableJson` 的 SHA-256。
- **Ruling R7：可續跑靠「目標實況」而不是只信進度檔。** 進度檔 `<chain 目錄>/.easyorder-restore-<project>-<datasetId>-<H>.json` 只記 `{ planDigest, project, datasetId, toSeq, completedBatches, startedAt, writes }`。每批寫入都帶 `currentDocument.exists=false`，所以同一份文件不可能寫兩次。`resume` 時：重算計畫並要求 digest 相同；對第 `completedBatches` 批先讀目標——全部存在且內容相等就視為「已提交但進度檔沒寫到」並前進；全部不存在才提交；部分存在（不可能，commit 是原子的）或內容不同就 fail closed。另抽查上一批已完成的最後一份文件存在，防止進度檔被改大。
- **Ruling R8：目標前置條件（fail closed）。** `restore --execute` 第一批前：`system/dataHead` 存在、`maintenance == true`、`seq == 0`、`lastCommandId == null`、`datasetId` 與鏈相同、`goLiveDate` 與 `records[1].before.head.goLiveDate` 相同；`commands`、`days`、`students`、`studentCodes`、`transactions`、`vendors`、`backfillDays`、`postCloseEntries` 與 collection group `settlements` 每個 `pageSize=1` 列表都是空的。`init` 只在上述集合與 `system/dataHead` 都不存在時建立 bootstrap head（seq 0、`maintenance: true`），並輸出符合 `p05-datahead-bootstrap-manifest.schema.json` 的 JSON。
- **Ruling R9：dry-run 是預設。** `restore` 沒帶 `--execute` 時只做 validate、目標前置檢查（唯讀）、輸出計畫摘要與寫入估算，不寫任何文件（包含進度檔）。非 Emulator 目標另外要求在 TTY 輸入 `RESTORE <project> <datasetId> <H>` 完全相符才開始。
- **Ruling R10：寫入額度。** `--max-writes N` 預設 18,000（Spark 每日 20,000 寫入留 10%）；達到上限就在批界停下，exit code 75，印出「明天用 resume 繼續」與剩餘寫入數。報告列出總寫入數與預估天數。
- **Ruling R11：`finalize` 只在 `verify` 通過後才解除維護。** 步驟：讀目標做完整 `verify`（見下）→ 依 `--operators <local.json>` 寫 operators（`buildOperatorDoc`，不存在才建立）→ 建空租約 `system/accessLease { holderUid: null, epoch: E, updatedAt: now }`，`E = max(目標既有 accessLease.epoch, 目標 accessEvents 最大文件編號, 還原 commands 的最大 leaseEpoch)`，滿足 spec §4.2 的 epoch 下限 → 最後才把 `dataHead.maintenance` 改成 `false`（`currentDocument.updateTime` 前置條件，防止同時被改）。`accessEvents` 不還原（spec §9.2）。
- **Ruling R12：對帳報告匿名。** `validate`／`verify` 的 JSON 報告只含：datasetId、H、各集合文件數、command seq 連續性、每個營業日的 totals、settlement 版本數、學生數與「餘額總和」、各集合內容的 SHA-256 digest、計時（解密、重播、寫入、總 RTO）、寫入數。**不含**姓名、代號、個別餘額、UID、email、備註。人看的摘要同樣規則。
- **Ruling R13：測試用兩個 Emulator 專案。** 來源 `demo-easyorder` 由真正的 production writer 產生 R02 情境並用 `exportRange` + `encryptBackup` 匯出兩到三包；目標 `demo-easyorder-restore` 由 CLI 寫入。fixture 每次測試現產，不提交加密檔（避免格式漂移和二進位檔進 repo）。
- **Ruling R14：#544 nits 拆成獨立小 PR（P15n），可與 P15a 平行，不擋 P15。**

## 4. PR 拆分

依賴：P15n 獨立；P15a → P15b → P15c → P15d。一次一個 PR 進審查（coordinator merge gate 規則）。每個 PR 都要 rebase 最新 main、更新 `docs/DEVELOPMENT-HANDOFF.md`（完整 SHA、驗證、下一步）。P15a–c 沒有新 command kind、不改 Rules，所以不需要擴充 P14 export/replay，但仍跑 `npm run test:cloud-backup` 證明 P14 未受影響（P15a 會改到 `cloudBackup.ts` 的 export 時尤其必要）。

---

### P15n — #544 兩個 nit（小 PR）

**改動：**

1. `frontend/src/components/cloud/CloudOrdersPage.tsx` `itemLabel`（line ~375）：退款列目前是 `` `退款：${tx.note}` ``，同一列旁邊的 `PaperTag` 又顯示紙本號，帶前綴的退款備註會出現兩次紙本號。改成 `` `退款：${splitPaperNote(tx.note).text}` ``。
2. `frontend/src/components/cloud/CloudAccountHistoryPage.test.tsx` line ~152：GREEN 時把 `getByText('前天補登')).toBeVisible()` 放寬成 `getAllByText(...).length > 0`。改回精確斷言：查清楚文字出現在哪幾個位置（例如明細列與詳情 `<dl>`），用 `within(...)` 對每個位置各斷言一次，或斷言精確數量並在註解寫明是哪幾處。不得再用 `> 0`。

**TDD：**

- RED commit：`CloudOrdersPage.test.tsx` 新增「退款備註 `紙本A-0123：退回餘額` 的列標籤只出現一次 `A-0123`（在 PaperTag），列標籤文字是 `退款：退回餘額`」，加上第 2 點收緊後的斷言（若收緊後在現行程式就通過，則它屬於測試修正，不算 RED，PR body 說明即可）。
- GREEN commit：第 1 點的程式修正。

**驗證：** `cd frontend && npx vitest run src/components/cloud/CloudOrdersPage.test.tsx src/components/cloud/CloudAccountHistoryPage.test.tsx`；`npx tsc --noEmit`、`npm run lint`、`npm run build`。E2E 交給 CI。

**驗收：** 退款列不重複顯示紙本號；沒有 `> 0` 型的寬鬆斷言。不改 Rules／備份。

---

### P15a — CLI 骨架與離線 `validate`

**新檔：**

- `scripts/easyorder-data-maintenance.mjs`：launcher（R1）。用法錯誤 exit 64，驗證失敗 exit 2，成功 0。`--help` 列出全部子命令（還沒實作的子命令回「P15b 尚未提供」並 exit 64，不能假裝成功）。
- `scripts/lib/ts-extension-hook.mjs`：resolve hook，只對以 `frontend/src/` 開頭的相對 import 補 `.ts`，其他照原樣。
- `frontend/src/maintenance/cli.ts`：參數解析、子命令分派、exit code、stdin 密碼（R3）。
- `frontend/src/maintenance/restoreChain.ts`：讀 chain 檔（R4）、逐包解密驗證、鏈結規則（R5）、`replayTo(H)` 回傳 `{ records, projections, totals, head }`。
- `frontend/src/maintenance/restoreReport.ts`：匿名對帳報告（R12），含寫入估算（R6 的文件數）與預估天數（R10）。
- `frontend/src/maintenance/__tests__/`：單元測試（`// @vitest-environment node`，vitest 預設是 jsdom）。
- `frontend/src/firebase/__tests__/cloudRestore.spec.ts`：Emulator 測試；`frontend/src/firebase/__tests__/helpers/r02Scenario.ts`：用 production writer（`createCloudCommandRepository`、`createCloudOrderRepository`、`createCloudDayCloseRepository` 等，與 `cloudBackup.spec.ts` 同一套）產生 R02 情境並匯出加密包到暫存目錄，回傳 chain 檔路徑與密碼。情境至少含：建立學生（含之後改代號）、供應商、菜單、開帳、訂餐、繳費、櫃台收支、退款、更正、作廢、撤回、期初更正、關帳、重開、再關帳、回填日（`StartBackfill` + 帶紙本前綴的補登）、`RecordBackup`；第一包 S=0，再做兩次增量。
- `frontend/tsconfig.maintenance.json`：`lib: ES2023`（+ `DOM` 只為了 WebCrypto 型別，若需要）、`types: ["node"]`、`include: ["src/maintenance"]`；`tsconfig.json` 加 reference；`tsconfig.app.json` 加 `"exclude": ["src/maintenance"]`。新模組在這個 config 下必須零診斷。

**修改：**

- `frontend/package.json`：新增 `test:cloud-restore`（仿 `test:cloud-backup`，`EASYORDER_REQUIRE_CLOUD_RESTORE=true`，`--maxWorkers=1`）。
- `.github/workflows/ci.yml`：仿 P14 backup proof 步驟（line ~93–100）新增 P15 restore proof，用 JSON reporter 檢查 total≥1、failed=0、skipped=0。
- `cloudBackup.ts`：原則上不改。若需要匯出內部 helper（例如 `resourcePath`、`reviveTimestamps`）給 maintenance 用，只加 `export`，不改行為。

**TDD（RED 先提交）：** 測試都經過真正入口——單元測試呼叫 `cli.ts` 的 `main(argv, io)`，Emulator 測試用 `child_process.spawnSync(process.execPath, ['../scripts/easyorder-data-maintenance.mjs', ...])`，stdin 傳密碼。

| 案例 | 輸入 | 預期 |
|---|---|---|
| A1 正確鏈 | R02 三包、正確密碼 | exit 0；報告 H 等於來源 `dataHead.seq`；各營業日 totals 等於來源 `days/*.totals`；學生數、餘額總和等於來源 |
| A2 任選 H | `--to-seq` 取兩包之間的某個 seq | exit 0；重播 projection 等於「只取前 H 筆」的獨立重播；H 在包界時等於該包 `projectionState` |
| A3 錯密碼 | 錯誤密碼 | exit 2，訊息「密碼錯誤或備份內容已損毀」，無報告檔 |
| A4 毀損 | 改加密檔一個 byte | exit 2 |
| A5 缺中間包 | chain 拿掉第 2 包 | exit 2，訊息指出 fromSeq 與前包 toSeq 不接 |
| A6 錯前包雜湊 | 第 3 包的 `previousPackageSha256` 對不上（用另一次匯出的包代替） | exit 2 |
| A7 混 dataset | chain 混入另一個 datasetId 的包 | exit 2 |
| A8 chain sha 不符 | chain 檔 `sha256` 填錯 | exit 2 |
| A9 H 超出 | `--to-seq` 大於最後 toSeq | exit 64 或 2（定一個並測） |
| A10 第一包不是 S=0 | chain 從增量包開始 | exit 2 |
| A11 報告匿名 | A1 的報告 JSON 與 stdout | 不含任何學生姓名、代號、UID、email、備註字串（用 fixture 已知值逐一 `not.toContain`） |
| A12 密碼不從參數讀 | `--password x` | exit 64 |

**驗證命令（`frontend/`）：** `npx vitest run src/maintenance`；`npm run test:cloud-restore`；`npm run test:cloud-backup`；`npx tsc --noEmit`；`npx tsc -p tsconfig.maintenance.json --noEmit`（零診斷）；`npx tsc -p tsconfig.app.json --noEmit` 與 base 正規化比對；`npm run lint`；`npm run build`；root 執行 `node scripts/easyorder-data-maintenance.mjs --help`。

**驗收：** 離線 `validate` 能讀 P14 真實產生的鏈並輸出匿名對帳；所有錯鏈、錯密碼、錯包都 fail closed；CI 新增 step 且實際執行 ≥1 個測試、0 skip。

---

### P15b — `init`、`restore`（dry-run／`--execute`）、`resume`

**新檔：**

- `frontend/src/maintenance/firestoreRest.ts`：REST 目標選擇與檢查（R2）、值編碼／解碼（`integerValue`、`doubleValue` 禁用、`timestampValue` 由 `{_type:'timestamp',seconds,nanoseconds}` 轉 RFC3339 含小數、`mapValue`、`arrayValue`、`nullValue`、`booleanValue`、`stringValue`）、`commit(writes)`、`get(path)`、`listOne(collection)`、collection group 查詢（`runQuery` 帶 `allDescendants`）。fetch 可注入以便單元測試。
- `frontend/src/maintenance/restorePlan.ts`：由 `replayTo(H)` 結果產生確定性批次（R6）與 digest；`studentCodes` 推導；dataHead 最終值。
- `frontend/src/maintenance/restoreExecutor.ts`：前置檢查（R8）、逐批提交、進度檔、`--max-writes`（R10）、resume 邏輯（R7）、計時。
- `init` 子命令：`node scripts/easyorder-data-maintenance.mjs init --project <id> --dataset <id> --go-live-date YYYY-MM-DD [--execute]`，輸出 bootstrap manifest（R8）。

**CLI 接口（P15 計畫已固定的部分照抄）：**

```bash
node scripts/easyorder-data-maintenance.mjs validate --manifest <chain.json> [--to-seq H] [--report <out.json>]
node scripts/easyorder-data-maintenance.mjs init --project <id> --dataset <id> --go-live-date <date> [--execute]
node scripts/easyorder-data-maintenance.mjs restore --project <id> --manifest <chain.json> [--to-seq H] --dry-run
node scripts/easyorder-data-maintenance.mjs restore --project <id> --manifest <chain.json> [--to-seq H] --execute [--max-writes N]
node scripts/easyorder-data-maintenance.mjs resume  --project <id> --manifest <chain.json> [--to-seq H] --execute [--max-writes N]
```

`--dry-run` 與 `--execute` 互斥；兩者都沒給視為 `--dry-run`。

**TDD（RED 先提交）：** 全部在 Emulator，來源 `demo-easyorder`，目標 `demo-easyorder-restore`（測試以 `initializeTestEnvironment({ projectId: 'demo-easyorder-restore', ... })` 載入同一份 Rules，並在 `beforeEach` 清空）。

| 案例 | 輸入／狀態 | 預期 |
|---|---|---|
| B1 dry-run 不寫 | 已 `init` 的目標，`restore --dry-run` | exit 0；印出寫入數；目標除 dataHead 外沒有任何文件；沒有進度檔 |
| B2 完整還原 | `init --execute` → `restore --execute` | exit 0；目標所有業務集合（含 `studentCodes`、`settlements`）逐文件與來源 **完全相同**（用 rules-disabled context 讀兩邊、`stableJson` 比較）；`dataHead` 除 `maintenance: true` 外與來源相同 |
| B3 re-export 往返 | B2 後，在目標用 `createCloudBackupRepository(...).exportRange({fromSeq:0})`（rules-disabled db） | `records`、`projectionState`、`totals` 與來源匯出 `stableJson` 相同 |
| B4 未空庫 | 目標已有一份 `students/x` | exit 2，什麼都沒寫 |
| B5 未維護 | 目標 dataHead `maintenance: false` | exit 2 |
| B6 沒 init | 目標沒有 dataHead | exit 2 |
| B7 錯 dataset | 目標 dataHead datasetId 與鏈不同 | exit 2 |
| B8 錯目標 | Emulator 環境下 `--project easyorder-prod`（非 demo-）；或非 Emulator 環境下 `--project demo-x` | exit 64，沒有任何網路寫入（注入 fetch 斷言零呼叫） |
| B9 中斷續跑（額度） | `restore --execute --max-writes <約總數一半>` | exit 75，進度檔記錄已完成批數；`resume --execute` 後 exit 0，結果同 B2，每份文件只寫一次（比對 emulator 文件 `createTime` 不重複／總寫入數等於計畫數） |
| B10 中斷續跑（提交後當掉） | 測試 seam：在第 k 批 commit 成功後、寫進度檔前丟例外 | `resume` 偵測第 k 批已存在且相等，前進不重寫，最終同 B2 |
| B11 續跑換鏈 | 中斷後用不同 `--to-seq` 或不同 chain `resume` | exit 2（digest 不符），不寫 |
| B12 進度檔造假 | 把 `completedBatches` 改大 | exit 2（抽查文件不存在） |
| B13 維護中不可營業 | B2 後、finalize 前，用 production writer 以合法 operator／lease 送一筆 `CreatePayment` | 被 Rules 拒絕（`before.maintenance == false` 不成立） |
| B14 init 拒絕非空 | 目標已有 dataHead 或任何業務文件時 `init --execute` | exit 2 |
| B15 編碼單元 | 單元測試：負數、0、大於 2^31 的安全整數、巢狀 map、空 map、陣列、null、timestamp 微秒 | REST 值正確；非整數 number 與非安全整數 fail closed |

**驗證命令：** 同 P15a，另加 `npx vitest run src/maintenance` 涵蓋 REST 編碼與計畫 digest 的單元測試。

**驗收：** 可在乾淨 Emulator 專案完整還原，結果與來源逐文件相同、可再匯出成同一條鏈；半途停止再恢復沒有重複；錯目標、未空庫、未維護、錯 dataset 都拒絕。

---

### P15c — `verify`、`finalize` 與復原後 smoke

**新檔／修改：**

- `frontend/src/maintenance/restoreVerify.ts`：讀目標全部業務集合（分頁），與 `replayTo(H)` 的預期文件集合比較：多一份、少一份、內容不同都列出（只列路徑類別與數量，不列內容），並重算每日 totals、學生餘額（由交易重算 vs. `currentBalance`）、settlement 版本連續、command seq 1..H 連續且唯一、`dataHead.seq == H`、`lastCommandId` 正確。輸出 R12 報告。
- `finalize`：R11。`--operators <file.json>` 格式 `[{ "uid": "...", "email": "..." }]`，至少一位；檔案只在本機。
- `verify` 也可在 finalize 之後單獨執行（此時 `maintenance: false` 是預期）。

**CLI：**

```bash
node scripts/easyorder-data-maintenance.mjs verify   --project <id> --manifest <chain.json> [--to-seq H] [--report <out.json>]
node scripts/easyorder-data-maintenance.mjs finalize --project <id> --manifest <chain.json> [--to-seq H] --operators <operators.json> --execute
```

**TDD（RED 先提交）：**

| 案例 | 輸入／狀態 | 預期 |
|---|---|---|
| C1 verify 通過 | B2 之後 | exit 0；報告的數字與 P15a `validate` 一致 |
| C2 verify 抓多文件 | 目標多一份 `transactions/x` | exit 2，報告指出 transactions 多 1 |
| C3 verify 抓內容不同 | 改一位學生 `currentBalance` | exit 2，報告指出 students 內容不同 1 且餘額重算不符 |
| C4 verify 抓缺 command | 刪掉一份 command | exit 2，指出 seq 缺號 |
| C5 finalize 前置 | 未完成 restore（進度未到底）或 verify 失敗 | exit 2，`maintenance` 仍為 true，沒寫 operators／lease |
| C6 finalize 成功 | B2 之後 | operators 建立；`accessLease = { holderUid: null, epoch: max(command leaseEpoch) }`；`maintenance: false` |
| C7 epoch 下限 | 目標預先有 `accessEvents/7`，command 最大 leaseEpoch 3 | lease epoch = 7；之後 operator 用 production `activeAccountLease` acquire 成功並寫出 `accessEvents/8` |
| C8 復原後可營業 | C6 後，operator acquire → production writer 送 `CreatePayment` | 成功，seq = H+1，該學生餘額正確變動 |
| C9 備份鏈接續 | C8 後，在目標以 `exportRange({ fromSeq: H, previousManifest: 來源最後一包 manifest, previousPackageSha256: 來源最後一包 sha })` | 成功匯出含 seq H+1 的增量（證明復原後的專案能接續原備份鏈） |
| C10 finalize 不重做 | finalize 跑第二次 | exit 2 或 0 但不改 epoch、不重建 operators（定一個並測；建議 exit 2「已解除維護」） |

**驗收：** 完整 §9.3 流程在 Emulator 走通：驗包 → 重播到 H → 分批載入 → 對帳 → 重建 operators 與空租約 → 重新登入 smoke → 接續備份。

---

### P15d — runbook、演練證據與 CheerC 交接

**純文件 + 一次實際演練**（不需 RED；照 docs-check 判斷）。

- 新增 `docs/ops/firebase-restore-runbook.md`（`firebase-backup-runbook.md` 的「Restore ownership and limits」段改為連結過去，刪除「P15 未提供」的過時敘述）。內容：
  1. 何時用、誰核准（director/admin），不在正式專案上做。
  2. 前置：Node 24、`cd frontend && npm ci`、備份鏈檔與 chain JSON 範本、密碼另外保管。
  3. **Emulator 演練**（任何人可照做）：用 `npm run test:cloud-restore` 產生的 fixture 或自己的合成鏈，逐條指令 `validate → init → restore --dry-run → restore --execute → verify → finalize`，預期輸出與 exit code。
  4. **獨立 Spark 空專案演練（CheerC 本機）**，見下方 §5。
  5. 未來真實事故流程（spec §9.3 順序）：保留現況備份 → 維護 → 新的隔離 Spark 專案 → 還原 → 對帳 → operators（新 UID 重新核准）→ 空租約 → 重新登入 smoke → 切換前端設定／網域（P17 範圍）。同專案清空後復原：CLI 不支援，需另立計畫。
  6. 寫入額度與分日：報告的寫入數 / 18,000 = 天數；超過就分日 `resume`，或先用本機查帳／紙本營運；不得升級 Blaze。
  7. 記錄 RPO（最後一包 H 的 committedAt 到事故時間）與 RTO（報告的計時）。
- `docs/ops/free-production-evidence.md` 新增 P15 節：Emulator 演練實測（文件數、寫入數、各階段秒數、PBKDF2 解密時間），標「真實 Spark 演練：UNVERIFIED，待 CheerC」。
- spec §9.3：補上 CLI 子命令、`maintenance` 前置、epoch 下限計算、REST／token 方式（只描述，不改契約語意）。
- plan P15 狀態列、handoff、`docs/PROJECT-STATUS.md`（若該檔記錄後端階段）。
- 實作者必須在乾淨 clone 上照 runbook 第 3 節逐字跑一次 Emulator 演練，把實際輸出（匿名）貼進 evidence；跑不通就是 runbook 錯，要修 runbook 而不是在 evidence 寫「通過」。

**驗證：** docs link/path 檢查；runbook 中每條指令都在本 PR 的 head 上實跑過（附輸出摘要）；`node scripts/easyorder-data-maintenance.mjs --help` 與 runbook 一致。

## 5. CheerC 交接：獨立 Spark 空專案還原演練（thread 不執行）

在 P15c 合併後，由 CheerC 在自己的電腦做一次。thread 只提供 runbook，回報的匿名數字由後續 PR 記入 evidence；未回報前一律標 UNVERIFIED，P15 acceptance 的「獨立 Spark 空庫恢復」不算完成。

1. 在 Firebase console 建一個**新的**專案（例如 `easyorder-restore-drill-<日期>`），確認是 Spark、沒有綁計費，不是 payroll，也不是未來的正式 EasyOrder 專案。
2. 建立 Firestore（Native 模式），在 repo root 用 `npx firebase deploy --only firestore:rules,firestore:indexes --project <drill-id>` 部署 Rules 與 indexes（確認 CLI 目標是 drill 專案）。啟用 Google 登入，只加自己的帳號。
3. 準備一條**合成資料**的備份鏈（在本機 prototype 以外的 Emulator 或測試資料產生；不要用真實學生資料，P18 之前沒有正式資料）。
4. `gcloud auth login`，`export EASYORDER_ACCESS_TOKEN="$(gcloud auth print-access-token)"`（一小時有效，不寫檔）。
5. 依序：`validate` → `init --execute` → `restore --dry-run`（看寫入數）→ `restore --execute`（輸入確認字串）→ `verify` → `finalize --operators <自己 UID 的本機檔> --execute`。過程中記下開始與結束時間。
6. 用本機前端指向 drill 專案（runbook 會寫明需要的環境變數）登入，確認看得到還原的學生與日結，送一筆測試繳費成功。
7. 在 Firebase console Usage 看當日寫入／讀取量。
8. 回報給 thread（匿名）：H、文件數、寫入數、console 寫入／讀取量、RTO、各階段秒數、有沒有任何錯誤訊息。之後可刪除 drill 專案。

## 6. 風險與防護

| 風險 | 防護 |
|---|---|
| Node 原生 TS 載入遇到非 erasable 語法或無副檔名 import | `erasableSyntaxOnly` 已開；hook 只處理相對路徑；CI 跑 `node scripts/... --help` 與 Emulator 演練實際啟動 CLI。若某個 import 鏈拉進 React／DOM 專用模組，改由 maintenance 只 import 純資料模組，不改那些模組。 |
| command 文件重建與原文件有一個欄位差異（例如多了 `datasetId`） | B2 逐文件比較 + B3 re-export 往返；任何差異都會讓測試失敗。 |
| timestamp 精度 | 來源 Firestore 只有微秒；`nanoseconds` 應為 1000 的倍數，不是就 fail closed。B2 比較會抓出差異。 |
| `studentCodes` 推導錯（改過代號的學生） | R02 情境必含 `ChangeStudentCode`；B2 比較含 `studentCodes`。 |
| 部分寫入或重複寫入 | 每批原子 commit + `exists=false`；R7 用目標實況判斷；B9／B10／B12。 |
| 寫到錯專案 | R2 的 demo-/非 demo- 雙向檢查、R8 前置條件、R9 確認字串；B8。 |
| 寫入額度超過 Spark | R10；報告估算天數。 |
| 解密密碼外洩 | R3；報告與 log 不含密碼、token；A12。 |
| 復原後 epoch 撞到舊事件 | R11 的 E 計算；C7。 |
| 讀取額度（verify 全讀） | verify 讀取數 ≈ 文件數；報告列出；大量資料的讀取外推屬 P16。 |
| App TSC 既有診斷 | `src/maintenance` 移出 app config，另有零診斷 config；app 診斷做 base 正規化比對。 |

## 7. 每個 PR 共同要求

- RED 與 GREEN 分兩個 commit（P15d 純文件除外）；RED 必須因行為失敗，不能是缺檔或編譯錯誤。
- 不跳過、不停用測試；Emulator 套件循序跑（`--maxWorkers=1`）；skip 不算通過。
- 只用 `demo-` 專案與合成資料；不提交任何加密備份檔、token、真實姓名。
- PR body 依 repo PR template，列 base／head 完整 SHA、實際跑過與沒跑的驗證。
- Rules 沒有變更：PR body 寫明「Rules 未改，無需量測」。若實作中發現必須改 Rules，停下回報 coordinator，不自行改。
