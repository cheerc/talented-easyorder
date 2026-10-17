# P11 介面與資料契約：正式關帳與重開版次（`CloseDay`／`ReopenDay`）

Base: `origin/main`（SHA `32e90c6`，含 P10b #501／收據 #502 與 P14 #496／#498）。本契約是 P11 雲端關帳、重開、日結版本、Rules 與備份 replay 的實作依據。規則來源：[正式後端 spec](2026-10-13-free-production-backend-spec.md) §5 文件表 `days/{date}/settlements/{revision}`、§6.1 命令表 `CloseDay／ReopenDay` 列、§7.1 expectedCash、§7.4 日期生命週期；[後端計畫](../plans/2026-10-13-free-production-backend-plan.md) §P11。

## 1. 範圍與拆分

- 新啟用 2 種 kind：`CloseDay`、`ReopenDay`。已啟用由 20 種變為 22 種；仍拒絕的 2 種是 `RecordExport`、`RecordPrint`（P12）。
- **P11a（本 PR）**：Rules、寫入器、receipt 驗證、日結讀取 repository、P14 備份 decoder／replay、Emulator 與備份測試。沒有畫面。
- **P11b**：雲端「日結」頁（未關帳清單、全日點現金、關帳、回查版本、重開），關帳區下方掛上 P14 備份區塊，以及 E2E。見第 9 節。
- 不部署、不碰正式 Firebase；測試只用 `demo-easyorder` Emulator 與合成資料。

## 2. 規則

1. 狀態只走 `open → closed → reopened → closed → …`。唯一能改營業日狀態的是這兩個命令；沒有直接設定狀態的入口。
2. **CloseDay**：營業日須為 open 或 reopened、開帳現金已確認（`openingCash` 不是 null）、日期不晚於台北今天。
   - `expectedCash = openingCash + retainedReceipts + cashierIncome − cashierExpense − accountRefunds`（spec §7.1，Rules、寫入器、receipt 與備份共用同一算式）。
   - `countedCash` 為 0 至 1,000,000,000 的整數；`payload.expectedCash` 必須等於 Rules 由 day totals 算出的值（不接受 client 自填總額，只當作「操作員看到的數字」的確認）。
   - `countedCash ≠ expectedCash` 時 `note` 必填（1–500 字）；相同時可空白。命令的 `reason` 固定為 null。
3. **ReopenDay**：營業日須為 closed；`reason` 必填 1–500 字，命令 `reason` 等於 `payload.reason`。
4. 已關帳的營業日，交易（建立、更正、作廢、取消、撤回、退款、櫃台收支）、菜單、開帳現金與期初更正一律被拒。這些 Rules 原本就要求營業日為 open／reopened；P11 在 Emulator 以寫入器對每一種寫入實測都回 `DAY_CLOSED`（P11b 補上 P10a 其餘更正類），原始 SDK 另實測直接改營業日狀態被拒。
5. 現金影響固定為 0；關帳不改 `totals`、菜單或開帳現金。
6. 關帳與交易同時送出時，兩者都寫同一份營業日文件並各自帶 `expectedRevisions.day`，所以只會得到「交易先入帳、關帳因版本衝突失敗」或「關帳先完成、交易被拒」。

## 3. 命令

- `targets`：`{ dayId, settlementRevision }`，`settlementRevision = 營業日 lastSettlementRevision + 1`。
- `expectedRevisions`：`{ day, settlement }`，`day ≥ 1`，`settlement = 目前的 lastSettlementRevision`。
- `payload`：CloseDay `{ countedCash, note, expectedCash }`；ReopenDay `{ reason }`。
- 收據共用欄位：`businessDate == dayId`、`studentId == null`、`reason`（CloseDay 為 null，ReopenDay 為原因）。
- `before`：`{ head, day, previousSettlement }`，`previousSettlement` 是第 n−1 版（第 1 版時為 null）。`after`：`{ head, day, settlement }`。

## 4. 日結版本文件 `days/{dayId}/settlements/{n}`

固定 15 個欄位，建立後不可改、不可刪：

| 欄位 | 內容 |
|---|---|
| `dayId`、`revision` | 營業日與版號 n（文件 ID 為 `String(n)`） |
| `status` | `closed` 或 `reopened` |
| `totals` | 當下營業日 8 欄統計 |
| `openingCash`、`expectedCash` | 當下開帳現金與 §7.1 應有現金 |
| `countedCash`、`difference` | 關帳為實點與 `countedCash − expectedCash`；重開為 null |
| `note` | 關帳為差額說明，重開為重開原因 |
| `actorUid`、`actorEmail` | 操作者 |
| `sourceSeq`、`committedAt` | 命令序號與伺服器時間 |
| `previousRevision` | n − 1 |
| `lastCommandId` | 建立這一版的命令 |

## 5. 原子寫入與 Rules 分工

一次 commit 寫 4 份文件：`system/dataHead`、`days/{dayId}`、`days/{dayId}/settlements/{n}`、`commands/{commandId}`。任何一份缺漏或不合規則，整批拒絕。

- 指令建立（`validDaySettlementCommand`，巢狀放在 `validCommandCreate` 最後一個 operand 內，與 `CorrectOpening` 共用，既有 kind 的運算式餘裕不變）：持有人與 lease、命令信封、targets／expectedRevisions、第 2 節的狀態與金額規則、零現金，並把 `before`／`after` 快照綁到實際文件（含第 n−1 版）。
- 營業日（`dayCloseCommand`，獨立的 `allow update`）：只改 `status`、`lastSettlementRevision`、`revision`、`lastCommandId`、`updatedAt`；狀態轉換與版號 +1。
- 日結版本（`settlementCreateCommand`）：整份文件等於由命令與 `before.day` 算出的固定 map；路徑版號等於 `targets.settlementRevision`。`update`、`delete` 一律拒絕；讀取只限目前持有人。

## 6. Client 與備份

- `cloudCommandSchema.ts`：`normalizeEnabledCommandInput`、`decodeEnabledCommandDoc` 與 receipt 驗證支援兩種 kind；`settlementExpectedCash` 與 `decodeSettlementDoc` 供寫入器、讀取與備份共用。
- `cloudCommandRepository.ts`：寫入前檢查營業日版本與日結版號、狀態、開帳現金、未來日期、應有現金是否變動；讀第 n−1 版並確認第 n 版不存在。
- `cloudDayCloseRepository.ts`：`read(dayId)` 由伺服器讀營業日與完整版本 1..n（數量或連續性不符、讀取期間 head 變動都 fail closed）；`closeDay`、`reopenDay`、`readCommand`。
- `firestorePaths.ts`：`settlementPath(dayId, n)` 改為 spec 路徑；舊的 `daily_settlements` 路徑函式移除（沒有呼叫者）。
- P14 備份：decoder／replay 接受兩種 kind。投影狀態以實際路徑 `days/{dayId}/settlements/{n}` 保存每一版；replay 檢查第 n 版尚不存在、`before.previousSettlement` 等於已重播的第 n−1 版，日統計重算只看營業日文件。

## 7. 過去日期但沒有營業的營業日（P10b 遺留）

期初日沒有營業日時，F3 會用 `EnsureDay` 建一個過去日期的 open 營業日。這種日子沒有開帳現金，而 `SetOpeningCash` 只能設台北今天，所以原本無法關帳。P11b 的日結頁把「沒有開帳現金、也沒有任何交易（`activeTransactionCount == 0`）」的過去日子另列，不列入未關帳提醒；那天沒有營業就不需處理。CheerC 之後選了「允許補開帳」（2026-10-17），見第 10 節：這類日子與「有交易但缺開帳現金」的過去日子都可以補開帳後關帳。

## 8. 驗收

- Emulator：`cloudDayClose.spec.ts`（`EASYORDER_REQUIRE_CLOUD_DAY_CLOSE=true`，CI 步驟「P11 day close proof」）。正向：L05（應有 1,170、實點 1,160 無理由不能關、有理由可關）、相同可不填說明、重試冪等、L06 競賽只成一邊、重開→更正→再關帳版號 1／2／3 且舊版不變、合法最大 payload、原始 SDK closure 持有人成功而非持有人拒絕。拒絕：缺開帳現金、重複關帳、重開需已關帳且有原因、未來日期、已關帳日每一種業務寫入、直接改營業日狀態、竄改日結版本任一欄位或路徑、略過營業日或版本寫入、改／刪／偽造版本。
- 備份：`cloudBackup.spec.ts` 以真實 close／reopen／re-close 命令分兩段增量匯出 → 解密 → replay；竄改差額、前一版快照或缺少前包版本都被拒。
- 預算與 probe 見 [P11 預算附錄](../../ops/p05-rules-budget.md#p11-day-close--budget-and-probe-receipt)。

## 9. P11b 雲端日結頁

- 雲端導覽新增「日結」。頁面只從伺服器讀：`readOverview()` 讀 head、租約與所有 open／reopened 營業日（超過 200 天、讀取期間 head 變動都 fail closed），`read(dayId)` 讀營業日與完整版本。預設日期是伺服器租約的台北日期，瀏覽器時鐘不決定營業日。
- 未關帳清單只列到租約日期為止（未來的預排日期不列）。第 7 節的過去無營業日子另列（沒有營業就不需處理，有營業可查看後補開帳），不列入待關帳；缺開帳現金但有交易的過去日子標成「缺開帳現金，需補開帳後關帳」；今天沒有開帳現金時提示先到「日期與供應商」確認。（第 10 節修訂）
- 關帳表單顯示伺服器算出的應有現金，輸入實點即時顯示差額；差額不為 0 時說明必填。說明與重開原因送出前先去頭尾空白，純空白視同未填（Rules 只檢查長度，這是畫面這一層的要求）。
- 命令結果不明時保留原命令編號，用相同編號與相同內容查詢回執，不換編號重送；結果確認前不顯示表單，也不能切換頁面。
- 已關帳日：菜單／開帳現金頁與學生期初更正的提示都指向「日結」頁填寫原因重開。
- P14 備份區塊（原本只在舊 AdminScreen）掛在日結頁下方；失去使用權時整頁清除，也不顯示備份區塊。
- 驗收：`CloudDayClosePage.test.tsx`（L05、相同金額免說明、實點格式、重開原因、未關帳清單與無營業、結果不明重試同編號、版本衝突、失去使用權、備份區塊、讀取不完整）；Emulator `P11.6`（四種更正類補測）、`P11.13`（未關帳清單分類）；E2E `D08`（關帳少 10 元需原因 → 櫃台不能入帳 → 重開需原因 → 相同金額再關帳成第 3 版 → 重新登入仍在）。

## 10. 補開帳（`BackfillOpeningCash`）

CheerC（2026-10-17）：網路問題可能讓某天整天沒確認開帳現金，事後應能補開帳再關帳。原本 `SetOpeningCash` 只能設台北今天，過去日子缺開帳現金就永遠不能關帳。

- 新增第 25 種 kind `BackfillOpeningCash`，與 `SetOpeningCash` 分開，原有開帳檢查一條都不放寬，稽核紀錄也看得出是事後補登。已啟用 23 種；仍拒絕 `RecordExport`、`RecordPrint`。
- 條件：營業日已存在、日期早於台北今天、不早於上線日、狀態 open 或 reopened、`openingCash`／`openedBy`／`openedAt` 都是 null。已關帳的日子要先重開；已有開帳現金的日子不能用補開帳改。
- `targets {dayId}`、`expectedRevisions {day}`（= 目前版本，≥ 1）、`payload {openingCash, reason}`：`openingCash` 為 0 至 20,000 的整數（與 `SetOpeningCash` 同上限），`reason` 必填 1–500 字，命令 `reason` 等於 `payload.reason`。`businessDate == dayId`、`studentId == null`、現金影響為 0。`before`／`after` 為 `{head, day}`。
- 一次 commit 寫 3 份文件：`system/dataHead`、`days/{dayId}`、`commands/{commandId}`。營業日只改 `openingCash`、`openedBy`（操作者 uid）、`openedAt`（伺服器時間）、`revision +1`、`lastCommandId`、`updatedAt`；`totals`、狀態、菜單不變。
- Rules：命令檢查 `validBackfillOpeningCash` 與 `CloseDay`／`ReopenDay` 一起巢狀在 `validCommandCreate` 最後一個 operand 內；營業日檢查 `dayBackfillOpeningCommand` 是 `days/{dayId}` 上獨立的第三個 `allow update`。「早於台北今天」寫成 `dayId 00:00Z + 24h ≤ request.time + 8h`。預算與 probe 見 [P11 補開帳附錄](../../ops/p05-rules-budget.md#p11-backfill-opening--budget-and-probe-receipt)。
- 寫入器：今天以租約 `updatedAt` 的台北日期為準（與日結頁相同），今天或未來日期回 `INVALID_INPUT`；已關帳回 `DAY_CLOSED`；版本不符回 `REVISION_CONFLICT`；已有開帳現金或早於上線日回 `INVALID_INPUT`。
- 範圍外：補開帳**不會**讓那天補登訂餐、繳費或櫃台收支；所有交易 Rules 仍只接受台北今天。伺服器上不存在的過去日子也不提供補開帳。
- 日結頁：查看過去、未關帳、沒有開帳現金的日子時出現「補開帳」表單（開帳現金、必填原因，送出前去頭尾空白）；完成後同一頁出現關帳表單。今天、已關帳或已有開帳現金的日子不顯示。
- P14 備份：decoder／replay 接受此 kind（targets `dayId`、revision `day`、投影 `day`）；replay 驗證營業日日期早於提交時的台北日期、不早於上線日、前後快照只差上述 6 個欄位、補開帳者與時間等於命令的操作者與 `committedAt`。
- 驗收：Emulator `cloudDayClose.spec.ts` `P11.14`–`P11.19`（有交易的過去日補開帳 → 重試冪等 → 應有現金含補登金額 → 關帳 → 再補開帳被拒；無營業日補 0 後關帳；寫入器拒絕今天、未來、已有開帳、已關帳、缺原因、過長原因、超過上限、負數與非持有人；合法最大 payload；22 種原始 SDK 竄改；Rules 拒絕今天、未來、已有開帳、已關帳、上線日前、略過營業日寫入、偽裝成 `SetOpeningCash`）；備份 `cloudBackup.spec.ts` 以真實 EnsureDay → 補開帳 → 關帳匯出 → 解密 → replay，偽造補開帳者、原因或前快照都被拒；畫面 `CloudDayClosePage.test.tsx` 補開帳表單與不顯示的情況。E2E 沒有新增：E2E 的上線日是當天，不存在可補開帳的過去營業日。

## 11. P11c1 帳務異常與開帳差額原因

CheerC（2026-10-17）：開帳現金應等於上一個已關帳日的實點現金；不同時只警示、記成帳務異常，仍允許照輸入的金額繼續當天作業。過去有資料卻沒關帳的日子，之後每天開帳、關帳都要警示，直到那天被處理。本節只做「算出異常、顯示警示、開帳差額留原因」；修補工具（回填中間日、關帳對齊、關帳後補記）是 P11c2–c4，不在此。

### 11.1 異常定義

純函式 `domain/ledgerAnomalies.ts`（`computeLedgerAnomalies`）。輸入是營業日（狀態、開帳現金、有效交易數，以及已關帳日最新日結版本的 `countedCash`）和「今天」，輸出依日期排序的異常；「今天」是租約 `updatedAt` 的台北日期，不用瀏覽器時鐘，也不檢查晚於今天的預排日。

- **`opening-mismatch`**：某日 D 已有 `openingCash`，日期早於 D 的最近一個 `status == 'closed'` 營業日 P 存在，且 P 最新日結版本的 `countedCash ≠ D.openingCash`。輸出含 P 的日期與實點、D 的開帳現金、差額（`openingCash − countedCash`）與 D、P 相差的日曆天數（連續兩天為 1）。
  - 找不到 P（上線第一天）不算異常；中間放假（沒有營業日文件）且金額一致也不算。
  - P 只看 `closed`：重開中的日子不算已關帳，往更早找；同一天多次關帳取最新版本。
  - P 與 D 之間若還有未關帳的日子，仍照上述規則比對（那天另外會有 `unclosed-past-day`）。
- **`unclosed-past-day`**：日期早於今天、狀態 open／reopened，且有開帳現金或有效交易數大於 0。等同日結頁 `classifyUnclosedDay` 的 `needs-close` 與 `missing-opening` 中早於今天的日子；沒有開帳現金也沒有有效交易的 `no-business`（含交易全部作廢）不算，今天未關帳也不算。

### 11.2 讀取

`createCloudLedgerReader(db).read()`（`cloudDayCloseRepository.ts`，`readLedger()` 為同一個讀取）。

- 只從伺服器讀：dataHead → 租約日期 → `days` 依 document ID 升冪、範圍 `goLiveDate`..今天 → 每個已關帳日的 `days/{id}/settlements/{lastSettlementRevision}` → 再讀一次 dataHead。`seq` 或 `datasetId` 在讀取期間變動回 `STALE_SNAPSHOT`。
- 營業日文件超過 400 份（讀 401 份判斷）回 `INCOMPLETE_SNAPSHOT`，fail closed，不截斷。已關帳日缺最新版本回 `INCOMPLETE_SNAPSHOT`；最新版本不是關帳版本、沒有日結版本或 schema 不符回 `UNSUPPORTED_SCHEMA`。
- 日結版本不可改，讀取器在記憶體以 `(datasetId, dayId, revision)` 快取，省 Spark 讀取額度；快取只活在該讀取器實例內。
- 沒有新增 index（只用 document ID 範圍與排序）。
- 回傳 `{ today, goLiveDate, anomalies, closedDays, seq }`；`closedDays` 是截至今天的所有已關帳日與其最新實點，開帳表單與寫入器用它找上一個已關帳日（`previousClosedDay`）。

### 11.3 畫面

- 導覽列「帳務異常（n）」：讀取中顯示（…）、失敗顯示（?）、0 筆也顯示（0），遵守 `navigationLocked`。讀取時機：進入雲端模式（登入並持有使用權後）、打開異常頁、開帳或關帳頁的命令確認成功之後；切頁不重讀。
- 異常頁 `CloudLedgerAnomaliesPage`：逐筆列出白話說明。`unclosed-past-day` 附按鈕帶該日期切到日結頁；`opening-mismatch` 說明可能原因、相隔天數，並寫明修補功能尚未開放（之後可回填中間日子，或在前一個已關帳日補記有標記的收支），文案不暗示金額已更正。異常頁暫不顯示開帳差額原因（要讀命令文件）。
- 警示橫幅：開帳區（日期與供應商頁，可開帳時）與日結頁，只要有 `unclosed-past-day` 就顯示「過去有 n 天尚未關帳（日期…）」，附「查看帳務異常」按鈕。
- 開帳表單：顯示上一個已關帳日的日期與實點；輸入金額不同時即時顯示差額警示並出現必填「差額原因」（去頭尾空白後 1–500 字），仍可送出；金額相同或沒有上一個已關帳日時沒有原因欄。上一個已關帳日讀取中或失敗時表單停用並說明，因為無法判斷是否需要原因。

### 11.4 `SetOpeningCash` 選填差額原因（唯一的 Rules 變更）

- payload 由 `{openingCash}` 改為 `{openingCash}` 或 `{openingCash, reason}`。有 `reason` 時通過 `validMutationReason`（1–500 字）且命令頂層 `reason == payload.reason`；沒有時命令頂層 `reason == null`，與原本相同。
- 只改 `validSetOpeningCash` 內部：`validCommandCreate` 沒有新增頂層 `||`；`days/{dayId}` 欄位與 `dayWriteCommand` 不變，營業日不存原因，原因只留在命令文件。因為 `p07CommandEnvelope` 把命令 `reason` 固定為 null（`RemoveVendor` 除外），`validSetOpeningCash` 改用內容相同、但不檢查 `reason` 的 `cashCommandEnvelope`（`BackfillOpeningCash` 等已在用），`reason` 由 `validSetOpeningCash` 自己的兩種形狀（無 reason 且命令 `reason == null`，或有合法 reason 且兩處相等）綁定；其他 kind 的 envelope 不變。
- **「有差額才必填」由畫面與寫入器強制，不是 Rules 保證。** Rules 無法得知上一個已關帳日，所以直接送原始 SDK 的 `SetOpeningCash` 可以不帶原因。寫入器（`cloudDayVendorRepository.setOpeningCash`）送出前用 `createCloudLedgerReader` 找上一個已關帳日；開帳現金與它的實點不同而原因缺少或純空白時回 `INVALID_INPUT`，不送出命令；讀不到時回對應錯誤碼（`STALE_SNAPSHOT` → `REVISION_CONFLICT`、`INCOMPLETE_SNAPSHOT` → `UNSUPPORTED_SCHEMA`），不改用「不需原因」放行。原因送出前 trim。有原因而金額相同時不禁止。
- 型別、normalizer（`cloudCommandSchema.ts`）、回執解碼（命令 `reason` 必須等於 `payload.reason ?? null`）與 `SetOpeningCashInput` 同步。舊版前端送的 `SetOpeningCash` 不帶原因，仍然合法。
- P14：`cloudBackup.ts` 的 `SetOpeningCash` 允許選填 `reason`；replay 沿用回執解碼驗證原因 1–500 字且與命令 `reason` 相同，沒有原因的舊備份照常通過。

### 11.5 驗收與範圍

- 單元：`ledgerAnomalies.test.ts`（含上線第一天、放假金額一致與不同、缺營業日文件、重開、多次關帳、只有開帳現金、全部作廢、今天、排序）、`cloudLedgerReader.test.ts`（升冪範圍、400／401 上限、head 變動、快取、版本不符）、`cloudCommandSchema.dayVendor.test.ts`。
- Emulator：`cloudDayClose.spec.ts` `P11c1.1`–`P11c1.12`（真實命令造異常、讀取上限、帶原因與不帶原因、最大 payload、原始 SDK 九種拒絕、寫入器強制）；`cloudBackup.spec.ts` 帶原因的 round-trip 與偽造被拒。
- 畫面：異常頁、導覽列（讀取中／失敗／0 筆）、兩頁橫幅、開帳表單與日期與供應商頁的原因欄。
- E2E 沒有新增：E2E 上線日是當天，沒有過去營業日，造不出兩種異常。
- 不做：P11c2–c4 修補工具；異常頁顯示開帳原因；角色權限（重開仍所有人可用）。
- 部署（CheerC 本機）：Rules 與前端一起上；舊前端不帶原因仍合法，只是不會被要求填差額原因。

