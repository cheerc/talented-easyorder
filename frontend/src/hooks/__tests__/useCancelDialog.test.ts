import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCancelDialog } from '../useCancelDialog';
import { usePosStore } from '../../store/posStore';

// Ref: #349 — Tests for useCancelDialog (cancel flow)

const mockStore = {
  transactions: [
    { studentId: 's1', businessDate: '2024-01-15', type: 'order', transactionId: 'tx-1' },
  ],
  deleteOrderWithRefundCheck: vi.fn(),
};

vi.mock('../../store/posStore', () => ({
  usePosStore: {
    getState: () => mockStore,
  },
}));

function makeArgs(overrides: Record<string, unknown> = {}) {
  return {
    picked: null as Record<string, unknown> | null,
    allTx: [] as Record<string, unknown>[],
    viewDate: '2024-01-15',
    ...overrides,
  };
}

describe('useCancelDialog', () => {
  it('starts with dialogs closed', () => {
    const { result } = renderHook(() =>
      useCancelDialog(makeArgs() as Parameters<typeof useCancelDialog>[0]),
    );
    expect(result.current.cancelDialogOpen).toBe(false);
    expect(result.current.noOrderDialogOpen).toBe(false);
  });

  it('openCancelConfirm does nothing when no student picked', () => {
    const { result } = renderHook(() =>
      useCancelDialog(makeArgs() as Parameters<typeof useCancelDialog>[0]),
    );
    act(() => result.current.openCancelConfirm());
    expect(result.current.cancelDialogOpen).toBe(false);
    expect(result.current.noOrderDialogOpen).toBe(false);
  });

  it('openCancelConfirm opens cancel dialog when order exists', () => {
    const args = makeArgs({
      picked: { studentId: 's1', displayName: 'A' },
      allTx: [{ studentId: 's1', businessDate: '2024-01-15', type: 'order' }],
    });
    const { result } = renderHook(() =>
      useCancelDialog(args as Parameters<typeof useCancelDialog>[0]),
    );
    act(() => result.current.openCancelConfirm());
    expect(result.current.cancelDialogOpen).toBe(true);
    expect(result.current.noOrderDialogOpen).toBe(false);
  });

  it('openCancelConfirm opens no-order dialog when no order for student', () => {
    const args = makeArgs({
      picked: { studentId: 's1', displayName: 'A' },
      allTx: [{ studentId: 's2', businessDate: '2024-01-15', type: 'order' }],
    });
    const { result } = renderHook(() =>
      useCancelDialog(args as Parameters<typeof useCancelDialog>[0]),
    );
    act(() => result.current.openCancelConfirm());
    expect(result.current.cancelDialogOpen).toBe(false);
    expect(result.current.noOrderDialogOpen).toBe(true);
  });

  it('setCancelDialogOpen toggles cancel dialog', () => {
    const { result } = renderHook(() =>
      useCancelDialog(makeArgs() as Parameters<typeof useCancelDialog>[0]),
    );
    act(() => result.current.setCancelDialogOpen(true));
    expect(result.current.cancelDialogOpen).toBe(true);
    act(() => result.current.setCancelDialogOpen(false));
    expect(result.current.cancelDialogOpen).toBe(false);
  });

  it('handleDeleteOrder calls deleteOrderWithRefundCheck with correct arguments', () => {
    const args = makeArgs({
      picked: { studentId: 's1', displayName: 'A' },
      allTx: [{ studentId: 's1', businessDate: '2024-01-15', type: 'order', transactionId: 'tx-1' }],
    });
    const { result } = renderHook(() =>
      useCancelDialog(args as Parameters<typeof useCancelDialog>[0]),
    );

    const store = usePosStore.getState();

    act(() => result.current.handleDeleteOrder(true));
    expect(store.deleteOrderWithRefundCheck).toHaveBeenCalledWith('tx-1', undefined, true);

    act(() => result.current.handleDeleteOrder(false));
    expect(store.deleteOrderWithRefundCheck).toHaveBeenCalledWith('tx-1', undefined, false);
  });
});
