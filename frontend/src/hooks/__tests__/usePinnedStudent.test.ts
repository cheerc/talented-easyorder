import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePinnedStudent } from '../usePinnedStudent';
import type { PosFlowState } from '../../domain/posFlow';
import type { StudentAccount } from '../../domain/student';

const students: StudentAccount[] = [
  { studentId: 's1', displayName: '王小明', balance: 0, disabled: false, lastUpdatedAt: '', dailyLimit: 200 },
  { studentId: 's2', displayName: '李小花', balance: 0, disabled: false, lastUpdatedAt: '', dailyLimit: 200 },
];

describe('usePinnedStudent', () => {
  it('returns null picked when idle', () => {
    const state: PosFlowState = { kind: 'idle', searchText: '' };
    const { result } = renderHook(() => usePinnedStudent(state, students));
    expect(result.current.picked).toBeNull();
    expect(result.current.currentMode).toBe('order');
    expect(result.current.currentPaidAmount).toBe('');
  });

  it('returns picked student when student_selected', () => {
    const state: PosFlowState = { kind: 'student_selected', studentId: 's1', mode: 'payment', source: 'manual', paidAmountText: '100', searchTextHint: '' };
    const { result } = renderHook(() => usePinnedStudent(state, students));
    expect(result.current.picked?.studentId).toBe('s1');
    expect(result.current.currentMode).toBe('payment');
    expect(result.current.currentPaidAmount).toBe('100');
  });

  it('pins student during committing', () => {
    const state: PosFlowState = { kind: 'committing', studentId: 's2', mode: 'order', source: 'manual', paidAmountText: '' };
    const { result } = renderHook(() => usePinnedStudent(state, students));
    expect(result.current.picked?.studentId).toBe('s2');
    expect(result.current.currentMode).toBe('order');
  });

  it('pins student during success (no UI flash)', () => {
    const state: PosFlowState = { kind: 'success', transactionId: 'tx-1', syncStatus: 'queued', studentId: 's1', mode: 'order', paidAmountText: '' };
    const { result } = renderHook(() => usePinnedStudent(state, students));
    expect(result.current.picked?.studentId).toBe('s1');
    expect(result.current.pinnedStudentId).toBe('s1');
  });

  it('returns expense mode during expense flow', () => {
    const state: PosFlowState = { kind: 'expense_input', amountText: '50' };
    const { result } = renderHook(() => usePinnedStudent(state, students));
    expect(result.current.picked).toBeNull();
    expect(result.current.currentMode).toBe('expense');
  });
});
