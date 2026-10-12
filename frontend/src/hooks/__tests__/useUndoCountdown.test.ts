import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUndoCountdown, UNDO_REASON } from '../useUndoCountdown';
import { usePosStore } from '../../store/posStore';
import { onError } from '../../errors/errorBus';

let dismissSuccess: ReturnType<typeof vi.fn>;
let setFlashKey: ReturnType<typeof vi.fn>;
let setSyncing: ReturnType<typeof vi.fn>;
let setPriceOverride: ReturnType<typeof vi.fn>;
let setPriceOverrideLabel: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  usePosStore.getState().resetData();
  dismissSuccess = vi.fn();
  setFlashKey = vi.fn();
  setSyncing = vi.fn();
  setPriceOverride = vi.fn();
  setPriceOverrideLabel = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

function getProps(): Parameters<typeof useUndoCountdown>[0] {
  return { dismissSuccess, setFlashKey, setSyncing, setPriceOverride, setPriceOverrideLabel } as unknown as Parameters<typeof useUndoCountdown>[0];
}

describe('useUndoCountdown', () => {
  it('U1: initial undoCountdown is 0', () => {
    const { result } = renderHook(() => useUndoCountdown(getProps()));

    expect(result.current.undoCountdown).toBe(0);
  });

  it('U2: setUndoCountdown starts countdown and reaches 0 after all ticks', () => {
    const { result } = renderHook(() => useUndoCountdown(getProps()));

    act(() => { result.current.setUndoCountdown(5); });

    for (let i = 0; i < 5; i++) {
      act(() => { vi.advanceTimersByTime(1000); });
    }

    expect(result.current.undoCountdown).toBe(0);
  });

  it('U3: countdown decrements every second', () => {
    const { result } = renderHook(() => useUndoCountdown(getProps()));

    act(() => { result.current.setUndoCountdown(3); });
    expect(result.current.undoCountdown).toBe(3);

    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.undoCountdown).toBe(2);

    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.undoCountdown).toBe(1);
  });

  it('U4: countdown reaches 0 clears lastCommittedTxIdRef', () => {
    const { result } = renderHook(() => useUndoCountdown(getProps()));

    act(() => {
      result.current.lastCommittedTxIdRef.current = 'tx-test-123';
      result.current.setUndoCountdown(1);
    });

    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.lastCommittedTxIdRef.current).toBeNull();
  });

  it('U5: dismissFlash calls all cleanup callbacks', () => {
    const props = getProps();
    const { result } = renderHook(() => useUndoCountdown(props));

    act(() => { result.current.dismissFlash(); });

    expect(props.dismissSuccess).toHaveBeenCalled();
    expect(props.setFlashKey).toHaveBeenCalled();
    expect(props.setSyncing).toHaveBeenCalledWith(false);
    expect(props.setPriceOverride).toHaveBeenCalledWith(null);
    expect(props.setPriceOverrideLabel).toHaveBeenCalledWith('');
    expect(result.current.undoCountdown).toBe(0);
  });

  it('U6: handleUndo calls deleteTransaction then dismissFlash', () => {
    usePosStore.getState().processTransaction('001', 'order', 90, 0);
    const tx = usePosStore.getState().transactions[0];
    expect(tx).toBeDefined();

    const props = getProps();
    const { result } = renderHook(() => useUndoCountdown(props));

    act(() => {
      result.current.lastCommittedTxIdRef.current = tx.transactionId;
    });

    act(() => { result.current.handleUndo(); });

    expect(props.dismissSuccess).toHaveBeenCalled();
    const txs = usePosStore.getState().transactions;
    expect(txs.find(t => t.transactionId === tx.transactionId)).toBeUndefined();
    expect(result.current.undoCountdown).toBe(0);
    // M2：撤回也留下原單與理由
    expect(usePosStore.getState().auditEvents.at(-1)).toMatchObject({
      eventType: 'transaction_deleted', entityId: tx.transactionId, reason: UNDO_REASON,
    });
  });

  it('U7: handleUndo no-ops when lastCommittedTxIdRef is null', () => {
    const store = usePosStore.getState();
    const txCountBefore = store.transactions.length;

    const props = getProps();
    const { result } = renderHook(() => useUndoCountdown(props));

    act(() => { result.current.handleUndo(); });

    expect(usePosStore.getState().transactions.length).toBe(txCountBefore);
    expect(props.dismissSuccess).not.toHaveBeenCalled();
  });

  it('撤回帶操作員；失敗時（例如那天已關帳）記錄錯誤，不默默當成成功', () => {
    usePosStore.getState().processTransaction('001', 'order', 90, 0);
    const tx = usePosStore.getState().transactions[0];
    const props = { ...getProps(), operatorId: 'op-9' };
    const { result } = renderHook(() => useUndoCountdown(props));

    act(() => { result.current.lastCommittedTxIdRef.current = tx.transactionId; });
    act(() => { result.current.handleUndo(); });
    expect(usePosStore.getState().auditEvents.at(-1)).toMatchObject({ operatorId: 'op-9', reason: UNDO_REASON });

    usePosStore.getState().processTransaction('001', 'order', 90, 0);
    const tx2 = usePosStore.getState().transactions[0];
    usePosStore.setState(s => ({ businessDateStatuses: { ...s.businessDateStatuses, [tx2.businessDate]: 'closed' } }));
    const seen: string[] = [];
    const unsubscribe = onError(e => seen.push(e.message));
    act(() => { result.current.lastCommittedTxIdRef.current = tx2.transactionId; });
    act(() => { result.current.handleUndo(); });
    unsubscribe();
    expect(usePosStore.getState().transactions.some(t => t.transactionId === tx2.transactionId)).toBe(true);
    expect(seen.some(m => m.startsWith('撤回失敗'))).toBe(true);
  });
});
