---
required_reads:
  - dispatch_books/talented-easyorder/PROJECT.md §5
  - dispatch_books/talented-easyorder/IMPL.md
  - docs/superpowers/plans/2026-05-30-split-posStore-monolith.md
---

# Plan: 11 Component Unit Tests on Refactored Architecture

## Summary

Closes #104. Add unit tests for 11 untested components, prioritizing cash-flow-critical components (EditTransactionModal, CashClosePanel, ReportSummaryStats).

## Complexity: complex+

Store-aware components, 11 test files, mock strategy varies by component coupling.

## Architecture Context

After #97 posStore split, the store is composed from `posActions/transactionActions`, `posActions/sessionActions`, `posActions/menuActions` spread into `create<PosState>()(persist(...))`. Components consume via `usePosStore(selector)`.

After #98, components use hook selectors instead of `getState()` — tests can mock `usePosStore` directly via `vi.mock`.

After #113, `EditTransactionModal.onSave` takes `(transactionId, updates)` — tests must match new signature.

## Test Strategy

### Pattern A: Pure Prop Components (no store mock needed)

Rely solely on props. Simplest, fastest. Used for:
- `EditTransactionModal.test.tsx`
- `ReportSummaryStats.test.tsx`
- `ExportActions.test.tsx`
- `ReopenDialog.test.tsx`
- `ReportDateRangeControls.test.tsx`

### Pattern B: Store-Connected Components (mock usePosStore)

Mock `usePosStore` with `vi.mock('../../store/posStore', ...)` returning controlled state. Used for:
- `TodayDashboard.test.tsx`
- `AuditTrailTable.test.tsx`
- `SettlementHistoryTable.test.tsx`
- `CashClosePanel.test.tsx` (store + internal state)

### Pattern C: Pure Presentation Components

Shallow render with mock props, verify DOM. Used for:
- `SyncStatusBadge.test.tsx`
- `MainLayout.test.tsx`

## Affected Files

### New files (11 test files):

1. **`src/components/__tests__/EditTransactionModal.test.tsx`** — ~25 tests
2. **`src/components/report/__tests__/CashClosePanel.test.tsx`** — ~20 tests
3. **`src/components/report/__tests__/ReportSummaryStats.test.tsx`** — ~10 tests
4. **`src/components/__tests__/TodayDashboard.test.tsx`** — ~15 tests
5. **`src/components/report/__tests__/AuditTrailTable.test.tsx`** — ~10 tests
6. **`src/components/report/__tests__/SettlementHistoryTable.test.tsx`** — ~10 tests
7. **`src/components/report/__tests__/ExportActions.test.tsx`** — ~5 tests
8. **`src/components/report/__tests__/ReopenDialog.test.tsx`** — ~5 tests
9. **`src/components/report/__tests__/ReportDateRangeControls.test.tsx`** — ~5 tests
10. **`src/components/__tests__/SyncStatusBadge.test.tsx`** — ~5 tests
11. **`src/components/__tests__/MainLayout.test.tsx`** — ~3 tests

Total: ~113 tests across 11 files.

### Modified files: none (test-only change)

### Affected callers: none (test files are leaf nodes)

### Related tests: N/A (these are the tests)

## Test Cases by Component

### 1. EditTransactionModal (Priority HIGH — cash flow)

**Pattern A** (pure props). Props: `open`, `transaction`, `onClose`, `onSave`.

- Does not render when `transaction` is null
- Does not render when `open` is false
- Pre-fills mealPrice, paidAmount, note from transaction on mount
- Updates form fields on prop change (new transaction)
- Calls onSave with (transactionId, {mealPrice, paidAmount, note}) on save
- Calls onClose after save
- Shows validation error when mealPrice is negative
- Shows validation error when mealPrice is not integer
- Shows validation error when paidAmount is negative
- Shows validation error when paidAmount is not integer
- Does not call onSave when validation fails
- Calls onClose when cancel button clicked
- Calls onClose when modal overlay dismissed (if Modal supports it)
- Handles zero values (mealPrice=0, paidAmount=0)
- Handles empty note
- Handles note with special characters
- Handles large values (mealPrice=9999, paidAmount=9999)
- Re-initializes form when transaction prop changes (edit different tx)
- Modal title is correct
- Save button text is correct
- Cancel button text is correct
- Number fields show "元" suffix
- Calls onSave with correct transactionId from the passed transaction

### 2. CashClosePanel (Priority HIGH — cash flow)

**Pattern B** (mock store + internal state). Props: `totals`, `businessDate`, `dateStatus`, `hasQueuedRows`, `hasFailedConflict`, `openingCash`, `onClose`, `queuedRowCount`.

- Shows "已關閉" pill and disables input when dateStatus is 'closed'
- Shows "已重開" pill when dateStatus is 'reopened'
- Displays openingCash formatted
- Displays netCash from totals
- Computes expectedDrawerCash = openingCash + netCash
- Shows "—" difference when no cash entered
- Shows "✓ 平" when countedCash equals expectedDrawerCash
- Shows positive difference in green when countedCash > expected
- Shows negative difference in warn when countedCash < expected
- "確認關帳" button disabled when note is empty
- "確認關帳" button disabled when hasFailedConflict is true
- "確認關帳" button disabled when hasQueuedRows and not queuedAccepted
- Shows queued rows checkbox when hasQueuedRows and queuedRowCount > 0
- "確認關帳" button enabled when hasQueuedRows and queuedAccepted
- Shows confirmation dialog on "確認關帳" click
- Confirmation dialog shows businessDate, openingCash, netCash, expectedDrawerCash, countedCash, difference
- Confirmation dialog calls onClose(countedCash, note) on confirm
- Clicking overlay dismisses confirmation dialog
- Shows failed conflict warning when hasFailedConflict
- Cash input field accepts numeric values

### 3. ReportSummaryStats (Priority HIGH — cash flow)

**Pattern A** (pure props). Props: `totals`, `itemName`, `counterCashFlow?`.

- Displays orderCount with "份" suffix
- Displays itemName as subtitle
- Displays totalIncome with "+$" prefix
- Displays totalExpense with "−$" prefix
- Displays netCash formatted
- Displays newDebt formatted
- Displays transactionCount
- Does not render counter cash flow section when counterCashFlow is undefined
- Does not render counter cash flow section when incomeCount=0 and expenseCount=0
- Renders counter income when incomeCount > 0 (amount + count)
- Renders counter expense when expenseCount > 0 (amount + count)
- Handles zero totals (all fields 0)

### 4. TodayDashboard (Priority MEDIUM — display logic)

**Pattern B** (mock store). Props: `onClose`.

- Renders system date in YYYY-MM-DD format
- Displays transaction count from filtered today transactions
- Displays order count from totals
- Displays cash collected from totals
- Displays net cash from totals
- Shows "營業中" when dateStatus is 'open'
- Shows "已關帳" when dateStatus is 'closed'
- Shows "已重開" when dateStatus is 'reopened'
- Shows settlement closer and time when todaySettlement exists
- Shows queued count (0 = "已全數同步", >0 = "尚有資料未同步")
- Shows correction count
- Shows void count
- Shows latest 5 transactions sorted by createdAt desc
- Shows "今日尚無交易紀錄" when no transactions today
- Calls onClose when overlay clicked
- Calls onClose when close button clicked
- Panel click does NOT call onClose (stopPropagation)

### 5. AuditTrailTable (Priority MEDIUM)

**Pattern B** (mock store).

- Shows "尚無稽核紀錄" when auditEvents is empty
- Renders events sorted by createdAt desc
- Shows event type label (編輯/更正/作廢/刪除/關帳/重開/匯出 CSV/列印)
- Shows correct pill class per event type
- Shows operatorId
- Shows entity type + truncated entityId
- Shows before/after summary: "(新建)" when before is null
- Shows before/after summary: "(已刪除)" when after is null
- Shows before/after summary: field changes joined by "; "
- Shows before/after summary: "-" when no changes
- Shows businessDate

### 6. SettlementHistoryTable (Priority MEDIUM)

**Pattern B** (mock store).

- Shows "尚無關帳紀錄" when dailySettlements is empty
- Renders settlements sorted by businessDate desc
- Shows status labels (已關帳/已重開/營業中)
- Shows orderCount, expectedCash, countedCash, difference
- Shows difference with "+" prefix when positive
- Shows difference in warn style when non-zero
- Shows closedBy and closedAt
- Expands row on click to show details (transactionCount, note, syncStatus)
- Collapses expanded row on second click
- Shows reopen info (reopenedBy, reopenedAt, reopenReason) when present

### 7. ExportActions (Priority MEDIUM)

**Pattern A** (pure props). Props: `onExportCsv`, `onPrint`, `onPushCloud?`.

- Renders "列印" and "匯出 CSV" buttons
- Calls onPrint when "列印" clicked
- Calls onExportCsv when "匯出 CSV" clicked
- Does not render "推送至雲端" when onPushCloud is undefined
- Renders "推送至雲端" when onPushCloud is provided
- Calls onPushCloud when "推送至雲端" clicked

### 8. ReopenDialog (Priority MEDIUM)

**Pattern A** (pure props). Props: `businessDate`, `onReopen`, `onCancel`.

- Displays businessDate in title
- "確認重開" button disabled when reason is empty
- "確認重開" button enabled when reason has text
- Calls onReopen(reason) when confirm clicked
- Calls onCancel when cancel clicked
- Calls onCancel when overlay clicked
- Dialog box click does NOT call onCancel (stopPropagation)
- Shows required field hint on reason input

### 9. ReportDateRangeControls (Priority MEDIUM)

**Pattern A** (pure props). Props: `dateRange`, `setDateRange`, `todayStr`, `txCount`, `customStart`, `customEnd`, `setCustomStart`, `setCustomEnd`.

- Renders 4 date range buttons (today/week/month/custom)
- Active button has "rpt-on" class
- Calls setDateRange with correct id on button click
- Shows custom date inputs when dateRange is 'custom'
- Calls setCustomStart on custom start input change
- Calls setCustomEnd on custom end input change
- Shows tx count in today mode

### 10. SyncStatusBadge (Priority LOW — pure presentation)

- Renders sync status indicator
- Shows correct status text per sync state

### 11. MainLayout (Priority LOW — pure presentation)

- Renders children
- Renders layout structure

## Test Impact

Existing tests must not be affected (test-only change). Verify with:
```bash
cd frontend && npx vitest run
```

## Pre-implementation Checks

1. Verify `npm ci` passes in frontend/
2. Verify existing tests all pass: `npx vitest run`
3. Confirm mock patterns match existing `__tests__/screens.test.tsx` and `pos-components.test.tsx`
4. Confirm `EditTransactionModal.onSave` signature matches post-#113: `(transactionId: string, updates: {...}) => void`
