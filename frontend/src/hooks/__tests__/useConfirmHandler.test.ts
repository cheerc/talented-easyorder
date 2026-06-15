import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useConfirmHandler } from '../useConfirmHandler';
import type { PosFlowState } from '../../domain/posFlow';

describe('useConfirmHandler', () => {
  it('calls requestConfirm when student_selected', () => {
    const state: PosFlowState = { kind: 'student_selected', studentId: 's1', mode: 'order', source: 'manual', paidAmountText: '', searchTextHint: '' };
    const requestConfirm = vi.fn();
    const confirmDuplicate = vi.fn();
    const confirmExpenseAmount = vi.fn();

    const { result } = renderHook(() =>
      useConfirmHandler({ state, requestConfirm, confirmDuplicate, confirmExpenseAmount })
    );
    result.current();
    expect(requestConfirm).toHaveBeenCalledOnce();
    expect(confirmDuplicate).not.toHaveBeenCalled();
  });

  it('calls confirmDuplicate when duplicate_warning', () => {
    const state: PosFlowState = { kind: 'duplicate_warning', studentId: 's1', source: 'manual', paidAmountText: '', searchTextHint: '' };
    const requestConfirm = vi.fn();
    const confirmDuplicate = vi.fn();
    const confirmExpenseAmount = vi.fn();

    const { result } = renderHook(() =>
      useConfirmHandler({ state, requestConfirm, confirmDuplicate, confirmExpenseAmount })
    );
    result.current();
    expect(confirmDuplicate).toHaveBeenCalledOnce();
  });

  it('calls confirmExpenseAmount with parsed amount when expense_input', () => {
    const state: PosFlowState = { kind: 'expense_input', amountText: '50' };
    const requestConfirm = vi.fn();
    const confirmDuplicate = vi.fn();
    const confirmExpenseAmount = vi.fn();

    const { result } = renderHook(() =>
      useConfirmHandler({ state, requestConfirm, confirmDuplicate, confirmExpenseAmount })
    );
    result.current();
    expect(confirmExpenseAmount).toHaveBeenCalledWith(50);
  });

  it('does nothing when idle', () => {
    const state: PosFlowState = { kind: 'idle', searchText: '' };
    const requestConfirm = vi.fn();
    const confirmDuplicate = vi.fn();
    const confirmExpenseAmount = vi.fn();

    const { result } = renderHook(() =>
      useConfirmHandler({ state, requestConfirm, confirmDuplicate, confirmExpenseAmount })
    );
    result.current();
    expect(requestConfirm).not.toHaveBeenCalled();
    expect(confirmDuplicate).not.toHaveBeenCalled();
    expect(confirmExpenseAmount).not.toHaveBeenCalled();
  });
});
