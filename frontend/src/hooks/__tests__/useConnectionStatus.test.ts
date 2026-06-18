import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConnectionStatus } from '../useConnectionStatus';

describe('#314 — useConnectionStatus', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns isOnline: true when navigator.onLine is true', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const { result } = renderHook(() => useConnectionStatus());
    expect(result.current.isOnline).toBe(true);
  });

  it('returns isOnline: false when navigator.onLine is false', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { result } = renderHook(() => useConnectionStatus());
    expect(result.current.isOnline).toBe(false);
  });

  it('updates when online event fires', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { result } = renderHook(() => useConnectionStatus());
    expect(result.current.isOnline).toBe(false);

    // Go online
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current.isOnline).toBe(true);
  });

  it('updates when offline event fires', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const { result } = renderHook(() => useConnectionStatus());
    expect(result.current.isOnline).toBe(true);

    // Go offline
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current.isOnline).toBe(false);
  });

  it('cleans up event listeners on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useConnectionStatus());

    const onlineAdded = addSpy.mock.calls.some(c => c[0] === 'online');
    const offlineAdded = addSpy.mock.calls.some(c => c[0] === 'offline');
    expect(onlineAdded).toBe(true);
    expect(offlineAdded).toBe(true);

    unmount();

    const onlineRemoved = removeSpy.mock.calls.some(c => c[0] === 'online');
    const offlineRemoved = removeSpy.mock.calls.some(c => c[0] === 'offline');
    expect(onlineRemoved).toBe(true);
    expect(offlineRemoved).toBe(true);
  });
});
