import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import { decodeBackfillDoc } from '../../domain/cloudCommandSchema';
import { isBackfilled } from '../cloudDayCloseRepository';

const marker = { dayId: '2026-10-10' };

describe('isBackfilled (contract §12)', () => {
  it('is true only with a marker for that day and a Taipei creation date later than the business date', () => {
    // 2026-10-11 02:00 in Taipei is 2026-10-10 18:00 UTC.
    expect(isBackfilled({ businessDate: '2026-10-10', createdAt: new Date('2026-10-10T18:00:00Z') }, marker)).toBe(true);
    expect(isBackfilled({ businessDate: '2026-10-10', createdAt: Timestamp.fromDate(new Date('2026-10-12T04:00:00Z')) }, marker)).toBe(true);
  });

  it('is false on the business date itself, even when the UTC date already differs', () => {
    // 2026-10-10 23:30 in Taipei is 2026-10-10 15:30 UTC; 2026-10-10 01:00 in Taipei is 2026-10-09 17:00 UTC.
    expect(isBackfilled({ businessDate: '2026-10-10', createdAt: new Date('2026-10-10T15:30:00Z') }, marker)).toBe(false);
    expect(isBackfilled({ businessDate: '2026-10-10', createdAt: new Date('2026-10-09T17:00:00Z') }, marker)).toBe(false);
  });

  it('is false without a marker or with a marker for another day', () => {
    const later = new Date('2026-10-12T04:00:00Z');
    expect(isBackfilled({ businessDate: '2026-10-10', createdAt: later }, null)).toBe(false);
    expect(isBackfilled({ businessDate: '2026-10-09', createdAt: later }, marker)).toBe(false);
  });
});

describe('decodeBackfillDoc', () => {
  const valid = () => ({
    dayId: '2026-10-10', reason: '停電', startedBy: 'uid-1', startedAt: Timestamp.fromDate(new Date('2026-10-12T04:00:00Z')),
    commandId: '00000000-0000-4000-8000-000000000001',
  });

  it('accepts exactly the five fields', () => {
    expect(decodeBackfillDoc(valid(), '2026-10-10')).toMatchObject({ dayId: '2026-10-10', reason: '停電' });
  });

  it.each<[string, (value: Record<string, unknown>) => unknown]>([
    ['another path', value => value],
    ['an extra field', value => ({ ...value, extra: 1 })],
    ['a missing field', value => { const { commandId, ...rest } = value; void commandId; return rest; }],
    ['an empty reason', value => ({ ...value, reason: '' })],
    ['a long reason', value => ({ ...value, reason: 'x'.repeat(501) })],
    ['a plain Date', value => ({ ...value, startedAt: new Date() })],
    ['not an object', () => 'marker'],
  ])('rejects %s', (label, change) => {
    const path = label === 'another path' ? '2026-10-11' : '2026-10-10';
    expect(() => decodeBackfillDoc(change(valid()), path)).toThrow();
  });
});
