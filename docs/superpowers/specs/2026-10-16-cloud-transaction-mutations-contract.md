# P10a 介面與資料契約：交易更正、作廢、取消與 5 秒撤回

Base: `origin/main`（SHA `e01ebdf`，含 P09b #494 與收據 #495）。本契約是 P10a 雲端交易修改、Rules 與 F1 畫面的實作依據。規則來源：[正式後端 spec](2026-10-13-free-production-backend-spec.md) §6.1、§7.1、§7.2、§11 L02–L04／L07／L09／L11；[後端計畫](../plans/2026-10-13-free-production-backend-plan.md) §P10；[操作回饋排程計畫](../plans/2026-10-15-operator-feedback-plan.md) 的 P10 列（退款可以更正、作廢、5 秒撤回）。

## 1. 範圍

- 新啟用 5 種 kind：`CorrectTransaction`、`VoidTransaction`、`CancelKeepDeposit`、`CancelRefund`、`Undo`。已啟用 kind 由 13 種變為 18 種；仍拒絕的 6 種是 `CorrectOpening`（P10b）、`CloseDay`、`ReopenDay`、`RecordExport`、`RecordPrint`、`RecordBackup`。
- 可修改的列：學生的訂餐、繳費、退款，以及櫃台收支（`studentId` 為 `__cashier__`）。
- 不刪除任何交易：Rules 的 `transactions` 一律 `allow delete: if false`，作廢只把 `status` 改成 `voided`。
- 畫面只做 F1（雲端櫃台點餐）：5 秒撤回、E 付款明細與今日現金列上的「更正／作廢／取消」。雲端 F2 帳務頁與稽核頁還沒有，repository 的 `mutateTransaction` 已可供日後呼叫。
- 期初更正（`CorrectOpening`，F3 表單）是 P10b，另開 PR。
- 不部署、不碰正式 Firebase；測試只用 `demo-easyorder` Emulator 與合成資料。

## 2. 規則

1. 每種修改都要理由，1–500 字，存在命令的 `reason`（等於 `payload.reason`）。撤回的理由固定為「送出後立即撤回」。
2. 只能修改 `active` 的列；已作廢的列不能再改（回 `INVALID_INPUT`）。
3. 營業日必須是 open 或 reopened，且不早於 goLiveDate；已關帳回 `DAY_CLOSED`。
4. `CancelRefund` 與 `Undo` 會在櫃台退還或收回現金，只限台北今天的列。更正、作廢、取消留款也可用在重開（reopened）的較早日期。
5. 更正不改列的種類：
   - 訂餐可改餐費、實收、備註（`amount = paidAmount − mealPrice`）。
   - 繳費的實收必須 ≥ 1；要改成 0 請作廢。
   - 櫃台收支不能改變收入／支出方向，金額 ≥ 1，原因不能空白。
   - 退款金額 ≥ 1、原因不能空白；調高時帳戶餘額不能變成負數。
   - 內容沒有變更時拒絕。
6. 取消只適用訂餐。
   - `CancelKeepDeposit`：有收款時，這筆變成同額繳費，餐點與菜單快照清空，現金不變，錢留在帳戶。沒收款時直接作廢，不留下 0 元繳費。
   - `CancelRefund`：作廢這筆訂餐，把當時實收的現金退還給學生。
7. `Undo` 只用在剛新增、還沒被改過的列，必須同時符合：
   - 原建立者本人（`operatorUid == auth.uid`）；
   - `revision == 1`；
   - `lastCommandId == payload.targetCommandId`。
   畫面的 5 秒是成功確認後的操作時窗，不是安全界線，Rules 仍以上面三條和台北今天把關。
8. 停用帳戶既有的訂餐仍可更正或取消（spec §6.1），但不能新增餐點。

## 3. 命令

- `targets`：`{ transactionId, studentId, dayId }`。`studentId` 是學生 UUID 或 `__cashier__`，必須等於交易本身的學生。
- `expectedRevisions`：
  - 學生列：`{ transaction, student, day }`，三個都 ≥ 1；
  - 櫃台收支列：`{ transaction, day }`，沒有學生版本。
- `payload`：
  - `CorrectTransaction`：`{ mealPrice, paidAmount, amount, note, reason }`（完整新值）；
  - `Undo`：`{ targetCommandId, reason }`；
  - 其他三種：`{ reason }`。
- 收據檢查：`reason == payload.reason`、`studentId == targets.studentId`、`businessDate == dayId`。`before`／`after` 快照含 `head`、`day`、`transaction`，學生列另含 `student`；原值永遠可從 `before.transaction` 追溯。
- `cashEffect` 由 Rules 與 `cloudTransactionMutation.ts` 用同一算式計算：
  - `before`：這筆修改前的現金貢獻；`after`：修改後的現金貢獻；`delta = after − before`。
  - 現金貢獻：訂餐／繳費是 `paidAmount`；櫃台收支是 `paidAmount − mealPrice`；退款是 `−amount`；作廢的列是 0。
  - `reasonKind`：
    - 更正：金額有變是 `correction`，否則 `none`；
    - 作廢：原本有現金是 `correction`，否則 `none`；
    - 取消留款：`none`；
    - 取消退款，或撤回訂餐／繳費：有收款是 `refund`，否則 `none`；
    - 撤回櫃台收支或退款：`reversal`。
  - `refundAmount`：`reasonKind` 是 `refund` 時等於原實收，否則 0。只是稽核紀錄，不參與應有現金計算。

## 4. 原子寫入

一次 commit 寫 5 份文件（櫃台收支列沒有學生，寫 4 份）：

- `commands/{id}`；
- `system/dataHead`：seq + 1；
- `days/{dayId}`：revision + 1；
- `students/{studentId}`：revision + 1；
- 既有的 `transactions/{id}`：revision + 1、`lastCommandId`、`updatedAt`。

少寫任何一份都被 Rules 拒絕；沒有命令就直接改交易也被拒絕，連使用權持有人也一樣。

- 交易：只能改第 2 節允許的欄位。建立時間、帳戶、日期、建立者、`createdSeq` 都不變。
- 學生：`currentBalance = 原餘額 − 舊貢獻 + 新貢獻`，學生貢獻是 `amount`，退款是 `−amount`，作廢是 0。只改 `currentBalance`、`revision`、`lastCommandId`、`updatedAt`。
- 日統計：8 欄都改成 `原值 − 舊列貢獻 + 新列貢獻`（`cloudLedgerProjection.contribution`）。作廢的列不計份數、餐費與收款；取消留款後只計 `retainedReceipts`。

## 5. 應有現金（spec §7.1）

公式不變：`expectedCash = openingCash + retainedReceipts + cashierIncome − cashierExpense − accountRefunds`。

例：開帳 1,000、學生 A 期初 100。
1. A 訂餐 90、實收 100：應有現金 1,100，A 餘額 110。
2. 餐費更正為 110：現金不變，A 餘額 90。
3. 取消並退款：訂餐作廢、`retainedReceipts` 減 100，應有現金回到 1,000，A 餘額回到 100。

## 6. 畫面（F1）

- **撤回**：新增（訂餐、繳費、櫃台收支、退款）由伺服器確認後，出現「送錯了？5 秒內可撤回 {誰} 的{項目}：現金 ±$X，餘額回到 $Y」與「撤回」按鈕，5 秒後自動消失。成功訊息：「已撤回 {誰} 的{項目}，帳戶餘額與現金已回復（命令序號 N）」。
- **E 付款明細**：
  - 列出這位學生今天所有的列，包含作廢的列（標示「已作廢」、刪除線、不計入合計）。
  - 每個有效列有「更正」按鈕；訂餐另有「取消」，其他列另有「作廢」。
- **今日現金**：櫃台收支列有「更正」「作廢」；作廢的列標示「已作廢」。
- **修改表單**：
  - 選擇動作：更正、作廢（記錯了）、取消訂餐（錢留在帳戶）、取消訂餐並退還 $X。
  - 依列的種類顯示可改欄位；理由必填。
  - 預覽「現金影響」（含帳本更正／退還現金給學生／沖回）與「帳戶餘額：$A → $B」。
  - 預覽用與 Rules 相同的算式；會被拒絕的內容（例如退款更正後餘額變負）在送出前就顯示原因，並停用確認鈕。
- **送出**：
  - 沿用 P08 的凍結命令。結果不明時用同一 commandId 重試；`localStorage` 只記 commandId、datasetId、UID。
  - 版本衝突時顯示「這筆交易、學生或營業日已在別處變更，{動作}沒有生效。已重新讀取最新資料，請確認後再操作。」，並保留表單。

## 7. 讀取與對帳

- 交易清單本來就讀回 `voided` 列。`reconcileDayTotals` 以作廢列貢獻 0 重算，與 `day.totals` 不一致時 fail closed。
- 收據驗證接受 `status: 'voided'` 的交易快照與 5 種新 kind。

## 8. Rules 預算

見 [`p05-rules-budget.md`](../../ops/p05-rules-budget.md) 的 P10a 附錄：存取次數 19/20、單寫最多 10/10；各探測點的餘裕與 mutant 結果。

## 9. 驗證

- **Emulator**：`cloudTransactionMutation.spec.ts`（`EASYORDER_REQUIRE_CLOUD_MUTATIONS=true`，CI 步驟「P10a transaction mutation proof」）45 個案例，涵蓋：
  - L02／L03／L04／L07／L08／L09／L11、A03 同時修改、關帳與重開日、停用帳戶、最大 payload；
  - 原始 SDK 的 22 種竄改、少寫投影、直接改刪交易、撤回與取消的誤用、櫃台收支夾帶學生。
- **單元**：`cloudTransactionMutation.test.ts`（算式與命令格式）。
- **畫面**：`CloudOrdersPage.test.tsx` 的 P10a 區塊（撤回、5 秒消失、更正預覽、取消退款、作廢列顯示、櫃台收支更正、退款更正負餘額、版本衝突）。
- **E2E**：`cloud-production.spec.ts` D06。繳費後 5 秒內撤回，訂餐更正後取消並退款；重新整理後由伺服器讀回，兩筆都保留為已作廢，命令留著前後值與理由。
