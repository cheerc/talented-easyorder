# Order Ledger And Cash Close Spec

## 功能描述

Order Ledger And Cash Close 定義交易流水帳、報表統計、錯誤修正、刪除/作廢政策、每日現金對帳（cash close）、鎖帳/重開流程、CSV/列印輸出，以及 Firebase 同步的資料邊界。

已實作完整的 ledger 領域層：交易建立（`createLedgerTransaction`）、餘額重算（`recalculateStudentBalances`）、合併顯示（`mergeLedgerTransactions`）、稽核事件（`ledgerAudit.ts`）、CSV 匯出（`ledgerExport.ts`）、報表統計（`ledgerReport.ts`）、每日結算（`cashClose.ts`）、以及現金工作階段（`cashSession.ts`）。

同步層使用 Firebase Firestore。Ledger sync boundary（`ledgerSyncBoundary.ts`）定義 queueable payload 與 close blocking 邏輯。

## 使用者故事

- As a counter operator, I want to review today's transactions grouped by student so that I can find mistakes quickly.
- As a counter operator, I want to correct a mistaken transaction with a reason so that the audit trail explains balance changes.
- As an accounting user, I want to close the business date with expected cash, counted cash, difference, and note so that daily reconciliation is explicit.
- As an accounting user, I want closed dates to become read-only so that old reports are not accidentally changed.
- As a manager, I want week/month/custom reports so that I can review order counts, collected cash, and new debt.
- As an admin, I want to export stable CSV columns so that external review can reconcile against the app.

## 驗收標準

### Ledger Display

Given the report screen opens for the current business date
When transactions exist for multiple students
Then `mergeLedgerTransactions` groups rows by student+businessDate and shows: latest time, student id, name snapshot, meal total, paid total, current after balance, order count, deposit/unpaid amounts.

Given a grouped student row is clicked
When the row expands
Then the UI shows each transaction with time, type, meal price, paid amount, note, after balance, source device, and sync status.

Given a date range filter is changed to today, week, month, or custom
When the report reloads
Then `filterTransactionsByBusinessDate` filters transactions and `calculateLedgerTotals` recomputes totals. `LedgerDateRange` supports today/week/month/custom kinds.

### Totals And Reporting

Given visible ledger rows for a date range
When `calculateLedgerTotals` runs
Then it computes: orderCount, totalIncome, totalExpense, netCash (= totalIncome - totalExpense), newDebt (unpaid meal amounts), and transactionCount.

Given CSV export is clicked
When the selected range has transactions
Then `buildTransactionCsvRows` generates rows with 22 stable columns (including deposit_amount, unpaid_amount). CSV output includes BOM for Excel compat and formula injection prevention (CWE-1236).

Given CSV export includes settlements
When `buildSettlementCsvRows` runs
Then settlement CSV has 15 columns: business_date through sync_status.

Given print is clicked
When the selected range has transactions
Then `buildLedgerPrintViewModel` includes business date range, totals, grouped ledger rows, and cash close status.

### Corrections And Audit

Given a transaction and the business date is open (`isBusinessDateWritable` returns true)
When an operator edits meal price, paid amount, or note
Then `decideLedgerEditPolicy` returns `direct_edit` with `reasonRequired: true`. An audit event is recorded via `createLedgerAuditEvent`.

Given a transaction and the business date is closed
When an operator attempts to edit it
Then `decideLedgerEditPolicy` returns `blocked`. The operator must reopen the date first.

Given an operator deletes a transaction on an open date
When `decideLedgerDeletePolicy` evaluates
Then it returns `hard_delete` with `reasonRequired: true`. An audit event of type `transaction_hard_deleted` is recorded.

Audit event types: `transaction_edited`, `transaction_deleted`, `transaction_hard_deleted`, `business_date_closed`, `business_date_reopened`, `csv_exported`, `report_printed`.

Given a transaction correction changes a student's balance
When the correction is committed
Then `recalculateStudentBalances` deterministically recomputes all after-balance values from sorted transactions.

### Daily Cash Close

Given the business date is open
When the accounting user opens cash close
Then `createCashCloseDraft` computes: openingCash, netCash, expectedCash (= openingCash + netCash), difference (= countedCash - expectedCash).

Given `validateCashClose` returns ok
When the accounting user confirms close
Then `createDailySettlement` creates a settlement row with status `closed` and the date becomes read-only.

Given counted cash differs from expected cash
When the accounting user confirms close without a note
Then `validateCashClose` returns `discrepancy_no_note` error.

Given there are failed or conflict sync rows
When the accounting user attempts close
Then `validateCashClose` returns `blocked_sync`. For queued rows, close requires explicit `queuedSettlementAccepted` confirmation.

Given a business date is closed
When POS or report edit shortcuts attempt to create/edit/delete transactions
Then `isBusinessDateWritable` returns false, blocking all mutations.

Given an admin reopens a closed business date
When `reopenBusinessDate` is called with reason, reopenedBy, and reopenedAt
Then the settlement status becomes `reopened`, settlementRevision increments, and the date accepts corrections.

Given a closed business date is reopened and corrected
When it is closed again
Then a new settlement revision is created without deleting the prior revision.

### Opening Cash

Given a business date and daily settlements exist for the previous day
When `getOpeningCash` computes opening cash
Then it uses the previous day's `countedCash` from the highest revision settlement.

Given no prior settlement and no cash session
When `getOpeningCash` computes opening cash
Then it defaults to 4000.

### Cash Session

A `DailyCashSession` (in `cashSession.ts`) tracks the drawer state for a business date. `createDailyCashSession` creates a session with status `open`. `validateOpeningCash` ensures the value is a non-negative integer ≤ 20000.

## 技術約束

- Vite 8 + React 19 + TypeScript 6 + Zustand 5.
- Ledger math must be deterministic pure functions (`calculateTransactionAmount`, `recalculateStudentBalances`, `calculateLedgerTotals`).
- Transaction rows use stable `transactionId`; array index is never identity.
- `businessDate` drives filtering, close status, and historical locks.
- `CASHIER_SENTINEL` (`__cashier__`) identifies non-student expense transactions.
- `mergeLedgerTransactions` merges same-day student transactions into single display rows with depositAmount/unpaidAmount.
- Correction and delete policies are enforced by `decideLedgerEditPolicy` / `decideLedgerDeletePolicy`.
- CSV column names are stable constants (`TRANSACTION_CSV_COLUMNS`, `SETTLEMENT_CSV_COLUMNS`).
- Closeout is a state transition (`status: 'closed'`) stored in `DailySettlement`, not just a visual label.
- Settlement revisions are append-only; prior revisions remain auditable.
- Test chain: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build`.

## 實際型別（對齊 `domain/ledger.ts`, `domain/cashClose.ts`, `domain/cashSession.ts`）

```ts
export type TransactionType = 'order' | 'payment' | 'expense';
export type LedgerSyncStatus = 'local' | 'queued' | 'synced' | 'failed' | 'conflict';
export type BusinessDateStatus = 'open' | 'closed' | 'reopened';

export interface LedgerTransaction {
  transactionId: string;
  businessDate: string;
  createdAt: string;
  studentId: string;
  studentNameSnapshot: string;
  type: TransactionType;
  mealPrice: number;
  paidAmount: number;
  amount: number;
  afterBalance: number;
  menuNameSnapshot: string;
  vendorNameSnapshot: string;
  sourceDevice: 'pc' | 'barcode_scanner' | 'ipad_handoff';
  operatorId?: string;
  syncStatus: LedgerSyncStatus;
  revision: number;
  note: string;
  depositAmount?: number;
  unpaidAmount?: number;
}

export interface DailySettlement {
  settlementId: string;
  businessDate: string;
  status: BusinessDateStatus;
  settlementRevision: number;
  orderCount: number;
  transactionCount: number;
  totalIncome: number;
  totalExpense: number;
  openingCash: number;
  netCash: number;
  expectedCash: number;
  countedCash: number;
  difference: number;
  note: string;
  closedBy: string;
  closedAt: string;
  reopenedBy?: string;
  reopenedAt?: string;
  reopenReason?: string;
  syncStatus: LedgerSyncStatus;
  revision: number;
}
```

## 與其他模組的介面

### 輸入

- Transaction rows and draft intents from `pc-pos-order-flow-spec` (`domain/posTransaction.ts`).
- Student ids and name snapshots from `student-account-management-spec` (`domain/student.ts`).
- Menu/vendor snapshots from `menu-vendor-management-spec` (`domain/menu.ts`).
- Sync status from Firebase (`firebase/ledgerRepository.ts`).

### 輸出

- Visible report groups (`LedgerGroup`) and totals (`LedgerTotals`) for UI.
- Balance recalculation results back to `student-account-management-spec`.
- Settlement rows for Firebase sync via `ledgerSyncBoundary.ts`.
- Close/reopen/read-only status used by `pc-pos-order-flow-spec`.
- Correction, void, close, and reopen audit events (`LedgerAuditEvent`).

### 依賴關係

- Depends on `pc-pos-order-flow-spec` for committed transaction inputs.
- Depends on `student-account-management-spec` for stable student identity and balance updates.
- Depends on `menu-vendor-management-spec` for menu/vendor snapshots.
- Feeds Firebase (`firebase/ledgerRepository.ts`, `firebase/settlementRepository.ts`) with transactions and settlements.

## 不在本模組範圍

- Student roster import or face profile management.
- Menu/vendor CRUD behavior outside historical snapshots.
- Firebase transport/retry/conflict resolution mechanics.
- Tax, invoice, or external accounting package integration.
