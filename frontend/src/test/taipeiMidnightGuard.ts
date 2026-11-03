/**
 * Emulator specs fix "today" (Asia/Taipei) when they load, often as a module constant, while Rules judge the day from the
 * Emulator's real `request.time`. A spec file that runs across Taipei midnight therefore sends commands for a day that has
 * become a past day without a back-fill marker, and they are refused (#614). Vitest runs the setup file before each test
 * file is imported, so waiting there until just past midnight keeps every file within one Taipei day.
 */

/**
 * A file starting this close to midnight waits for it. The longest single Emulator spec (`cloudCapacity.spec.ts`) takes
 * about 210 s on CI; twice that leaves room for growth. A wait happens at most once a day and costs at most about 7 minutes.
 */
export const TAIPEI_MIDNIGHT_MARGIN_MS = 420_000;
/** Past midnight, so rounding between the Node and Emulator clocks (same host) cannot leave the old day. */
export const TAIPEI_MIDNIGHT_BUFFER_MS = 2_000;

const DAY_MS = 86_400_000;
/** Taipei midnight is 16:00 UTC; Taiwan has no daylight saving time. */
const TAIPEI_MIDNIGHT_UTC_MS = 16 * 3_600_000;

/** Milliseconds until the next Taipei midnight, in (0, 86_400_000]. */
export function msUntilTaipeiMidnight(nowMs: number): number {
  const sinceUtcMidnight = ((nowMs % DAY_MS) + DAY_MS) % DAY_MS;
  const left = (TAIPEI_MIDNIGHT_UTC_MS - sinceUtcMidnight + DAY_MS) % DAY_MS;
  return left === 0 ? DAY_MS : left;
}

/** How long to wait: the time left plus the buffer when it is within the margin, otherwise 0. */
export function taipeiMidnightWaitMs(nowMs: number, marginMs = TAIPEI_MIDNIGHT_MARGIN_MS, bufferMs = TAIPEI_MIDNIGHT_BUFFER_MS): number {
  const left = msUntilTaipeiMidnight(nowMs);
  return left <= marginMs ? left + bufferMs : 0;
}

/** Waits past Taipei midnight when it is close, only where a Firestore Emulator is configured. Returns the wait. */
export async function guardTaipeiMidnight(deps: {
  env: Record<string, string | undefined>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}): Promise<number> {
  if (!deps.env.FIRESTORE_EMULATOR_HOST && !deps.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS) return 0;
  const wait = taipeiMidnightWaitMs(deps.now());
  if (wait === 0) return 0;
  deps.log?.(`[#614] waiting ${Math.ceil(wait / 1_000)}s for Taipei midnight before this Emulator spec`);
  await deps.sleep(wait);
  return wait;
}
