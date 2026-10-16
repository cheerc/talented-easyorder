# P09b 介面與資料契約：帳戶退款（`CreateRefund`）

Base: `origin/main`（SHA `c444621`，含 P09a #493）。本契約是 P09b 雲端退款、日統計第 8 欄、Rules 與 F1 畫面的實作依據。規則來源：[操作回饋排程計畫](../plans/2026-10-15-operator-feedback-plan.md) §P09b 與 §5 Q1（CheerC 依建議定案）。

## 1. 範圍

- 新啟用 `CreateRefund`：已啟用 kind 由 12 種變為 13 種，其餘 11 種仍拒絕（`ALL_COMMAND_KINDS` 共 24 種）。
- `day.totals` 由 7 欄變 8 欄，新增 `accountRefunds`。
- 退款的更正、作廢、5 秒撤回留 P10；F2 退款列與 CSV 留 P12；補登舊日期留 P13。
- 不部署、不碰正式 Firebase；測試只用 `demo-easyorder` Emulator 與合成資料。

## 2. 規則（§5 Q1）

1. 金額是 1 到目前餘額的整數（上限 1,000,000），不退成欠款；餘額 ≤ 0 時不能退。
2. 理由必填，1–500 字。
3. 只記台北今天、狀態 open 或 reopened、不早於 goLiveDate 的營業日；已關帳回 `DAY_CLOSED`。
4. 停用帳戶也可以退。

## 3. 命令

- `targets`：`{ transactionId, studentId, dayId }`；`studentId` 不得是 `__cashier__`。
- `expectedRevisions`：`{ transaction: 0, student, day }`。
- `payload`：`{ amount, reason }`。
- 收據：`reason == payload.reason`、`studentId == targets.studentId`、`businessDate == dayId`。
- `cashEffect`：`{ before: 0, after: -amount, delta: -amount, reasonKind: 'refund', refundAmount: amount }`。
- `before`／`after` 快照含 `head`、`student`、`day`、`transaction`；`before.transaction` 為 `null`。

## 4. 原子寫入

一次 commit 寫 `commands/{id}`、`system/dataHead`（seq + 1）、`days/{dayId}`（revision + 1）、`students/{studentId}`（revision + 1）與新的 `transactions/{id}`。少寫學生或營業日都被 Rules 拒絕。

- 交易文件：`type: 'refund'`、`amount` 為正整數、`mealPrice 0`、`paidAmount 0`、`mealKind: null`、`note` 等於理由、`studentNameSnapshot` 等於學生姓名、`createdSeq` 等於新 seq。不在 `paidAmount` 放負數，保留既有非負不變量。
- 學生：`currentBalance −= amount`；只改 `currentBalance`、`revision`、`lastCommandId`、`updatedAt`。
- 日統計：`activeTransactionCount + 1`、`accountRefunds += amount`；份數、餐費、`retainedReceipts`、櫃台收支都不變。

## 5. 應有現金（spec §7.1）

`netCash = retainedReceipts + cashierIncome − cashierExpense − accountRefunds`；`expectedCash = openingCash + netCash`。退款只透過 `accountRefunds` 扣一次，`cashEffect.refundAmount` 只是稽核紀錄，不參與計算。退款不和學生收款互相抵銷。

例：開帳 1,000、學生 A 期初 100，退款 60 → A 餘額 40、`accountRefunds` 60、應有現金 940。

## 6. 畫面（F1）

- 選學生後在繳費（W）模式按「退款」打開退款框：顯示目前餘額，金額預設為全部正餘額（上限 1,000,000），理由必填；預覽「現金影響：−$X」與「退款後餘額」。
- 送出前一律跳確認框：「確定從 {姓名} 的帳戶退還 $X 現金嗎？退款後餘額 $Y」。
- 錯誤訊息：「退款金額必須是 1 到 {餘額} 的整數（不能超過目前餘額）」、「退款原因必填，且不能超過 500 字」、「帳戶餘額不是正數，沒有可退的金額」。
- 繳費輸入負數時：「收款金額不能是負數。要退錢給學生請用「退款」。」
- 停用帳戶提示改為「此帳戶已停用，禁止新增餐點；仍可繳費或退款。」
- 成功訊息只在伺服器收據確認後出現：「已確認 {編號} {姓名} 退款 $X 完成（命令序號 N）」。結果不明時沿用同一 commandId 重試。
- 右欄「今日現金」多一行「帳戶退款」；E 付款明細列出「退款：{理由}」並另計「今日退款」，不算進「今日收款」；最近帳戶顯示「僅退款」或「繳費・退款」。

## 7. 讀取與對帳

- 交易清單接受 `refund` 列：`mealPrice 0`、`paidAmount 0`、`amount` 1–1,000,000、理由非空、學生不得是 `__cashier__`。
- `reconcileDayTotals` 由交易重算 `accountRefunds`；`retainedReceipts` 只算 order／payment。與 `day.totals` 不一致時 fail closed。
- 舊版 7 欄日統計讀取時回 `UNSUPPORTED_SCHEMA`，不顯示金額。

## 8. Rules 預算

見 [`p05-rules-budget.md`](../../ops/p05-rules-budget.md) 的 P09b 附錄：存取次數 19/20、單寫最多 10/10；各探測點的餘裕與 mutant 結果。

## 9. 驗證

- Emulator：`cloudRefund.spec.ts`（`EASYORDER_REQUIRE_CLOUD_REFUND=true`，CI 步驟「P09b account refund proof」）；`cloudCashMovement.spec.ts` P09.9 補上交易文件多欄、少欄、改固定欄位的拒絕案例。
- 畫面：`CloudOrdersPage.test.tsx` 的退款、退款結果不明重試、櫃台收支結果不明重試等案例。
- E2E：`cloud-production.spec.ts` D05（W 面板退款、應有現金扣一次、重新整理後由伺服器讀回）。
