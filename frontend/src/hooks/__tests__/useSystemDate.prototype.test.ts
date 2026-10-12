import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// M0 S-DATE：練習模式下，模擬營業日取代實際日期。
vi.mock('../../appMode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../appMode')>()),
  isPrototypeMode: true,
}));

import { useSystemDate } from '../useSystemDate';
import { usePosStore } from '../../store/posStore';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-01T10:00:00Z'));
  usePosStore.getState().setSimulationDate(null);
});

afterEach(() => {
  vi.useRealTimers();
  usePosStore.getState().setSimulationDate(null);
});

describe('useSystemDate in prototype mode', () => {
  it('uses the real date until a simulation date is set, then moves systemDate and viewDate', () => {
    const { result } = renderHook(() => useSystemDate());
    expect(result.current.systemDate).toBe('2026-06-01');

    act(() => { usePosStore.getState().setSimulationDate('2026-06-03'); });
    expect(result.current.systemDate).toBe('2026-06-03');
    expect(result.current.viewDate).toBe('2026-06-03');

    // 檢視前一天不影響可寫營業日。
    act(() => { result.current.setViewDate('2026-06-02'); });
    expect(result.current.viewDate).toBe('2026-06-02');
    expect(result.current.systemDate).toBe('2026-06-03');

    act(() => { usePosStore.getState().setSimulationDate(null); });
    expect(result.current.systemDate).toBe('2026-06-01');
    expect(result.current.viewDate).toBe('2026-06-01');
  });
});
