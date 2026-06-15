import { describe, expect, it, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePosStore } from '../posStore';
import {
  useStudents,
  useTransactions,
  useMenu,
  useSession,
  useTransactionActions,
  useSessionActions,
} from '../selectors';

beforeEach(() => {
  usePosStore.getState().resetData();
});

describe('domain selector hooks', () => {
  it('useStudents returns only student state', () => {
    const { result } = renderHook(() => useStudents());
    expect(result.current.students).toBeDefined();
    expect(Array.isArray(result.current.students)).toBe(true);
  });

  it('useTransactions returns only transaction state', () => {
    const { result } = renderHook(() => useTransactions());
    expect(result.current.transactions).toBeDefined();
    expect(Array.isArray(result.current.transactions)).toBe(true);
  });

  it('useMenu returns only menu state', () => {
    const { result } = renderHook(() => useMenu());
    expect(result.current.todayMenu).toBeDefined();
    expect(result.current.vendors).toBeDefined();
  });

  it('useSession returns session + audit + settlement state', () => {
    const { result } = renderHook(() => useSession());
    expect(result.current.auditEvents).toBeDefined();
    expect(result.current.dailySettlements).toBeDefined();
    expect(result.current.businessDateStatuses).toBeDefined();
    expect(result.current.cashSessions).toBeDefined();
  });

  it('useTransactionActions returns action functions', () => {
    const { result } = renderHook(() => useTransactionActions());
    expect(typeof result.current.deleteTransaction).toBe('function');
    expect(typeof result.current.editTransaction).toBe('function');
    expect(typeof result.current.commitPosTransactionDraft).toBe('function');
  });

  it('useSessionActions returns session action functions', () => {
    const { result } = renderHook(() => useSessionActions());
    expect(typeof result.current.closeBusinessDate).toBe('function');
    expect(typeof result.current.reopenBusinessDate).toBe('function');
    expect(typeof result.current.openCashSession).toBe('function');
  });

  // Reviewer finding #1: use setTodayMenu to test cross-domain isolation
  // (processTransaction mutates both students+transactions simultaneously)
  it('useTransactions does not re-render when menu changes', () => {
    let renderCount = 0;
    renderHook(() => {
      renderCount++;
      return useTransactions();
    });

    const initialCount = renderCount;

    // Mutate menu — should NOT trigger re-render of useTransactions
    act(() => {
      usePosStore.getState().setTodayMenu({
        businessDate: '2026-06-15',
        itemName: 'Changed Menu',
        price: 999,
        vendorId: 'v1',
        vendorNameSnapshot: 'Test Vendor',
        updatedAt: new Date().toISOString(),
        revision: 2,
      });
    });

    expect(renderCount).toBe(initialCount);
  });

  it('useStudents does not re-render when menu changes', () => {
    let renderCount = 0;
    renderHook(() => {
      renderCount++;
      return useStudents();
    });

    const initialCount = renderCount;

    act(() => {
      usePosStore.getState().setTodayMenu({
        businessDate: '2026-06-15',
        itemName: 'Another Menu',
        price: 888,
        vendorId: 'v1',
        vendorNameSnapshot: 'Test Vendor',
        updatedAt: new Date().toISOString(),
        revision: 3,
      });
    });

    expect(renderCount).toBe(initialCount);
  });

  it('useMenu does not re-render when session changes', () => {
    let renderCount = 0;
    renderHook(() => {
      renderCount++;
      return useMenu();
    });

    const initialCount = renderCount;

    act(() => {
      usePosStore.getState().setBusinessDateStatus('2026-06-15', 'closed');
    });

    expect(renderCount).toBe(initialCount);
  });
});
