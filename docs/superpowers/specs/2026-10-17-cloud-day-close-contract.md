# P11 介面與資料契約：正式關帳與重開版次（`CloseDay`／`ReopenDay`）

Base: `origin/main`（SHA `32e90c6`，含 P10b #501／收據 #502 與 P14 #496／#498）。本契約是 P11 雲端關帳、重開、日結版本、Rules 與備份 replay 的實作依據。規則來源：[正式後端 spec](2026-10-13-free-production-backend-spec.md) §5 文件表 `days/{date}/settlements/{revision}`、§6.1 命令表 `CloseDay／ReopenDay` 列、§7.1 expectedCash、§7.4 日期生命週期；[後端計畫](../plans/2026-10-13-free-production-backend-plan.md) §P11。

## 1. 範圍與拆分

- 新啟用 2 種 kind：`CloseDay`、`ReopenDay`。已啟用由 20 種變為 22 種；仍拒絕的 2 種是 `RecordExport`、`RecordPrint`（P12）。
- **P11a（本 PR）**：Rules、寫入器、receipt 驗證、日結讀取 repository、P14 備份 decoder／replay、Emulator 與備份測試。沒有畫面。
- **P11b（下一個 PR）**：雲端「日結」頁（全日點現金、關帳、回查版本、重開），關帳區下方掛上 P14 備份區塊，以及 E2E。
- 不部署、不碰正式 Firebase；測試只用 `demo-easyorder` Emulator 與合成資料。

## 2. 規則

1. 狀態只走 `open → closed → reopened → closed → …`。唯一能改營業日狀態的是這兩個命令；沒有直接設定狀態的入口。
2. **CloseDay**：營業日須為 open 或 reopened、開帳現金已確認（`openingCash` 不是 null）、日期不晚於台北今天。
   - `expectedCash = openingCash + retainedReceipts + cashierIncome − cashierExpense − accountRefunds`（spec §7.1，Rules、寫入器、receipt 與備份共用同一算式）。
   - `countedCash` 為 0 至 1,000,000,000 的整數；`payload.expectedCash` 必須等於 Rules 由 day totals 算出的值（不接受 client 自填總額，只當作「操作員看到的數字」的確認）。
   - `countedCash ≠ expectedCash` 時 `note` 必填（1–500 字）；相同時可空白。命令的 `reason` 固定為 null。
3. **ReopenDay**：營業日須為 closed；`reason` 必填 1–500 字，命令 `reason` 等於 `payload.reason`。
4. 已關帳的營業日，交易（建立、更正、作廢、取消、撤回、退款、櫃台收支）、菜單、開帳現金與期初更正一律被拒；這些規則原本就要求營業日為 open／reopened，P11 以 Emulator 對每一種寫入實測。
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

期初日沒有營業日時，F3 會用 `EnsureDay` 建一個過去日期的 open 營業日。這種日子沒有開帳現金，而 `SetOpeningCash` 只能設台北今天，所以它無法關帳。P11 的預設處理：Rules 不放寬；P11b 的日結頁把「沒有開帳現金、也沒有任何交易（`activeTransactionCount == 0`）」的過去日子標成「無營業，不需關帳」，不列入未關帳提醒。若 CheerC 改選「允許補開帳」，另開變更。

## 8. 驗收

- Emulator：`cloudDayClose.spec.ts`（`EASYORDER_REQUIRE_CLOUD_DAY_CLOSE=true`，CI 步驟「P11 day close proof」）。正向：L05（應有 1,170、實點 1,160 無理由不能關、有理由可關）、相同可不填說明、重試冪等、L06 競賽只成一邊、重開→更正→再關帳版號 1／2／3 且舊版不變、合法最大 payload、原始 SDK closure 持有人成功而非持有人拒絕。拒絕：缺開帳現金、重複關帳、重開需已關帳且有原因、未來日期、已關帳日每一種業務寫入、直接改營業日狀態、竄改日結版本任一欄位或路徑、略過營業日或版本寫入、改／刪／偽造版本。
- 備份：`cloudBackup.spec.ts` 以真實 close／reopen／re-close 命令分兩段增量匯出 → 解密 → replay；竄改差額、前一版快照或缺少前包版本都被拒。
- 預算與 probe 見 [P11 預算附錄](../../ops/p05-rules-budget.md#p11-day-close--budget-and-probe-receipt)。
