---
status: draft-r1
date: 2026-05-17
complexity: complex+
batch: 1 of 3
review_round: 1
---

# Batch 1 — 金流邏輯重設計

## Goal

簡化 EasyOrder 的交易模型，從會計系統思維（order/topup/cancel/correction/void）改為櫃台現金流思維（收入/支出）。取消操作改為刪除原始紀錄，保留簡單的金額編輯功能，所有金額強制整數。

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
| `correction` | ❌ 移除 | 改為直接編輯原紀錄（見 D9） |
| `void` | ❌ 移除 | 改為刪除 |
| — | `expense` | 新增：櫃台支出（付店家、遺失等） |

### D2: 取消訂單 = 刪除

- 刪除原始 order 紀錄（非新增 cancel 紀錄）
- 學生 `currentBalance` 自動調整：`+= mealPrice - paidAmount`（還原）
- 如果被刪除的 order 有 `paidAmount > 0`：UI 顯示退款提醒（不自動建立退款紀錄）
- `afterBalance` 不再重算整條鏈（只調 student.currentBalance）
- **已關帳日期**：reopen 後允許刪除，但顯示警告：「此筆已計入前次結算，刪除後請重新關帳」
- 刪除時建立 audit event（`type: 'transaction_deleted'`），記錄被刪除紀錄的 snapshot

### D3: Expense 交易

- `studentId` 設為 `'__cashier__'`（保持欄位非 nullable，簡化 type guard）
- 只影響櫃台現金（計入 netCash 的支出端）
- 必須有 `note`（自動 or 手動填入）
- **欄位語意**：`mealPrice = 支出金額`, `paidAmount = 0`, `amount = -支出金額`（複用現有公式 `paidAmount - mealPrice`）

### D4: F1 POS 模式

| 快捷鍵 | Before | After |
|--------|--------|-------|
| Q | 訂便當 | 訂便當（不變） |
| W | 補錢・儲值 | 繳費 |
| E | 取消當日訂餐 | 支出 |

取消操作移到 StudentCard 上的 contextual button（學生有今日訂單時顯示）。

### D5: 支出模式 UX

1. 不需選學生（進入 expense 模式時跳過 search）
2. **Inline 替代 CustomerCard 區域**（非 modal），顯示數字金額輸入框
3. 輸入金額 → Enter → 彈出選擇框（inline）：
   - `[付便當錢]`（左，預設）← → `[其他原因]`（右）
   - 鍵盤左右切換，Enter 確認
4. 選「付便當錢」→ 備註自動填 `付便當錢`，直接送出
5. 選「其他原因」→ 出現文字輸入框（必填），Enter 送出
6. 選項清單抽為 constant：`const EXPENSE_QUICK_OPTIONS = ['付便當錢', '其他原因'] as const;`

### D6: 快捷鍵衝突規則

- 文字輸入框 focused（`type="text"` / `contenteditable`）→ 攔截 Q/W/E/R，不觸發模式切換
- 數字輸入框 focused（`type="number"` / `inputmode="numeric"`）→ Q/W/E/R 正常觸發
- 無 input focused → 正常觸發
- **實作位置**：抽成獨立 `useKeyboardShortcuts` hook（掛在 document level）

### D7: F2 報表公式

```
totalIncome = Σ(order.paidAmount) + Σ(payment.paidAmount)
totalExpense = Σ(expense.mealPrice)
netCash = totalIncome - totalExpense
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
- 額外：以下站點加 `Math.round()` 防護：
  - `commitPosTransactionDraft()` 的 balance 計算
  - `deleteTransaction()` 的 balance 調整
  - store hydrate（posStateValidator migration）路徑
- UI 顯示永不帶小數點

### D9: 修改金額功能（保留簡化版）

- 移除 correction/void 的雙紀錄設計
- 保留**直接編輯**原紀錄的 `mealPrice` / `paidAmount`（inline edit）
- 編輯後自動 recalculate：`amount = paidAmount - mealPrice`，更新 `student.currentBalance`
- 建立 audit event（`type: 'transaction_edited'`），記錄 before/after snapshot
- UI：在 F2 LedgerGroupedTable 每筆紀錄旁的「編輯」按鈕 → inline edit fields

---

## 已決議的設計問題（Round 1 共識）

| # | 問題 | 決議 | 原因 |
|---|------|------|------|
| 1 | Expense studentId | `'__cashier__'` sentinel | 避免 30+ 處 null check，sentinel 語意明確 |
| 2 | afterBalance 一致性 | currentBalance 是 truth | 刪除後不 recalc 整條鏈，afterBalance 只作歷史 snapshot |
| 3 | 支出快速選項 | 固定兩選項 | 「付便當錢/其他原因」，選項清單抽為 constant 方便日後擴充 |
| 4 | Delete audit trail | 保留 | `{ type: 'transaction_deleted', originalTransaction: <snapshot>, deletedBy, deletedAt }` |
| 5 | Expense 在 F2 分組 | 獨立「櫃台支出」section 在表格頂部 | 不混入 per-student group |

---

## Tasks

### Task 0: State Migration

**Scope:**
- `frontend/src/storage/posStateValidator.ts`
  - 新增 migration function：偵測舊 `TransactionType`（topup→payment, cancel/correction/void→drop）
  - topup 紀錄 → 轉為 payment type
  - cancel/correction/void 紀錄 → 移除（已 resolved 的操作不再需要）
  - 移除後 recalculate 所有 student 的 `currentBalance`（從 0 開始重算）
  - 版本號機制：persist state 加 `schemaVersion` field，migration 只在版本不符時觸發

**Success criteria:**
- 舊 localStorage 資料 load 後不 crash
- Migration 後 app 正常運作，students balance 一致
- Migration 只觸發一次（冪等）

### Task 1: Domain Model 重構

**Scope:**
- `frontend/src/domain/ledger.ts`
  - `TransactionType` → `'order' | 'payment' | 'expense'`
  - 移除 `countActiveOrdersForStudent()`（改用 filter 直接查）
  - 移除 `canCancelToday()`
  - `createLedgerTransaction()` 支援 expense（studentId = `'__cashier__'`）
  - `calculateTransactionAmount()` 保留（expense: paidAmount=0, mealPrice=支出金額 → amount=-支出金額）
  - 移除 `voidedAt`/`voidedBy`/`voidReason`/`correctsTransactionId` 欄位
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
  - `getEffectiveLedgerRows()` → 移除或簡化為 identity（不再有 voided rows）
  - `groupLedgerRowsByStudent()` 跳過 `studentId === '__cashier__'`
- `frontend/src/domain/cashClose.ts`
  - `createCashCloseDraft()` 使用新版 LedgerTotals
  - `createDailySettlement()` 同上
- `frontend/src/domain/ledgerAudit.ts`
  - 移除 `createCorrectionTransaction()` / `createVoidTransaction()`
  - 保留 audit event 結構
  - 新增 event types: `'transaction_deleted'`, `'transaction_edited'`
  - audit event 記錄 before/after snapshot

**Success criteria:**
- 所有 domain function 編譯通過
- 新 types 無 any/unknown escape
- expense 使用 `mealPrice=支出金額, paidAmount=0` 的欄位語意

### Task 2: Store 重構

**Scope:**
- `frontend/src/store/posStore.ts`
  - 移除：`correctTransaction()`, `voidTransaction()`, `hardDeleteLocalDraft()`
  - 修改 `deleteTransaction()` → 同步調整 student.currentBalance + 建立 delete audit event
  - 新增 `deleteOrderWithRefundCheck(id: string)` → return type:
    ```typescript
    interface DeleteOrderResult {
      deleted: boolean;
      refundAmount: number;  // paidAmount of deleted order (0 if no refund needed)
      studentName: string;
      wasClosedDate: boolean; // true if businessDate was closed/reopened
    }
    ```
  - 修改 `commitPosTransactionDraft()` → 支援 expense type
  - 新增 `editTransaction(id: string, updates: { mealPrice?: number; paidAmount?: number; note?: string })` → 編輯金額 + recalc balance + audit event
  - 移除 `processTransaction()` 的 cancel/correction/void 相關路徑
  - 整數防護：`Math.round()` at `commitPosTransactionDraft`, `deleteTransaction`, `editTransaction`
- `frontend/src/hooks/usePosFlow.ts`
  - 適配新的 PosMode / PosFlowState
  - 新增 expense flow（不需 student selection）
  - 移除 cancel mode flow

**Success criteria:**
- Store actions 正確更新 balance（刪除時還原，編輯時 diff）
- Expense 紀錄正確建立（studentId = `'__cashier__'`，netCash 減少）
- `deleteOrderWithRefundCheck` return 完整資訊供 UI 使用
- `editTransaction` 正確 recalc balance + 建立 audit event

### Task 3: F1 POS UI 重構

**Scope:**
- `frontend/src/components/pos-components.tsx`
  - `ActionBar` 模式：訂便當(Q) / 繳費(W) / 支出(E)
  - `CustomerCard` 新增「取消訂餐」contextual button（學生有今日 order 時顯示）
    - 點擊 → confirm dialog → `deleteOrderWithRefundCheck` → 條件性退款提醒 toast
    - 已關帳日期：額外警告「此筆已計入前次結算，刪除後請重新關帳」
  - 新增 `ExpensePanel` 組件（inline，expense 模式時替代 CustomerCard 區域）
    - 數字金額輸入 → Enter → inline 選擇框（付便當錢 / 其他原因）
    - 選「其他原因」→ 文字備註輸入框
  - `IdleHero` 更新文案（E = 支出）
  - `getQuickAmounts()` 的 `'topup'` → `'payment'`
- `frontend/src/hooks/useKeyboardShortcuts.ts`（新檔案）
  - 從 pos-components.tsx 抽出 keyboard handler
  - 掛在 document level
  - 文字框 focused → suppress Q/W/E/R
  - 數字框 / 無 focus → Q/W/E/R 正常觸發
- `frontend/src/App.tsx`
  - 整合 ExpensePanel render（expense mode 時顯示）
  - Toast 管理（退款提醒、已關帳警告）

**Success criteria:**
- Q/W/E 切換模式正確
- 支出模式不需搜尋學生，inline 顯示在 CustomerCard 區域
- 文字輸入框中 Q/W/E 不觸發模式切換
- 取消按鈕正確刪除 order 並條件顯示退款提醒
- 已關帳日期刪除時顯示額外警告

### Task 4: F2 Report UI 簡化

**Scope:**
- `frontend/src/components/report/ReportSummaryStats.tsx`
  - 顯示：訂單數、總收入、總支出、淨現金流
  - 移除：退款、儲值、取消數
- `frontend/src/components/report/LedgerGroupedTable.tsx`
  - 移除 Correct/Void 按鈕
  - 保留 Delete 按鈕（調用 deleteOrderWithRefundCheck）
  - 新增「編輯」按鈕 → inline edit mealPrice/paidAmount（調用 editTransaction）
  - Expense 紀錄：獨立「櫃台支出」section 在表格頂部
- `frontend/src/components/report/CashClosePanel.tsx`
  - 使用新版 LedgerTotals（totalIncome / totalExpense / netCash）
  - 移除 refund 相關顯示
- `frontend/src/components/report/CorrectionDialog.tsx` → 刪除整個檔案
- `frontend/src/components/report/VoidDialog.tsx` → 刪除整個檔案
- `frontend/src/components/screens.tsx`
  - 移除 CorrectionDialog/VoidDialog 的 import
  - ReportScreen 的 totals 傳遞適配新版 LedgerTotals

**Success criteria:**
- F2 只顯示收入/支出兩類
- 結算公式：期望現金 = 開帳 + 收入 - 支出
- 無 correction/void UI 殘留
- 編輯功能可 inline 修改金額

### Task 5: Tests 重寫

**前置：先 grep 確認影響範圍**
```bash
cd frontend && grep -rl "'cancel'\|'topup'\|'correction'\|'void'" src/__tests__/ src/**/__tests__/ --include='*.ts' --include='*.tsx' | wc -l
```

**Scope:**
- 所有引用舊 type（topup/cancel/correction/void）的測試 → 改為新 type 或移除
- 新增 tests：
  - expense 建立 + netCash 計算
  - deleteOrderWithRefundCheck（含退款提醒、已關帳警告）
  - editTransaction（金額修改 + balance recalc + audit event）
  - keyboard shortcut suppression（文字框 vs 數字框）
  - state migration（舊 localStorage → 新格式）
  - `'__cashier__'` sentinel 在 groupLedgerRowsByStudent 中被跳過

**Success criteria:**
- `vitest run` 全部通過
- 新功能有 test coverage

---

## 實作順序

```
Task 0 (migration) → Task 1 (domain) → Task 2 (store) → Task 3 (F1 UI) → Task 5a (grep test scope) → Task 4 (F2 UI) → Task 5b (rewrite tests)
```

Task 1 建議分兩個 commit：
1. 純 type 定義變更（不刪 function body）→ build error 可清楚歸因
2. 刪除/重寫 function bodies

---

## 影響範圍（完整檔案清單）

### 修改的檔案：
| 檔案 | Task | 改動程度 |
|------|------|---------|
| `src/domain/ledger.ts` | 1 | 重大 |
| `src/domain/posFlow.ts` | 1 | 重大 |
| `src/domain/posTransaction.ts` | 1 | 中等 |
| `src/domain/ledgerReport.ts` | 1 | 重大 |
| `src/domain/cashClose.ts` | 1 | 中等 |
| `src/domain/ledgerAudit.ts` | 1 | 中等 |
| `src/store/posStore.ts` | 2 | 重大 |
| `src/hooks/usePosFlow.ts` | 2 | 重大 |
| `src/storage/posStateValidator.ts` | 0 | 重大 |
| `src/components/pos-components.tsx` | 3 | 重大 |
| `src/components/screens.tsx` | 4 | 中等 |
| `src/components/report/ReportSummaryStats.tsx` | 4 | 中等 |
| `src/components/report/LedgerGroupedTable.tsx` | 4 | 重大 |
| `src/components/report/CashClosePanel.tsx` | 4 | 中等 |
| `src/App.tsx` | 3 | 中等 |

### 新增的檔案：
| 檔案 | Task |
|------|------|
| `src/hooks/useKeyboardShortcuts.ts` | 3 |

### 刪除的檔案：
| 檔案 | Task |
|------|------|
| `src/components/report/CorrectionDialog.tsx` | 4 |
| `src/components/report/VoidDialog.tsx` | 4 |

### 可能受影響（需 impl 確認）：
- `src/domain/ipadHandoff.ts` — 如引用 TransactionType
- `src/domain/posSearch.ts` — 如引用舊 type
- `src/mocks/initialData.ts` — 如含 topup/cancel 測試資料

---

## 風險與緩解

| 風險 | 嚴重度 | 緩解 |
|------|--------|------|
| State migration 失敗 → app crash | 🔴 高 | Task 0 migration + schemaVersion 版本控制 |
| afterBalance 鏈斷裂 | 🟡 中 | 接受 trade-off：currentBalance 是 truth |
| Type narrowing cascade（~30 處 switch） | 🟡 中 | TypeScript strict mode 會在 build 時全部浮現 |
| 快捷鍵在特定 browser/IME 異常 | 🟡 中 | useKeyboardShortcuts hook 集中管理 |
| Expense state machine 新分支 edge cases | 🟡 中 | 明確的 state diagram + test coverage |
