import { describe, expect, it } from 'vitest';
import { businessWeekday, formatBusinessDate } from '../businessDate';

describe('formatBusinessDate (#707)', () => {
  it('shows the weekday for every day of a week, with full-width parentheses', () => {
    expect(formatBusinessDate('2026-11-09')).toBe('2026-11-09（一）');
    expect(formatBusinessDate('2026-11-10')).toBe('2026-11-10（二）');
    expect(formatBusinessDate('2026-11-11')).toBe('2026-11-11（三）');
    expect(formatBusinessDate('2026-11-12')).toBe('2026-11-12（四）');
    expect(formatBusinessDate('2026-11-13')).toBe('2026-11-13（五）');
    expect(formatBusinessDate('2026-11-14')).toBe('2026-11-14（六）');
    expect(formatBusinessDate('2026-11-15')).toBe('2026-11-15（日）');
  });

  it('uses U+FF08 / U+FF09, not ASCII parentheses', () => {
    const text = formatBusinessDate('2026-11-13');
    expect(text.codePointAt(10)).toBe(0xff08);
    expect(text.codePointAt(12)).toBe(0xff09);
    expect(text).not.toMatch(/[()]/);
  });

  it('handles year boundaries and leap days', () => {
    expect(formatBusinessDate('2026-12-31')).toBe('2026-12-31（四）');
    expect(formatBusinessDate('2027-01-01')).toBe('2027-01-01（五）');
    expect(formatBusinessDate('2024-02-29')).toBe('2024-02-29（四）');
    expect(formatBusinessDate('2028-02-29')).toBe('2028-02-29（二）');
  });

  it('returns invalid input unchanged and never throws', () => {
    for (const bad of ['2023-02-29', '2026-13-01', '2026-00-10', '', '2026-1-5', '2026-11-13 ', 'abc']) {
      expect(formatBusinessDate(bad)).toBe(bad);
      expect(businessWeekday(bad)).toBe('');
    }
  });
});

describe('businessWeekday (#707)', () => {
  it('returns one weekday character', () => {
    expect(businessWeekday('2026-11-13')).toBe('五');
    expect(businessWeekday('2026-11-15')).toBe('日');
  });
});
