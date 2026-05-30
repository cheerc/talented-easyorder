import type { PosState } from '../store/posTypes';

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

// ---- deep validation functions ----

const VALID_STUDENT_STATUSES = new Set(['active', 'inactive']);
const VALID_FACE_STATUSES = new Set(['none', 'enrolled', 'disabled', 'needs_review']);
const VALID_TX_TYPES = new Set(['order', 'payment', 'expense']);
const VALID_SYNC_STATUSES = new Set(['local', 'queued', 'synced', 'failed', 'conflict']);
const VALID_SOURCE_DEVICES = new Set(['pc', 'barcode_scanner', 'ipad_handoff']);
const VALID_SETTLEMENT_STATUSES = new Set(['open', 'closed', 'reopened']);
const VALID_AUDIT_EVENT_TYPES = new Set([
  'transaction_edited', 'transaction_deleted', 'transaction_hard_deleted',
  'business_date_closed', 'business_date_reopened', 'csv_exported', 'report_printed',
]);
const VALID_AUDIT_ENTITY_TYPES = new Set(['transaction', 'settlement', 'business_date', 'export']);
const VALID_VENDOR_STATUSES = new Set(['active', 'inactive']);

function hasStr(v: unknown, key: string): boolean {
  return typeof (v as Record<string, unknown>)[key] === 'string';
}

function hasNum(v: unknown, key: string): boolean {
  return typeof (v as Record<string, unknown>)[key] === 'number';
}

function isSafeInt(n: unknown): boolean {
  return typeof n === 'number' && Number.isSafeInteger(n);
}

export function validateStudentAccount(s: unknown): { ok: true } | { ok: false; reason: string } {
  if (typeof s !== 'object' || s === null) return { ok: false, reason: 'expected object' };
  const r = s as Record<string, unknown>;
  if (!hasStr(r, 'studentId')) return { ok: false, reason: 'missing studentId' };
  if (!hasStr(r, 'displayName')) return { ok: false, reason: 'missing displayName' };
  if (!hasStr(r, 'createdAt')) return { ok: false, reason: 'missing createdAt' };
  if (!hasStr(r, 'updatedAt')) return { ok: false, reason: 'missing updatedAt' };
  if (!hasNum(r, 'currentBalance')) return { ok: false, reason: 'missing currentBalance' };
  if (!hasNum(r, 'revision')) return { ok: false, reason: 'missing revision' };
  if (!isSafeInt(r.currentBalance)) return { ok: false, reason: 'currentBalance not safe integer' };
  if (!isSafeInt(r.revision) || r.revision < 1) return { ok: false, reason: 'invalid revision' };
  if (!VALID_STUDENT_STATUSES.has(r.status as string)) return { ok: false, reason: `invalid status: ${String(r.status)}` };
  if (!Array.isArray(r.aliases)) return { ok: false, reason: 'aliases not array' };
  if (!VALID_FACE_STATUSES.has(r.faceEnrollmentStatus as string)) return { ok: false, reason: `invalid faceEnrollmentStatus: ${String(r.faceEnrollmentStatus)}` };
  return { ok: true };
}

export function validateLedgerTransaction(t: unknown): { ok: true } | { ok: false; reason: string } {
  if (typeof t !== 'object' || t === null) return { ok: false, reason: 'expected object' };
  const r = t as Record<string, unknown>;
  if (!hasStr(r, 'transactionId')) return { ok: false, reason: 'missing transactionId' };
  if (!hasStr(r, 'businessDate')) return { ok: false, reason: 'missing businessDate' };
  if (!hasStr(r, 'createdAt')) return { ok: false, reason: 'missing createdAt' };
  if (!hasStr(r, 'studentId')) return { ok: false, reason: 'missing studentId' };
  if (!hasNum(r, 'mealPrice')) return { ok: false, reason: 'missing mealPrice' };
  if (!hasNum(r, 'paidAmount')) return { ok: false, reason: 'missing paidAmount' };
  if (!hasNum(r, 'amount')) return { ok: false, reason: 'missing amount' };
  if (!hasNum(r, 'afterBalance')) return { ok: false, reason: 'missing afterBalance' };
  if (!hasNum(r, 'revision')) return { ok: false, reason: 'missing revision' };
  if (!isSafeInt(r.mealPrice)) return { ok: false, reason: 'mealPrice not safe integer' };
  if (!isSafeInt(r.paidAmount)) return { ok: false, reason: 'paidAmount not safe integer' };
  if (r.revision < 1) return { ok: false, reason: 'invalid revision' };
  if (!VALID_TX_TYPES.has(r.type as string)) return { ok: false, reason: `invalid type: ${String(r.type)}` };
  if (!VALID_SYNC_STATUSES.has(r.syncStatus as string)) return { ok: false, reason: `invalid syncStatus: ${String(r.syncStatus)}` };
  if (!VALID_SOURCE_DEVICES.has(r.sourceDevice as string)) return { ok: false, reason: `invalid sourceDevice: ${String(r.sourceDevice)}` };
  return { ok: true };
}

export function validateTodayMenu(m: unknown): { ok: true } | { ok: false; reason: string } {
  if (typeof m !== 'object' || m === null) return { ok: false, reason: 'expected object' };
  const r = m as Record<string, unknown>;
  if (!hasStr(r, 'businessDate')) return { ok: false, reason: 'missing businessDate' };
  if (!hasStr(r, 'itemName')) return { ok: false, reason: 'missing itemName' };
  if (!hasStr(r, 'vendorId')) return { ok: false, reason: 'missing vendorId' };
  if (!hasStr(r, 'updatedAt')) return { ok: false, reason: 'missing updatedAt' };
  if (!hasNum(r, 'price')) return { ok: false, reason: 'missing price' };
  if (!hasNum(r, 'revision')) return { ok: false, reason: 'missing revision' };
  if (!isSafeInt(r.price) || r.price <= 0) return { ok: false, reason: 'price not positive safe integer' };
  if (r.revision < 1) return { ok: false, reason: 'invalid revision' };
  return { ok: true };
}

export function validateLedgerAuditEvent(e: unknown): { ok: true } | { ok: false; reason: string } {
  if (typeof e !== 'object' || e === null) return { ok: false, reason: 'expected object' };
  const r = e as Record<string, unknown>;
  if (!hasStr(r, 'auditEventId')) return { ok: false, reason: 'missing auditEventId' };
  if (!hasStr(r, 'entityId')) return { ok: false, reason: 'missing entityId' };
  if (!hasStr(r, 'businessDate')) return { ok: false, reason: 'missing businessDate' };
  if (!hasStr(r, 'reason')) return { ok: false, reason: 'missing reason' };
  if (!hasStr(r, 'operatorId')) return { ok: false, reason: 'missing operatorId' };
  if (!hasStr(r, 'createdAt')) return { ok: false, reason: 'missing createdAt' };
  if (!VALID_AUDIT_EVENT_TYPES.has(r.eventType as string)) return { ok: false, reason: `invalid eventType: ${String(r.eventType)}` };
  if (!VALID_AUDIT_ENTITY_TYPES.has(r.entityType as string)) return { ok: false, reason: `invalid entityType: ${String(r.entityType)}` };
  return { ok: true };
}

export function validateDailySettlement(s: unknown): { ok: true } | { ok: false; reason: string } {
  if (typeof s !== 'object' || s === null) return { ok: false, reason: 'expected object' };
  const r = s as Record<string, unknown>;
  if (!hasStr(r, 'settlementId')) return { ok: false, reason: 'missing settlementId' };
  if (!hasStr(r, 'businessDate')) return { ok: false, reason: 'missing businessDate' };
  if (!hasStr(r, 'closedBy')) return { ok: false, reason: 'missing closedBy' };
  if (!hasStr(r, 'closedAt')) return { ok: false, reason: 'missing closedAt' };
  const numFields = ['settlementRevision', 'orderCount', 'transactionCount', 'totalIncome', 'totalExpense', 'openingCash', 'netCash', 'expectedCash', 'countedCash', 'difference', 'revision'] as const;
  for (const f of numFields) {
    if (!hasNum(r, f)) return { ok: false, reason: `missing ${f}` };
  }
  if (!VALID_SETTLEMENT_STATUSES.has(r.status as string)) return { ok: false, reason: `invalid status: ${String(r.status)}` };
  if (!VALID_SYNC_STATUSES.has(r.syncStatus as string)) return { ok: false, reason: `invalid syncStatus: ${String(r.syncStatus)}` };
  return { ok: true };
}

export function validateVendor(v: unknown): { ok: true } | { ok: false; reason: string } {
  if (typeof v !== 'object' || v === null) return { ok: false, reason: 'expected object' };
  const r = v as Record<string, unknown>;
  if (!hasStr(r, 'vendorId')) return { ok: false, reason: 'missing vendorId' };
  if (!hasStr(r, 'name')) return { ok: false, reason: 'missing name' };
  if (!hasStr(r, 'createdAt')) return { ok: false, reason: 'missing createdAt' };
  if (!hasStr(r, 'updatedAt')) return { ok: false, reason: 'missing updatedAt' };
  if (!hasNum(r, 'revision')) return { ok: false, reason: 'missing revision' };
  if (r.revision < 1) return { ok: false, reason: 'invalid revision' };
  if (!VALID_VENDOR_STATUSES.has(r.status as string)) return { ok: false, reason: `invalid status: ${String(r.status)}` };
  return { ok: true };
}

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

  // Deep validation — full scan for small collections, sampling for large

  // Full: todayMenu (single object)
  const menuResult = validateTodayMenu(state.todayMenu);
  if (!menuResult.ok) return { ok: false, reason: `invalid todayMenu: ${menuResult.reason}` };

  // Full: vendors (typically <100)
  const vendors = state.vendors as unknown[];
  for (const v of vendors) {
    const r = validateVendor(v);
    if (!r.ok) return { ok: false, reason: `invalid vendor: ${r.reason}` };
  }

  // Full: dailySettlements (typically <365)
  const settlements = state.dailySettlements as unknown[];
  for (const s of settlements) {
    const r = validateDailySettlement(s);
    if (!r.ok) return { ok: false, reason: `invalid dailySettlement: ${r.reason}` };
  }

  // Full: auditEvents (typically <500)
  const auditEvents = state.auditEvents as unknown[];
  for (const e of auditEvents) {
    const r = validateLedgerAuditEvent(e);
    if (!r.ok) return { ok: false, reason: `invalid auditEvent: ${r.reason}` };
  }

  // Full scan: students
  const students = state.students as unknown[];
  for (const s of students) {
    const r = validateStudentAccount(s);
    if (!r.ok) return { ok: false, reason: `invalid student: ${r.reason}` };
  }

  // Full scan: transactions
  const transactions = state.transactions as unknown[];
  for (const t of transactions) {
    const r = validateLedgerTransaction(t);
    if (!r.ok) return { ok: false, reason: `invalid transaction: ${r.reason}` };
  }

  // Full scan: businessDateStatuses
  const bds = state.businessDateStatuses as Record<string, unknown>;
  for (const [date, status] of Object.entries(bds)) {
    if (typeof status !== 'string' || !VALID_SETTLEMENT_STATUSES.has(status)) {
      return { ok: false, reason: `invalid businessDateStatus for ${date}: ${String(status)}` };
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
