import { describe, it, expect } from 'vitest';
import {
  isHistoricalBusinessDate,
  canWriteBusinessDate,
} from '../businessDate';
describe('isHistoricalBusinessDate', () => {
  it('returns false when viewDate equals systemDate', () => {
    expect(isHistoricalBusinessDate('2026-05-07', '2026-05-07')).toBe(false);
  });

  it('returns true when viewDate is before systemDate', () => {
    expect(isHistoricalBusinessDate('2026-05-06', '2026-05-07')).toBe(true);
  });

  it('returns false when viewDate is after systemDate', () => {
    expect(isHistoricalBusinessDate('2026-05-08', '2026-05-07')).toBe(false);
  });
});

describe('canWriteBusinessDate', () => {
  it('current open date is writable', () => {
    expect(canWriteBusinessDate('open', '2026-05-07', '2026-05-07')).toBe(true);
  });

  it('historical date is not writable', () => {
    expect(canWriteBusinessDate('open', '2026-05-06', '2026-05-07')).toBe(false);
  });

  it('closed date is not writable even if current', () => {
    expect(canWriteBusinessDate('closed', '2026-05-07', '2026-05-07')).toBe(false);
  });

  it('reopened date is writable when not historical', () => {
    expect(canWriteBusinessDate('reopened', '2026-05-07', '2026-05-07')).toBe(true);
  });

  it('reopened date is not writable when historical', () => {
    expect(canWriteBusinessDate('reopened', '2026-05-06', '2026-05-07')).toBe(false);
  });
});
