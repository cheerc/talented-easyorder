import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePosFlow } from '../usePosFlow';
import { usePosStore } from '../../store/posStore';

const DEFAULT_ARGS = {
  businessDate: '2026-05-07',
  isHistorical: false,
  priceOverride: null,
  priceOverrideLabel: '',
};

beforeEach(() => {
  usePosStore.getState().resetData();
});

describe('usePosFlow — order flow', () => {
  it('completes full order cycle: idle → selectStudent → changeMode(order) → requestConfirm → commitTransaction → success', () => {
    const { result } = renderHook(() => usePosFlow(DEFAULT_ARGS));

    expect(result.current.state.kind).toBe('idle');

    act(() => result.current.selectStudent('001', 'manual'));
    expect(result.current.state.kind).toBe('student_selected');
    if (result.current.state.kind === 'student_selected') {
      expect(result.current.state.studentId).toBe('001');
      expect(result.current.state.mode).toBe('order');
    }

    act(() => result.current.changeMode('order'));

    act(() => result.current.requestConfirm());
    // requestConfirm dispatches requestCommit → state transitions to committing →
    // useEffect auto-triggers commitTransaction
    expect(result.current.state.kind).toBe('success');
    if (result.current.state.kind === 'success') {
      expect(result.current.state.transactionId).toBeTruthy();
      expect(result.current.state.syncStatus).toBe('queued');
    }

    // Verify store was updated
    const txs = usePosStore.getState().transactions;
    expect(txs.length).toBeGreaterThan(0);
    expect(txs[0].type).toBe('order');
    expect(txs[0].studentId).toBe('001');
  });
});

describe('usePosFlow — payment flow', () => {
  it('completes payment cycle: selectStudent → setPaidAmountText → requestConfirm → success', () => {
    const { result } = renderHook(() => usePosFlow(DEFAULT_ARGS));

    act(() => result.current.selectStudent('001', 'manual'));
    act(() => result.current.changeMode('payment'));
    act(() => result.current.setPaidAmountText('500'));

    if (result.current.state.kind === 'student_selected') {
      expect(result.current.state.paidAmountText).toBe('500');
    }

    act(() => result.current.requestConfirm());

    expect(result.current.state.kind).toBe('success');

    const txs = usePosStore.getState().transactions;
    expect(txs.length).toBeGreaterThan(0);
    expect(txs[0].type).toBe('payment');
    expect(txs[0].paidAmount).toBe(500);
  });

  it('blocks requestConfirm when paidAmountText is empty or zero', () => {
    const { result } = renderHook(() => usePosFlow(DEFAULT_ARGS));

    act(() => result.current.selectStudent('001', 'manual'));
    act(() => result.current.changeMode('payment'));

    // No paidAmountText set — should stay in student_selected
    act(() => result.current.requestConfirm());
    expect(result.current.state.kind).toBe('student_selected');

    // Set empty amount
    act(() => result.current.setPaidAmountText(''));
    act(() => result.current.requestConfirm());
    expect(result.current.state.kind).toBe('student_selected');

    // Set zero
    act(() => result.current.setPaidAmountText('0'));
    act(() => result.current.requestConfirm());
    expect(result.current.state.kind).toBe('student_selected');
  });
});

describe('usePosFlow — expense flow', () => {
  it('completes full expense cycle: enterExpenseMode → input amount → confirm → select direction → select reason → commit', () => {
    const { result } = renderHook(() => usePosFlow(DEFAULT_ARGS));

    // Enter expense mode
    act(() => result.current.enterExpenseMode());
    expect(result.current.state.kind).toBe('expense_input');

    // Input amount
    act(() => result.current.updateExpenseAmount('200'));
    act(() => result.current.confirmExpenseAmount(200));
    expect(result.current.state.kind).toBe('expense_direction');

    // Select direction
    act(() => result.current.selectExpenseDirection('expense'));
    expect(result.current.state.kind).toBe('expense_reason');

    // Select reason → transitions to committing
    act(() => result.current.selectExpenseReason('付便當錢'));
    // After selecting reason, the reducer transitions to committing state,
    // useEffect auto-triggers commitTransaction
    expect(result.current.state.kind).toBe('success');

    const txs = usePosStore.getState().transactions;
    expect(txs.length).toBeGreaterThan(0);
    expect(txs[0].type).toBe('expense');
    expect(txs[0].mealPrice).toBe(200);
  });

  it('handles expense with other reason requiring note', () => {
    const { result } = renderHook(() => usePosFlow(DEFAULT_ARGS));

    act(() => result.current.enterExpenseMode());
    act(() => result.current.updateExpenseAmount('150'));
    act(() => result.current.confirmExpenseAmount(150));
    act(() => result.current.selectExpenseDirection('expense'));
    act(() => result.current.selectExpenseReason('支出其他'));
    expect(result.current.state.kind).toBe('expense_other_note');

    act(() => result.current.updateExpenseNote('買文具'));
    act(() => result.current.confirmExpenseNote('買文具'));

    expect(result.current.state.kind).toBe('success');

    const txs = usePosStore.getState().transactions;
    expect(txs[0].type).toBe('expense');
    expect(txs[0].note).toBe('買文具');
  });
});

describe('usePosFlow — scanner input', () => {
  it('receiveScannerInput auto-selects student by scanned code', () => {
    const { result } = renderHook(() => usePosFlow(DEFAULT_ARGS));

    act(() => result.current.receiveScannerInput({ rawCode: '001', terminator: 'Enter' }));

    expect(result.current.state.kind).toBe('student_selected');
    if (result.current.state.kind === 'student_selected') {
      expect(result.current.state.studentId).toBe('001');
      expect(result.current.state.source).toBe('scan');
    }
  });
});

describe('usePosFlow — duplicate detection', () => {
  it('detects duplicate order and shows duplicate_warning state', () => {
    // Seed an existing order for student 001
    const store = usePosStore.getState();
    store.processTransaction('001', 'order', 90, 0);

    const { result } = renderHook(() => usePosFlow(DEFAULT_ARGS));

    // Select student who already has an order — auto mode='payment' (hasOrderToday)
    act(() => result.current.selectStudent('001', 'manual'));
    expect(result.current.state.kind).toBe('student_selected');
    if (result.current.state.kind === 'student_selected') {
      expect(result.current.state.mode).toBe('payment');
    }

    // Switch back to order mode
    act(() => result.current.changeMode('order'));

    // requestConfirm detects duplicate
    act(() => result.current.requestConfirm());
    expect(result.current.state.kind).toBe('duplicate_warning');
  });

  it('confirmDuplicate proceeds to committing and then success', () => {
    const store = usePosStore.getState();
    store.processTransaction('001', 'order', 90, 0);

    const { result } = renderHook(() => usePosFlow(DEFAULT_ARGS));

    act(() => result.current.selectStudent('001', 'manual'));
    act(() => result.current.changeMode('order'));
    act(() => result.current.requestConfirm());

    expect(result.current.state.kind).toBe('duplicate_warning');

    act(() => result.current.confirmDuplicate());

    // confirmDuplicate dispatches confirmDuplicate → reducer transitions to committing →
    // useEffect triggers commitTransaction
    expect(result.current.state.kind).toBe('success');

    const txs = usePosStore.getState().transactions;
    // Should have the seeded transaction + new order
    const orders = txs.filter(t => t.studentId === '001' && t.type === 'order');
    expect(orders.length).toBeGreaterThanOrEqual(2);
  });
});

describe('usePosFlow — cancel flow', () => {
  it('cancelFlow resets to idle from student_selected', () => {
    const { result } = renderHook(() => usePosFlow(DEFAULT_ARGS));

    act(() => result.current.selectStudent('001', 'manual'));
    expect(result.current.state.kind).toBe('student_selected');

    act(() => result.current.cancelFlow());
    expect(result.current.state.kind).toBe('idle');
  });

  it('cancelFlow resets to idle from expense flow', () => {
    const { result } = renderHook(() => usePosFlow(DEFAULT_ARGS));

    act(() => result.current.enterExpenseMode());
    expect(result.current.state.kind).toBe('expense_input');

    act(() => result.current.cancelFlow());
    expect(result.current.state.kind).toBe('idle');
  });

  it('dismissSuccess returns to idle from success state', () => {
    const { result } = renderHook(() => usePosFlow(DEFAULT_ARGS));

    // Complete a quick order to reach success
    act(() => result.current.selectStudent('001', 'manual'));
    act(() => result.current.requestConfirm());
    expect(result.current.state.kind).toBe('success');

    act(() => result.current.dismissSuccess());
    expect(result.current.state.kind).toBe('idle');
  });
});
