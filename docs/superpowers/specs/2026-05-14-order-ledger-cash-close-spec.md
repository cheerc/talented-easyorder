# Order Ledger And Cash Close Spec

## 功能描述

Order Ledger And Cash Close 定義交易流水帳、報表統計、錯誤修正、刪除/作廢政策、每日現金對帳、鎖帳流程、CSV/列印輸出，以及同步到 Google Sheets 每日結算總表的資料邊界。

PDF Phase 1 要求「全數位化管理」與「每日現金對帳」。目前 prototype 已有今日帳、學員彙總、展開明細、inline edit/delete、訂餐/收現/欠款統計，但尚未定義不可變 ledger、修正原因、closeout、reopen、CSV schema 或 Google Sheets 的每日結算總表。本 spec 將報表從 UI prototype 推進到可稽核帳務流程。

## 使用者故事

- As a counter operator, I want to review today's transactions grouped by student so that I can find mistakes quickly.
- As a counter operator, I want to correct a mistaken transaction with a reason so that the audit trail explains balance changes.
- As an accounting user, I want to close the business date with expected cash, counted cash, difference, and note so that daily reconciliation is explicit.
- As an accounting user, I want closed dates to become read-only so that old reports are not accidentally changed.
- As a manager, I want week/month/custom reports so that I can review order counts, collected cash, refunds, and new debt.
- As an admin, I want to export stable CSV columns so that Google Sheets and external review can reconcile against the app.

## 驗收標準

### Ledger Display

Given the report screen opens for the current business date
When transactions exist for multiple students
Then the default view groups rows by student and shows latest time, student id, name snapshot, meal total, paid total, current after balance, and record count.

Given a grouped student row is clicked
When the row expands
Then the UI shows each transaction with time, type, meal price, paid amount, note, after balance, source device, and sync status.

Given a date range filter is changed to today, week, month, or custom
When the report reloads
Then totals and visible rows are computed from transactions whose `businessDate` falls inside the selected range.

### Totals And Reporting

Given visible ledger rows for a date range
When totals are calculated
Then order count, order sales amount, cash collected, refund amount, net cash, new debt, top-up amount, cancellation count, and transaction count equal the sum of visible rows.

Given CSV export is clicked
When the selected range has transactions
Then the generated CSV includes stable column names sufficient to rebuild visible totals without local app state.

Given print is clicked
When the selected range has transactions
Then the print view includes business date range, totals, grouped ledger rows, and cash close status.

Given CSV export is clicked after a business date is closed
When the export file is generated
Then it includes both transaction rows and the settlement summary fields for that business date.

### Corrections And Audit

Given a transaction is unsynced and the business date is open
When an operator edits meal price, paid amount, type, or note
Then the app recalculates amount/after balance and records an audit event with before values, after values, editor, timestamp, and reason when required.

Given a transaction is synced or the business date has been closed
When an operator attempts to edit it
Then direct mutation is blocked and the UI offers reversal plus replacement or admin reopen flow.

Given an operator deletes a transaction
When the transaction has ledger history or sync status beyond local draft
Then the app creates a void/reversal audit record instead of hard-deleting the row.

Given a transaction correction changes a student's balance
When the correction is committed
Then all later after-balance values for that student are recalculated deterministically.

### Daily Cash Close

Given the business date is open
When the accounting user opens cash close
Then the close form displays expected cash, cash collected, refund amount, net cash, transaction count, order count, and unsettled sync count.

Given counted cash equals expected cash
When the accounting user confirms close
Then a settlement row is created and the business date becomes closed/read-only.

Given counted cash differs from expected cash
When the accounting user confirms close without a note
Then close is blocked until a discrepancy note is entered.

Given there are failed or pending sync rows
When the accounting user attempts close
Then close is blocked for failed/conflict rows and allowed for queued local rows only after the user confirms the settlement will be queued for sync.

Given a business date is closed
When POS or report edit shortcuts attempt to create/edit/delete transactions
Then the action is blocked and the UI shows the closed-date state.

Given an admin reopens a closed business date
When a required reason is submitted
Then a reopen audit event is recorded and the date accepts corrections until closed again.

Given a closed business date is reopened and corrected
When it is closed again
Then a new settlement revision is created without deleting the prior settlement revision.

## 技術約束

- Frontend remains pure Vite 8 + React 19 + TypeScript 6 + Zustand 5 for initial implementation.
- Ledger math must be implemented as deterministic pure functions with unit tests.
- Transaction rows must use stable ids; array index cannot be used as identity.
- `businessDate` drives filtering, close status, and historical locks.
- Prefer append-only correction/reversal records for synced or closed data; local draft hard delete is allowed only before sync/close boundaries.
- Daily settlement rows must map cleanly to the PDF's `每日結算總表` Google Sheet.
- CSV column names must be stable and documented before sync/export implementation.
- Closeout is a state transition stored in domain data, not just a report filter or visual label.
- A closed settlement may be revised by reopen/reclose, but prior revisions remain auditable.
- Existing test chain applies from `frontend/`: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build`.

## UI/UX 要求

- Reports remain dense and scan-friendly; summary cards sit above grouped ledger rows.
- Grouped rows are default; expanded detail rows expose audit/correction controls only when allowed.
- Closed, historical, unsynced, failed-sync, voided, and corrected states must be visually distinct.
- Correction and void flows use confirmation dialogs with reason capture when audit policy requires it.
- Cash close is a focused form, not buried inside inline report editing.
- Discrepancy warnings must show expected cash, counted cash, and difference in the same view.
- CSV/print actions must clearly indicate the selected date range.
- Closed dates should show a lock indicator in both POS and report views.

## 與其他模組的介面

### 輸入

- Transaction rows and draft intents from `pc-pos-order-flow`.
- Student ids and name snapshots from `student-account-management`.
- Menu/vendor snapshots from `menu-and-vendor-management`.
- Sync status, revisions, and failed/pending row status from `google-sheets-sync-and-offline`.

### 輸出

- Visible report groups and totals for UI.
- Balance recalculation results back to `student-account-management`.
- Settlement rows and settlement revision events for `google-sheets-sync-and-offline`.
- Close/reopen/read-only status used by `pc-pos-order-flow`.
- Correction, void, close, and reopen audit events.

### 依賴關係

- Depends on `pc-pos-order-flow` for committed transaction inputs.
- Depends on `student-account-management` for stable student identity and balance updates.
- Depends on `menu-and-vendor-management` for menu/vendor snapshots.
- Feeds `google-sheets-sync-and-offline` with transactions, corrections, audit events, and settlements.
- Feeds `pc-pos-order-flow` with duplicate/cancel availability and date close status.

## CSV / 列印格式定義

### Transaction CSV Columns

Transaction CSV exports use one row per ledger transaction with these stable columns:

1. `business_date`
2. `transaction_id`
3. `created_at`
4. `student_id`
5. `student_name_snapshot`
6. `type`
7. `meal_price`
8. `paid_amount`
9. `amount`
10. `after_balance`
11. `menu_name_snapshot`
12. `vendor_name_snapshot`
13. `source_device`
14. `operator_id`
15. `sync_status`
16. `revision`
17. `note`
18. `voided_at`
19. `voided_by`
20. `void_reason`

### Settlement CSV Columns

Settlement CSV exports use one row per settlement revision:

1. `business_date`
2. `settlement_revision`
3. `status`
4. `order_count`
5. `transaction_count`
6. `expected_cash`
7. `counted_cash`
8. `difference`
9. `note`
10. `closed_by`
11. `closed_at`
12. `reopened_by`
13. `reopened_at`
14. `reopen_reason`
15. `sync_status`

### Print Layout

Printed reports include:

- Header: title, business date/range, generated timestamp, generated-by operator if available.
- Totals: order count, transaction count, order sales, cash collected, refunds, net cash, new debt, top-up amount, cancellation count.
- Cash close: open/closed/reopened status, expected cash, counted cash, difference, close note, close timestamp.
- Ledger table: grouped by student with expanded transaction rows.
- Footer: sync summary with queued/failed/conflict counts.

## Google Sheets 同步資料邊界

This module owns the data shape and state transitions for ledger and settlement records. It does not own transport, retry, authentication, or conflict resolution mechanics.

Rows emitted to `google-sheets-sync-and-offline`:

- `transactions`: committed ledger rows, correction rows, void/reversal rows.
- `daily_settlements`: close, reopen, and reclose settlement revisions.
- `sync_events` candidates: correction audit events, void events, close/reopen events, export events when audit logging is enabled.

Close policy:

- `failed` or `conflict` transaction sync status blocks close.
- `queued` transaction sync status may close only if all queued rows are locally committed and the settlement row is also queued atomically.
- Closing a date emits a settlement row and marks the business date read-only locally before remote sync completes.
- If settlement sync later fails, the business date remains locally closed and the sync module surfaces a failed-settlement state for admin repair.

## 建議資料型別

```ts
export type TransactionType = 'order' | 'topup' | 'cancel' | 'correction' | 'void';
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
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
}

export interface DailySettlement {
  settlementId: string;
  businessDate: string;
  status: BusinessDateStatus;
  settlementRevision: number;
  orderCount: number;
  transactionCount: number;
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

## 現有實作對照

- Current report UI: `ReportScreen` in `frontend/src/components/screens.tsx`.
- Current store actions: `updateTransaction`, `deleteTransaction`, `processTransaction` in `frontend/src/store/posStore.ts`.
- Current strengths: grouped report, expandable rows, inline edit/delete, simple totals, date lock in POS.
- Current gaps: date range buttons are mostly UI-only, edit/delete lacks audit, no settlement rows, no close/reopen state, no CSV/print implementation, no sync status, no explicit Google Sheets settlement boundary, hard local mutation exists.

## 不在本模組範圍

- Student roster import or face profile management.
- Menu/vendor CRUD behavior outside historical snapshots.
- Google Sheets transport/retry/conflict resolution mechanics.
- Tax, invoice, or external accounting package integration.
