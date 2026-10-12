import { describe, it, expect } from 'vitest';
import { getTaiwanDate, getTaiwanISOString, formatTaipeiDateTime, formatTaipeiTime } from '../dateTime';

describe('#367 — Taiwan timezone utilities', () => {
  it('getTaiwanDate returns YYYY-MM-DD format', () => {
    const result = getTaiwanDate();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('getTaiwanISOString returns ISO-like string with +08:00 suffix', () => {
    const result = getTaiwanISOString();
    // Format: YYYY-MM-DDTHH:MM:SS+08:00
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
  });

  it('getTaiwanDate returns a valid date', () => {
    const result = getTaiwanDate();
    const parsed = new Date(result);
    expect(parsed.toString()).not.toBe('Invalid Date');
  });

  it('getTaiwanISOString parses to a valid Date', () => {
    const result = getTaiwanISOString();
    const parsed = new Date(result);
    expect(parsed.toString()).not.toBe('Invalid Date');
  });
});

describe('formatTaipeiDateTime / formatTaipeiTime（M2 F10）', () => {
  it('UTC 時間轉成台北時間（+8 小時），跨日也正確', () => {
    expect(formatTaipeiDateTime('2026-05-30T08:42:58.000Z')).toBe('2026-05-30 16:42:58');
    expect(formatTaipeiDateTime('2026-05-30T18:00:00.000Z')).toBe('2026-05-31 02:00:00');
    expect(formatTaipeiTime('2026-05-30T08:42:58.000Z')).toBe('16:42:58');
  });

  it('已帶 +08:00 的字串不再位移', () => {
    expect(formatTaipeiTime('2026-05-30T16:42:58+08:00')).toBe('16:42:58');
  });

  it('空值或無法解析時回傳空字串', () => {
    expect(formatTaipeiDateTime('')).toBe('');
    expect(formatTaipeiDateTime(undefined)).toBe('');
    expect(formatTaipeiTime('not-a-date')).toBe('');
  });
});
