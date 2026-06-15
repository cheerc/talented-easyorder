import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useExpenseProps } from '../useExpenseProps';
import type { PosFlowState } from '../../domain/posFlow';

describe('useExpenseProps', () => {
  it('returns null for idle state', () => {
    const state: PosFlowState = { kind: 'idle', searchText: '' };
    const { result } = renderHook(() => useExpenseProps(state));
    expect(result.current).toBeNull();
  });

  it('returns expense_input props', () => {
    const state: PosFlowState = { kind: 'expense_input', amountText: '100' };
    const { result } = renderHook(() => useExpenseProps(state));
    expect(result.current).toEqual({ kind: 'expense_input', amountText: '100', amount: 0 });
  });

  it('returns expense_direction props', () => {
    const state: PosFlowState = { kind: 'expense_direction', amount: 50 };
    const { result } = renderHook(() => useExpenseProps(state));
    expect(result.current).toEqual({ kind: 'expense_direction', amountText: '', amount: 50 });
  });

  it('returns expense_reason props', () => {
    const state: PosFlowState = { kind: 'expense_reason', amount: 75, direction: 'expense' };
    const { result } = renderHook(() => useExpenseProps(state));
    expect(result.current).toEqual({ kind: 'expense_reason', amountText: '', amount: 75 });
  });

  it('returns null for student_selected state', () => {
    const state: PosFlowState = { kind: 'student_selected', studentId: 's1', mode: 'order', source: 'manual', paidAmountText: '', searchTextHint: '' };
    const { result } = renderHook(() => useExpenseProps(state));
    expect(result.current).toBeNull();
  });
});
