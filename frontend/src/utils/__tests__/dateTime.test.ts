import { describe, it, expect } from 'vitest';
import { getTaiwanDate, getTaiwanISOString } from '../dateTime';

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
