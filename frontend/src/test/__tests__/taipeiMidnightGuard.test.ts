import { describe, expect, it, vi } from 'vitest';
import {
  TAIPEI_MIDNIGHT_BUFFER_MS,
  TAIPEI_MIDNIGHT_MARGIN_MS,
  guardTaipeiMidnight,
  msUntilTaipeiMidnight,
  taipeiMidnightWaitMs,
} from '../taipeiMidnightGuard';

const at = (iso: string) => Date.parse(iso);
const DAY_MS = 86_400_000;

describe('taipeiMidnightGuard (#614)', () => {
  it('waits 420 s before Taipei midnight with a 2 s buffer after it', () => {
    expect(TAIPEI_MIDNIGHT_MARGIN_MS).toBe(420_000);
    expect(TAIPEI_MIDNIGHT_BUFFER_MS).toBe(2_000);
  });

  it('measures the time left until the next Taipei midnight (16:00 UTC)', () => {
    expect(msUntilTaipeiMidnight(at('2026-11-03T15:59:50.000Z'))).toBe(10_000);
    expect(msUntilTaipeiMidnight(at('2026-11-03T04:00:00.000Z'))).toBe(12 * 3_600_000);
    expect(msUntilTaipeiMidnight(at('2026-11-03T16:00:01.000Z'))).toBe(DAY_MS - 1_000);
    // Exactly midnight is the start of a new day: the next midnight is a whole day away.
    expect(msUntilTaipeiMidnight(at('2026-11-03T16:00:00.000Z'))).toBe(DAY_MS);
  });

  it('waits until just past midnight only inside the margin', () => {
    expect(taipeiMidnightWaitMs(at('2026-11-03T15:59:50.000Z'))).toBe(12_000);
    expect(taipeiMidnightWaitMs(at('2026-11-03T04:00:00.000Z'))).toBe(0);
    expect(taipeiMidnightWaitMs(at('2026-11-03T15:53:00.000Z'))).toBe(422_000);
    expect(taipeiMidnightWaitMs(at('2026-11-03T15:52:59.999Z'))).toBe(0);
    expect(taipeiMidnightWaitMs(at('2026-11-03T16:00:00.000Z'))).toBe(0);
    expect(taipeiMidnightWaitMs(at('2026-11-03T16:00:01.000Z'))).toBe(0);
  });

  it('takes the margin and buffer as arguments', () => {
    expect(taipeiMidnightWaitMs(at('2026-11-03T15:59:00.000Z'), 30_000, 0)).toBe(0);
    expect(taipeiMidnightWaitMs(at('2026-11-03T15:59:40.000Z'), 30_000, 500)).toBe(20_500);
  });

  it('does nothing without an Emulator environment', async () => {
    const sleep = vi.fn(async () => undefined);
    const waited = await guardTaipeiMidnight({ env: {}, now: () => at('2026-11-03T15:59:50.000Z'), sleep });
    expect(waited).toBe(0);
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each(['FIRESTORE_EMULATOR_HOST', 'FIREBASE_FIRESTORE_EMULATOR_ADDRESS'])(
    'sleeps past midnight once and logs it when %s is set', async name => {
      const sleep = vi.fn(async () => undefined);
      const log = vi.fn();
      const waited = await guardTaipeiMidnight({
        env: { [name]: '127.0.0.1:8080' }, now: () => at('2026-11-03T15:59:50.000Z'), sleep, log,
      });
      expect(waited).toBe(12_000);
      expect(sleep).toHaveBeenCalledTimes(1);
      expect(sleep).toHaveBeenCalledWith(12_000);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]?.[0]).toContain('12s');
    },
  );

  it('does not sleep in an Emulator environment far from midnight', async () => {
    const sleep = vi.fn(async () => undefined);
    const log = vi.fn();
    const waited = await guardTaipeiMidnight({
      env: { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, now: () => at('2026-11-03T04:00:00.000Z'), sleep, log,
    });
    expect(waited).toBe(0);
    expect(sleep).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
