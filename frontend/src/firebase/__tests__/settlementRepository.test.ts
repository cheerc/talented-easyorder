import { describe, expect, it } from 'vitest';
import { createCloseAttemptId, summarizeCloseAttemptConflict } from '../settlementRepository';

describe('settlementRepository', () => {
  it('creates stable close attempt ids', () => {
    expect(createCloseAttemptId('pc-1', '2026-05-16', 7)).toBe('pc-1:close:2026-05-16:7');
  });

  it('marks multiple different attempts as conflict', () => {
    expect(summarizeCloseAttemptConflict([
      { id: 'a', actualDrawer: 5260, difference: 0 },
      { id: 'b', actualDrawer: 5250, difference: -10 },
    ])).toEqual({ conflict: true, attemptIds: ['a', 'b'] });
  });
});
