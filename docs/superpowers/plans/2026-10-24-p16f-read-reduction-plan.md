# P16f 減法：讓日讀取回到 Spark 額度內（執行計畫）

日期：2026-10-24。基準：main `b1b3849`（#554 P16d）＋ #555 P16e 分支 `claude/p16e-capacity-gate`（`50c761b`，r1 rework 中）。**P16f1 開工前 #555 必須已合併**，兩批都 rebase 最新 main。本檔是計畫分支文件，不進 main。

來源：P16 計畫 `2026-10-24-p16-capacity-security-plan.md`（同分支）R8／R11；#555 的 `docs/ops/p16-capacity-gate.json`、`p16-capacity-costs.json`、`frontend/src/maintenance/capacityGate.ts`；CheerC 2026-10-24 指示：「簡單的訂便當系統，不要過度工程」「總之都透過減法處理，讓系統好維護、簡單化、低成本」；設計上限每日 200 筆、平常 100 筆；完整性取捨由團隊決定（coordinator Gate 1 裁定，有爭議加開 reviewer 討論）。Rules 不放寬。

## 1. 問題（#555 實測）

設計上限 200 筆／日時日讀取 277k（上限 25k），寫入 1,584（通過）。讀取不是資料量大，而是幾個地方**重複讀了不需要的東西**：

| 來源 | 現況 | 為什麼多 |
|---|---|---|
| 訂餐頁 | 每送一筆就重讀整份名單＋當日所有交易（`CloudOrdersPage.tsx` `completeSuccess`，約 340 讀／次 × 199） | 只變了 1 位學生、1 筆交易、1 個營業日 |
| 報表餘額 | 報表中每個出現的帳戶都從開帳起讀**全部歷史**，而且讀兩次（`cloudReadRepository.ts` `readReport` → `readAccountPrefix` line 742–817）；兩年後每份日報約十萬讀，#555 成本表的淺歷史 fixture 還低估了約 10 倍 | 只為了算區間內每筆的「交易後餘額」 |
| 雙讀完整性證明 | 日交易、帳戶歷史、稽核都多一次 `documentIdProof` 查詢（line 494–529、766–780、981–992、1052–1063） | 防「缺排序欄位」的文件被漏掉 |
| 單一學生查詢讀整份名單 | 帳戶歷史、單一學生報表各讀一次 200 名名單（line 881、933） | 只需要那 1 位 |
| 學生稽核 | 讀該生**全部歷史**的 command（兩次） | 畫面只需最近的 |
| 帳務異常掃描 | 每次頁面啟動都讀開帳以來每一天＋每天最新日結（`cloudDayCloseRepository.ts` `createCloudLedgerReader().read` line 724–760），日期／供應商頁也帶到 | 已關帳的舊日子不會再變 |
| 租約心跳 | 每 60 秒續約（1 讀 1 寫），兩個頁面各收一次快照 | 租約 5 分鐘到期，60 秒太密 |

## 2. 減法清單與決定項目

每項都寫：做法、放棄什麼風險、建議。標 **〔團隊決定〕** 的是碰到完整性檢查的取捨，由 coordinator 在 Gate 1 裁定（CheerC 已授權，不再問 CheerC）。

### S1〔團隊決定〕拿掉 `documentIdProof` 第二次查詢

- **選項 A（建議）：直接刪除。** 理由：Rules 已保證每筆交易建立時 `createdAt == request.time`、更正時不可改（`firestore.rules` line 876、1022、2369、2376），命令也有 `committedAt == request.time`（line 286 等）。所有 client 寫入都經 Rules（P16a 守門）。唯一繞過 Rules 的寫入是維護者 CLI 還原，而 P15 `verify` 會逐份比對。**放棄的風險：** 有人用維護者權限手動寫入缺 `createdAt` 的文件時，報表會靜靜少一筆。
- 選項 B：改用 count 聚合查詢比對筆數（約 1 讀／1000 筆）。保留檢查但多一種查詢形式，且要確認與 P16c 的 `limit ≤ 500` list 規則相容。
- 選項 C：維持雙讀（成本 ×2）。

### S2〔團隊決定〕報表與帳戶歷史的「交易後餘額」改從目前餘額往回推

- **選項 A（建議）：** 學生文件的 `currentBalance` 由 Rules 隨每筆命令逐筆驗證。區間內每筆的交易後餘額 = `currentBalance` 減去「該筆之後所有有效交易的影響」。所以只要讀**區間起日到今天**的交易，用現有 index `(businessDate, createdAt, __name__)` 一次查完全部學生（單一學生用 `(studentId, businessDate, createdAt, __name__)`），在記憶體依同樣排序往回推。今天的日報只讀今天的交易。**放棄的風險：** 每次開報表不再重做「期初＋全部歷史 = 目前餘額」的整體對帳。這個對帳仍在兩個地方存在：每次 P14 備份匯出的 replay 驗證，以及 P15 `verify` 由交易重算餘額對照 `currentBalance`。
- 選項 B：維持從期初往前算（兩年後每份報表數萬到十萬讀，無法留在額度內）。

### S3〔團隊決定〕帳務異常掃描只看最近 62 天＋所有未關帳日

- **選項 A（建議）：** 掃描範圍改為「今天往前 62 天」加上 `status in ['open','reopened']` 的所有日子（`readCloudDayCloseOverview` 已有這個查詢，line 508–512）。舊的已關帳日只有重開才會改變，重開後狀態變成 `reopened`，會被第二個查詢抓到。日期／供應商頁共用同一個 reader，一起變便宜。**放棄的風險：** 兩個都已關帳、超過 62 天的相鄰日子之間若有開帳金額不一致，在掉出視窗後就不再顯示。這種異常在發生後的 62 天內都會一直顯示（導覽列「帳務異常（n）」常駐）。
- 選項 B：維持全歷史掃描（兩年後每次頁面啟動約 1,500 讀）。

### S4〔團隊決定〕訂餐頁送單後只補讀改到的文件

- **選項 A（建議）：** 收據的 `seq` 正好等於頁面快照的 `seq + 1` 時，代表這段期間只有自己這一筆，補讀收據 targets 指到的學生、營業日、交易（各 1 讀）與 `dataHead`，更新到記憶體快照；`seq` 不連續（例如同 UID 另一頁也送了單）就照舊整頁重讀。**放棄的風險：** 幾乎沒有。head seq 圍欄還在，只是連續時不重讀沒變的文件。程式多一條「套用變更」的分支，要有單元測試覆蓋。
- 選項 B：只補讀名單以外的部分（仍要讀整天交易，省得不夠）。

### S5（不碰完整性，直接做）單一學生的查詢只讀那位學生

帳戶歷史、單一學生報表改用 `getDoc(students/{id})`，並照舊比對 `dataHead` 前後一致（`STALE_SNAPSHOT` 檢查不變）。全體報表仍讀名單（用來顯示姓名與檢查交易指向存在的學生）。

### S6（不碰完整性，直接做）學生稽核分頁

依 spec §8「歷史 query cursor 分頁，預設每頁 100」：學生稽核改為最新 100 筆（`seq` 由新到舊）＋「載入更多」。需新增 composite index `commands (studentId ASC, seq DESC, __name__ DESC)`，`indexCoverage.test.ts` 與 `p16-query-shapes.json` 一起更新。

### S7（不碰完整性，直接做）租約心跳 60 秒 → 120 秒

`LEASE_HEARTBEAT_INTERVAL_MS` 改為 120 秒。Rules 的 5 分鐘到期不變，所以接手時間不變；一次續約失敗後下一次仍在到期前。

### S8〔團隊決定〕儲存：先不做封存

設計上限兩年 1,131 MiB（FAIL）、平常 561 MiB（WARN，約 1,133 天才到 85%）。最大項目是 command 文件（含 before／after 快照，每筆約 4.3 KB＋1.7 KB index）。

- **選項 A（建議）：** 不做封存或資料瘦身。以平常量（CheerC：每天不到 100 人）判斷約三年才到 85%；spec §10 已有「每日看 Usage、70% 提示、85% 前另立保留 spec」。在 runbook 與 evidence 寫明監看門檻。**放棄的風險：** 如果實際量接近 200 筆／日，大約一年半要回頭處理。
- 選項 B：縮小 command 快照。要改 Rules 的 `command.after == getAfter(...)` 驗證，餘裕很薄、改動大，不符合減法原則。
- 選項 C：封存舊 command（匯出後刪除）。違反「不可刪會計歷史」（spec §10），而且要新工具。

### S9（不碰完整性，直接做）工作負載假設改成實際用法

#555 的假設（每天 6 份日報、3 份週報、1 份月報、5 次 CSV、20 次帳戶查詢）是猜的，偏高。改為：日報 6、週報 1、月報每週 1（0.2／日）、CSV／列印 2、帳戶查詢 10（設計上限）／5（平常）、日稽核 3；其餘不變。P18 由 CheerC 的實際數字取代（沿用 P16 R10）。**Gate 門檻與保守計法（R8、R11）不變。**

## 3. 預估效果（設計上限 200 筆／日，保守計法，粗估）

| 項目 | 現在 | 減法後 |
|---|---:|---:|
| 命令本身（含 Rules 依賴讀取） | 約 11,400 | 約 11,400（不變） |
| 訂餐頁 | 68,000 | 約 3,000 |
| 報表、CSV、帳戶查詢、稽核 | 約 180,000（含低估） | 約 6,000 |
| 異常掃描、日期／供應商頁 | 約 14,000 | 約 1,500 |
| 租約與名單 | 約 3,500 | 約 2,000 |
| **合計** | **約 277,000** | **約 24,000（平常日約 14,000）** |

設計上限會貼近 25k。若實測仍略超，下一步不是再加機制，而是先檢查工作負載假設；仍不夠時 Gate 改用去重計法（官方計價方式）由 coordinator 裁定，並在 evidence 寫明。

## 4. PR 拆分（兩批）

依賴：#555 合併 → P16f1 → P16f2。每批照專案規則：rebase 最新 main、更新 handoff（完整 SHA、驗證、下一步）、Full Vitest、lint、build、App TSC parity、`npm run test:cloud-backup`、Emulator spec 依序跑、Cloud E2E。**Rules 不改**（S6 只加 index），所以不需要量測 Rules；若實作發現必須改 Rules，停下來回報。

### P16f1 — 讀取 repository 減法（S1、S2、S5、S6）

**檔案：** `frontend/src/firebase/cloudReadRepository.ts`（`readReport`、`readAccountHistory`、`readAccountPrefix` 改為往回推、`readDayTransactions` 與稽核查詢拿掉第二次查詢、學生稽核分頁）；`firestore.indexes.json`；`docs/ops/p16-query-shapes.json`；對應 spec 的單元／Emulator 測試；spec §8 查詢策略一段改寫（往回推、分頁）。

**TDD：**
- RED：(1) 在 `cloudCapacity.spec.ts` 加一個「長歷史」fixture（一位學生 300 筆歷史交易、今天 2 筆），斷言今天日報與該生今天帳戶歷史的讀取數 ≤ 今天交易數＋固定額（例如 ≤ 40）——現況會讀全部歷史兩次，失敗。(2) 單元／Emulator 測試：往回推的交易後餘額與舊方法在同一份資料上完全相同（含更正、作廢、退款、回填日、跨已關帳日更正 L07）。舊方法的結果用現有測試的期望值當基準。
- GREEN：實作 S1（依 Gate 1 裁定）、S2、S5、S6。

**驗收：** 既有報表、帳戶歷史、稽核的 Emulator 測試全部通過（行為不變，只有讀取數變少）；新長歷史讀取上限通過；index 覆蓋測試通過。

### P16f2 — 頁面與掃描減法、重算 gate（S3、S4、S7、S9、S8 文件）

**檔案：** `frontend/src/components/cloud/CloudOrdersPage.tsx`（S4）；`frontend/src/firebase/cloudDayCloseRepository.ts`（S3）；`frontend/src/firebase/activeAccountLease.ts`（S7）；`frontend/src/maintenance/capacityGate.ts`（S9）；`docs/ops/p16-capacity-costs.json`、`p16-capacity-gate.json` 重新產生；evidence P16 節更新結論；runbook 加儲存監看門檻（S8）；plan receipt 列 P16 狀態。

**TDD：**
- RED：(1) 訂餐頁單元測試：seq 連續的成功送單只補讀 targets 與 head、不呼叫整頁讀取；seq 跳號時整頁重讀。(2) 異常掃描 Emulator 測試：100 個已關帳舊日子＋1 個 70 天前的重開日，讀取數 ≤ 62＋未關帳日數＋固定額，且重開日仍列為異常。(3) `capacityGate.test.ts` 斷言設計上限與平常日的讀取 verdict 為 PASS——現況 FAIL。
- GREEN：實作 S3、S4、S7、S9，重量成本表與 gate。

**驗收：** gate 讀取 PASS（設計上限與平常日），寫入、刪除照舊 PASS；儲存照實記錄（S8 選 A 時：設計上限 FAIL／平常 WARN，並寫監看門檻與 85% 前另立保留 spec 的觸發條件）。E2E 通過。gate 若仍 FAIL：照實記錄，`[BLOCKER]` 回報 coordinator，附各項拆解，不自行再加機制。

## 5. 風險與回歸保護

| 風險 | 保護 |
|---|---|
| 往回推的餘額與舊方法不同（例如同時間排序、回填日、更正）。 | P16f1 RED (2)：同一份資料兩法結果逐筆相同；沿用舊測試期望值。排序沿用 `(businessDate, createdAt, transactionId)`。 |
| 訂餐頁局部更新漏掉別頁的寫入。 | 只有 seq 剛好 +1 才局部更新，其他一律整頁重讀；head 圍欄不變。 |
| 異常掃描視窗外的舊異常不再顯示。 | S3 已列放棄的風險；62 天內常駐顯示；重開日一律掃。 |
| 新 composite index 在正式環境缺漏。 | `indexCoverage.test.ts`；部署時 indexes 與 Rules、前端一起上。 |
| 心跳變慢導致租約被誤判失效。 | Rules 到期 5 分鐘不變；120 秒間隔下單次失敗仍在期限內；`activeAccountLease.spec.ts` 全部重跑。 |

## 6. Gate 1 請 coordinator 裁定

S1、S2、S3、S4、S8 五項〔團隊決定〕，planner 建議全部選 A。S5、S6、S7、S9 不碰完整性，直接做。

## 7. r2 對帳修訂（2026-10-24，對照 #555 head `9c327d0`）

#555 r2 把報表的真實成本算進來後，設計上限變成每日 3,092,501 讀（`load.report` 15 次約 2.8M）。逐列對照後，**第 3 節的 24k 估計不成立**，原因是 r2 揭露了兩件第 2 節沒寫清楚的事：(1) 單一學生的報表、帳戶歷史都還會先讀「全部學生」的區間交易（`readAccountHistory` 呼叫 `readTransactionsForRange`，`cloudReadRepository.ts` line 944；`readReport` 帶 `studentId` 時先讀全部再過濾，line 882）；(2) 報表頁每次查詢都同時讀報表與區間稽核（`CloudReportPage.tsx` line 427–428），帳戶頁一次讀帳戶歷史、單一學生報表、單一學生區間稽核三份（`CloudAccountHistoryPage.tsx` line 348–350），而單一學生區間稽核讀該生**全部歷史**的 command（`readAuditRange` 的 `studentId` 分支）。以下修訂取代第 2、3 節的對應內容。

### 修訂與新增的減法

- **S2 補充（確認）：** 往回推只讀「區間起日到今天」的交易，**完全不再讀任何帳戶的開帳以來歷史**。全體報表用一次 `(businessDate, createdAt, __name__)` 範圍查詢；帶 `studentId` 時只用 `(studentId, businessDate, createdAt, __name__)` 查該生，不先讀全部學生。`readAccountHistory` 拿掉 `loadRange`／`readTransactionsForRange` 對全部學生的讀取（若只為了回填標記，改讀區間內的 `backfillDays`，每日至多 1 讀）。
- **S6 擴大：** 學生稽核（`readAudit` 學生範圍）與單一學生區間稽核（`readAuditRange` 帶 `studentId`）合併為同一個分頁查詢：該生最新 100 筆 command（`seq` 新到舊）＋「載入更多」，畫面依區間標示或篩選。不再讀該生全部歷史。
- **S10（新增，直接做）：** 報表頁的區間稽核改成按「顯示稽核」才讀，不跟每次報表一起讀。
- **S11（新增，直接做）：** 帳戶頁拿掉重複的單一學生 `readReport`（與 `readAccountHistory` 內容相同，以帳戶歷史顯示）；名單在頁面開啟時讀一次，之後每次查詢只用 S5 的單一學生 `getDoc`。
- **S12（新增，直接做）：** CSV／列印直接使用畫面上已讀到、且 `sourceSeq` 等於目前 head 的報表資料，不再重讀；不一致才重讀（`STALE_SNAPSHOT` 檢查不變）。發起稽核命令照舊。

S10–S12 都不碰完整性檢查（head 圍欄與對帳都保留），歸到 P16f2（頁面層）；S2 補充與 S6 擴大歸到 P16f1。P16f1 的 RED (1) 加一條：帶 `studentId` 的報表與帳戶歷史，在其他 199 位學生各有今天交易時，讀取數仍 ≤ 該生區間交易數＋固定額。

### 修訂後估計（保守計法；工作負載依 S9）

| 項目 | 設計上限 200 筆 | 平常 100 筆 |
|---|---:|---:|
| 命令本身（含 Rules 依賴讀取，不變） | 11,400 | 5,700 |
| 訂餐頁（S4） | 3,000 | 1,500 |
| 全體報表：今天 6、週 1、月 0.2（S1、S2；每份＝名單 200＋區間交易） | 4,300 | 2,900 |
| 稽核：按需讀，假設每日 3 次日稽核＋2 次區間稽核（S1、S10） | 1,700 | 1,100 |
| 帳戶頁：10／5 次，每次單一學生歷史＋最新 100 筆稽核，名單每日 2 次（S2、S5、S6、S11） | 1,700 | 1,100 |
| 報表頁與帳戶頁開頁摘要 | 700 | 700 |
| 異常掃描、日期／供應商頁、日結頁（S3） | 1,500 | 1,500 |
| 租約（S7）、學生頁、備份匯出、使用權紀錄 | 2,600 | 2,300 |
| **合計** | **約 27,000** | **約 17,000** |

結論：**平常日預期通過；設計上限預期仍略超 25k（約 8%）。** 剩下的主要是命令本身的保守計法（11.4k；官方去重計法約 9.1k）與每日今天報表次數。依 Gate 1 裁定的順序處理：P16f2 量完若設計上限仍 FAIL，先由 coordinator 確認工作負載（例如今天報表 6 次是否實際），最後才考慮去重計法；不再加機制。若需要更多減法，下一個候選是 `loadRange` 每天約 10 讀（日、日結、回填、補記各一查詢）只為摘要使用時改讀日文件與最新日結，屬直接做的範圍，但本計畫不預先列入。
