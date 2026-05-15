import type { PosState } from '../store/posStore';

const REQUIRED_KEYS = [
  'students', 'transactions', 'vendors', 'todayMenu',
  'auditEvents', 'dailySettlements', 'businessDateStatuses',
] as const;

const ARRAY_KEYS = new Set<string>(['students', 'transactions', 'vendors', 'auditEvents', 'dailySettlements']);
const OBJECT_KEYS = new Set<string>(['todayMenu', 'businessDateStatuses']);

export type ValidationResult =
  | { ok: true; state: PosState }
  | { ok: false; reason: string };

export function validatePersistedState(raw: unknown): ValidationResult {
  if (raw === null || raw === undefined) {
    return { ok: false, reason: 'persisted state is null or undefined' };
  }
  if (typeof raw !== 'object') {
    return { ok: false, reason: `expected object, got ${typeof raw}` };
  }

  const state = raw as Record<string, unknown>;

  for (const key of REQUIRED_KEYS) {
    if (!(key in state)) {
      return { ok: false, reason: `missing required key: ${key}` };
    }
  }

  for (const key of ARRAY_KEYS) {
    if (!Array.isArray(state[key])) {
      return { ok: false, reason: `expected array for key: ${key}, got ${typeof state[key]}` };
    }
  }

  for (const key of OBJECT_KEYS) {
    const val = state[key];
    if (val === null || typeof val !== 'object' || Array.isArray(val)) {
      return { ok: false, reason: `expected object for key: ${key}, got ${typeof val}` };
    }
  }

  return { ok: true, state: state as unknown as PosState };
}
