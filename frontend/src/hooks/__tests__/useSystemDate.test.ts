import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSystemDate } from '../useSystemDate';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-31T23:59:59Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSystemDate', () => {
  it('S1: returns systemDate and viewDate as today ISO date on mount', () => {
    const { result } = renderHook(() => useSystemDate());

    expect(result.current.systemDate).toBe('2026-05-31');
    expect(result.current.viewDate).toBe('2026-05-31');
  });

  it('S2: setViewDate updates viewDate but not systemDate', () => {
    const { result } = renderHook(() => useSystemDate());

    act(() => result.current.setViewDate('2026-06-01'));

    expect(result.current.viewDate).toBe('2026-06-01');
    expect(result.current.systemDate).toBe('2026-05-31');
  });

  it('S3: interval tick updates systemDate across date boundary', () => {
    const { result } = renderHook(() => useSystemDate());
    expect(result.current.systemDate).toBe('2026-05-31');

    // Hook uses 60s interval; advance to fire the tick after crossing midnight
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(result.current.systemDate).toBe('2026-06-01');
  });

  it('S4: visibilitychange event updates systemDate', () => {
    vi.setSystemTime(new Date('2026-06-02T08:00:00Z'));
    const { result } = renderHook(() => useSystemDate());

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(result.current.systemDate).toBe('2026-06-02');
  });

  it('S5: cleanup on unmount clears interval and removes listener', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const removeListenerSpy = vi.spyOn(document, 'removeEventListener');

    const { unmount } = renderHook(() => useSystemDate());
    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(removeListenerSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

    clearIntervalSpy.mockRestore();
    removeListenerSpy.mockRestore();
  });
});
