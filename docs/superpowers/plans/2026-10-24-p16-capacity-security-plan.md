# P16 容量、安全與查詢整合驗證：執行計畫

日期：2026-10-24。基準：main `f922c73`（#549 P15d 合併後）。本檔是計畫分支文件，不進 main。

來源：

- 後端計畫 P16：`docs/superpowers/plans/2026-10-13-free-production-backend-plan.md` §4「P16 — 容量、安全與查詢整合驗證」（scope：cloud tests、indexes、evidence、CI、必要最小讀取優化；RED/GREEN 與 Acceptance 原文）。
- 後端 spec：`docs/superpowers/specs/2026-10-13-free-production-backend-spec.md` §2（Spark 額度表）、§8（查詢策略與 indexes 清單）、§10（驗證包絡、目標日讀取 < 25,000、寫入 < 10,000、單 command ≤ 64 KiB、70%／85% 警戒、1 GiB 外推）、§11（A01–A04、L08–L10、R04）、§14（P16 gate 失敗時交證據與最小修訂方案，不自行降安全或開計費）。
- Rules 存取次數與 expression 預算：`docs/ops/p05-rules-budget.md`（各 kind 的 no-cache access call 圖、line 55「7／11 BatchGet read-RPC dependency 另列 P16 read-cost 帳」、P13c1 lease／accessEvents 次數）。
- 剩餘工作盤點：`/mnt/project-files/notes/P13後剩餘工作.md` §1、§3（P16 結束時 CheerC 只在推算超出 Spark 額度時需要決定）。

## 1. 目標、範圍與排除

### 目標

用 Emulator＋合成資料，對「正式後端在 spec §10 包絡下能不能留在 Spark 免費額度 50% 內、Rules 是否對全部 27 種 command 都閉合、client 是否只經 command／lease 寫入、查詢是否都有約束與對應 index」給出可重跑的證據與 CI gate。量不到的正式網路延遲明確標 UNVERIFIED，留給 P18。

### 範圍內

1. 靜態寫入面 guard：production client 只有 `cloudCommandRepository.ts`（commands＋投影同一 transaction）與 `activeAccountLease.ts`（lease＋`accessEvents`）可以寫 Firestore。
2. 全部 27 kind 的 Rules allow／deny 矩陣（Emulator），加上不可變集合與讀取授權矩陣。
3. 所有 client list 查詢必須帶 `limit`（Rules 新增約束＋修正目前沒帶 limit 的查詢）。
4. SDK 邊界的讀寫計量器、每項操作的實測成本表、查詢形狀紀錄。
5. 容量模型（純函式）：日讀寫量、Rules dependent reads 保守上界、儲存與 index 項目大小、兩年外推。
6. 歷史規模驗證（會隨歷史成長的掃描）、尖峰 60 筆／60 秒、同 UID 雙頁競爭、index 覆蓋與未用 index 清理、evidence、CI 步驟。

### 排除

- 不碰正式專案、正式金鑰、Blaze、部署；不在任何非 `demo-` 專案執行指令。正式網路 P95（送單 < 2 秒、首頁 < 3 秒）thread 量不到，一律 UNVERIFIED，P18 補。
- 不新增 command kind、不改 P14 備份格式（所以不需擴充 export/replay；仍依專案規則每個 PR 跑 `npm run test:cloud-backup`）。
- 不先做讀取優化。只有 P16e 的 gate 失敗時才開 P16f，且任何會拿掉完整性檢查或稽核的優化（例如 `cloudReadRepository.ts` 的 `documentIdProof` 第二次查詢）都要先帶證據問 CheerC（spec §10「不裁掉稽核或安全驗證」、§14）。
- 不做 P17 的 Hosting／headers／deploy，也不依賴 P15 的獨立 Spark 演練（那仍是 CheerC 本機工作、UNVERIFIED）。
- 不改 UI 行為；不加 app 內延遲計時器（見 Ruling R9）。

## 2. 已驗證的事實與 spike（planner 2026-10-24 實跑）

| 事實 | 證據 |
|---|---|
| `ALL_COMMAND_KINDS` 共 27 種，Rules `validCommandCreate` 對 27 種都有分支（全部已啟用）。 | `frontend/src/domain/cloudCommands.ts` line 83–140；`firestore.rules` line 1260–1285 |
| Production 寫入只出現在三個檔：`cloudCommandRepository.ts`（`tx.set/update`）、`activeAccountLease.ts`（lease＋event）、`operatorAdmin.ts`（`bootstrapOperator`／`setOperatorActiveStatus` 用 `setDoc`／`updateDoc`）。`operatorAdmin` 的寫入函式沒有任何 production import（只有 `operatorAdmin.test.ts`；`buildOperatorDoc` 被 `operatorDocParity.test.ts` 使用），而且 Rules `operators` 的 create／update 一律 `false`，所以那兩個函式在正式環境必定失敗。operators 的正式建立已由 P15 `finalize --operators`（REST，維護者權限）負責。 | `grep -rln "runTransaction\|writeBatch\|setDoc\|updateDoc\|deleteDoc\|addDoc" frontend/src`（排除 tests）；`firestore.rules` line 2192–2195 |
| 讀取只用一次性 server 讀取；`onSnapshot` 只有 lease（`activeAccountLease.ts` line 387）與 operator（`authService.ts` line 165）兩個。lease 心跳 60 秒（`LEASE_HEARTBEAT_INTERVAL_MS`）。 | `grep -rn onSnapshot frontend/src` |
| 目前 list 規則只檢查 `currentHolder()`，持有者可以不帶 limit 掃整個集合（commands、transactions、students、days…）。 | `firestore.rules` line 2240–2340 |
| 沒帶 `limit` 的 production 查詢至少有：`cloudDayCloseRepository.ts` line 519（`backfillDays` 的 `documentId in` chunk，最多 30）與 line 582（`days/{d}/settlements` 整個子集合）。其他查詢的最大 page limit 是 `MAX_UNCLOSED_DAYS + 1 = 201`（同檔 line 511）。 | `grep -n "limit(" frontend/src/firebase/*.ts`、`grep -n getDocsFromServer` |
| 日交易、學生歷史、稽核查詢各讀兩次（主查詢＋`documentIdProof` 依 documentId 再讀一次比對集合），讀取成本是單次的 2 倍。 | `cloudReadRepository.ts` line 494–529、757–780、981–992、1052–1063 |
| `firestore.indexes.json` 有 spec §8 沒列的 composite index：transactions `(businessDate, createdAt DESC)`、`(studentId, createdAt)`，以及舊集合 `cash_adjustments`（Rules 全拒）。`fieldOverrides` 只停用了 commands 的 `before`／`after`。 | `firestore.indexes.json`；spec §8 indexes 清單 |
| **Spike 1（計量器可行）**：在 Emulator spec 用 `vi.mock('firebase/firestore', importOriginal ⇒ 包裝)` 包住 `runTransaction`（Proxy 包 `tx.get/set/update/delete`）與 `getDocsFromServer`，production `acquireLease` 實測得到 `{ reads: 1, writes: 2 }`（lease＋`accessEvents`），與 P13c1 預期相符。dynamic import 的 `getFirestoreMod()` 也會拿到被 mock 的模組。 | planner 暫存 spec（已刪），`npx firebase emulators:exec --project demo-easyorder --config ../firebase.json --only firestore "npx vitest run …"` 2/2 pass |
| **Spike 2（limit 規則可行）**：Rules `allow list: if request.query.limit != null && request.query.limit <= 500;` 在 Emulator 拒絕不帶 limit 與 `limit(501)`，接受 `limit(500)`。注意：多個 match 對同一路徑是 OR，`/{document=**}` 的 allow 會蓋過它（目前 `firestore.rules` 結尾的 catch-all 是 `if false`，不受影響）。 | 同上 |
| `src/test/setup.ts` 會吞掉 console 輸出；量測結果要寫 JSON 檔或用斷言，不要靠 `console.log`。 | spike 觀察 |

## 3. 共用設計（Rulings）

- **Ruling R1：P16 不改 command 語意，Rules 只動 list 規則（P16c）。** 其餘批次是測試、工具、文件、index 設定與死碼刪除。— 理由：P16 是驗證 phase；寫入 anchor 的 expression 餘裕已很薄（最薄 +14，`p05-rules-budget.md` P13d1），list 規則是獨立的 `allow`，不影響寫入 anchor。
- **Ruling R2：寫入面 guard 是 Node 靜態掃描的 Vitest 單元測試。** 掃 `frontend/src/**/*.{ts,tsx}`，排除 `__tests__/`、`*.test.*`、`*.spec.*`、`src/test/`、`src/maintenance/`（Node CLI，走 REST、不進 bundle；guard 另外斷言 app 入口沒有 import `maintenance/`）。偵測 `setDoc|updateDoc|deleteDoc|addDoc|writeBatch|runTransaction` 與 `tx.set|tx.update|tx.delete` 形式；allowlist 只有 `firebase/cloudCommandRepository.ts`、`firebase/activeAccountLease.ts`。— 理由：plan P16「掃描所有 client writes 僅 command 或 lease」。
- **Ruling R3：刪除 `operatorAdmin.ts` 的 `bootstrapOperator`、`setOperatorActiveStatus` 與它們的單元測試，保留 `buildOperatorDoc` 與 parity 測試。** 這是刪除在 Rules 下必定失敗、沒有 caller 的死碼，不是停用測試；PR 內明列被刪的測試名稱與理由。文件若還教人用這兩個函式（`grep -rn "bootstrapOperator\|setOperatorActiveStatus" docs`），改指向 P15 `finalize --operators`。
- **Ruling R4：Rules 矩陣用「擷取→變異→重送」harness，因果由正向對照證明。** 對每一步合法操作：用 production writer 走到 `runTransaction` 內，擷取它要寫的 set／update 清單後拋出中止（不提交）；以 raw SDK `writeBatch` 在指定 auth context 重送。每一步先跑全部變異（每個都必須被拒且資料不變），最後重送未變異的原批次必須成功（正向對照），再進下一步。這樣同一批次只差一個變異，拒絕必然由該變異造成。擷取方式可沿用 Spike 1 的 `vi.mock` 包裝；`serverTimestamp()` sentinel 原樣重送。
- **Ruling R5：矩陣的變異類別固定為下列 M1–M10，每個 kind 都要跑到（不適用的格子必須寫明理由）：**
  M1 未登入；M2 已登入但不在白名單；M3 白名單但 `active: false`（停用 operator）；M4 核准 operator 但不是租約持有者；M5 持有者但 `leaseEpoch` 過期（先以合法 release／acquire 推進 epoch）；M6 偽造 actor（`actor.uid`／`email` 不等於 auth）；M7 少寫一個投影（對批次中每個非 command 寫入各刪一次）；M8 只寫投影不寫 command；M9 夾帶額外寫入（另一個學生或另一天的文件，帶同一 `lastCommandId`）；M10 重放（正向對照提交後再送一次同批次）。
  另有與 kind 無關的集合級矩陣：對每個 match 路徑測 update／delete（不可變集合必拒）、對每個可讀集合測 get／list 在 M1–M4 身分下被拒。
- **Ruling R6：矩陣覆蓋 guard。** 純單元測試斷言矩陣定義檔的 kind 集合 `==` `ALL_COMMAND_KINDS`、每個 kind 的 M1–M10 都有結果或理由。之後新增 kind 沒補矩陣會直接紅。
- **Ruling R7：list 上限 500。** 每個 `allow list` 加 `request.query.limit != null && request.query.limit <= 500`（必要時把 `allow get, list` 拆成兩行）。500 ≥ 目前最大 page limit 201，也 ≥ spec §8 的「預設每頁 100」。沒帶 limit 的 production 查詢補 limit：settlements 用 `limit(MAX_SETTLEMENT_VERSIONS + 1)` 並保留超額 fail closed；`documentId in` chunk 用 `limit(chunk.length)`。實作者需再 grep 一次全部 `getDocs*`／`onSnapshot(query…)`／Lite `getDocs` 確認清單完整。P15 CLI 走 REST＋owner／OAuth token，不受 Rules 影響（runbook 第 3 節的指令要重跑確認）。
- **Ruling R8：計量規則（寫在 helper 開頭的註解與 evidence）。** client 讀取：`getDoc*` 每次 1（不存在也算 1）；查詢 `max(1, 回傳筆數)`；`tx.get` 每次 1；transaction 重試的每次 `tx.get` 都算；`onSnapshot` 初始每份文件 1、之後每次變更 1。寫入：只算提交成功的 `tx.set/update/delete`；中止或被拒的不算寫入，但其讀取照算。Rules dependent reads 不從 Emulator 量，用 `p05-rules-budget.md` 的每 kind no-cache access call 數（commit closure，加上 transaction 讀取 RPC 的 read-authorization dependency，例如 CreateOrder 的 19＋11）當保守上界；另列一欄「依官方計價說明的去重估計」並附抓取日期與連結。gate 用保守上界。官方計價頁若抓不到，沿用 spec §2 2026-10-13 的表並註明。
- **Ruling R9：延遲不做 app 內儀表。** Emulator 時間只當參考值寫進 evidence，標「本機 Emulator，非雲端延遲」。P16e 在 evidence 的 P18 清單加一條手動量測步驟（正式環境送單 20 次、首頁冷載 5 次，DevTools Network 的時間取 P95），P18 由 CheerC 執行。— 理由：P13b1 安全診斷 allowlist 不允許新增欄位；plan P16 明說量不到的列未驗、P18 補。
- **Ruling R10：工作負載假設集中在一份表，模型可調。** 預設：500 筆業務 command／日，組成 1 EnsureDay、1 SetDayMenu、1 SetOpeningCash、300 CreateOrder、140 CreatePayment、20 CreateCashMovement、10 CreateRefund、20 更正類（Correct／Void／CancelKeepDeposit／CancelRefund／Undo 平均）、1 CloseDay、1 RecordBackup、2 RecordExport／RecordPrint、其餘補 CreateOrder 到 500；2 個同 UID 頁面各開 10 小時（心跳 60 秒）；每日完整載入 20 次、F2 週／月查詢 10 次、F5 帳戶查詢 50 次、稽核查詢 5 次、CSV／列印 5 次、增量備份匯出 1 次（500 筆）、日結頁開 5 次。**另跑最壞情形：500 筆全是 access call 最多的 kind。gate 取兩者較大值。** 真實數字到 P18 由 CheerC 提供後再算一次。
- **Ruling R11：gate 門檻。** 日讀取 < 25,000、日寫入 < 10,000、日刪除 = 0（Spark 50%，spec §10）。兩年儲存（含 index 項目）：< 512 MiB 通過；512 MiB–0.85 GiB 記為「需在達 85% 前另立保留／封存 spec」但不擋；≥ 0.85 GiB 失敗。單 command 文件（含 before／after）實測最大值 < 64 KiB。gate 失敗：不自行優化、不放寬，P16e 照實記錄並以 `[BLOCKER]` 回報 coordinator，附各項成本拆解與最小修訂方案，由 CheerC 決定（spec §14）。
- **Ruling R12：儲存大小用官方公式計算，不假設每筆 1 KB。** 依 Firestore storage size 說明（文件名稱大小＋各欄位名稱與值大小＋32 bytes；index 項目＝文件名稱＋索引欄位值＋固定額外量），對 Emulator 讀回的真實文件逐份計算，取平均與 P95；index 項目依 `firestore.indexes.json`（composite）與自動單欄位 index（扣掉 `fieldOverrides`）計。公式與來源連結寫在模型檔註解。
- **Ruling R13：歷史規模用「形狀等價」資料，不真的寫 250,000 筆 command。** 會隨歷史成長的讀取只取決於：營業日數（異常掃描、未關帳清單、上一個已關帳日分段查找）、單一學生的交易數（F5 前綴）、單日交易數與 command 數（日報、稽核、備份）。所以歷史資料用 production writer 產生「730 個營業日 × 每日少量 command」＋「一位學生 500 筆交易」＋「一個滿載日 500 筆 command」；儲存外推則用滿載日的實測平均／P95 文件大小 × 兩年筆數。production writer 因今日限定 Rules 做不出的歷史形狀，才用 `withSecurityRulesDisabled` 種入由同一套 domain builder 產生的文件，並用 repository 的 strict decode 與 P15 `verify` 的對帳函式驗證；evidence 列出哪些形狀是種入的。CI 只跑小規模（例如 0／30／90 天）並驗證線性；730 天完整版是本機／thread 可跑的 npm 指令，不進 CI。
- **Ruling R14：計量結果是 CI 回歸 gate。** 固定 fixture 的每項操作 client 讀／寫數與 checked-in 成本表完全相等；成本變動必須在同一 PR 更新成本表與 evidence。

## 4. PR 拆分

依賴：P16a → P16b → P16c → P16d → P16e（P16f 只在 gate 失敗且 CheerC 決定後）。一次一個 PR 進審查。每個 PR：rebase 最新 main；更新 `docs/DEVELOPMENT-HANDOFF.md`（完整 SHA、驗證、下一步）；Full Vitest、lint、build；App TSC 與 base normalized parity（目前 208 inherited diagnostics，新檔零診斷）；`npm run test:cloud-backup`；Emulator spec 依序（`--maxWorkers=1` 或 `--no-file-parallelism`）；新 Emulator spec 加進 CI 並用既有的 JSON count check（total ≥ 1、failed = 0、skipped = 0）。

---

### P16a — client 寫入面掃描與死碼刪除（小 PR）

**檔案：** 新 `frontend/src/firebase/__tests__/clientWriteSurface.test.ts`；改 `frontend/src/firebase/operatorAdmin.ts`、`frontend/src/firebase/__tests__/operatorAdmin.test.ts`；相關 docs。

**TDD：**
- RED commit：`clientWriteSurface.test.ts`（R2）。預期失敗原因：`operatorAdmin.ts` 出現 `setDoc`／`updateDoc` 且不在 allowlist。另一個案例斷言 app 端沒有 import `src/maintenance/`（應該直接通過，屬 guard）。
- GREEN commit：依 R3 刪兩個寫入函式與其測試；docs 改指向 `finalize --operators`。

**驗收：** guard 通過；`operatorDocParity.test.ts` 通過；`grep -rn "bootstrapOperator\|setOperatorActiveStatus" frontend/src docs` 只剩歷史 receipt（不改歷史紀錄）。Rules 未改，無需量測。

**指令：** `cd frontend && npx vitest run src/firebase/__tests__/clientWriteSurface.test.ts src/firebase/__tests__/operatorDocParity.test.ts`；Full Vitest、lint、build、TSC parity、`npm run test:cloud-backup`。

---

### P16b — 全 27 kind Rules allow／deny 矩陣（測試 PR）

**檔案：** 新 `frontend/src/firebase/__tests__/helpers/batchCapture.ts`（R4 擷取與重送）、`frontend/src/firebase/__tests__/rulesMatrix.ts`（矩陣定義：kind × M1–M10 預期、不適用理由）、`frontend/src/firebase/__tests__/cloudRulesMatrix.spec.ts`（Emulator，`EASYORDER_REQUIRE_CLOUD_RULES_MATRIX`）、`frontend/src/firebase/__tests__/rulesMatrixCoverage.test.ts`（R6）；`.github/workflows/ci.yml` 新步驟；evidence 新節「P16b」。

**情境：** 一條用 production writer 走完 27 kind 的劇本（可參考 `helpers/r02Scenario.ts` 的寫法與順序：EnsureDay → SetOpeningCash → SetDayMenu → 學生／供應商 → 訂單／繳費／收支／退款 → 五種更正 → 補開帳／回填 → CloseDay／ReopenDay → 關帳後補記 → RecordExport／Print／Backup）。每一步依 R4：擷取 → M1–M10 → 正向對照。另加集合級矩陣（R5 後段）與每 kind 一個「最大合法 payload」正向案例（證明在 Rules 存取次數上限內，並記錄 command 文件大小給 P16d）。

**TDD：** 這是驗證用測試，不改行為；第一次跑就通過是預期結果，因果由正向對照證明。`rulesMatrixCoverage.test.ts` 先提交成 RED（矩陣定義為空時 27 個 kind 缺漏），再提交矩陣與 spec 成 GREEN。**若任何變異意外被接受（Rules 漏洞）：停止，不在本 PR 修 Rules，`[BLOCKER]` 回報 coordinator，附最小重現。**

**驗收：** 27 kind × M1–M10 全部有結果；集合級矩陣全拒；正向對照全過；skipped = 0。evidence 列矩陣表（kind × 類別 → 拒絕／不適用與理由）與執行計數。

**指令：** `cd frontend && npx firebase emulators:exec --project demo-easyorder --config ../firebase.json --only firestore "EASYORDER_REQUIRE_CLOUD_RULES_MATRIX=true npx vitest run src/firebase/__tests__/cloudRulesMatrix.spec.ts --maxWorkers=1"`；`npx vitest run src/firebase/__tests__/rulesMatrixCoverage.test.ts`；共用驗證。

---

### P16c — list 查詢必須帶 limit（Rules＋查詢修正）

**檔案：** `firestore.rules`（只動 `allow list`）；`frontend/src/firebase/cloudDayCloseRepository.ts`（line 519、582 的查詢）及實作者 grep 到的其他無 limit 查詢；`cloudRulesMatrix.spec.ts`／`rulesMatrix.ts` 加「持有者不帶 limit／limit 501 被拒、limit 500 可讀」列；`docs/ops/p05-rules-budget.md` 新節「P16c」；spec §8 查詢策略補一句上限；evidence。

**TDD：**
- RED commit：矩陣新增列——持有者對 commands、transactions、students、days、settlements（collection group 若有用到）、backfillDays、postCloseEntries、studentCodes、vendors、accessEvents 不帶 limit 的 list 應被拒。在 main Rules 上會被接受，所以失敗。另加 repository 層 Emulator 案例：日結頁讀 settlements 與回填標記在新 Rules 下仍成功（RED 時這兩個會因 Rules 尚未改而通過，屬回歸保護；真正的 RED 是前者）。
- GREEN commit：Rules 依 R7 修改；兩個查詢補 limit 並保留 fail closed。

**Rules 量測（專案規則）：** 用 `/mnt/project-files/tools/rules-probe` 對 main 與分支量相同案例：至少 `cmd`（CreateOrder 回填案例 `P11c2a.14`）、`tx`、`head`、`leaseUpdate` 四個寫入 anchor 應不變；另為新的 list 規則加 anchor 量一次。SHA-256（main `98b143a3…455`）與結果寫進 budget 文件與 PR。

**驗收：** 全部既有 Emulator spec 依序通過（list 規則影響所有讀取路徑）；Cloud E2E（`npm run test:e2e`）通過；P15 runbook 第 3 節 Emulator 指令重跑通過（CLI 不受影響）。部署注意寫進 handoff：Rules 與前端要一起上（舊前端的無 limit 查詢會被新 Rules 拒）。

**指令：** 上述 spec 的 `-t` 子集；`npm run test:e2e`；`npm run test:cloud-restore`；rules-probe；共用驗證。

---

### P16d — 讀寫計量器、單項成本表與容量模型

**檔案：** 新 `frontend/src/firebase/__tests__/helpers/firestoreMeter.ts`（R8；包 full 與 Lite 兩個模組；同時記錄每次查詢的形狀：集合／collection group、where 欄位與運算子、orderBy、limit）；新 `frontend/src/firebase/__tests__/cloudCapacity.spec.ts`（Emulator，`EASYORDER_REQUIRE_CLOUD_CAPACITY`，輸出 JSON 報告到 `EASYORDER_P16_REPORT` 指定路徑）；新 `frontend/src/maintenance/capacityModel.ts`＋`frontend/src/maintenance/__tests__/capacityModel.test.ts`（純函式；放 `maintenance/` 因為不進 app bundle）；新 `docs/ops/p16-capacity-costs.json`（checked-in 成本表，R14）；CI 步驟；evidence。

**`cloudCapacity.spec.ts` 要量的操作**（全部經 production repository 的 `createCloud*Repository` 與 `activeAccountLease`，不手寫查詢）：27 kind 各一次提交（含成功後的 receipt 確認）；租約 acquire／renew／release／takeover；開機（operator listener、lease、dataHead、500 名學生名單、今日營業日與交易）；訂餐頁載入；F2 週與月；F5 一位學生（歷史 N 筆）；稽核（日、學生、null-date）；`readAccessEvents`；日結頁（未關帳清單、settlements、回填標記、關帳後補記）；異常掃描；CSV／列印的完整讀取；增量備份匯出 500 筆；同 UID 第二頁開機與心跳。

**`capacityModel.ts`：** 輸入成本表、Rules 每 kind 保守上界（R8）、工作負載表（R10）→ 輸出日讀／寫／刪（一般組成與最壞情形）；輸入文件樣本與 indexes 設定 → 每份文件與 index 項目大小（R12）→ 兩年外推。

**TDD：**
- RED commit：`capacityModel.test.ts` 用手算的小 fixture（例如 2 種操作、3 份文件、1 個 composite index）斷言日總量與 storage bytes；模組不存在所以失敗。`cloudCapacity.spec.ts` 對 `p16-capacity-costs.json` 斷言完全相等，成本表先放空表 → 失敗。
- GREEN commit：實作模型；跑一次產生實測值、人工核對（每個數字要能用 Rules／repository 程式解釋，例如 acquire = 1 讀 2 寫）後填入成本表。

**驗收：** 成本表每一列都有來源說明；模型單元測試通過；Emulator spec skipped = 0；evidence 列出單項成本表、計量規則、Rules 保守上界來源（`p05-rules-budget.md` 對應節）。

**指令：** `cd frontend && npx vitest run src/maintenance/__tests__/capacityModel.test.ts`；`npx firebase emulators:exec --project demo-easyorder --config ../firebase.json --only firestore "EASYORDER_REQUIRE_CLOUD_CAPACITY=true EASYORDER_P16_REPORT=/tmp/p16-capacity.json npx vitest run src/firebase/__tests__/cloudCapacity.spec.ts --maxWorkers=1"`；共用驗證。

---

### P16e — 歷史規模、日用量與兩年外推、index 覆蓋、gate 與 evidence

**檔案：** 新 `frontend/src/firebase/__tests__/helpers/historyScenario.ts`（R13）；`cloudCapacity.spec.ts` 加歷史規模、尖峰、競爭案例；新 `frontend/src/firebase/__tests__/indexCoverage.test.ts`；`firestore.indexes.json`（清理未用 index、補 `fieldOverrides`）；`frontend/package.json` 新 `capacity:history` 指令（730 天完整版，不進 CI）；`docs/ops/free-production-evidence.md` 新節「P16 容量與安全 gate」；plan receipt 列 P16；spec §8 indexes 清單同步；handoff。

**內容：**
1. **歷史規模：** 以 0／30／90 天（CI）量會成長的操作，斷言讀取數對營業日數或學生交易數呈線性並擬合係數；`capacity:history` 跑 730 天＋單一學生 500 筆＋滿載日 500 筆，結果寫進 evidence（附執行指令與耗時）。
2. **日用量 gate：** 用 P16d 模型＋實測成本＋730 天的掃描成本，算一般組成與最壞情形（R10），對 R11 門檻判定。
3. **兩年儲存：** 滿載日文件大小平均／P95 × 兩年筆數（約 250,000 commands＋對應 transactions、days、settlements）＋index 項目，對 R11 判定。另記錄每 kind 最大 command 文件大小（< 64 KiB）。
4. **尖峰：** 單頁 60 筆 CreateOrder 連續提交全部成功、無重試（計量器的 transaction 嘗試次數 = 60）。**競爭：** 同 UID 兩頁同時對不同學生送單，每筆最終一次成功或得到明確錯誤碼（`REVISION_CONFLICT`／`UNKNOWN_RESULT` 走同 ID 確認），沒有重複入帳，SDK 重試 ≤ 5（spec §8），重試的讀取計入模型。
5. **index 覆蓋：** `indexCoverage.test.ts` 讀 P16d 計量器在完整 Emulator 跑中記錄的查詢形狀清單（固定成 checked-in JSON），斷言每個需要 composite index 的形狀在 `firestore.indexes.json` 有對應項，且每個 composite index 至少被一個形狀使用。Emulator 不檢查 composite index，這是唯一能在部署前抓到「requires an index」的地方。依結果刪掉未用的 composite index（預期：transactions `(businessDate, createdAt DESC)`、`(studentId, createdAt)`、`cash_adjustments`，以實測為準）；對 commands 等集合中從不查詢的大欄位評估加 `fieldOverrides` 以減少 index 項目（每加一項都要證明沒有查詢用到該欄位）。
6. **延遲：** Emulator 參考值＋P18 手動量測步驟（R9）。
7. **evidence 與狀態：** 四項分開記錄（容量、安全矩陣、查詢／index、延遲 UNVERIFIED）；plan receipt 列 P16 的實際狀態；不寫「可正式上線」。

**TDD：**
- RED commit：`indexCoverage.test.ts` 對現有 `firestore.indexes.json` 失敗（未用 composite index 存在）；歷史線性與 gate 斷言先放入，若現況已通過則照實記錄為「驗證通過、無需 RED」，因果以成本表解釋。
- GREEN commit：清理 indexes、補 `fieldOverrides`、更新形狀清單與成本表。

**Gate 結果處理：** 全部通過 → `[PR-READY]`，evidence 寫 PASS 與數字。任何一項失敗 → PR 仍可合併（只含證據與不改語意的清理），但 evidence 寫 FAIL，implementer 同時以 `[BLOCKER]` 回報 coordinator 附成本拆解與最小修訂選項（例如縮短不必要的重讀、合併同 UID 雙頁心跳、快取異常掃描結果、拿掉 `documentIdProof`——最後一項會減少完整性檢查，必須 CheerC 決定）。coordinator 轉給 CheerC，P16f 等決定後再規劃。

**指令：** `npx vitest run src/firebase/__tests__/indexCoverage.test.ts`；Emulator `cloudCapacity.spec.ts`（同 P16d 指令）；`npm run capacity:history`（本機）；共用驗證；`npm run test:e2e`（indexes 變更不影響 Emulator，但確認沒有誤刪查詢）。

---

### P16f（條件式）— 讀取優化

只有 P16e gate 失敗且 CheerC 選定方案後才規劃；本計畫不預先指定內容。

## 5. 風險與回歸保護

| 風險 | 保護 |
|---|---|
| 矩陣擷取 harness 繞過 production writer，測到的不是真實批次。 | R4 每一步都從 production writer 擷取，正向對照必須成功；擷取點只在 `runTransaction` 邊界。 |
| list limit 規則讓某條沒找到的查詢在正式環境被拒。 | P16c 要求再次 grep 全部讀取點，跑全部 Emulator spec 與 E2E；evidence 列出查詢清單（檔案：行號）。部署時 Rules 與前端一起上（專案規則）。 |
| 計量數字與 Firestore 實際計費不同。 | R8 寫明計量規則與官方來源；gate 用保守上界；正式數字在 P17／P18 由 CheerC 看 Firebase Usage 對照，未對照前標 UNVERIFIED。 |
| 刪錯 composite index，正式環境查詢失敗（Emulator 不會發現）。 | 只刪 `indexCoverage.test.ts` 證明沒有形狀使用的 index；形狀清單來自完整 Emulator 跑；spec §8 清單同步；部署後第一次開各頁觀察「requires an index」（已在專案記憶的 post-deploy watch）。 |
| 歷史資料用種入方式，與真實寫入不一致。 | R13：優先 production writer；種入的形狀用 strict decode＋對帳驗證並在 evidence 標明。 |
| Emulator spec 偶發慢（Rules 編譯約 10 秒以上）。 | `beforeAll` timeout 至少 120 秒；全部依序跑。 |
| 刪除 `operatorAdmin` 寫入函式被當成「停用測試」。 | R3：刪的是死碼與其測試，PR 明列；guard 測試是新增的保護。 |

## 6. 需要 CheerC 的地方

- 正常情況不需要。P16 全部在 Emulator 完成。
- 只有 P16e gate 失敗時，需要 CheerC 在 coordinator 轉交的證據上選修訂方案（spec §14）。
- P18 時由 CheerC 提供真實工作量並在正式環境做延遲手動量測（R9、R10）。
