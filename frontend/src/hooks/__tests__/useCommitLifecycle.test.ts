import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCommitLifecycle, UNDO_SECONDS } from '../useCommitLifecycle';
import type { UseCommitLifecycleArgs } from '../useCommitLifecycle';

// Ref: #349 — Tests for useCommitLifecycle (financial operations lifecycle)

vi.mock('../../storage/crashDraft', () => ({
  clearCrashDraft: vi.fn(),
}));

function makeArgs(overrides: Partial<UseCommitLifecycleArgs> = {}): UseCommitLifecycleArgs {
  return {
    stateKind: 'idle',
    successTransactionId: null,
    lastCommittedTxIdRef: { current: null },
    setUndoCountdown: vi.fn(),
    setSyncing: vi.fn(),
    ...overrides,
  };
}

describe('useCommitLifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns lastSync as "剛剛" initially', () => {
    const args = makeArgs();
    const { result } = renderHook(() => useCommitLifecycle(args));
    expect(result.current.lastSync).toBe('剛剛');
  });

  it('sets syncing=true when transitioning to success', () => {
    const args = makeArgs({ stateKind: 'idle' });
    const { rerender } = renderHook(
      ({ stateKind }) => useCommitLifecycle({ ...args, stateKind }),
      { initialProps: { stateKind: 'idle' } },
    );

    rerender({ stateKind: 'success' });
    expect(args.setSyncing).toHaveBeenCalledWith(true);
  });

  it('sets syncing=false after 800ms delay on success', () => {
    const args = makeArgs({ stateKind: 'idle' });
    const { rerender } = renderHook(
      ({ stateKind }) => useCommitLifecycle({ ...args, stateKind }),
      { initialProps: { stateKind: 'idle' } },
    );

    rerender({ stateKind: 'success' });
    vi.advanceTimersByTime(800);
    expect(args.setSyncing).toHaveBeenCalledWith(false);
  });

  it('stores the success transaction ID in ref and starts the undo countdown right away (L05)', () => {
    const ref = { current: null as string | null };
    const args = makeArgs({ stateKind: 'idle', lastCommittedTxIdRef: ref });
    const { rerender } = renderHook(
      ({ stateKind, successTransactionId }) => useCommitLifecycle({ ...args, stateKind, successTransactionId }),
      { initialProps: { stateKind: 'idle', successTransactionId: null as string | null } },
    );

    rerender({ stateKind: 'success', successTransactionId: 'tx-latest' });
    expect(ref.current).toBe('tx-latest');
    // 成功畫面還在時就要開始倒數，不能等畫面關掉。
    expect(args.setUndoCountdown).toHaveBeenCalledWith(UNDO_SECONDS);
  });

  it('does not restart the countdown when leaving success', () => {
    const ref = { current: null as string | null };
    const args = makeArgs({ stateKind: 'idle', lastCommittedTxIdRef: ref });
    const { rerender } = renderHook(
      ({ stateKind, successTransactionId }) => useCommitLifecycle({ ...args, stateKind, successTransactionId }),
      { initialProps: { stateKind: 'idle', successTransactionId: null as string | null } },
    );

    rerender({ stateKind: 'success', successTransactionId: 'tx-latest' });
    vi.mocked(args.setUndoCountdown).mockClear();
    rerender({ stateKind: 'idle', successTransactionId: null });
    vi.runAllTimers();
    expect(args.setUndoCountdown).not.toHaveBeenCalled();
  });
});
