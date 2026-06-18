import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installGlobalErrorListeners } from '../errorLogger';

describe('installGlobalErrorListeners cleanup (#291)', () => {
  let cleanup: () => void;
  const originalAddEventListener = window.addEventListener;
  const originalRemoveEventListener = window.removeEventListener;
  let listeners: Map<string, Set<EventListener>>;

  beforeEach(() => {
    listeners = new Map();
    window.addEventListener = vi.fn((type: string, handler: EventListener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(handler);
    }) as unknown as typeof window.addEventListener;
    window.removeEventListener = vi.fn((type: string, handler: EventListener) => {
      listeners.get(type)?.delete(handler);
    }) as unknown as typeof window.removeEventListener;
  });

  afterEach(() => {
    window.addEventListener = originalAddEventListener;
    window.removeEventListener = originalRemoveEventListener;
  });

  it('registers error and unhandledrejection listeners', () => {
    cleanup = installGlobalErrorListeners();
    expect(listeners.get('error')?.size).toBe(1);
    expect(listeners.get('unhandledrejection')?.size).toBe(1);
  });

  it('cleanup removes all listeners', () => {
    cleanup = installGlobalErrorListeners();
    cleanup();
    expect(listeners.get('error')?.size ?? 0).toBe(0);
    expect(listeners.get('unhandledrejection')?.size ?? 0).toBe(0);
  });
});
