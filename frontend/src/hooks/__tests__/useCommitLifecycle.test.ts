import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCommitLifecycle } from '../useCommitLifecycle';
import type { UseCommitLifecycleArgs } from '../useCommitLifecycle';

// Ref: #349 — Tests for useCommitLifecycle (financial operations lifecycle)

vi.mock('../../store/posStore', () => ({
  usePosStore: {
    getState: () => ({
      transactions: [
        { transactionId: 'tx-latest', syncStatus: 'local' },
      ],
    }),
  },
}));

vi.mock('../../storage/crashDraft', () => ({
  clearCrashDraft: vi.fn(),
}));

function makeArgs(overrides: Partial<UseCommitLifecycleArgs> = {}): UseCommitLifecycleArgs {
  return {
    stateKind: 'idle',
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

  it('stores latest transaction ID in ref on success', () => {
    const ref = { current: null as string | null };
    const args = makeArgs({ stateKind: 'idle', lastCommittedTxIdRef: ref });
    const { rerender } = renderHook(
      ({ stateKind }) => useCommitLifecycle({ ...args, stateKind }),
      { initialProps: { stateKind: 'idle' } },
    );

    rerender({ stateKind: 'success' });
    expect(ref.current).toBe('tx-latest');
  });
});
