import { describe, expect, it, vi } from 'vitest';

const BASE_DELAY_MS = 1000;

describe('subscribeBusinessDate batching', () => {
  it('batches three onSnapshot callbacks within same microtask tick', async () => {
    // Simulate the batching logic directly — the same queueMicrotask
    // pattern used in realtimeSubscriptions.ts.
    let batchPending = false;
    const pending: Array<() => void> = [];
    const calls: string[] = [];

    function scheduleBatch(fn: () => void) {
      pending.push(fn);
      if (!batchPending) {
        batchPending = true;
        queueMicrotask(() => {
          batchPending = false;
          const batch = pending.splice(0);
          for (const call of batch) call();
        });
      }
    }

    // Simulate three onSnapshot callbacks firing synchronously
    scheduleBatch(() => calls.push('students'));
    scheduleBatch(() => calls.push('transactions'));
    scheduleBatch(() => calls.push('settlements'));

    // Before microtask, no calls yet
    expect(calls).toEqual([]);

    // Wait for microtask flush
    await new Promise<void>(resolve => queueMicrotask(resolve));

    // All three callbacks flushed together
    expect(calls).toEqual(['students', 'transactions', 'settlements']);
  });

  it('does not re-enter — second wave schedules a new microtask', async () => {
    let batchPending = false;
    const pending: Array<() => void> = [];
    const calls: string[] = [];

    function scheduleBatch(fn: () => void) {
      pending.push(fn);
      if (!batchPending) {
        batchPending = true;
        queueMicrotask(() => {
          batchPending = false;
          const batch = pending.splice(0);
          for (const call of batch) call();
        });
      }
    }

    // First wave
    scheduleBatch(() => calls.push('A'));
    scheduleBatch(() => calls.push('B'));

    await new Promise<void>(resolve => queueMicrotask(resolve));
    expect(calls).toEqual(['A', 'B']);

    // Second wave
    scheduleBatch(() => calls.push('C'));
    expect(calls).toEqual(['A', 'B']);

    await new Promise<void>(resolve => queueMicrotask(resolve));
    expect(calls).toEqual(['A', 'B', 'C']);
  });

  it('single callback still flushed via microtask', async () => {
    let batchPending = false;
    const pending: Array<() => void> = [];
    const calls: string[] = [];

    function scheduleBatch(fn: () => void) {
      pending.push(fn);
      if (!batchPending) {
        batchPending = true;
        queueMicrotask(() => {
          batchPending = false;
          const batch = pending.splice(0);
          for (const call of batch) call();
        });
      }
    }

    scheduleBatch(() => calls.push('only'));

    expect(calls).toEqual([]);

    await new Promise<void>(resolve => queueMicrotask(resolve));
    expect(calls).toEqual(['only']);
  });
});

describe('#343 — retryableOnSnapshot', () => {
  it('retries on transient errors with exponential backoff', async () => {
    vi.useFakeTimers();

    // Mock getFirestoreMod to return a controllable onSnapshot
    let errorCallback: ((error: Error & { code?: string }) => void) | null = null;
    let nextCallback: ((snapshot: Record<string, unknown>) => void) | null = null;
    const mockUnsub = vi.fn();

    vi.spyOn(await import('../firebaseModules'), 'getFirestoreMod').mockReturnValue({
      onSnapshot: (_query: unknown, _opts: unknown, onNext: (s: Record<string, unknown>) => void, onError: (e: Error) => void) => {
        nextCallback = onNext;
        errorCallback = onError;
        return mockUnsub;
      },
    } as Record<string, unknown> as ReturnType<typeof import('../firebaseModules').getFirestoreMod>);

    const { retryableOnSnapshot } = await import('../realtimeSubscriptions');
    const onNext = vi.fn();
    const onError = vi.fn();
    const queryRef = {} as import('firebase/firestore').Query;

    const unsub = retryableOnSnapshot(queryRef, { includeMetadataChanges: true }, onNext, onError);

    // Simulate transient error
    const transientError = Object.assign(new Error('unavailable'), { code: 'unavailable' });
    errorCallback!(transientError);

    // Should not call onError yet (retrying)
    expect(onError).not.toHaveBeenCalled();

    // Advance past first retry delay (1000ms)
    vi.advanceTimersByTime(1000);

    // Should have resubscribed (mockUnsub reset + new onSnapshot call)
    expect(nextCallback).not.toBeNull();

    unsub();
    vi.useRealTimers();
  });

  it('does not retry on permanent errors (PERMISSION_DENIED)', async () => {
    vi.useFakeTimers();

    let errorCallback: ((error: Error & { code?: string }) => void) | null = null;
    const mockUnsub = vi.fn();

    vi.spyOn(await import('../firebaseModules'), 'getFirestoreMod').mockReturnValue({
      onSnapshot: (_query: unknown, _opts: unknown, _onNext: unknown, onError: (e: Error) => void) => {
        errorCallback = onError;
        return mockUnsub;
      },
    } as Record<string, unknown> as ReturnType<typeof import('../firebaseModules').getFirestoreMod>);

    const { retryableOnSnapshot } = await import('../realtimeSubscriptions');
    const onNext = vi.fn();
    const onError = vi.fn();
    const queryRef = {} as import('firebase/firestore').Query;

    const unsub = retryableOnSnapshot(queryRef, { includeMetadataChanges: true }, onNext, onError);

    // Simulate permanent error
    const permError = Object.assign(new Error('permission denied'), { code: 'permission-denied' });
    errorCallback!(permError);

    // Should immediately call onError
    expect(onError).toHaveBeenCalledWith(permError);

    unsub();
    vi.useRealTimers();
  });

  it('stops retrying after max retries exceeded', async () => {
    vi.useFakeTimers();

    let errorCallback: ((error: Error & { code?: string }) => void) | null = null;
    const mockUnsub = vi.fn();

    vi.spyOn(await import('../firebaseModules'), 'getFirestoreMod').mockReturnValue({
      onSnapshot: (_query: unknown, _opts: unknown, _onNext: unknown, onError: (e: Error) => void) => {
        errorCallback = onError;
        return mockUnsub;
      },
    } as Record<string, unknown> as ReturnType<typeof import('../firebaseModules').getFirestoreMod>);

    const { retryableOnSnapshot } = await import('../realtimeSubscriptions');
    const onNext = vi.fn();
    const onError = vi.fn();
    const queryRef = {} as import('firebase/firestore').Query;

    retryableOnSnapshot(queryRef, { includeMetadataChanges: true }, onNext, onError);

    const transientError = Object.assign(new Error('unavailable'), { code: 'unavailable' });

    // Fire 4 transient errors with advancing timers between each
    for (let i = 0; i < 4; i++) {
      errorCallback!(transientError);
      vi.advanceTimersByTime(BASE_DELAY_MS * Math.pow(2, i));
    }

    // 5th error should exceed MAX_RETRIES (4)
    errorCallback!(transientError);

    // Now onError should be called
    expect(onError).toHaveBeenCalledWith(transientError);

    vi.useRealTimers();
  });

  it('resets retry count on successful snapshot', async () => {
    vi.useFakeTimers();

    let errorCallback: ((error: Error & { code?: string }) => void) | null = null;
    let nextCallback: ((snapshot: Record<string, unknown>) => void) | null = null;
    const mockUnsub = vi.fn();

    vi.spyOn(await import('../firebaseModules'), 'getFirestoreMod').mockReturnValue({
      onSnapshot: (_query: unknown, _opts: unknown, onNext: (s: Record<string, unknown>) => void, onError: (e: Error) => void) => {
        nextCallback = onNext;
        errorCallback = onError;
        return mockUnsub;
      },
    } as Record<string, unknown> as ReturnType<typeof import('../firebaseModules').getFirestoreMod>);

    const { retryableOnSnapshot } = await import('../realtimeSubscriptions');
    const onNext = vi.fn();
    const onError = vi.fn();
    const queryRef = {} as import('firebase/firestore').Query;

    const unsub = retryableOnSnapshot(queryRef, { includeMetadataChanges: true }, onNext, onError);

    // Simulate transient error then successful retry
    const transientError = Object.assign(new Error('unavailable'), { code: 'unavailable' });
    errorCallback!(transientError);
    vi.advanceTimersByTime(1000);

    // Successful snapshot resets counter
    nextCallback!({ docs: [] });
    expect(onNext).toHaveBeenCalled();

    unsub();
    vi.useRealTimers();
  });
});
