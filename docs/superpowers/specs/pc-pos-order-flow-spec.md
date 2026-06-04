# PC POS Order Flow Spec

## 功能描述

PC POS Order Flow 定義櫃台核心流程：搜尋學員、確認身份、選擇交易模式（訂餐/繳費/雜支）、預覽餘額、送出一筆交易、進入同步/排隊狀態，並回到下一位學員。

系統支援三種交易模式：`order`（訂餐，可選已付金額）、`payment`（現金繳費）、`expense`（雜支，含收入/支出方向與原因）。搜尋支援文字（學號/姓名/別名）與條碼掃描。iPad handoff 事件可預選學員。重複訂餐需二次確認。

同步層使用 Firebase Firestore，交易先在本地 commit，再透過 sync boundary 排隊同步。離線時服務不中斷。

## 使用者故事

- As a counter operator, I want to find a student by id/name text search or barcode scan so that I can process the next person without leaving the keyboard.
- As a counter operator, I want to record an order, payment, or expense so that all counter actions produce ledger entries.
- As a counter operator, I want to preview the resulting balance before confirming so that I catch obvious mistakes before committing.
- As a counter operator, I want duplicate same-day orders to require an explicit second confirmation so that accidental double orders are reduced.
- As a counter operator, I want the screen to clear after a successful transaction so that the next student cannot see private data.
- As an admin/operator, I want historical dates to be read-only in the POS flow so that old records are not accidentally changed from the counter screen.
- [PLANNED] As a Phase 2 operator, I want an iPad recognition event to preselect or queue a student without automatically creating an order.

## 驗收標準

### Search And Selection

Given the POS is idle on the current business date
When the operator types text into the search field
Then the system uses text search mode and matches active students by exact/partial studentId and displayName, including aliases.

Given the POS is idle on the current business date
When the operator types an exact active `studentId` and presses Enter
Then the matching active student is selected and the order mode is focused. If the student has an order today, mode defaults to `payment`.

Given the POS is idle on the current business date
When the operator types a partial display name
Then matching active students are shown with id, name, and balance state.

Given multiple search results are visible
When the operator presses ArrowDown, ArrowUp, and Enter
Then focus moves through suggestions and Enter selects the highlighted student.

Given a student is inactive
When the operator searches in normal POS mode
Then the student is hidden (only active students are returned by `searchPosStudents`).

Given a barcode scanner sends a complete code and Enter/Tab terminator
When the system resolves via `resolveScannedStudent`
Then the code is matched against exact studentId first, then aliases. Single match → student selected. Multiple alias matches → `scan_ambiguous` error. No match → `scan_not_found` error.

Given QR/barcode input resolves to zero or multiple students
When the scan is processed
Then no student is selected and the UI shows a recoverable scan error with fallback to text search.

### Transaction State Machine

The state machine (`reducePosFlow` in `domain/posFlow.ts`) defines these states:

| State | Description |
|-------|-------------|
| `idle` | Search input active, no student selected |
| `student_selected` | Student selected, mode/amount editing |
| `duplicate_warning` | Same-day duplicate order requires confirmation |
| `expense_input` | Entering expense amount |
| `expense_direction` | Selecting income or expense direction |
| `expense_reason` | Selecting expense reason（付便當錢/支出其他/收入其他） |
| `expense_other_note` | Entering custom note for "其他" expense |
| `committing` | Transaction being persisted |
| `success` | Transaction committed, showing result |
| `error` | Commit failed with retryable/non-retryable message |
| `historical_readonly` | Non-current business date, read-only |

Given the POS starts in `idle`
When an active student is selected by text search, scan search, or iPad handoff
Then the state changes to `student_selected` with source `manual`, `scan`, or `ipad`.

Given the state is `student_selected`
When the operator changes mode between `order`, `payment`, and `expense`
Then the transaction preview recalculates before confirmation and no ledger record is created.

Given the state is `student_selected` and the operator confirms a valid transaction
When local commit starts
Then the state changes to `committing` and duplicate keyboard/mouse submissions are ignored until commit succeeds or fails.

Given local commit succeeds
When the success confirmation is shown
Then the state changes to `success`, the transaction sync status is set to `local` or `queued`, and dismissal returns to `idle`.

Given local commit fails because validation rejects the intent
When the error is shown
Then the state returns to `student_selected`, preserves the current input, and allows correction/retry.

Given local commit fails because local persistence is unavailable
When the error is shown
Then no transaction is considered committed, retry is available, and the operator can cancel back to idle.

### Expense Flow

Given the operator presses the expense shortcut from `idle`
When `enterExpenseMode` fires
Then state transitions: `idle` → `expense_input` → `expense_direction` → (`expense_reason` or `expense_other_note`) → `committing`.

Given the direction is `income`
When the operator selects "收入其他"
Then state goes to `expense_other_note` for custom note entry.

Given the direction is `expense` and reason is "付便當錢"
When the operator selects it
Then state goes directly to `committing` with pre-filled note "付便當錢".

Given the direction is `expense` and reason is "支出其他"
When the operator selects it
Then state goes to `expense_other_note` for custom note entry.

Expense transactions use `CASHIER_SENTINEL` (`__cashier__`) as studentId and "櫃台" as student name.

### Transaction Math

Given a selected student and today's menu price is 90
When the operator confirms `order` with empty cash input
Then the created transaction has `mealPrice = 90`, `paidAmount = 0`, `amount = -90`, and the student's balance decreases by 90.

Given a selected student
When the operator confirms `payment` with cash input `500`
Then the created transaction has `mealPrice = 0`, `paidAmount = 500`, `amount = 500`, and the student's balance increases by 500.

Given an expense with direction `expense` and amount 200
When confirmed
Then `mealPrice = 200`, `paidAmount = 0`, `amount = -200`.

Given an expense with direction `income` and amount 300
When confirmed
Then `mealPrice = 0`, `paidAmount = 300`, `amount = 300`.

Formula: `amount = paidAmount - mealPrice`. No alternate balance formula is allowed.

### Duplicate And Safety States

Given a selected student already has an active same-day order
When the operator confirms another `order` for the first time
Then no transaction is created and the state changes to `duplicate_warning`.

Given the duplicate-order warning is displayed
When the operator confirms again (`confirmDuplicate`)
Then a second order transaction is created and the warning closes.

Given the duplicate-order warning is displayed
When the operator presses Escape or clicks no/cancel
Then the warning closes and no transaction is created (returns to `idle`).

Given a non-current business date is selected
When the operator attempts search, order, payment, expense, or keyboard shortcuts
Then the POS is in `historical_readonly` state and all write actions are blocked.

### Error, Cancel, And Retry Rules

Given no student is selected
When the operator presses Escape
Then search text clears and the POS remains idle.

Given a student is selected and no transaction has been committed
When the operator presses Escape or clicks cancel
Then the selected student, input amount, duplicate warning, and mode state are cleared without creating a ledger row.

Given a transaction intent is invalid (missing menu, student, or amount data)
When the operator confirms
Then no ledger row is created and the UI shows the first actionable validation error.

Given sync fails after local commit
When the transaction already has a local committed id
Then the operator sees queued/failed-sync status and must not retry by creating a second transaction.

### Completion And Privacy

Given any transaction is successfully committed locally
When the success confirmation is dismissed
Then selected student, amount input, duplicate state, and action mode are reset and search input regains focus.

Given a transaction is committed while offline
When the success confirmation is displayed
Then the sync indicator shows queued/offline state without blocking the next POS transaction.

### iPad Handoff

Given the PC POS is idle
When a valid iPad handoff event arrives (validated via `validateIpadHandoffMessage`)
Then the handoff is converted to a scanner input via `toHandoffScannerInput` and resolves the student. The source is marked as `ipad`.

[PLANNED] Given a PC transaction is already active
When a valid iPad handoff event arrives
Then the event is queued or rejected visibly and does not replace the active student.

Handoff events expire after 30 seconds (MAX_HANDOFF_AGE_MS). Only version 1, actions `order`/`payment`, and source `ipad_handoff` are accepted. Events are passed through `sessionStorage`.

## 技術約束

- Vite 8 + React 19 + TypeScript 6 + Zustand 5.
- Pure frontend; order flow must work without backend connectivity.
- Transaction math uses `amount = paidAmount - mealPrice`.
- Business date must be a domain field captured at transaction creation.
- POS flow state is a discriminated union reduced by `reducePosFlow` in `domain/posFlow.ts`.
- Transaction creation delegates to pure domain functions (`buildPosTransactionDraft`, `deriveTransactionAttributes`).
- Keyboard shortcuts must not bypass disabled or read-only states.
- Test chain: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build`.

## 實際型別（對齊 `domain/posFlow.ts`, `domain/posTransaction.ts`）

```ts
export type PosMode = 'order' | 'payment' | 'expense';
export type PosSelectionSource = 'manual' | 'scan' | 'ipad';
export type PosSourceDevice = 'pc' | 'barcode_scanner' | 'ipad_handoff';

export type PosFlowState =
  | { kind: 'idle'; searchText: string }
  | { kind: 'student_selected'; studentId: string; mode: PosMode; source: PosSelectionSource; paidAmountText: string; searchTextHint: string }
  | { kind: 'duplicate_warning'; studentId: string; source: PosSelectionSource; paidAmountText: string; searchTextHint: string }
  | { kind: 'expense_input'; amountText: string }
  | { kind: 'expense_direction'; amount: number }
  | { kind: 'expense_reason'; amount: number; direction: ExpenseDirection }
  | { kind: 'expense_other_note'; amount: number; direction: ExpenseDirection }
  | { kind: 'committing'; studentId?: string; mode: PosMode; source: PosSelectionSource; paidAmountText: string; expenseAmount?: number; expenseNote?: string; expenseDirection?: ExpenseDirection }
  | { kind: 'success'; transactionId: string; syncStatus: 'queued' | 'synced' | 'failed' }
  | { kind: 'historical_readonly'; businessDate: string }
  | { kind: 'error'; studentId?: string; mode?: PosMode; source?: PosSelectionSource; paidAmountText?: string; message: string; retryable: boolean };

export interface PosTransactionIntent {
  businessDate: string;
  studentId: string;
  type: PosMode;
  mealPrice: number;
  paidAmount: number;
  note: string;
  sourceDevice: PosSourceDevice;
}
```

## 與其他模組的介面

### 輸入

- Active `StudentAccount` search results from `student-account-management-spec` (`domain/student.ts`, `domain/posSearch.ts`).
- Active `TodayMenu` and menu/vendor snapshots from `menu-vendor-management-spec` (`domain/menu.ts`).
- Existing same-day ledger rows from `order-ledger-cash-close-spec` (`domain/ledger.ts`) for duplicate/cancel detection.
- Sync status from Firebase (`firebase/ledgerRepository.ts`).
- iPad handoff events from `ipad-face-auth-handoff-spec` (`domain/ipadHandoff.ts`).

### 輸出

- Committed transaction rows for `order-ledger-cash-close-spec` (`domain/ledger.ts`).
- Queueable payloads via `domain/ledgerSyncBoundary.ts` for Firebase sync.
- UI state events for success, duplicate warning, read-only lock, and queued/offline status.

### 依賴關係

- Depends on `student-account-management-spec` for active student identity and balance.
- Depends on `menu-vendor-management-spec` for menu price and snapshots.
- Feeds `order-ledger-cash-close-spec` with transaction rows.
- Receives optional student preselection from `ipad-face-auth-handoff-spec`.

## 不在本模組範圍

- Student roster import/admin maintenance; covered by `student-account-management-spec`.
- Menu/vendor CRUD; covered by `menu-vendor-management-spec`.
- Daily close and audited correction policy; covered by `order-ledger-cash-close-spec`.
- Firebase transport and retry; covered by `firebase/` integration layer.
- Face recognition implementation; covered by `ipad-face-auth-handoff-spec`.
