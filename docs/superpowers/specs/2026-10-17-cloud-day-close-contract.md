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
- `payload`：CloseDay `{ countedCash, note, expectedCash }`，回填日另帶 `alignWithDayId`（§14）；ReopenDay `{ reason }`。
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
- 範圍外：補開帳本身**不會**讓那天補登訂餐、繳費或櫃台收支（回填交易見 [§12](#12-p11c2a-回填斷層日startbackfill)）。伺服器上不存在的過去日子不提供補開帳；要先用 `EnsureDay` 建立。
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

- 只從伺服器讀：dataHead → 租約日期 → `days` 依 document ID 升冪、範圍 `goLiveDate`..今天，**每頁 200 筆、以 `startAfter` 分頁讀完**（P11c2a 取代 P11c1 的 400 份硬上限）→ 每個已關帳日的 `days/{id}/settlements/{lastSettlementRevision}` → **每一頁之後都再讀一次 dataHead**。`seq` 或 `datasetId` 在讀取期間變動回 `STALE_SNAPSHOT`。
- **讀取次數約等於營業日數**（每份營業日文件 1 次讀取，加上每個已關帳日 1 次日結版本讀取，版本在同一個 Firestore 實例內快取）；這只發生在異常頁與導覽列計數，開帳表單與寫入器不做完整掃描（見下一條）。完整掃描的失敗上限是 20,000 份營業日文件（約 55 年），超過回 `INCOMPLETE_SNAPSHOT`，不截斷。已關帳日缺最新版本回 `INCOMPLETE_SNAPSHOT`；最新版本不是關帳版本、沒有日結版本或 schema 不符回 `UNSUPPORTED_SCHEMA`。
- **上一個已關帳日的查找**（`findPreviousClosed(dayId)`，開帳表單與 `SetOpeningCash` 寫入器共用）：從 `dayId` 往回，每次讀 `[dayId−31 天, dayId)` 的營業日（升冪、由後往前找第一個 `closed`），找不到再往前一段，直到上線日；每一段之後都比對 dataHead。讀取量只取決於「離上一個已關帳日多遠」，與歷史總長度無關，所以營業日超過 400 份後仍能設定開帳現金。表單的「可送出」條件只依賴這個查找，異常掃描失敗（導覽列顯示「?」）不會擋住開帳。
- 日結版本不可改，讀取器在記憶體以 `(datasetId, dayId, revision)` 快取，省 Spark 讀取額度；快取只活在該讀取器實例內。
- 沒有新增 index（只用 document ID 範圍與排序）。
- 回傳 `{ today, goLiveDate, anomalies, closedDays, seq }`。

### 11.3 畫面

- 導覽列「帳務異常（n）」：讀取中顯示（…）、失敗顯示（?）、0 筆也顯示（0），遵守 `navigationLocked`。讀取時機：進入雲端模式（登入並持有使用權後）、打開異常頁、開帳或關帳頁的命令確認成功之後；切頁不重讀。
- 異常頁 `CloudLedgerAnomaliesPage`：逐筆列出白話說明。`unclosed-past-day` 附按鈕帶該日期切到日結頁；`opening-mismatch` 說明可能原因、相隔天數，並寫明修補功能尚未開放（之後可回填中間日子，或在前一個已關帳日補記有標記的收支），文案不暗示金額已更正。異常頁暫不顯示開帳差額原因（要讀命令文件）。
- 警示橫幅：開帳區（日期與供應商頁，可開帳時）與日結頁，只要有 `unclosed-past-day` 就顯示「過去有 n 天尚未關帳（日期…）」，附「查看帳務異常」按鈕。
- 開帳表單：顯示上一個已關帳日的日期與實點；輸入金額不同時即時顯示差額警示並出現必填「差額原因」（去頭尾空白後 1–500 字），仍可送出；金額相同或沒有上一個已關帳日時沒有原因欄。上一個已關帳日讀取中或失敗時表單停用並說明，因為無法判斷是否需要原因。

### 11.4 `SetOpeningCash` 選填差額原因（唯一的 Rules 變更）

- payload 由 `{openingCash}` 改為 `{openingCash}` 或 `{openingCash, reason}`。有 `reason` 時通過 `validMutationReason`（1–500 字）且命令頂層 `reason == payload.reason`；沒有時命令頂層 `reason == null`，與原本相同。
- 只改 `validSetOpeningCash` 內部：`validCommandCreate` 沒有新增頂層 `||`；`days/{dayId}` 欄位與 `dayWriteCommand` 不變，營業日不存原因，原因只留在命令文件。因為 `p07CommandEnvelope` 把命令 `reason` 固定為 null（`RemoveVendor` 除外），`validSetOpeningCash` 改用內容相同、但不檢查 `reason` 的 `cashCommandEnvelope`（`BackfillOpeningCash` 等已在用），`reason` 由 `validSetOpeningCash` 自己的兩種形狀（無 reason 且命令 `reason == null`，或有合法 reason 且兩處相等）綁定；其他 kind 的 envelope 不變。
- **「有差額才必填」由畫面與寫入器強制，不是 Rules 保證。** Rules 無法得知上一個已關帳日，所以直接送原始 SDK 的 `SetOpeningCash` 可以不帶原因。寫入器（`cloudDayVendorRepository.setOpeningCash`）送出前用 `createCloudLedgerReader` 找上一個已關帳日；開帳現金與它的實點不同而原因缺少或純空白時回 `INVALID_INPUT`，不送出命令；讀不到時回對應錯誤碼（`STALE_SNAPSHOT` → `REVISION_CONFLICT`、`INCOMPLETE_SNAPSHOT` → `UNSUPPORTED_SCHEMA`），不改用「不需原因」放行。原因送出前 trim。有原因而金額相同時不禁止。純空白原因會通過 Rules 與 normalizer（與既有 `validMutationReason` 一致，Rules 不 trim），只由寫入器與畫面 trim 後擋下。
- 型別、normalizer（`cloudCommandSchema.ts`）、回執解碼（命令 `reason` 必須等於 `payload.reason ?? null`）與 `SetOpeningCashInput` 同步。舊版前端送的 `SetOpeningCash` 不帶原因，仍然合法。
- P14：`cloudBackup.ts` 的 `SetOpeningCash` 允許選填 `reason`；replay 沿用回執解碼驗證原因 1–500 字且與命令 `reason` 相同，沒有原因的舊備份照常通過。

### 11.5 驗收與範圍

- 單元：`ledgerAnomalies.test.ts`（含上線第一天、放假金額一致與不同、缺營業日文件、重開、多次關帳、只有開帳現金、全部作廢、今天、排序）、`cloudLedgerReader.test.ts`（升冪範圍、400／401 上限、head 變動、快取、版本不符）、`cloudCommandSchema.dayVendor.test.ts`。
- Emulator：`cloudDayClose.spec.ts` `P11c1.1`–`P11c1.12`（真實命令造異常、讀取上限、帶原因與不帶原因、最大 payload、原始 SDK 九種拒絕、寫入器強制）；`cloudBackup.spec.ts` 帶原因的 round-trip 與偽造被拒。
- 畫面：異常頁、導覽列（讀取中／失敗／0 筆）、兩頁橫幅、開帳表單與日期與供應商頁的原因欄。
- E2E 沒有新增：E2E 上線日是當天，沒有過去營業日，造不出兩種異常。
- 不做：P11c2–c4 修補工具；異常頁顯示開帳原因；角色權限（重開仍所有人可用）。
- 部署（CheerC 本機）：Rules 與前端一起上；舊前端不帶原因仍合法，只是不會被要求填差額原因。

## 12. P11c2a 回填斷層日（`StartBackfill`）

CheerC（2026-10-17）：某天整天沒用系統，事後要能補登那天的訂餐、繳費與櫃台收支（含呆帳）；回填的資料要有標記與原因；已關過帳的日子不能用回填改。本節是後端；回填模式的畫面是 P11c2b，「關帳要與下一天開帳對齊」是 P11c3，已關帳日的事後補記是 P11c4。

### 12.1 機制

- **建立那一天**：沿用 `EnsureDay`（Rules 已允許上線日後的過去日期）與 `BackfillOpeningCash`（§10），不另做建日命令。
- **新 kind `StartBackfill`**（第 26 種，已啟用 24 種）：把一個過去的營業日標成「回填中」並寫下原因。
  - 條件：營業日存在、早於台北今天、不早於上線日、狀態 open 或 reopened、**`lastSettlementRevision == 0`**（從沒關過帳）、還沒有標記。
  - `targets {dayId}`、`expectedRevisions {day}`（= 目前版本，≥ 1）、`payload {reason}`（1–500 字，命令 `reason` 等於 `payload.reason`）、`businessDate == dayId`、`studentId == null`、現金影響為 0、`before`／`after` 為 `{head, day, backfill}`。
  - 一次 commit 寫 3 份文件：`system/dataHead`、`commands/{commandId}`、新集合 `backfillDays/{dayId}` = `{dayId, reason, startedBy, startedAt, commandId}`。營業日文件**不動**（它是固定形狀，不加欄位）；命令的 `before.day` 與 `after.day` 相同。
- **標記不可改也不可刪**：`backfillDays/{dayId}` 的 `get`／`list` 只給目前持有人，`create` 只能經由 `StartBackfill` 命令（`backfillDayCommand` 綁住命令的 kind、commandId、`committedAt == request.time`、`targets.dayId`，並要求命令的 `after.backfill` 等於這份文件），`update`／`delete` 一律 false。
- **放寬「只限今天」，只開三種**：`CreateOrder`、`CreatePayment`、`CreateCashMovement`。這些路徑上的日期檢查由 `validCurrentTaipeiDate(d)` 改為 `validTransactionDay(d, day)` = `validCurrentTaipeiDate(d) || (day.lastSettlementRevision == 0 && exists(backfillDays/d))`（今天的交易先短路，不多一次文件存取；`day` 沿用該路徑已讀的營業日快照，沒有額外的 `get`）。涉及：交易文件 `validTransactionDoc`（`businessDate`）、`validTransactionPayload`（`targets.dayId`）、`validCreateCashMovement`（命令與交易兩處）。`dayWriteCommand` 不動。
- **不開放**：`CreateRefund`（會動現場現金）、`Undo`、`CancelRefund`（維持只限今天）。作廢、更正等 mutation 本來就允許過去未關帳的日子，維持原狀。`SetDayMenu` 直接設定本來就能設過去未關帳日的菜單（只有 `selectionDate` 要是今天），不需要放寬；繼承路徑不放寬。
- **標記判定（交易不加欄位）**：交易文件的形狀不變。一筆交易是「回填的」，當且僅當該日有 `backfillDays/{dayId}`，而且交易 `createdAt`（伺服器時間）換成台北日期後晚於 `businessDate`。兩個條件都由 Rules 保證，無法偽造。讀取端提供 `readBackfillDay(dayId)`（回 `CloudBackfillDay | null`）與 `isBackfilled(tx, backfill)`；日結 overview 的每個未關帳日帶 `backfill`（原因、開始者、時間），P11c2b 的畫面與 P12 報表用。原因記在日的層級，櫃台收支本身另有自己的 reason。
- **關帳之後**：標記之後該日一旦關過帳（`lastSettlementRevision > 0`），即使重開，三種交易也被拒；要改只能走 mutation 或之後的 P11c4。

### 12.2 寫入器與錯誤碼

- `cloudCommandRepository`：新增 `StartBackfill`；三種交易命令不在客戶端判斷日期，由 Rules 決定，被拒時以讀回的營業日診斷。今天的判斷照舊用租約 `updatedAt` 的台北日期。
- 錯誤碼：`StartBackfill` 對關過帳的日子（狀態 closed 或 `lastSettlementRevision > 0`）→ `DAY_CLOSED`；三種交易被 Rules 拒絕時，營業日目前為 closed → `DAY_CLOSED`；已關過帳又重開（open 但 `lastSettlementRevision > 0`）→ `DAY_CLOSED`，訊息說明「曾經關過帳（現在是重開狀態）」（P11c2b 起，原本回 `INVALID_INPUT`）；過去日沒有標記 → `INVALID_INPUT`，訊息指向日結頁的「標為回填」；今天、未來、上線日前、營業日不存在、已有標記、缺原因或過長 → `INVALID_INPUT`；沒有標記的過去日交易 → `INVALID_INPUT`；版本不符 → `REVISION_CONFLICT`；非持有人 → `LEASE_LOST`。
- 回填日的開帳現金仍用 `BackfillOpeningCash`（原因本來就必填），Rules 不改；預設帶入上一個已關帳日實點、金額不同時原因必填是畫面（P11c2b）的事。
- 型別、normalizer、回執解碼（`validateStartBackfillReceipt`：營業日前後相同、標記欄位等於 payload 原因、操作者 uid、`committedAt` 與 `commandId`）同步；交易回執解碼的日期條件改為「台北今天，或從沒關過帳的過去日」（標記是否存在不在回執內，由 Rules 與 P14 replay 證明）。

### 12.3 P14 備份

- decoder／replay 接受 `StartBackfill`（targets `dayId`、revision `day`、投影 `day`＋`backfill`；`backfillDays` 以實際路徑 `backfillDays/{dayId}` 存進 projectionState）。
- replay 驗證：標記日期早於提交時的台北日期、`lastSettlementRevision == 0`、狀態 open／reopened、之前沒有同日標記、`startedBy` 與 `startedAt` 等於命令的操作者與 `committedAt`、原因等於 payload。
- 回填交易 replay：`CreateOrder`／`CreatePayment`／`CreateCashMovement` 若提交時的台北日期晚於 `businessDate`，該日必須已有較早重播出的標記且營業日從沒關過帳；營業日晚於提交日期也被拒。因此偽造標記、標記前的回填交易、竄改原因都會被拒。舊備份（沒有回填）照常通過。

### 12.4 文件存取與部署

- 回填路徑多一次 `exists(backfillDays/{dayId})`：以 Emulator 的回填 `CreateOrder`／`CreatePayment`／`CreateCashMovement` 正向案例（`P11c2a.14`）證明沒有超過每請求 10 次、batch 20 次的上限；預算見 [P11c2a 附錄](../../ops/p05-rules-budget.md#p11c2a--gap-day-backfill--budget-and-probe-receipt)。
- `backfillDays` 是新集合，只用 document ID 的 `get` 與 `documentId() in [...]`（overview 每 30 個營業日一個查詢），**不需要新 index**；`firestore.indexes.json` 不變。
- 部署（CheerC 本機）：Rules、前端、`firestore.indexes.json` 一起上（indexes 這批不變，也一併帶上）；舊前端不會送 `StartBackfill`，既有今天的交易路徑不變。

### 12.5 驗收與範圍

- 單元：`cloudLedgerReader.test.ts`（分頁、分段往回、可注入的頁大小與分段天數、head 變動）、`cloudBackfillReader.test.ts`（`isBackfilled` 台北日界、`decodeBackfillDoc`）。
- Emulator：`cloudDayClose.spec.ts` `P11c2a.1`–`.3`（分頁掃描超過 400 份、上一個已關帳日超過 400 天仍找得到、讀取中 head 變動回 `STALE_SNAPSHOT`）與 `P11c2a.4`–`.14`（完整回填流程後關帳與重試冪等；沒有標記的過去日交易被拒；寫入器的 7 種拒絕與錯誤碼；標記後關帳再重開仍拒；合法最大 `StartBackfill`；原始 SDK 21 種竄改；Rules 拒絕今天、未來、上線日前、已關帳、關過帳；標記不可改、刪、手動建立；回填日不能退款或作廢；讀取端；三種交易各自的正向案例）；備份 `cloudBackup.spec.ts` 真實 EnsureDay → 補開帳 → 開始回填 → 回填訂餐／繳費／收支 → 關帳 → 匯出 → 解密 → replay，偽造標記、標記前的交易、竄改原因被拒。
- 不做：回填模式的畫面（P11c2b）、關帳對齊（P11c3）、已關帳日補記（P11c4）、角色權限。

## 13. P11c2b 回填模式畫面

只動畫面與讀取端，**Rules 不改**（沒有新 command kind、沒有新欄位）。CheerC 的方向：異常頁每個斷層日有「回填這一天」；回填要寫原因；進訂餐頁後有顯眼的回填橫幅與「離開回填」；回填中只能補訂餐、繳費與櫃台收支，不能退款、撤回或「取消並退還」。

### 13.1 開始回填（日結頁，三步）

- **入口**：異常頁（§11.3）的「開帳現金與上次關帳不同」列，若兩個日期之間有沒有營業日文件的日子，列出這些日子（最多 31 天，最舊在前，超過顯示總數），每天一顆「回填這一天（YYYY-MM-DD）」；「從沒關過帳的過去未關帳日」列有「標為回填，補登剩下的交易」。兩者都只是導向日結頁並選定那一天（`initialDayId`），不在異常頁送命令。
- **日結頁回填表單**（只對「早於台北今天、不早於上線日、從沒關過帳、還沒有標記」的日子顯示；已關帳、重開過、今天、上線日前都不顯示）：回填原因必填 1–500 字（trim 後計）；那天還沒有開帳現金時再加開帳現金（0–20,000 的整數）。**預設開帳現金 = 上一個已關帳日的實點現金**；改成別的金額，必須另寫 1–500 字的差額原因（這就是 `BackfillOpeningCash` 的 `reason`）；與上次關帳相同時，`reason` 用回填原因。
- **三個命令，各有自己的 command ID**：`EnsureDay`（那天沒有營業日文件）→ `BackfillOpeningCash`（還沒有開帳現金）→ `StartBackfill`。下一步由**伺服器現況**推導（沒有日 → 建日；沒有開帳 → 補開帳；沒有標記 → 標記），所以重試永遠不重做已完成的步驟。確認完一步後自動接下一步。
- **失敗與重試**：任一步失敗，頁面說明「回填 X 停在這一步」，並保留計畫；按「繼續回填」從那一步續跑。明確被拒（例如版本衝突）= 沒有建立任何東西，續跑用新命令與目前版本；**結果不確定**沿用日結頁既有的復原機制：保留原 command ID、先查 receipt、再以相同輸入確認，不換 ID。
- **查詢上一個已關帳日失敗**：不能開始回填（需要它算預設值與差額），顯示原因與「重新查詢」；開帳表單（日期與供應商頁）同樣加「重新查詢上一個已關帳日」按鈕（#511 審查備註）。
- 回填中的日子，日結頁顯示「正在回填（原因：…）」與「到訂餐頁補登」，並且不再提供第二次開始；日結未關帳清單的那一天標「回填中」。

### 13.2 訂餐頁的回填檢視

- 日期選單只在有回填中的日子時出現（`listCloudBackfillingDays`：有標記、`status === 'open'`、從沒關過帳——重開過的日子 Rules 已不收交易，不列）；清單讀不到時只顯示一行說明，**今天的作業不受影響**（租約遺失、無權限、忙碌仍照常結束頁面）。App 也可帶 `initialBackfillDayId` 直接開某一天。
- `loadSnapshot({dayId})`：dayId 為空或等於今天 = 今天；過去日必須介於上線日與今天之前**且有標記**，否則 `INVALID_INPUT`（頁面提供「回到今天」）。快照多了 `businessDate`、`backfill`、`backfillDays`、`backfillDaysError`。
- 回填檢視：所有列、合計與命令（`dayId`、營業日版本）都屬於那一天；顯眼的橫幅「正在回填 YYYY-MM-DD（原因：…）」與「離開回填」；只開放訂餐、繳費與櫃台收支。**退款**停用並說明；**5 秒撤回**不提供（Rules 的 `Undo` 只限今天），改用更正／作廢；**取消訂餐並退還**不提供，只剩「取消訂餐，錢留在帳戶」。沒有那天的菜單時，只能登記「其他餐點」並提示到日期與供應商頁設定那天的菜單（過去未關帳日的 `SetDayMenu` 直接設定本來就可用，§12.1）。
- 標籤：`isBackfilled`（有標記，且建立時間的台北日期晚於營業日）的列顯示「回填」；一般列、非回填日完全不變。台北午夜以 UTC 16:00:00 為界（單元測試 `cloudBackfillReader.test.ts`）。

### 13.3 寫入器診斷（#511 審查備註）

標記後關帳再重開的日子，三種交易被 Rules 拒絕時，寫入器回 `DAY_CLOSED` 與明確訊息（見 §12.2）；沒有標記的過去日回 `INVALID_INPUT` 並指向「標為回填」。P11c3 起，「沒有標記、關過帳又重開」的日子也回 `DAY_CLOSED`，訊息明說原因是**沒有回填標記**（與「有標記、關過帳又重開」的訊息分開）。診斷只在被拒時多讀租約與標記兩份文件，成功路徑不變。

### 13.4 驗收與範圍

- 單元／元件（Vitest）：`CloudDayClosePage.test.tsx`（三步成功、每步失敗與續跑、結果不確定保留 ID、差額原因、查詢失敗重試、標為回填單步、回填中顯示、不該顯示的日子）、`CloudOrdersPage.test.tsx`（橫幅與離開、日期選單、標籤、退款／撤回／取消並退還的停用、清單讀取失敗、回到今天）、`CloudLedgerAnomaliesPage.test.tsx`、`ledgerAnomalies.test.ts`、`CloudDayVendorsPage.test.tsx`（重新查詢）、`cloudBackfillReader.test.ts`（午夜邊界）。
- Emulator：`cloudDayClose.spec.ts` 異常物件帶 `gapDays`／`gapDayCount`、`P11c2a.7` 改為 `DAY_CLOSED`、新增 `P11c2b.1`（repository 三步與回填中清單）；`cloudOrderRepository.spec.ts` `P11c2b.R1`–`R3`。
- 不做：關帳對齊（P11c3）、已關帳日補記（P11c4）、角色權限（重開仍人人可用）、P12。

## 14. P11c3 回填日關帳對齊

CheerC 的規則（規劃文件 R3）：回填完的日子要關帳時，結果必須和**下一個有開帳的日子**的開帳現金一致，對不上就不能關帳，並提示回頭補齊那天的帳（補登交易或收支，含呆帳）。例：星期一關帳 1,000，星期二斷線事後回填，星期三開帳 950；星期二的開帳預設 1,000，回填完關帳時實點必須是 950，應有現金也必須算出 950，差的 50 元要補登星期二的交易或收支補平，否則擋下。

只適用於有 `backfillDays/{dayId}` 標記的日子；一般日子的關帳**完全不變**。`ReopenDay` 不變（回填日重開後不能再補登，§12.1）。

### 14.1 `CloseDay` 對已標記日子的額外條件（Rules）

檢查分在兩處，沒有新的頂層 `||`：

- **指令規則 `validDaySettlementCommand` 的 CloseDay 分支**（只驗形狀與對齊）：`payload` 是原本三個欄位 `{countedCash, note, expectedCash}`，或四個欄位 `{…, alignWithDayId}`。四個欄位時：`countedCash == expectedCash`（不接受「有差額但寫說明」）；`alignWithDayId` 為 `null`，或一個合法台北日期字串、**晚於本日**、對應的營業日存在、`openingCash` 等於 `countedCash`（`openingCash == null` 時不相等，自然被拒）。三個欄位的一般關帳先短路成立，所以一般日子在這條最緊的規則上沒有多付成本。
- **營業日規則 `dayCloseCommand`**（餘裕大）：CloseDay 帶不帶 `alignWithDayId` 必須與 `exists(backfillDays/{dayId})` 一致 —— **有標記就必須帶、沒標記就不能帶**。選「沒標記不帶」而不是「必須為 null」，是為了讓一般日子的命令、指紋、備份與舊客戶端完全不變。指令、營業日、結算版本在同一個原子 commit，營業日的更新要過這條規則才能成立，所以把標記連動放在這裡等價於放在指令規則，卻不占用指令規則的餘裕。
- 其餘（`expectedCash` 公式、`countedCash` 範圍、`note` 長度、`before`／`after` 快照）與一般關帳相同。結算版本文件的形狀不變（`difference` 必為 0）。

### 14.2 Rules 的極限與寫入器的責任

Rules 無法證明兩件事，由寫入器與異常頁補上：

1. **本日與 `alignWithDayId` 之間沒有其他已開帳的日子**（Rules 不能查詢範圍）。
2. **傳 `null` 時，本日之後真的沒有已開帳的日子**。

- 寫入器 `findNextOpened(dayId)`：從本日後一天往前掃到租約的台北日期，每段 31 個曆日一個以 document ID 排序的查詢，找到第一個 `openingCash != null` 的營業日（開帳了的 open／closed／reopened 都算）就停；每段之後比對 data head，變動回 `STALE_SNAPSHOT`。讀取量跟著斷層長度，不跟歷史長度。
- `closeDay({alignWithDayId})`：有帶這個欄位時（日結頁對有標記的日子一律帶），先以 `readCommand` 確認這個 command ID 還沒有回執（重試不受掃描結果影響），再 `findNextOpened`；最近的已開帳日與 `alignWithDayId` 不同（較遠的一天、或最近有而傳了 `null`、或最近沒有而傳了日期）→ `REVISION_CONFLICT` 並說明最近的是哪一天，不送命令。
- 交易內（client 端）再讀一次標記與對齊日：標記存在卻沒帶 `alignWithDayId`、沒有標記卻帶了、有差額、對齊日不存在／沒開帳／金額不符 → `INVALID_INPUT`（訊息說明原因）；讀過的文件在提交時被改，交易自然失敗重試。Rules 在提交時再證明一次同樣的事實。
- 異常頁（§11）繼續當安全網：對不上的相鄰日仍顯示 `opening-mismatch`。

### 14.3 畫面（日結頁）

- 有標記、還沒關帳、已有開帳現金的日子，載入時多一次 `findNextOpened`（查詢失敗只停用關帳並顯示原因與「重新查詢」，不影響其他資料）。
- 關帳區顯示「須等於 YYYY-MM-DD 的開帳現金 N 元」（沒有較晚的已開帳日則說明不需對齊，只要實點等於應有現金）、目前應有現金與差額。**實點預設填入對齊金額**。
- 差額不為 0：「確認關帳」停用，寫明差多少，並引導回訂餐頁的回填模式補登那天的交易或收支（含呆帳）。回填日的備註改為選填（沒有差額原因）。
- 一般日子的畫面與行為不變。

### 14.4 P14 備份

- decoder：`CloseDay` 的 payload 接受選填 `alignWithDayId`（`null` 或合法日期）。
- replay：沒有標記的日子帶 `alignWithDayId` → 拒；有 `alignWithDayId` 時結算 `difference == 0` 且 `countedCash == expectedCash`；非 `null` 時對齊日必須晚於本日，且**在提交當時**（重播到這筆命令時的狀態）已有 `openingCash`、金額相等。偽造對齊金額、把關帳挪到對齊日開帳之前、對齊日不存在都會被拒。
- 舊備份（P11c3 之前、有標記的日子關帳沒有 `alignWithDayId`）與一般關帳照常通過。
- **刻意放寬**：replay 對「有標記的日子關帳卻沒帶 `alignWithDayId`」放行，是為了相容 P11c3 之前的備份。代價是偽造的備份可以把標記日寫成有差額的關帳並通過 replay，而上線中的 Rules 不允許這種關帳。待確認正式環境從未在 P11c3 之前關過標記日，再收緊為「標記日必帶欄位」（見 handoff 待辦）。

### 14.5 #513 審查遺留（一併處理）

- **訂餐頁讀取成本**：`loadSnapshot` 每次都跑一次日結 overview（等於每筆櫃台操作多 3–4 次讀取）。改為 `loadSnapshot({dayId, knownBackfillDays})`：櫃台操作成功或明確被拒後的重讀沿用頁面手上的回填日清單（上次讀取成功才沿用），第一次載入、切換日期、離開回填、「重新載入」、回到今天仍重讀。回填標記本身（`readBackfillDay`）每次仍讀，所以被檢視的那一天是否還在回填永遠是新的。
- **E2E `D09` 清理**：測試期間新增的 `commands` 文件（依 `seq` 大於測試前的 head）一併刪除，`dataHead` 的 `seq`、`lastCommandId`、`goLiveDate` 還原。
- **診斷訊息**：「沒有標記、關過帳又重開」的過去日，三種交易被拒時回 `DAY_CLOSED`，訊息明說**沒有回填標記**；有標記的重開日維持「曾經關過帳（現在是重開狀態）」。診斷只在被拒時多讀租約與標記。
- **完整三步 UI E2E**：`D10` 種下已關帳的前一天（870）與已關帳的後一天（970），中間那天沒有營業日文件；由異常頁「回填這一天」→ 日結頁三步（建日、補開帳預設 870、標記）→ 差 100 停用 → 訂餐頁補繳費 60、再 40 → 日結頁以預設 970 對齊關帳，並用 Admin 讀取確認三個命令、結算與 `alignWithDayId`。

### 14.6 驗收、部署與範圍

- 單元／元件：`cloudCommandSchema.dayClose.test.ts`（欄位、對齊日必須晚於本日、有差額被拒）、`cloudLedgerReader.test.ts`（`findNextOpened`：最近的已開帳日、跳過未開帳、分段往後、head 變動、壞路徑）、`CloudDayClosePage.test.tsx`（對齊顯示與預設、差額停用並引導、`null` 對齊、查詢失敗重試、一般日子不變）、`CloudOrdersPage.test.tsx`（清單重用與不重用）。
- Emulator：`cloudDayClose.spec.ts` `P11c3.1`–`P11c3.10`（對齊關帳與重試冪等、`null` 對齊、寫入器拒絕較遠日與錯的 `null`、標記／差額的寫入器拒絕、補收支後才能關帳、一般日子不變、原始 SDK 拒絕 10 種（差額＋對齊相符、差額＋null、金額不符、對齊自己、對齊更早的日子、對齊不存在、對齊未開帳、非字串、路徑、缺欄位）＋自己對齊自己（無其他差異）＋偽造 before＋多餘欄位＋一般日子帶欄位、合法最大 payload、重開後再關帳、無標記重開日的診斷訊息）；備份 `cloudBackup.spec.ts` 真實 EnsureDay → 補開帳 → 標記 → 補登 → 對齊關帳 → 匯出 → 解密 → replay 與偽造對齊被拒。E2E `D10`。Rules mutant 與餘裕見[預算附錄](../../ops/p05-rules-budget.md#p11c3--aligned-close-of-a-back-filled-day--budget-and-probe-receipt)。
- 部署（CheerC 本機）：Rules、前端、`firestore.indexes.json` 一起上（indexes 不變）。舊前端對有標記的日子關帳會被新 Rules 拒絕（缺 `alignWithDayId`），所以 Rules 與前端要同一次上線。
- 不做：已關帳日補記（P11c4）、角色權限（重開仍人人可用）、P12（回填日關帳後查帳頁仍待 P12）。

## 15. P11c4 關帳後補記（`RecordPostCloseEntry`）

CheerC 的規則（R6／R7、Q2）：已關帳的日子不能靠重開來修，只能補記**有標記、原因必填**的一般櫃台收支（收入、支出、呆帳類）；學生的訂餐與繳費一律不能動。例：星期一關帳 1,000，星期三開帳 950，中間沒有營業；在星期一補記一筆 50 元支出並寫原因，星期一的「有效關帳現金」變成 950，`opening-mismatch` 消失。分兩批：**P11c4a（後端、Rules、P14、Emulator）**寫在本節；P11c4b（畫面）之後補在 §15.8。

> 本節是 P11c4a（後端）的契約。畫面（P11c4b）尚未開始；沒做的項目見 §15.6 與 PR body 的「未完成」。

### 15.1 機制（Rules）

- 新 command kind `RecordPostCloseEntry`，一次 commit 寫三份文件：`system/dataHead`、`commands/{id}`、新集合 `postCloseEntries/{entryId}`。**不寫營業日文件、不動日結版本、交易與學生**；營業日形狀（`size() == 10`）與 `revision` 都不變，所以 `P08.8` dayWrite 的餘裕不受影響。
- 使用條件：營業日 `status == 'closed'`（重開中的日子走一般流程，不能補記）；日期不早於上線日。
- `payload = {direction: 'income' | 'expense', amount, reason}`：`amount` 為 1–20,000 的整數；`reason` 原始字串長度 1–500；命令頂層 `reason` 必須等於 `payload.reason`。Rules 的 `reason.trim().size() >= 1` 會拒絕全由 U+0000–U+0020 組成的原因（含 ASCII 控制字元與空白）。Client normalizer 另拒絕空字串，以及全由空格、tab、CR、LF 組成的原因；兩者接受集合不完全相同。NBSP（U+00A0）、全形空白（U+3000）等 Unicode 空白不會被 Rules 的 `trim()` 移除，原始 SDK 可寫入。**回執、補記讀取與 P14 備份驗證不得拒絕 Rules 可寫入的值**；否則一筆不可修改的補記會卡住讀取或匯出。有效原因一律保留原字串。
- 補記文件欄位 `{entryId, dayId, settlementRevision, direction, amount, reason, createdBy, createdAt, commandId}`，`entryId == commandId`（文件 ID 就是 command ID，重試落在同一份文件）；`settlementRevision` 必須等於營業日目前的 `lastSettlementRevision`。文件不可修改、不可刪除。
- 命令分支巢狀放在 `validCommandCreate` 最後一個 operand，不加頂層 `||`。`postCloseEntries` 的權限：get／list 限 currentHolder；create 只能經由這個命令（`postCloseEntryCommand`，仿 `backfillDayCommand`）；update／delete 一律 `false`。

### 15.2 冪等與 `expectedRevisions`

`expectedRevisions = {day, settlement}`：`day` 必須等於營業日目前的 `revision`，`settlement` 必須等於 `lastSettlementRevision`。營業日文件這一批不被寫入，但寫入器的交易會 `tx.get` 它，提交時若這一天被重開（`revision` 與 `lastSettlementRevision` 都會變）交易就失敗重試；Rules 也在提交當下用 `get()` 比對目前的營業日。重試沿用同一個 command ID：已有回執就回傳回執，補記文件落在 `postCloseEntries/{commandId}`，不會重複。

### 15.3 有效關帳現金

- 公式：最新日結版本的 `countedCash` + Σ income − Σ expense，**只計入 `settlementRevision == lastSettlementRevision` 的補記**（`src/domain/postCloseEntries.ts`）。
- 日子重開再重新關帳後，舊補記只當歷史顯示、不再計入（重新點算已經涵蓋它們）。
- 兩處改用有效關帳現金：異常計算（`opening-mismatch` 比較「下一個已開帳日的開帳現金」與前一個已關帳日的**有效**關帳現金，差額 `difference = openingCash − 有效關帳現金`）、開帳預設值（回填日的開帳預設為上一個已關帳日的有效關帳現金）。
- P11c3 的對齊**不用**有效關帳現金：回填日關帳要等於「下一個已開帳日」的 `openingCash`，那是該日自己的欄位，補記不會改它；補記發生在關帳之後，由異常頁的 `opening-mismatch` 接手（Q2 的例子：星期一 1,000、星期三開帳 950，補記 50 元支出後差額為 0，異常消失）。
- 讀取（`cloudDayCloseRepository.ts`）：單一日子的 `readCloudDayClose` 依 `dayId` 查詢（`where dayId == x`、依文件 ID 排序、每頁 200 筆、`startAfter`，只靠單欄位索引，不需新的 composite index；Emulator 不檢查索引，正式環境的索引行為沒有在本批驗證）。帳務異常頁掃描整個 `postCloseEntries` 集合一次、依日子分組，不是每個已關帳日各查一次。每頁都比對 head（變動就 `STALE_SNAPSHOT`），任何一頁失敗整個結果 fail closed，總量上限 20,000 筆，超過也 fail closed。

### 15.4 寫入器

`recordPostCloseEntry(input)` 提交 `RecordPostCloseEntry`：交易內 `tx.get` 營業日確認 `closed`、`revision` 與 `lastSettlementRevision` 吻合、日期不早於上線日、補記文件尚不存在；`INVALID_INPUT`（不是已關帳日）、`REVISION_CONFLICT`（版本不符）。回執驗證（`validatePostCloseEntryReceipt`）檢查 head 推進、`cashEffect` 全為 0、營業日前後相同且為 `closed`、`before.postCloseEntry === null`、補記文件各欄位與 payload、操作者、`committedAt` 相符。畫面（輸入表單、列表、標記）是 P11c4b。

### 15.5 P14 備份

- decoder：新 kind 與 payload（`direction`、`amount`、`reason`）、`targets = {dayId}`、`expectedRevisions = {day, settlement}`、`before/after = {head, day, postCloseEntry}`。補記文件路徑 `postCloseEntries/{commandId}`。
- 驗證（匯出與開啟時）：營業日 before／after 相同且為 `closed`、`lastSettlementRevision == expectedRevisions.settlement`；補記各欄位對 payload／操作者／`committedAt`；金額 1–20,000、方向、原因原始字串長度 1–500；manifest 不另拒絕空白原因，因 Unicode 空白可由 Rules 寫入（見 §15.1）；營業日不早於上線日。Client normalizer 對空字串與全由空格、tab、CR、LF 組成的原因另有檢查，但不可使備份／讀取拒絕 Rules 已接受的 Unicode 空白值。
- replay：重播到這筆命令時，營業日必須是 `closed`、`lastSettlementRevision` 等於補記的 `settlementRevision`，且補記文件尚不存在。補記挪到關帳之前、重開之後沒重新關帳、同一筆重放，都會被拒。
- 舊備份（沒有新 kind）照常通過。

### 15.6 驗收與範圍

- 單元：`postCloseEntries.test.ts`（有效關帳現金）、`ledgerAnomalies.test.ts`（有效關帳現金讓異常消失）、`cloudCommandSchema.*`、`CloudOrdersPage.test.tsx`（被拒絕後重讀回填日清單）。
- Emulator：`cloudDayClose.spec.ts` `P11c4.*`（見 PR 與 evidence 的實際數字）；備份 `cloudBackup.spec.ts` 真實 關帳 → 補記 → 重開 → 重新關帳 → 補記 → 匯出 → 解密 → replay 與偽造被拒。Rules mutant 與餘裕見[預算附錄](../../ops/p05-rules-budget.md#p11c4a--post-close-entry--budget-and-probe-receipt)。
- 部署（CheerC 本機）：Rules、前端、`firestore.indexes.json` 一起上（indexes 不變；補記讀取只用單欄位索引）。舊前端看不到補記，所以異常頁會把已補平的差額照舊顯示；Rules 與前端要同一次上線。
- 不做（P11c4b／P12）：補記畫面、列表與標記、日結頁的有效關帳現金顯示；P12 查帳頁（報表要顯示回填與關帳後補記的標記）。
