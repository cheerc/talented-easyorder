import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSystemDate } from '../useSystemDate';

beforeEach(() => {
  vi.useFakeTimers();
  // Ref: #367 — Use a time that is unambiguous in Asia/Taipei:
  // 2026-06-01T10:00:00Z = 2026-06-01T18:00:00+08:00 (still June 1 in Taiwan)
  vi.setSystemTime(new Date('2026-06-01T10:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSystemDate', () => {
  it('S1: returns systemDate and viewDate as today Taiwan date on mount', () => {
    const { result } = renderHook(() => useSystemDate());

    expect(result.current.systemDate).toBe('2026-06-01');
    expect(result.current.viewDate).toBe('2026-06-01');
  });

  it('S2: setViewDate updates viewDate but not systemDate', () => {
    const { result } = renderHook(() => useSystemDate());

    act(() => result.current.setViewDate('2026-06-02'));

    expect(result.current.viewDate).toBe('2026-06-02');
    expect(result.current.systemDate).toBe('2026-06-01');
  });

  it('S3: interval tick updates systemDate across Taiwan midnight', () => {
    // Start at 2026-06-01T15:59:00Z = 2026-06-01T23:59:00+08:00 (Taiwan)
    vi.setSystemTime(new Date('2026-06-01T15:59:00Z'));
    const { result } = renderHook(() => useSystemDate());
    expect(result.current.systemDate).toBe('2026-06-01');

    // Advance 2 minutes → 2026-06-01T16:01:00Z = 2026-06-02T00:01:00+08:00
    act(() => {
      vi.advanceTimersByTime(120_000);
    });

    expect(result.current.systemDate).toBe('2026-06-02');
  });

  it('S4: visibilitychange event updates systemDate', () => {
    vi.setSystemTime(new Date('2026-06-02T08:00:00Z'));
    const { result } = renderHook(() => useSystemDate());

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // 2026-06-02T08:00:00Z = 2026-06-02T16:00:00+08:00 → June 2 in Taiwan
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
