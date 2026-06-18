import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useExpenseFlow } from '../useExpenseFlow';

describe('#332 — useExpenseFlow', () => {
  it('dispatches enterExpenseMode', () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useExpenseFlow(dispatch));

    act(() => { result.current.enterExpenseMode(); });
    expect(dispatch).toHaveBeenCalledWith({ type: 'enterExpenseMode' });
  });

  it('dispatches expenseUpdateAmount with text', () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useExpenseFlow(dispatch));

    act(() => { result.current.updateExpenseAmount('150'); });
    expect(dispatch).toHaveBeenCalledWith({ type: 'expenseUpdateAmount', text: '150' });
  });

  it('dispatches expenseConfirmAmount with number', () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useExpenseFlow(dispatch));

    act(() => { result.current.confirmExpenseAmount(150); });
    expect(dispatch).toHaveBeenCalledWith({ type: 'expenseConfirmAmount', amount: 150 });
  });

  it('dispatches expenseSelectDirection', () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useExpenseFlow(dispatch));

    act(() => { result.current.selectExpenseDirection('out'); });
    expect(dispatch).toHaveBeenCalledWith({ type: 'expenseSelectDirection', direction: 'out' });
  });

  it('dispatches expenseSelectReason', () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useExpenseFlow(dispatch));

    act(() => { result.current.selectExpenseReason('付便當錢'); });
    expect(dispatch).toHaveBeenCalledWith({ type: 'expenseSelectReason', reason: '付便當錢' });
  });

  it('dispatches expenseUpdateNote', () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useExpenseFlow(dispatch));

    act(() => { result.current.updateExpenseNote('test note'); });
    expect(dispatch).toHaveBeenCalledWith({ type: 'expenseUpdateNote', note: 'test note' });
  });

  it('dispatches expenseConfirmNote', () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useExpenseFlow(dispatch));

    act(() => { result.current.confirmExpenseNote('final note'); });
    expect(dispatch).toHaveBeenCalledWith({ type: 'expenseConfirmNote', note: 'final note' });
  });
});
