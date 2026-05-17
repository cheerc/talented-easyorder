import type { PosState } from '../store/posStore';

const CURRENT_SCHEMA_VERSION = 2;

const REQUIRED_KEYS = [
  'students', 'transactions', 'vendors', 'todayMenu',
  'auditEvents', 'dailySettlements', 'businessDateStatuses',
] as const;

const ARRAY_KEYS = new Set<string>(['students', 'transactions', 'vendors', 'auditEvents', 'dailySettlements']);
const OBJECT_KEYS = new Set<string>(['todayMenu', 'businessDateStatuses']);

export type MigrationResult =
  | { ok: true; state: PosState & { schemaVersion: number } }
  | { ok: false; reason: string };

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

export function migrateState(raw: unknown): MigrationResult {
  if (raw === null || raw === undefined) {
    return { ok: false, reason: 'persisted state is null or undefined' };
  }
  if (typeof raw !== 'object') {
    return { ok: false, reason: `expected object, got ${typeof raw}` };
  }

  const state = raw as Record<string, unknown>;
  const version = (state.schemaVersion as number) ?? 0;

  if (version >= CURRENT_SCHEMA_VERSION) {
    (state as Record<string, unknown>).schemaVersion = CURRENT_SCHEMA_VERSION;
    return { ok: true, state: state as unknown as PosState & { schemaVersion: number } };
  }

  const rawTx = state.transactions as Array<Record<string, unknown>> | undefined;
  if (!rawTx || !Array.isArray(rawTx)) {
    return { ok: false, reason: 'transactions is not an array' };
  }

  const oldTypes = new Set(['topup', 'cancel', 'correction', 'void']);

  // Type remapping: topup→payment, cancel/correction/void→drop
  const migratedTx = rawTx
    .filter((t) => {
      const type = t.type as string;
      if (type === 'cancel' || type === 'correction' || type === 'void') return false;
      return true;
    })
    .map((t) => {
      const type = t.type as string;
      if (type === 'topup') return { ...t, type: 'payment' };
      return t;
    }) as Array<Record<string, unknown>>;

  state.transactions = migratedTx;

  // Recalculate student balances from 0
  const rawStudents = state.students as Array<Record<string, unknown>> | undefined;
  if (rawStudents && Array.isArray(rawStudents)) {
    const balanceMap = new Map<string, number>();
    for (const s of rawStudents) {
      balanceMap.set(s.studentId as string, 0);
    }

    const sorted = [...migratedTx].sort((a, b) => {
      const aDate = (a.businessDate as string) || '';
      const bDate = (b.businessDate as string) || '';
      if (aDate !== bDate) return aDate.localeCompare(bDate);
      const aAt = (a.createdAt as string) || '';
      const bAt = (b.createdAt as string) || '';
      if (aAt !== bAt) return aAt.localeCompare(bAt);
      return ((a.transactionId as string) || '').localeCompare((b.transactionId as string) || '');
    });

    for (const tx of sorted) {
      const sid = tx.studentId as string;
      const paidAmount = (tx.paidAmount as number) || 0;
      const mealPrice = (tx.mealPrice as number) || 0;
      const amount = (paidAmount - mealPrice);
      tx.amount = amount;

      const prev = balanceMap.get(sid) ?? 0;
      const newBalance = prev + amount;
      balanceMap.set(sid, newBalance);
      tx.afterBalance = newBalance;
    }

    state.students = rawStudents.map((s) => ({
      ...s,
      currentBalance: Math.round(balanceMap.get(s.studentId as string) ?? (s.currentBalance as number) ?? 0),
    }));
  }

  (state as Record<string, unknown>).schemaVersion = CURRENT_SCHEMA_VERSION;
  return { ok: true, state: state as unknown as PosState & { schemaVersion: number } };
}
