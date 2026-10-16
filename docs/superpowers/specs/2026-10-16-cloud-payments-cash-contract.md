# P09a 介面與資料契約：雲端繳費（W）與櫃台收支（A）

Base: `origin/main`（SHA `fc7943970a5ceb86d841eeca8be6a75d3ba75dec`，含 P08 #491 與收據 #492）。本契約是 P09a 雲端繳費、櫃台收支、Rules 與 F1 畫面的實作依據。退款（`CreateRefund`）屬 P09b，不在本契約內。

## 1. 範圍

- 開放 `CreatePayment` 的 F1 入口（W），以及新啟用的 `CreateCashMovement`（A）。已啟用 kind 由 11 種變為 12 種，其餘 11 種仍拒絕。
- 5 秒撤回、更正與作廢仍留 P10；關帳 UI 仍留 P11；退款留 P09b。
- 不部署、不碰正式 Firebase；測試只用 `demo-easyorder` Emulator 與合成資料。

## 2. 繳費（W，`CreatePayment`）

- 沿用 P05 已啟用的 `CreatePayment` 寫路徑與 Rules，不改 Rules。
- 金額為 1–1,000,000 的整數；0、負數、小數與非數字在送出前拒絕（Rules 也拒絕 0 與負數）。
- 停用帳戶不能新增餐點，但仍可繳費：畫面自動切到繳費模式並提示「此帳戶已停用，禁止新增餐點；仍可繳費。」
- 成功訊息只在伺服器收據確認後出現：「已確認 {編號} {姓名} 繳費 $X 完成（命令序號 N）」。
- E 付款明細顯示「繳費」列，最近帳戶顯示「僅繳費」。

## 3. 櫃台收支（A，`CreateCashMovement`）

### 3.1 命令

- `targets`：`{ transactionId, dayId }`，不含學生；`expectedRevisions`：`{ transaction: 0, day }`。
- `payload`：`{ mealPrice, paidAmount, reason }`，**恰一邊 > 0**：收入 `mealPrice 0, paidAmount X`；支出 `mealPrice X, paidAmount 0`。金額上限 1,000,000；`reason` 1–500 字必填。
- 收據：`reason == payload.reason`、`studentId == '__cashier__'`、`businessDate == dayId`。
- `cashEffect`：收入 `{before 0, after X, delta X, reasonKind 'collection', refundAmount 0}`；支出 `{before 0, after -X, delta -X, reasonKind 'payout', refundAmount 0}`。
- `before`／`after` 只有 `head`、`day`、`transaction` 三個快照；`before.transaction` 為 `null`。

### 3.2 原子寫入

一次 commit 寫 `commands/{id}`、`system/dataHead`（seq + 1）、`days/{dayId}`（revision + 1）與新的 `transactions/{id}`。**不寫任何學生文件**；多寫學生或少寫營業日都被 Rules 拒絕。

交易文件：`type: 'expense'`、`studentId: '__cashier__'`、`studentNameSnapshot: '櫃台'`、`mealKind: null`、`note` 等於理由、`amount = paidAmount − mealPrice`、`createdSeq` 等於新 seq。

日統計：`activeTransactionCount + 1`、`cashierIncome += paidAmount`、`cashierExpense += mealPrice`；其餘欄位不變。營業日必須是今天（台北時間）、不早於 goLiveDate、狀態為 open 或 reopened；已關帳回 `DAY_CLOSED`。

### 3.3 畫面

- 未選學生時按 A 或「櫃台收支（A）」打開面板：支出／收入切換、金額、理由，支出有「付餐費給廠商」快捷鍵；預覽「現金影響：−$80」。
- 錯誤訊息：「櫃台收支金額必須是 1 到 1,000,000 的整數」、「櫃台收支原因必填，且不能超過 500 字」。
- 成功訊息：「已確認櫃台支出 $80入帳（命令序號 N）」。結果不明時沿用 P08 的同編號重試，不換 commandId。

## 4. 應有現金（spec §7.1）

`totalIncome = retainedReceipts + cashierIncome`；`totalExpense = cashierExpense`；`netCash = totalIncome − totalExpense`；`expectedCash = openingCash + netCash`。餐費不是現金支出。開帳現金未確認時顯示「開帳現金未確認，無法計算」。

右欄「今日現金」卡片列出開帳現金、學生收款、櫃台收入、櫃台支出、應有現金與當日櫃台收支明細。L05 範例：開帳 1,000、學生收款 200、收入 50、支出 80，應有現金 1,170。

## 5. 讀取與對帳

- 交易清單接受 `expense` 列：學生必須是 `__cashier__`、名稱必須是「櫃台」、理由非空、恰一邊 > 0；非 expense 列不得使用 `__cashier__`。
- `reconcileDayTotals` 由交易重算 `cashierIncome`／`cashierExpense`，`retainedReceipts` 不含 expense 列；與 `day.totals` 不一致時 fail closed（取代 P08 假設櫃台收支為 0 的做法）。
- 孤兒交易檢查略過 expense 列（它們沒有學生）。

## 6. Rules 預算

見 [`p05-rules-budget.md`](../../ops/p05-rules-budget.md) 的 P09a 附錄：存取次數 15/20、單寫最多 8/10；新分支都放在各 `||` 鏈最後，只有指令規則少 1 個探測單位。
