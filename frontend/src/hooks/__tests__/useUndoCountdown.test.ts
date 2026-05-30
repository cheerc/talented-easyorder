import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUndoCountdown } from '../useUndoCountdown';
import { usePosStore } from '../../store/posStore';

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

function getProps() {
  return { dismissSuccess, setFlashKey, setSyncing, setPriceOverride, setPriceOverrideLabel };
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
});
