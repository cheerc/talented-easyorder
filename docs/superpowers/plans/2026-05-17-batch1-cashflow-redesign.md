---
status: draft
date: 2026-05-17
complexity: complex+
batch: 1 of 3
---

# Batch 1 — 金流邏輯重設計

## Goal

簡化 EasyOrder 的交易模型，從會計系統思維（order/topup/cancel/correction/void）改為櫃台現金流思維（收入/支出）。取消操作改為刪除原始紀錄，所有金額強制整數。

## Context

- Base: `origin/main` HEAD
- 現有 355 tests（需大量修改以適應新 domain model）
- 相關 issues: #5（取消=刪除）、#6（整數金額）、#9（金流重設計）

---

## 設計決策

### D1: Transaction Types 簡化

| Before | After | 說明 |
|--------|-------|------|
| `order` | `order` | 學生訂便當（保留） |
| `topup` | `payment` | 學生繳費（改名+簡化語意） |
| `cancel` | ❌ 移除 | 取消=刪除原始 order |
| `correction` | ❌ 移除 | 不再有修正紀錄 |
| `void` | ❌ 移除 | 不再有作廢紀錄 |
| — | `expense` | 新增：櫃台支出（付店家、遺失等） |

### D2: 取消訂單 = 刪除

- 刪除原始 order 紀錄（非新增 cancel 紀錄）
- 學生 `currentBalance` 自動調整：`+= mealPrice - paidAmount`（還原）
- 如果被刪除的 order 有 `paidAmount > 0`：UI 顯示退款提醒（不自動建立退款紀錄）
- `afterBalance` 不再重算整條鏈（只調 student.currentBalance）

### D3: Expense 交易

- `studentId` 設為 `'__cashier__'`（保持欄位非 nullable，簡化 type guard）
- 只影響櫃台現金（計入 netCash 的支出端）
- 必須有 `note`（自動 or 手動填入）

### D4: F1 POS 模式

| 快捷鍵 | Before | After |
|--------|--------|-------|
| Q | 訂便當 | 訂便當（不變） |
| W | 補錢・儲值 | 繳費 |
| E | 取消當日訂餐 | 支出 |

取消操作移到 StudentCard 上的 contextual button（學生有今日訂單時顯示）。

### D5: 支出模式 UX

1. 不需選學生（進入 expense 模式時跳過 search）
2. 直接顯示數字鍵盤（金額輸入框）
3. 輸入金額 → Enter → 彈出選擇框：
   - `[付便當錢]`（左，預設）← → `[其他原因]`（右）
   - 鍵盤左右切換，Enter 確認
4. 選「付便當錢」→ 備註自動填 `付便當錢`，直接送出
5. 選「其他原因」→ 出現文字輸入框（必填），Enter 送出

### D6: 快捷鍵衝突規則

- 文字輸入框 focused（`type="text"` / `contenteditable`）→ 攔截 Q/W/E/R，不觸發模式切換
- 數字輸入框 focused（`type="number"` / `inputmode="numeric"`）→ Q/W/E/R 正常觸發
- 無 input focused → 正常觸發

### D7: F2 報表公式

```
netCash = Σ(order.paidAmount) + Σ(payment.paidAmount) - Σ(expense.mealPrice)
expectedCash = openingCash + netCash
difference = countedCash - expectedCash
```

LedgerTotals 簡化為：
```typescript
interface LedgerTotals {
  orderCount: number;
  totalIncome: number;     // order.paidAmount + payment.paidAmount
  totalExpense: number;    // expense.mealPrice
  netCash: number;         // totalIncome - totalExpense
  newDebt: number;         // Σ(order.mealPrice - order.paidAmount) where > 0
  transactionCount: number;
}
```

移除：`refundAmount`、`topUpAmount`、`cancellationCount`、`orderSalesAmount`、`cashCollected`

### D8: 整數金額

- `parsePaidAmount()` 已經拒絕小數（現有）
- 額外：所有 `number` 型別的金額欄位加 `Math.round()` 防護
- UI 顯示永不帶小數點

---

## Tasks

### Task 1: Domain Model 重構

**Scope:**
- `frontend/src/domain/ledger.ts`
  - `TransactionType` → `'order' | 'payment' | 'expense'`
  - 移除 `countActiveOrdersForStudent()`（改用 filter 直接查）
  - 移除 `canCancelToday()`
  - `createLedgerTransaction()` 支援 expense（studentId = `'__cashier__'`）
  - `calculateTransactionAmount()` 保留（expense 時 amount = -mealPrice）
- `frontend/src/domain/posFlow.ts`
  - `PosMode` → `'order' | 'payment' | 'expense'`
  - `PosFlowState` 新增 `kind: 'expense_input'`（無需學生的狀態）
  - `PosFlowEvent` 新增 `{ type: 'enterExpenseMode' }` / `{ type: 'expenseConfirm'; amount: number; note: string }`
  - 移除 cancel 相關的 mode/event
- `frontend/src/domain/posTransaction.ts`
  - `buildPosTransactionDraft()` 移除 cancel 邏輯
  - 新增 `buildExpenseTransactionDraft()`（不需 student/menu）
- `frontend/src/domain/ledgerReport.ts`
  - `LedgerTotals` 簡化（見 D7）
  - `calculateLedgerTotals()` 重寫
  - `getEffectiveLedgerRows()` 簡化（不再過濾 voided）
  - `groupLedgerRowsByStudent()` 跳過 `studentId === '__cashier__'`
- `frontend/src/domain/cashClose.ts`
  - `createCashCloseDraft()` 使用新版 LedgerTotals
  - `createDailySettlement()` 同上
- `frontend/src/domain/ledgerAudit.ts`
  - 移除 `createCorrectionTransaction()` / `createVoidTransaction()`
  - 保留 audit event 結構（用於 delete 紀錄）
  - 新增 event type: `'transaction_deleted'`

**Success criteria:**
- 所有 domain function 編譯通過
- 新 types 無 any/unknown escape

### Task 2: Store 重構

**Scope:**
- `frontend/src/store/posStore.ts`
  - 移除：`correctTransaction()`, `voidTransaction()`, `hardDeleteLocalDraft()`
  - 修改 `deleteTransaction()` → 同步調整 student.currentBalance
  - 修改 `commitPosTransactionDraft()` → 支援 expense type
  - 新增 `deleteOrderWithRefundCheck(id: string)` → 刪除 order + return `{ refundAmount: number }` 供 UI 顯示提醒
  - 移除 `processTransaction()` 的 cancel/correction/void 相關路徑
  - 整數防護：所有 set balance 時 `Math.round()`
- `frontend/src/hooks/usePosFlow.ts`（如存在）
  - 適配新的 PosMode / PosFlowState

**Success criteria:**
- Store actions 正確更新 balance（刪除時還原）
- Expense 紀錄正確建立（studentId = `'__cashier__'`，netCash 減少）

### Task 3: F1 POS UI 重構

**Scope:**
- `frontend/src/components/pos-components.tsx`
  - `ActionBar` 模式：訂便當(Q) / 繳費(W) / 支出(E)
  - `CustomerCard` 新增「取消訂餐」contextual button（學生有今日 order 時顯示）
    - 點擊 → confirm dialog → delete order → 顯示退款提醒 toast（如 paidAmount > 0）
  - 新增 `ExpensePanel` 區塊（expense 模式時替代 CustomerCard）
    - 數字金額輸入 → Enter → 選擇框（付便當錢 / 其他原因）
    - 選「其他原因」→ 文字備註輸入框
  - 快捷鍵 handler：判斷 `activeElement` type → 文字框時 suppress Q/W/E/R
  - `IdleHero` 更新文案（E = 支出）

**Success criteria:**
- Q/W/E 切換模式正確
- 支出模式不需搜尋學生
- 文字輸入框中 Q/W/E 不觸發模式切換
- 取消按鈕正確刪除 order 並顯示退款提醒（如有）

### Task 4: F2 Report UI 簡化

**Scope:**
- `frontend/src/components/report/ReportSummaryStats.tsx`
  - 顯示：訂單數、總收入、總支出、淨現金流
  - 移除：退款、儲值、取消數
- `frontend/src/components/report/LedgerGroupedTable.tsx`
  - 移除 Correct/Void 按鈕
  - 保留 Delete 按鈕（替代 void 功能，同 Task 2 的 deleteOrderWithRefundCheck）
  - Expense 紀錄不分組到學生下（獨立一個「櫃台支出」group 或頂部 section）
- `frontend/src/components/report/CashClosePanel.tsx`
  - 使用新版 LedgerTotals（totalIncome / totalExpense / netCash）
  - 移除 refund 相關顯示
- `frontend/src/components/report/CorrectionDialog.tsx` → 刪除整個檔案
- `frontend/src/components/report/VoidDialog.tsx` → 刪除整個檔案

**Success criteria:**
- F2 只顯示收入/支出兩類
- 結算公式：期望現金 = 開帳 + 收入 - 支出
- 無 correction/void UI 殘留

### Task 5: Tests 重寫

**Scope:**
- 所有 `__tests__/` 目錄下引用舊 type（topup/cancel/correction/void）的測試
- 新增 expense 相關 unit tests
- 新增 delete-order-with-refund-check 測試
- 新增 keyboard shortcut suppression 測試

**Success criteria:**
- `vitest run` 全部通過
- 新功能有 test coverage（expense、delete、keyboard）

---

## 影響範圍評估

### 不動的：
- Firebase sync 相關邏輯（syncStatus 欄位保留）
- Vendor CRUD（F4）
- History/Settlement 歷史查看（F5）
- 日期選擇、month navigation（Batch 2 處理）
- Seed data（Batch 3 處理）

### 風險：
- `afterBalance` 鏈斷裂：刪除中間紀錄後其他紀錄的 afterBalance 不正確 → 接受此 trade-off，`currentBalance` 才是 source of truth，`afterBalance` 只作歷史參考
- 現有 localStorage persist 的舊資料格式 → `posStateValidator.ts` 需要 migration 處理舊 type

---

## Discussion Questions（供 team 討論）

1. **Expense 的 studentId = `'__cashier__'`** 是否足夠乾淨？替代方案：讓 `studentId` 變 optional，但這會增加大量 null check。
2. **afterBalance 一致性**：刪除 order 後，是否需要 recalculate 同學生後續所有 transaction 的 afterBalance？還是接受「currentBalance 才是 truth」？
3. **支出快速選項**：目前設計只有「付便當錢/其他原因」兩個選項。是否需要支援自定義常用選項（如「文具費」「影印費」）？目前先做固定兩選項。
4. **Delete audit trail**：刪除 order 時是否需要 audit event（記錄誰刪了什麼）？建議保留，只是改 type 為 `'transaction_deleted'`。
5. **Expense 在 F2 的分組**：expense 不屬於任何學生，在報表中如何呈現？建議：獨立一個「櫃台支出」section 在表格頂部。
