# E Mode Rework + Delete Confirmation + Dual Column Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework E mode from "取消訂餐" (cancel order) to "訂餐狀況" (order status) with DRY dual-column income/expense display, delete confirmation dialogs, and RecentStrip auto-switch.

**Architecture:** Extract shared `transactionUtils.ts` (getIncome/getExpense helpers) and `TransactionStatusView` component for dual-column (收入/支出) display. Used by both CustomerCard (E mode) and RecentStrip (detail rows). E uses focusZone `'view-status'` (NOT `'mode-*'` prefix — avoids collision with Enter handler's `startsWith('mode-')` branch in useAppNavigationShortcuts). Delete actions get confirmation dialogs for all transaction types.

**Tech Stack:** React, TypeScript, Vitest, existing UI patterns (CancelOrderDialog, LedgerGroup)

**Spec reference:** GitHub issues #400, #401, #402 (capability spec)

**Closes:** #400, #401, #402

---

## File Structure

### New Files
- `frontend/src/domain/transactionUtils.ts` — Shared getIncome/getExpense helpers (DRY: used by TransactionStatusView + RecentStrip)
- `frontend/src/components/pos/TransactionStatusView.tsx` — Shared component: renders a student's today transactions in dual-column (收入/支出) format with optional action buttons
- `frontend/src/components/pos/DeleteConfirmDialog.tsx` — Generic delete confirmation dialog for payment/expense transactions (order deletion reuses existing CancelOrderDialog)
- `frontend/src/domain/__tests__/transactionUtils.test.ts` — Tests for getIncome/getExpense
- `frontend/src/components/pos/__tests__/TransactionStatusView.test.tsx` — Tests for TransactionStatusView
- `frontend/src/components/pos/__tests__/DeleteConfirmDialog.test.tsx` — Tests for DeleteConfirmDialog

### Modified Files
- `frontend/src/components/pos/ActionBar.tsx` — Rename E button label; change onClick to mode-switch
- `frontend/src/components/pos/CustomerCard.tsx` — Show TransactionStatusView in E mode; remove cancel hint
- `frontend/src/components/pos/RecentStrip.tsx` — Use dual-column layout from TransactionStatusView pattern; integrate delete confirmation
- `frontend/src/components/PosColumn.tsx` — Wire new E mode behavior; add delete confirmation state; auto-switch on RecentStrip student click
- `frontend/src/components/pos-components.tsx` — Export new components
- `frontend/src/hooks/useKeyboardShortcuts.ts` — Change E key to set focusZone='view-status'
- `frontend/src/hooks/useAppNavigationShortcuts.ts` — Update modes array: 'btn-delete-order' → 'view-status'; add explicit guard in Enter handler (view-status = no-op, NOT matching startsWith('mode-'))
- `frontend/src/hooks/useCancelDialog.ts` — Add openCancelConfirmForTx(tx) to handle RecentStrip order deletion
- `frontend/src/styles/pos.css` — Add dual-column layout styles
- `frontend/src/App.tsx` — Wire DeleteConfirmDialog state + new focusZone value
- `frontend/src/__tests__/pcPosFlow.integration.test.tsx` — Update E key integration tests
- `frontend/src/__tests__/pcPosSafety.integration.test.tsx` — Update cancel flow integration tests

### Test Files to Update
- `frontend/src/components/__tests__/pos-components.test.tsx` — ActionBar label, new E mode behavior
- `frontend/src/hooks/__tests__/useAppNavigationShortcuts.test.ts` — Updated modes array + Enter guard
- `frontend/src/components/pos/__tests__/CustomerCard.test.tsx` — E mode status view
- `frontend/src/__tests__/pcPosFlow.integration.test.tsx` — E key no longer triggers cancel
- `frontend/src/__tests__/pcPosSafety.integration.test.tsx` — Cancel flow via RecentStrip delete

---

## Task 1: Shared Transaction Utils + Dual-Column Style + TransactionStatusView Component

**Files:**
- Create: `frontend/src/domain/transactionUtils.ts`
- Create: `frontend/src/domain/__tests__/transactionUtils.test.ts`
- Create: `frontend/src/components/pos/TransactionStatusView.tsx`
- Create: `frontend/src/components/pos/__tests__/TransactionStatusView.test.tsx`
- Modify: `frontend/src/styles/pos.css`
- Modify: `frontend/src/components/pos-components.tsx`

- [ ] **Step 1: Create transactionUtils.ts with tests**

```ts
// frontend/src/domain/transactionUtils.ts
import type { LedgerTransaction } from './ledger';

/** Returns income amount for display, or null if this tx has no income component */
export function getIncome(tx: LedgerTransaction): number | null {
  if (tx.type === 'payment') return tx.paidAmount;
  if (tx.type === 'order' && tx.paidAmount > 0) return tx.paidAmount;
  return null;
}

/** Returns expense amount for display, or null if this tx has no expense component */
export function getExpense(tx: LedgerTransaction): number | null {
  if (tx.type === 'order') return tx.mealPrice;
  if (tx.type === 'expense') return tx.amount;
  return null;
}
```

```ts
// frontend/src/domain/__tests__/transactionUtils.test.ts
import { getIncome, getExpense } from '../transactionUtils';

const baseTx = {
  transactionId: 'tx-1', businessDate: '2026-06-18', createdAt: '2026-06-18T09:00:00Z',
  studentId: 's1', studentNameSnapshot: '王柏翰', menuNameSnapshot: '', vendorNameSnapshot: '',
  sourceDevice: 'pc' as const, syncStatus: 'synced' as any, revision: 1, note: '',
  afterBalance: 0, mealPrice: 0, paidAmount: 0, amount: 0,
};

describe('getIncome', () => {
  it('returns paidAmount for payment', () => {
    expect(getIncome({ ...baseTx, type: 'payment', paidAmount: 500 })).toBe(500);
  });
  it('returns paidAmount for order with payment', () => {
    expect(getIncome({ ...baseTx, type: 'order', paidAmount: 90, mealPrice: 90 })).toBe(90);
  });
  it('returns null for order without payment', () => {
    expect(getIncome({ ...baseTx, type: 'order', paidAmount: 0, mealPrice: 90 })).toBeNull();
  });
  it('returns null for expense', () => {
    expect(getIncome({ ...baseTx, type: 'expense', amount: 100 })).toBeNull();
  });
});

describe('getExpense', () => {
  it('returns mealPrice for order', () => {
    expect(getExpense({ ...baseTx, type: 'order', mealPrice: 90 })).toBe(90);
  });
  it('returns amount for expense', () => {
    expect(getExpense({ ...baseTx, type: 'expense', amount: 100 })).toBe(100);
  });
  it('returns null for payment', () => {
    expect(getExpense({ ...baseTx, type: 'payment', paidAmount: 500 })).toBeNull();
  });
});
```

Run: `cd frontend && npx vitest run src/domain/__tests__/transactionUtils.test.ts --reporter verbose 2>&1 | tail -20`
Expected: 7 tests PASS

- [ ] **Step 2: Write failing tests for TransactionStatusView**

```tsx
// frontend/src/components/pos/__tests__/TransactionStatusView.test.tsx
import { render, screen } from '@testing-library/react';
import { TransactionStatusView } from '../../pos-components';
import type { LedgerTransaction } from '../../../domain/ledger';

// Helper to create mock transactions
function mockTx(overrides: Partial<LedgerTransaction>): LedgerTransaction {
  return {
    transactionId: 'tx-1',
    businessDate: '2026-06-18',
    studentId: 's1',
    studentNameSnapshot: '王柏翰',
    type: 'order',
    mealPrice: 90,
    paidAmount: 0,
    afterBalance: -90,
    menuNameSnapshot: '雞腿便當',
    note: '',
    createdAt: '2026-06-18T09:13:41Z',
    operatorId: 'op1',
    ...overrides,
  } as LedgerTransaction;
}

describe('TransactionStatusView', () => {
  it('renders column headers 收入 and 支出', () => {
    render(<TransactionStatusView transactions={[]} />);
    expect(screen.getByText('收入')).toBeInTheDocument();
    expect(screen.getByText('支出')).toBeInTheDocument();
  });

  it('renders order-only transaction in 支出 column', () => {
    const txs = [mockTx({ type: 'order', mealPrice: 90, paidAmount: 0 })];
    render(<TransactionStatusView transactions={txs} />);
    // 支出 column shows -90
    expect(screen.getByText('-90')).toBeInTheDocument();
    // 收入 column is empty for this row
    expect(screen.queryByText('+90')).not.toBeInTheDocument();
  });

  it('renders payment transaction in 收入 column', () => {
    const txs = [mockTx({ type: 'payment', mealPrice: 0, paidAmount: 500 })];
    render(<TransactionStatusView transactions={txs} />);
    expect(screen.getByText('+500')).toBeInTheDocument();
  });

  it('renders order with payment in both columns', () => {
    const txs = [mockTx({ type: 'order', mealPrice: 90, paidAmount: 90 })];
    render(<TransactionStatusView transactions={txs} />);
    expect(screen.getByText('+90')).toBeInTheDocument();
    expect(screen.getByText('-90')).toBeInTheDocument();
  });

  it('renders transaction type badge', () => {
    const txs = [mockTx({ type: 'order' })];
    render(<TransactionStatusView transactions={txs} />);
    expect(screen.getByText('訂')).toBeInTheDocument();
  });

  it('renders time from createdAt', () => {
    const txs = [mockTx({ createdAt: '2026-06-18T09:13:41Z' })];
    render(<TransactionStatusView transactions={txs} />);
    // Time formatted as HH:MM:SS (locale-dependent, check substring)
    expect(screen.getByText(/09:13/)).toBeInTheDocument();
  });

  it('renders empty state when no transactions', () => {
    render(<TransactionStatusView transactions={[]} />);
    expect(screen.getByText('今日無交易紀錄')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/pos/__tests__/TransactionStatusView.test.tsx --reporter verbose 2>&1 | tail -20`
Expected: FAIL — module not found

- [ ] **Step 3: Add dual-column CSS styles**

Add to `frontend/src/styles/pos.css`:

```css
/* --- Transaction Status View (dual column) --- */
.tx-status-view {
  width: 100%;
}
.tx-status-header {
  display: grid;
  grid-template-columns: 100px 60px 1fr 1fr;
  gap: 8px;
  padding: 4px 8px;
  font-size: 0.85rem;
  color: var(--text-secondary, #888);
  border-bottom: 1px solid var(--border-light, #eee);
}
.tx-status-row {
  display: grid;
  grid-template-columns: 100px 60px 1fr 1fr;
  gap: 8px;
  padding: 6px 8px;
  align-items: center;
  font-size: 0.95rem;
}
.tx-col-income {
  text-align: right;
  color: var(--income-color, #2e7d32);
  font-weight: 600;
}
.tx-col-expense {
  text-align: right;
  color: var(--expense-color, #c62828);
  font-weight: 600;
}
.tx-status-empty {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary, #888);
}
```

- [ ] **Step 4: Implement TransactionStatusView**

```tsx
// frontend/src/components/pos/TransactionStatusView.tsx
import React from 'react';
import type { LedgerTransaction } from '../../domain/ledger';
import { getIncome, getExpense } from '../../domain/transactionUtils';

interface TransactionStatusViewProps {
  transactions: LedgerTransaction[];
  actions?: (tx: LedgerTransaction) => React.ReactNode;
}

const TYPE_LABELS: Record<string, string> = {
  order: '訂',
  payment: '繳',
  expense: '支',
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export const TransactionStatusView = React.memo(function TransactionStatusView({
  transactions,
  actions,
}: TransactionStatusViewProps) {
  if (transactions.length === 0) {
    return <div className="tx-status-empty">今日無交易紀錄</div>;
  }

  return (
    <div className="tx-status-view">
      <div className="tx-status-header">
        <span />
        <span />
        <span className="tx-col-income">收入</span>
        <span className="tx-col-expense">支出</span>
      </div>
      {transactions.map((tx) => {
        const income = getIncome(tx);
        const expense = getExpense(tx);
        return (
          <div key={tx.transactionId} className="tx-status-row">
            <span className="tx-time">{formatTime(tx.createdAt)}</span>
            <span className={'tx-type-badge tx-type-' + tx.type}>{TYPE_LABELS[tx.type] ?? tx.type}</span>
            <span className="tx-col-income">{income != null ? `+${income}` : ''}</span>
            <span className="tx-col-expense">{expense != null ? `-${expense}` : ''}</span>
            {actions?.(tx)}
          </div>
        );
      })}
    </div>
  );
});
```

- [ ] **Step 5: Export from pos-components.tsx**

Add to `frontend/src/components/pos-components.tsx`:
```tsx
export { TransactionStatusView } from './pos/TransactionStatusView';
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/pos/__tests__/TransactionStatusView.test.tsx --reporter verbose 2>&1 | tail -30`
Expected: 7 tests PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/pos/TransactionStatusView.tsx \
       frontend/src/components/pos/__tests__/TransactionStatusView.test.tsx \
       frontend/src/styles/pos.css \
       frontend/src/components/pos-components.tsx
git commit -m "feat(pos): add TransactionStatusView dual-column component (#400, #402)"
```

---

## Task 2: DeleteConfirmDialog for Non-Order Transactions

**Files:**
- Create: `frontend/src/components/pos/DeleteConfirmDialog.tsx`
- Create: `frontend/src/components/pos/__tests__/DeleteConfirmDialog.test.tsx`
- Modify: `frontend/src/components/pos-components.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// frontend/src/components/pos/__tests__/DeleteConfirmDialog.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { DeleteConfirmDialog } from '../../pos-components';

describe('DeleteConfirmDialog', () => {
  const baseProps = {
    open: true,
    studentName: '王柏翰',
    transactionType: 'payment' as const,
    amount: 500,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it('renders confirmation message with student name', () => {
    render(<DeleteConfirmDialog {...baseProps} />);
    expect(screen.getByText(/王柏翰/)).toBeInTheDocument();
  });

  it('shows payment-specific message for payment type', () => {
    render(<DeleteConfirmDialog {...baseProps} transactionType="payment" />);
    expect(screen.getByText(/繳費/)).toBeInTheDocument();
  });

  it('shows expense-specific message for expense type', () => {
    render(<DeleteConfirmDialog {...baseProps} transactionType="expense" />);
    expect(screen.getByText(/支出/)).toBeInTheDocument();
  });

  it('shows amount in message', () => {
    render(<DeleteConfirmDialog {...baseProps} amount={500} />);
    expect(screen.getByText(/500/)).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button clicked', () => {
    const onConfirm = vi.fn();
    render(<DeleteConfirmDialog {...baseProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('確認刪除'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('calls onCancel when cancel button clicked', () => {
    const onCancel = vi.fn();
    render(<DeleteConfirmDialog {...baseProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('返回'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('does not render when open is false', () => {
    render(<DeleteConfirmDialog {...baseProps} open={false} />);
    expect(screen.queryByText(/王柏翰/)).not.toBeInTheDocument();
  });

  it('handles Enter key to confirm', () => {
    const onConfirm = vi.fn();
    render(<DeleteConfirmDialog {...baseProps} onConfirm={onConfirm} />);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalled();
  });

  it('handles Escape key to cancel', () => {
    const onCancel = vi.fn();
    render(<DeleteConfirmDialog {...baseProps} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/pos/__tests__/DeleteConfirmDialog.test.tsx --reporter verbose 2>&1 | tail -20`
Expected: FAIL

- [ ] **Step 3: Implement DeleteConfirmDialog**

```tsx
// frontend/src/components/pos/DeleteConfirmDialog.tsx
import React, { useEffect, useCallback } from 'react';

interface DeleteConfirmDialogProps {
  open: boolean;
  studentName: string;
  transactionType: 'payment' | 'expense';
  amount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

const TYPE_LABELS = { payment: '繳費', expense: '支出' } as const;

export const DeleteConfirmDialog = React.memo(function DeleteConfirmDialog({
  open, studentName, transactionType, amount, onConfirm, onCancel,
}: DeleteConfirmDialogProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  }, [open, onConfirm, onCancel]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!open) return null;

  const label = TYPE_LABELS[transactionType];

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={`刪除${label}確認`}>
      <div className="modal-box cancel-dialog">
        <h3>刪除{label}紀錄</h3>
        <p>確定要刪除 {studentName} 的{label}紀錄（${amount} 元）嗎？</p>
        <div className="dialog-actions">
          <button className="btn-ghost" onClick={onCancel}>返回</button>
          <button className="btn-danger" onClick={onConfirm}>確認刪除</button>
        </div>
      </div>
    </div>
  );
});
```

- [ ] **Step 4: Export from pos-components.tsx**

Add to `frontend/src/components/pos-components.tsx`:
```tsx
export { DeleteConfirmDialog } from './pos/DeleteConfirmDialog';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/pos/__tests__/DeleteConfirmDialog.test.tsx --reporter verbose 2>&1 | tail -20`
Expected: 9 tests PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/pos/DeleteConfirmDialog.tsx \
       frontend/src/components/pos/__tests__/DeleteConfirmDialog.test.tsx \
       frontend/src/components/pos-components.tsx
git commit -m "feat(pos): add DeleteConfirmDialog for payment/expense deletion (#401)"
```

---

## Task 3: E Mode Rework — ActionBar + Keyboard + Navigation

**Files:**
- Modify: `frontend/src/components/pos/ActionBar.tsx` (L35-44: label + onClick)
- Modify: `frontend/src/hooks/useKeyboardShortcuts.ts` (L86-98: E handler)
- Modify: `frontend/src/hooks/useAppNavigationShortcuts.ts` (L89: modes array, L69-70: Enter handler)
- Modify: `frontend/src/components/__tests__/pos-components.test.tsx`
- Modify: `frontend/src/hooks/__tests__/useAppNavigationShortcuts.test.ts`

- [ ] **Step 1: Write failing tests for ActionBar E button rename**

In `frontend/src/components/__tests__/pos-components.test.tsx`, update ActionBar test:

```tsx
// Find the existing ActionBar 'renders delete order button' test and update expected label
it('renders E button with 訂餐狀況 label', () => {
  render(
    <ActionBar mode="order" setMode={vi.fn()} onStatusMode={vi.fn()} focusZone="mode-order" />
  );
  expect(screen.getByText('訂餐狀況')).toBeInTheDocument();
  expect(screen.getByText('E')).toBeInTheDocument();
});

it('calls onStatusMode when E button clicked', () => {
  const onStatusMode = vi.fn();
  render(
    <ActionBar mode="order" setMode={vi.fn()} onStatusMode={onStatusMode} focusZone="mode-order" />
  );
  fireEvent.click(screen.getByText('訂餐狀況'));
  expect(onStatusMode).toHaveBeenCalled();
});
```

- [ ] **Step 2: Write failing tests for navigation modes array update**

In `frontend/src/hooks/__tests__/useAppNavigationShortcuts.test.ts`, update the modes array test to use `view-status` instead of `btn-delete-order`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/__tests__/pos-components.test.tsx src/hooks/__tests__/useAppNavigationShortcuts.test.ts --reporter verbose 2>&1 | tail -30`
Expected: FAIL

- [ ] **Step 4: Update ActionBar.tsx**

Change ActionBar props and E button:
- Replace `onDeleteOrder?: () => void` with `onStatusMode?: () => void`
- Rename label from `取消訂餐` to `訂餐狀況`
- Change `onClick` from `onDeleteOrder` to `onStatusMode`
- Update highlight: `focusZone === 'view-status'` instead of `focusZone === 'btn-delete-order'`

```tsx
interface ActionBarProps {
  mode: PosMode;
  setMode: (mode: PosMode) => void;
  onStatusMode?: () => void;
  focusZone: string;
}

// E button section:
{onStatusMode && (
  <button
    className={'mode ' + (focusZone === 'view-status' ? 'mode-on mode-focus' : '')}
    onClick={onStatusMode}
    style={{ flex: 1 }}
  >
    <span className="mode-key">E</span>
    <span className="mode-lbl">訂餐狀況</span>
  </button>
)}
```

- [ ] **Step 5: Update useKeyboardShortcuts.ts E handler**

Change `setFocusZoneRef.current?.('btn-delete-order')` to `setFocusZoneRef.current?.('view-status')`.

- [ ] **Step 6: Update useAppNavigationShortcuts.ts**

Change modes array: `'btn-delete-order'` → `'view-status'`.
Update Enter handler: `focusZone === 'btn-delete-order'` → `focusZone === 'view-status'` (but Enter on view-status should be a no-op, not call cancelOrder — remove the cancelOrder call for this zone).

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/__tests__/pos-components.test.tsx src/hooks/__tests__/useAppNavigationShortcuts.test.ts --reporter verbose 2>&1 | tail -30`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/pos/ActionBar.tsx \
       frontend/src/hooks/useKeyboardShortcuts.ts \
       frontend/src/hooks/useAppNavigationShortcuts.ts \
       frontend/src/components/__tests__/pos-components.test.tsx \
       frontend/src/hooks/__tests__/useAppNavigationShortcuts.test.ts
git commit -m "feat(pos): rename E button to 訂餐狀況, update keyboard/nav (#400)"
```

---

## Task 4: CustomerCard E Mode Status View

**Files:**
- Modify: `frontend/src/components/pos/CustomerCard.tsx` (L73-167: bill-summary section)
- Modify: `frontend/src/components/PosColumn.tsx` (pass transactions + focusZone wiring)
- Modify: `frontend/src/components/pos/__tests__/CustomerCard.test.tsx`

- [ ] **Step 1: Write failing tests for E mode status view**

```tsx
// Add to frontend/src/components/pos/__tests__/CustomerCard.test.tsx
import { TransactionStatusView } from '../../pos-components';

it('shows TransactionStatusView when focusZone is view-status', () => {
  render(
    <CustomerCard
      {...defaultProps}
      focusZone="view-status"
      studentTransactions={[mockOrderTx]}
    />
  );
  // Should show dual-column headers
  expect(screen.getByText('收入')).toBeInTheDocument();
  expect(screen.getByText('支出')).toBeInTheDocument();
  // Should NOT show bill summary
  expect(screen.queryByText('結帳明細')).not.toBeInTheDocument();
});

it('hides pay input when focusZone is view-status', () => {
  render(
    <CustomerCard
      {...defaultProps}
      focusZone="view-status"
      studentTransactions={[]}
    />
  );
  expect(screen.queryByLabelText('付款金額')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Update CustomerCard.tsx**

Add `studentTransactions?: LedgerTransaction[]` to props. In the bill-summary section:

```tsx
{focusZone === 'view-status' ? (
  <TransactionStatusView transactions={studentTransactions ?? []} />
) : (
  // existing bill-summary + pay-panel code
)}
```

Remove the old cancel hint (`即將取消訂餐，按 Enter 確認或 Escape 取消`).

- [ ] **Step 4: Update PosColumn.tsx to pass studentTransactions**

Compute `studentTransactions` from `recentGroups` (find the group matching `picked?.studentId`, use its `.transactions`):

```tsx
const studentTransactions = picked
  ? recentGroups.find(g => g.studentId === picked.studentId)?.transactions ?? []
  : [];

// Pass to CustomerCard:
<CustomerCard
  ...
  studentTransactions={studentTransactions}
/>
```

- [ ] **Step 5: Run tests**

Run: `cd frontend && npx vitest run src/components/pos/__tests__/CustomerCard.test.tsx --reporter verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/pos/CustomerCard.tsx \
       frontend/src/components/PosColumn.tsx \
       frontend/src/components/pos/__tests__/CustomerCard.test.tsx
git commit -m "feat(pos): show TransactionStatusView in E mode (#400)"
```

---

## Task 5: RecentStrip Dual-Column + Delete Confirmation Wiring

**Files:**
- Modify: `frontend/src/components/pos/RecentStrip.tsx` — Dual-column layout for detail rows, import getIncome/getExpense from transactionUtils
- Modify: `frontend/src/components/PosColumn.tsx` — Wire delete confirmation dialogs + auto-switch E mode on student click
- Modify: `frontend/src/hooks/useCancelDialog.ts` — Add `openCancelConfirmForTx(tx)` that selects student then opens CancelOrderDialog
- Modify: `frontend/src/App.tsx` — Wire DeleteConfirmDialog + deleteConfirmTx state

- [ ] **Step 1: Write failing tests for RecentStrip dual-column**

Update RecentStrip tests to expect dual-column headers and income/expense display.

- [ ] **Step 2: Write failing tests for delete confirmation flow**

Test that `handleRecentDeleteClick` for payment/expense opens a confirmation dialog instead of deleting immediately.

- [ ] **Step 3: Update RecentStrip detail rows to dual-column format**

Replace the single amount column with dual 收入/支出 columns. Import `getIncome`/`getExpense` from `../../domain/transactionUtils` (DRY — same helpers as TransactionStatusView). Use same CSS classes `.tx-col-income`/`.tx-col-expense`.

Add column headers (收入/支出) at the top of the expanded detail section.

- [ ] **Step 4: Update PosColumn.tsx — delete confirmation wiring**

Replace `handleRecentDeleteClick` to show confirmation:
- Order type → open CancelOrderDialog (existing behavior, but now via RecentStrip instead of E button)
- Payment/expense type → open DeleteConfirmDialog (new)

Add state:
```tsx
const [deleteConfirmTx, setDeleteConfirmTx] = useState<LedgerTransaction | null>(null);
```

Update handler:
```tsx
const handleRecentDeleteClick = (tx: LedgerTransaction) => {
  if (tx.type === 'order') {
    openCancelConfirmForTx(tx);
  } else {
    setDeleteConfirmTx(tx);
  }
};
```

`openCancelConfirmForTx` is a new function in `useCancelDialog.ts`:
```tsx
// Add to useCancelDialog.ts:
const openCancelConfirmForTx = useCallback((tx: LedgerTransaction) => {
  // Find student account from allStudents by tx.studentId, select it, then open dialog
  const student = allStudents.find(s => s.studentId === tx.studentId);
  if (student) {
    selectStudent(student.studentId, 'manual');
  }
  // Store the specific orderTx for the dialog
  setOrderTx(tx);
  setCancelDialogOpen(true);
}, [allStudents, selectStudent]);

// Return from useCancelDialog:
return { ...existing, openCancelConfirmForTx };
```

- [ ] **Step 5: Update PosColumn.tsx — auto-switch E mode on student click**

Change `onStudentClick` callback to also set focusZone to `view-status`:

```tsx
onStudentClick={!isHistorical && dateStatus !== 'closed' ? (sid) => {
  selectStudent(sid, 'manual');
  setFocusZone('view-status');
} : undefined}
```

- [ ] **Step 6: Update ActionBar wiring in PosColumn.tsx**

Replace `onDeleteOrder={openCancelConfirm}` with:
```tsx
onStatusMode={() => setFocusZone('view-status')}
```

- [ ] **Step 7: Wire DeleteConfirmDialog in App.tsx**

Render `DeleteConfirmDialog` in `App.tsx` (same location as CancelOrderDialog):

```tsx
import { DeleteConfirmDialog } from './components/pos-components';

// In the render:
<DeleteConfirmDialog
  open={deleteConfirmTx != null}
  studentName={deleteConfirmTx ? /* find student name from tx */ deleteConfirmTx.studentNameSnapshot : ''}
  transactionType={deleteConfirmTx?.type === 'expense' ? 'expense' : 'payment'}
  amount={deleteConfirmTx?.amount ?? 0}
  onConfirm={() => {
    if (deleteConfirmTx) deleteTransaction(deleteConfirmTx.transactionId);
    setDeleteConfirmTx(null);
  }}
  onCancel={() => setDeleteConfirmTx(null)}
/>
```

- [ ] **Step 8: Run full test suite**

Run: `./workflow.sh t4-full`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(pos): wire E mode, dual-column RecentStrip, delete confirmations (#400, #401, #402)"
```

---

## Task 5b: Update Integration Tests

**Files:**
- Modify: `frontend/src/__tests__/pcPosFlow.integration.test.tsx` — E key now sets 'view-status' focusZone, not 'btn-delete-order'
- Modify: `frontend/src/__tests__/pcPosSafety.integration.test.tsx` — Cancel order flow changed: no longer via E button, now via RecentStrip delete

- [ ] **Step 1: Update pcPosFlow.integration.test.tsx**

Find tests that simulate E key press and expect `btn-delete-order` behavior. Update to expect `view-status` focusZone instead. E key should no longer trigger cancel dialog.

- [ ] **Step 2: Update pcPosSafety.integration.test.tsx**

Find tests that simulate cancel order flow via E button. Update to test cancel via RecentStrip delete button → CancelOrderDialog flow instead.

- [ ] **Step 3: Run integration tests**

Run: `cd frontend && npx vitest run src/__tests__/pcPosFlow.integration.test.tsx src/__tests__/pcPosSafety.integration.test.tsx --reporter verbose 2>&1 | tail -30`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/__tests__/pcPosFlow.integration.test.tsx \
       frontend/src/__tests__/pcPosSafety.integration.test.tsx
git commit -m "test(pos): update integration tests for E mode rework (#400)"
```

---

## Task 6: Integration Verification + Final Cleanup

- [ ] **Step 1: Run t1 (build)**

Run: `./workflow.sh t1`
Expected: PASS

- [ ] **Step 2: Run t2 (tsc)**

Run: `./workflow.sh t2`
Expected: PASS

- [ ] **Step 3: Run t3 (lint)**

Run: `./workflow.sh t3`
Expected: PASS

- [ ] **Step 4: Run t4 (full unit tests)**

Run: `./workflow.sh t4-full`
Expected: All PASS

- [ ] **Step 5: Review changed file list**

Run: `git diff --stat origin/dev`
Verify only expected files changed.

- [ ] **Step 6: Create PR**

```bash
gh pr create --base dev --title "feat(pos): E mode rework + delete confirmations + dual-column display (#400, #401, #402)" \
  --body "## Summary
Reworks E mode from '取消訂餐' to '訂餐狀況', adds delete confirmation dialogs, and implements dual-column income/expense display.

### Changes
- **E mode → 訂餐狀況**: Shows student's today transactions in dual-column format
- **Delete confirmations**: All transaction deletions require confirmation dialog
- **Dual-column display**: RecentStrip and E mode share income/expense column pattern (DRY)
- **RecentStrip auto-switch**: Clicking student name auto-switches to E mode
- **Shared TransactionStatusView**: Reusable component for transaction display

Closes #400
Closes #401
Closes #402

## Test Evidence
- t1 (build) ✅
- t2 (tsc) ✅
- t3 (lint) ✅
- t4 (unit) ✅"
```

- [ ] **Step 7: Final commit if needed**

---

## Test Impact

Files that may need test updates:
- `frontend/src/components/__tests__/pos-components.test.tsx` — ActionBar E button tests
- `frontend/src/components/pos/__tests__/CustomerCard.test.tsx` — E mode view
- `frontend/src/hooks/__tests__/useAppNavigationShortcuts.test.ts` — modes array
- `frontend/src/__tests__/pcPosFlow.integration.test.tsx` — E key behavior integration
- `frontend/src/__tests__/pcPosSafety.integration.test.tsx` — cancel flow changes

## Affected Callers

- `ActionBar` consumed by: `PosColumn.tsx` (prop rename: `onDeleteOrder` → `onStatusMode`)
- `CustomerCard` consumed by: `PosColumn.tsx` (new prop: `studentTransactions`)
- `useKeyboardShortcuts` consumed by: `App.tsx` (focusZone value change only, no API change)
- `useAppNavigationShortcuts` consumed by: `App.tsx` (modes array internal change)
- `useCancelDialog` consumed by: `App.tsx` (may need new state exports)
- `RecentStrip` consumed by: `PosColumn.tsx` (no prop change, layout change only)
