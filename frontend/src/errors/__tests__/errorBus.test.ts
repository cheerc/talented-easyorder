import { describe, expect, it, beforeEach, vi } from 'vitest';
import { emitError, onError, offError, _resetForTest } from '../errorBus';
import type { ErrorLogEntry } from '../errorLogger';

type ErrorInput = Omit<ErrorLogEntry, 'id' | 'createdAt'>;

beforeEach(() => {
  _resetForTest();
});

describe('errorBus', () => {
  it('delivers emitted errors to subscribed listeners', () => {
    const listener = vi.fn();
    onError(listener);

    const entry: ErrorInput = { source: 'auth', message: 'test error' };
    emitError(entry);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(entry);
  });

  it('supports multiple listeners', () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    onError(listenerA);
    onError(listenerB);

    emitError({ source: 'sync', message: 'multi' });

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
  });

  it('removes listener via offError', () => {
    const listener = vi.fn();
    onError(listener);
    offError(listener);

    emitError({ source: 'storage', message: 'removed' });

    expect(listener).not.toHaveBeenCalled();
  });

  it('returns unsubscribe function from onError', () => {
    const listener = vi.fn();
    const unsubscribe = onError(listener);
    unsubscribe();

    emitError({ source: 'storage', message: 'unsubscribed' });

    expect(listener).not.toHaveBeenCalled();
  });

  it('does not throw when emitting with no listeners', () => {
    expect(() => emitError({ source: 'auth', message: 'no listeners' })).not.toThrow();
  });

  it('does not call already-removed listener even if other listeners remain', () => {
    const kept = vi.fn();
    const removed = vi.fn();
    onError(kept);
    onError(removed);
    offError(removed);

    emitError({ source: 'auth', message: 'partial' });

    expect(kept).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });

  it('handles listener errors without breaking other listeners', () => {
    const badListener = vi.fn(() => { throw new Error('boom'); });
    const goodListener = vi.fn();
    onError(badListener);
    onError(goodListener);

    // Should not throw, and good listener should still be called
    expect(() => emitError({ source: 'auth', message: 'error in listener' })).not.toThrow();
    expect(goodListener).toHaveBeenCalledTimes(1);
  });
});
