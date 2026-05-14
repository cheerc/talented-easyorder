# PC POS Order Flow Spec

## 功能描述

PC POS Order Flow 定義 PDF Phase 1 的櫃台核心流程：搜尋學員、確認身份、選擇交易模式、預覽餘額、送出一筆交易、進入同步/排隊狀態，並回到下一位學員。

現有 prototype 已具備高保真 PC POS：姓名/編號搜尋、訂便當、儲值、取消當日訂餐、重複訂餐警告、交易後餘額預覽、完成彈窗、歷史日期鎖定、最近交易列表。此 spec 將它整理為正式可測的作業狀態機，並保留未來 QR/條碼輸入作為第二搜尋模式，避免後續加入 Google Sheets、條碼掃描器或 iPad handoff 時破壞高速櫃台流程。

## 使用者故事

- As a counter operator, I want to find a student by id/name text search or future QR/barcode scan so that I can process the next person without leaving the keyboard.
- As a counter operator, I want to record an order, top-up/payment, or same-day cancellation so that all lunch counter actions produce ledger entries.
- As a counter operator, I want to preview the resulting balance before confirming so that I catch obvious mistakes before committing.
- As a counter operator, I want duplicate same-day orders to require an explicit second confirmation so that accidental double orders are reduced.
- As a counter operator, I want the screen to clear after a successful transaction so that the next student cannot see private data.
- As an admin/operator, I want historical dates to be read-only in the POS flow so that old records are not accidentally changed from the counter screen.
- As a Phase 2 operator, I want an iPad recognition event to preselect or queue a student without automatically creating an order.

## 驗收標準

### Search And Selection

Given the POS is idle on the current business date
When the operator types text into the search field
Then the system uses text search mode and matches active students by exact/partial id and Traditional Chinese display name.

Given the POS is idle on the current business date
When the operator types an exact active `studentId` and presses Enter
Then the matching active student is selected and the order mode is focused.

Given the POS is idle on the current business date
When the operator types a partial Traditional Chinese display name
Then matching active students are shown with id, name, and balance state.

Given multiple search results are visible
When the operator presses ArrowDown, ArrowUp, and Enter
Then focus moves through suggestions and Enter selects the highlighted student.

Given a student is inactive
When the operator searches in normal POS mode
Then the student is hidden unless an admin-only inactive search mode is explicitly enabled.

Given QR/barcode input support is enabled in a future implementation
When a scanner sends a complete code and terminator key
Then the system uses scan search mode, resolves the code to one active student, and selects that student without changing transaction semantics.

Given QR/barcode input resolves to zero or multiple students
When the scan is processed
Then no student is selected and the UI shows a recoverable scan error with fallback to text search.

### Transaction State Machine

Given the POS starts in `idle`
When an active student is selected by text search, scan search, or iPad handoff
Then the state changes to `student_selected` with source `manual`, `scan`, or `ipad`.

Given the state is `student_selected`
When the operator changes mode between `order`, `topup`, and `cancel`
Then the transaction preview recalculates before confirmation and no ledger record is created.

Given the state is `student_selected` and the operator confirms a valid transaction
When local commit starts
Then the state changes to `committing` and duplicate keyboard/mouse submissions are ignored until commit succeeds or fails.

Given local commit succeeds
When the success confirmation is shown
Then the state changes to `success`, the transaction is queued for sync if needed, and dismissal returns to `idle`.

Given local commit fails because validation rejects the intent
When the error is shown
Then the state returns to `student_selected`, preserves the current input, and allows correction/retry.

Given local commit fails because local persistence is unavailable
When the error is shown
Then no transaction is considered committed, retry is available, and the operator can cancel back to idle.

### Transaction Confirmation

Given a selected student and today's menu price is 90
When the operator confirms `order` with empty cash input
Then the created transaction has `mealPrice = 90`, `paidAmount = 0`, `amount = -90`, and the student's balance decreases by 90.

Given a selected student and today's menu price is 90
When the operator confirms `order` with cash input `90`
Then the created transaction has `mealPrice = 90`, `paidAmount = 90`, `amount = 0`, and the student's balance is unchanged.

Given a selected student
When the operator confirms `topup` with cash input `500`
Then the created transaction has `mealPrice = 0`, `paidAmount = 500`, `amount = 500`, and the student's balance increases by 500.

Given a selected student has one active same-day order
When the operator confirms `cancel` with no cash refund
Then the created transaction reverses that active order count, marks cancellation intent, and increases the student's balance by the canceled meal price.

Given a selected student has no active same-day order
When the operator navigates to cancel mode by mouse or keyboard
Then cancel mode is disabled and no transaction can be created.

### Duplicate And Safety States

Given a selected student already has an active same-day order
When the operator confirms another `order` for the first time
Then no transaction is created and a duplicate-order warning is displayed.

Given the duplicate-order warning is displayed
When the operator confirms again
Then a second order transaction is created and the warning closes.

Given the duplicate-order warning is displayed
When the operator presses Escape or clicks no/cancel
Then the warning closes and no transaction is created.

Given a non-current business date is selected
When the operator attempts search, order, top-up, cancel, or keyboard shortcuts
Then the POS write flow is blocked and a historical read-only state is shown.

### Error, Cancel, And Retry Rules

Given no student is selected
When the operator presses Escape
Then search text clears and the POS remains idle.

Given a student is selected and no transaction has been committed
When the operator presses Escape or clicks cancel
Then the selected student, input amount, duplicate warning, and mode state are cleared without creating a ledger row.

Given a selected student's balance or today's menu changes while the operator is on the confirmation screen
When the operator confirms
Then the system recalculates the transaction preview from the latest domain state before committing.

Given a transaction intent is invalid because required menu, student, or amount data is missing
When the operator confirms
Then no ledger row is created and the UI shows the first actionable validation error.

Given sync to Google Sheets fails after local commit
When the transaction already has a local committed id
Then the operator sees queued/failed-sync status and must not retry by creating a second transaction.

Given sync to Google Sheets fails before local commit
When no local committed id exists
Then retry attempts the same intent and cancel abandons it without ledger side effects.

### Completion And Privacy

Given any transaction is successfully committed locally
When the success confirmation is dismissed
Then selected student, amount input, duplicate state, and action mode are reset and search input regains focus.

Given a transaction is committed while offline
When the success confirmation is displayed
Then the top bar or sync indicator shows queued/offline state without blocking the next POS transaction.

### iPad Handoff

Given no PC transaction is active
When a valid iPad handoff event arrives for an active student
Then the PC selects that student and marks the source as iPad handoff.

Given a PC transaction is already active
When a valid iPad handoff event arrives
Then the event is queued or rejected visibly and does not replace the active student.

## 技術約束

- Frontend remains Vite 8 + React 19 + TypeScript 6 + Zustand 5.
- The first implementation pass remains pure frontend; order flow must work without backend connectivity.
- Transaction math uses `amount = paidAmount - mealPrice`; no alternate balance formula is allowed.
- Business date must be a domain field captured at transaction creation, not inferred later from UI date display.
- POS flow state should be explicit and testable instead of spread across unrelated `useState` flags where possible.
- Transaction creation should delegate to pure domain functions/reducers that unit tests can cover independently from React rendering.
- Keyboard shortcuts must not bypass disabled or read-only states.
- Existing test chain applies from `frontend/`: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build`.

## UI/UX 要求

- The primary screen is the actual POS, not a landing page or setup wizard.
- The idle state shows today's menu, price, vendor, order count, sync state, and a focused search input.
- The selected-student state shows id, name, balance, today order count, transaction preview, payment input, quick amount buttons, and confirmation/cancel controls.
- Keyboard operation is first-class: search input, suggestions, mode shortcuts, arrows, Enter, and Escape must remain predictable.
- Duplicate, destructive, and historical-lock states are blocking and visually distinct.
- After completion, student-private financial data must disappear before the next person is served.
- Offline/queued sync information should be visible but should not interrupt service unless a conflict requires operator action.

## 與其他模組的介面

### 輸入

- Active `StudentAccount` search results and balances from `student-account-management`.
- Active `TodayMenu` and menu/vendor snapshots from `menu-and-vendor-management`.
- Existing same-day ledger rows from `order-ledger-and-cash-close` to determine duplicate/cancel availability.
- Sync status and pending-queue state from `google-sheets-sync-and-offline`.
- Optional iPad handoff events from `face-auth-ipad-handoff`.

### 輸出

- Draft transaction intent before confirmation.
- Committed transaction rows for `order-ledger-and-cash-close`.
- Balance-changing events for `student-account-management`.
- Pending sync queue entries for `google-sheets-sync-and-offline`.
- UI state events for success, duplicate warning, read-only lock, and queued/offline status.

### 依賴關係

- Depends on `student-account-management` for active student identity and balance.
- Depends on `menu-and-vendor-management` for menu price and snapshots.
- Feeds `order-ledger-and-cash-close` with transaction rows.
- Feeds `google-sheets-sync-and-offline` with locally committed operations.
- Receives optional student preselection from `face-auth-ipad-handoff`.

## 建議狀態與型別

```ts
export type PosMode = 'order' | 'topup' | 'cancel';
export type PosSelectionSource = 'manual' | 'scan' | 'ipad';
export type PosFlowState =
  | { kind: 'idle' }
  | { kind: 'student_selected'; studentId: string; mode: PosMode; source: PosSelectionSource }
  | { kind: 'duplicate_warning'; studentId: string; mode: 'order' }
  | { kind: 'committing'; studentId: string; mode: PosMode }
  | { kind: 'success'; transactionId: string }
  | { kind: 'historical_readonly'; businessDate: string }
  | { kind: 'error'; studentId?: string; message: string; retryable: boolean };

export interface TransactionIntent {
  businessDate: string;
  studentId: string;
  type: PosMode;
  mealPrice: number;
  paidAmount: number;
  note: string;
  sourceDevice: 'pc' | 'barcode_scanner' | 'ipad_handoff';
}
```

## 現有實作對照

- Current main flow: `frontend/src/App.tsx`.
- Current UI components: `SearchBox`, `CustomerCard`, `ActionBar`, `ConfirmBanner`, `RecentStrip` in `frontend/src/components/pos-components.tsx`.
- Current store action: `processTransaction` in `frontend/src/store/posStore.ts`.
- Current strengths: high-fidelity UI, working keyboard shortcuts, duplicate warning, date lock, local persistence.
- Current gaps: state machine is implicit, transaction schema lacks source/sync/operator/snapshots, no iPad event receiver, no UI tests for keyboard flow, fake sync only.

## 不在本模組範圍

- Student roster import/admin maintenance; covered by `student-account-management`.
- Menu/vendor CRUD; covered by `menu-and-vendor-management`.
- Daily close and audited correction policy; covered by `order-ledger-and-cash-close`.
- Google Sheets transport and retry; covered by `google-sheets-sync-and-offline`.
- Face recognition implementation; covered by `face-auth-ipad-handoff`.
