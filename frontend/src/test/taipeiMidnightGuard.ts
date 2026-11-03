// RED stub (#614): the real guard lands in the GREEN commit.
export const TAIPEI_MIDNIGHT_MARGIN_MS = 0;
export const TAIPEI_MIDNIGHT_BUFFER_MS = 0;

export function msUntilTaipeiMidnight(_nowMs: number): number {
  return 0;
}

export function taipeiMidnightWaitMs(_nowMs: number, _marginMs = TAIPEI_MIDNIGHT_MARGIN_MS, _bufferMs = TAIPEI_MIDNIGHT_BUFFER_MS): number {
  return 0;
}

export async function guardTaipeiMidnight(_deps: {
  env: Record<string, string | undefined>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}): Promise<number> {
  return 0;
}
