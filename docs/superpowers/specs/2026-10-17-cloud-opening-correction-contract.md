# P10b 介面與資料契約：期初更正（`CorrectOpening`，F3）

Base: `origin/main`（SHA `a694b32`，含 P10a #497、收據 #499 與 CLAUDE.md 指引 #500）。本契約是 P10b 雲端期初更正、Rules 與 F3 學生頁表單的實作依據。規則來源：[正式後端 spec](2026-10-13-free-production-backend-spec.md) §2 F3、§5 命令表 `CorrectOpening` 列、§7 餘額規則（期初更正段）；[後端計畫](../plans/2026-10-13-free-production-backend-plan.md) §P10。

## 1. 範圍

- 新啟用 1 種 kind：`CorrectOpening`。已啟用 kind 由 19 種變為 20 種；仍拒絕的 4 種是 `CloseDay`、`ReopenDay`、`RecordExport`、`RecordPrint`。
- 畫面只做 F3（雲端學生頁）：每列「更正期初」，可改期初金額與期初備註，原因必填，送出前預覽期初與目前結餘的變化。
- 期初日不能改。要改期初日只能另建學生，這不在本 phase。
- 不部署、不碰正式 Firebase；測試只用 `demo-easyorder` Emulator 與合成資料。

## 2. 規則

1. 鎖定原本的 `openingBalance.asOfDate`：`asOfDate` 與 `openingBalance.createdAt` 永遠不變，只有 `amount` 與 `note` 可以改。
2. 金額為整數，−1,000,000,000 至 1,000,000,000；備註最多 500 字；原因 1–500 字，存在命令的 `reason`（等於 `payload.reason`）。
3. 金額與備註都沒變時拒絕（`INVALID_INPUT`），不寫入。只改備註是允許的。
4. 學生目前結餘加上期初差額：`currentBalance = 原 currentBalance − 原期初 + 新期初`。不重算交易，也沒有「直接指定目前餘額」的入口。
5. 期初日的營業日必須存在且為 open 或 reopened：
   - 不存在：回 `INVALID_INPUT`。畫面請操作員先按「先建立營業日」，送出一般 `EnsureDay`（不影響現金），再回來更正。
   - 已關帳：回 `DAY_CLOSED`。畫面提示先重開該日。`ReopenDay` 屬 P11，目前雲端也還不能關帳，所以這條在現階段只由 Rules 與測試把關。
6. 營業日只增加 `revision`、`lastCommandId`、`updatedAt` 作為異動紀錄；`totals`、菜單、開帳現金與狀態不變。現金影響固定為 0。
7. 停用的學生也可以更正期初，狀態維持停用。

## 3. 命令

- `targets`：`{ studentId, dayId }`，`dayId` 必須等於學生的 `openingBalance.asOfDate`。
- `expectedRevisions`：`{ student, day }`，兩個都 ≥ 1。
- `payload`：`{ amount, note, reason }`（完整新值）。
- 收據共用欄位：`businessDate == dayId`（原期初日）、`studentId == targets.studentId`、`reason == payload.reason`。
- `before`／`after` 快照含 `head`、`student`、`day`；原期初物件可從 `before.student.openingBalance` 追溯。
- `cashEffect` 固定 `{ before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 }`。

## 4. 原子寫入

一次 commit 寫 4 份文件：`system/dataHead`、`students/{studentId}`、`days/{dayId}`、`commands/{commandId}`。任何一份缺漏或不合規則，整批拒絕、無部分寫入。

Rules 分工：

- 指令建立（`validCorrectOpening`，`validCommandCreate` 最後一個分支）：持有人與 lease、命令信封、targets／expectedRevisions／payload 的固定欄位與範圍、原因、`businessDate`、`studentId`、`asOfDate == dayId`、營業日 open／reopened、零現金，並把 `before`／`after` 快照綁到實際文件；學生與營業日都要前進一個 revision 並帶本命令 ID。
- 學生投影（`studentWriteCommand` 的 `CorrectOpening` 分支 → `validStudentOpeningCorrection`）：只能改 `openingBalance`、`currentBalance`、`revision`、`lastCommandId`、`updatedAt`；新期初物件必須等於 `{ amount: payload.amount, asOfDate: 原值, note: payload.note, createdAt: 原值 }` 且與原物件不同；餘額依第 2 節第 4 條。
- 營業日投影（`dayWriteCommand` 的 `CorrectOpening` 分支）：目標日相符、快照相符、狀態 open／reopened、只改 `revision`、`lastCommandId`、`updatedAt`。
- 學生 update 的欄位白名單加入 `openingBalance`；其他每個命令分支本來就各自限定可改欄位（`EditStudent`、`SetStudentStatus`、`ChangeStudentCode`、交易與退款），所以只有 `CorrectOpening` 能改期初。

## 5. Client

- `cloudCommandSchema.ts`：`normalizeEnabledCommandInput` 與 receipt 驗證支援 `CorrectOpening`（收據檢查期初物件、餘額差額、營業日只增 revision、零現金）。
- `cloudCommandRepository.ts`：寫入前檢查兩個 revision、期初日、營業日存在與狀態、內容有變；版本衝突回 `REVISION_CONFLICT`。
- `cloudStudentRepository.ts`：`readOpeningDay(dayId)`（伺服器讀取，回 `{ revision, status }` 或 `null`）、`ensureOpeningDay`、`correctOpening`。
- `CloudStudentsPage.tsx`：每列「更正期初」；期初日營業日缺少時顯示「先建立營業日」，已關帳時只顯示提示、不出表單；回應不明時沿用既有的同編號查詢與重試。
- P14 備份：`cloudBackup.ts` 的 decoder／replay 接受 `CorrectOpening`，replay 檢查餘額差額等於期初差額。

## 6. 驗收

- Emulator：`cloudOpeningCorrection.spec.ts`（`EASYORDER_REQUIRE_CLOUD_OPENING=true`，CI 步驟「P10b opening correction proof」）。正向：更正 100 → 80 讓結餘 250 → 230、只改備註、缺營業日先建立、已關帳拒絕而重開後可更正、停用學生、版本衝突與重試冪等、合法最大 payload、原始 SDK closure 持有人成功而非持有人拒絕。拒絕：期初日或建立時間被改、餘額不調或多調、改其他學生欄位、營業日統計／開帳現金／狀態被改、現金不為零、原因缺漏或不一致、多餘欄位、`businessDate` 或目標日不是期初日、版本過期、快照造假、略過學生或營業日寫入、用 `EditStudent` 或直接 update 改期初。
- 備份：`cloudBackup.spec.ts` 以真實 `CorrectOpening` 命令驗證匯出 → 解密 → replay；竄改餘額的收據被拒。
- 畫面：`CloudStudentsPage.test.tsx` 的期初更正兩項；Cloud E2E D07。
- 預算與 probe 見 [P10b 預算附錄](../../ops/p05-rules-budget.md#p10b-opening-correction--budget-and-probe-receipt)。
