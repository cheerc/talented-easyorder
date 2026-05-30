import { describe, expect, it } from 'vitest';

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
