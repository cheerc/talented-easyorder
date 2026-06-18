import type { ValidationResult } from '../types/validation';
import type { WirePersistedState } from './wireTypes';
import { recalculateStudentBalances } from '../domain/ledger';
import type { StudentAccount } from '../domain/student';
import type { LedgerTransaction } from '../domain/ledger';

const CURRENT_SCHEMA_VERSION = 2;

// Ref: #296 — Runtime type guards to replace unsafe `as unknown` casts.
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Structural guard: checks all required keys, array/object shape. */
export function isWirePersistedState(v: unknown): v is WirePersistedState {
  if (!isRecord(v)) return false;
  for (const key of REQUIRED_KEYS) {
    if (!(key in v)) return false;
  }
  for (const key of ARRAY_KEYS) {
    if (!Array.isArray(v[key])) return false;
  }
  for (const key of OBJECT_KEYS) {
    const val = v[key];
    if (val === null || typeof val !== 'object' || Array.isArray(val)) return false;
  }
  return true;
}

const REQUIRED_KEYS = [
  'students', 'transactions', 'vendors', 'todayMenu',
  'auditEvents', 'dailySettlements', 'businessDateStatuses',
  'cashSessions',
] as const;

const ARRAY_KEYS = new Set<string>(['students', 'transactions', 'vendors', 'auditEvents', 'dailySettlements']);
const OBJECT_KEYS = new Set<string>(['todayMenu', 'businessDateStatuses', 'cashSessions']);

export type MigrationResult =
  | { ok: true; state: WirePersistedState & { schemaVersion: number } }
  | { ok: false; reason: string };

export type PersistedStateValidationResult =
  | { ok: true; state: WirePersistedState }
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

function hasStr(v: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(v, key) && typeof v[key] === 'string';
}

function hasNum(v: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(v, key) && typeof v[key] === 'number';
}

function isSafeInt(n: unknown): boolean {
  return typeof n === 'number' && Number.isSafeInteger(n);
}

export function validateStudentAccount(s: unknown): ValidationResult {
  if (!isRecord(s)) return { ok: false, reason: 'expected object' };
  const r = s;
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

export function validateLedgerTransaction(t: unknown): ValidationResult {
  if (!isRecord(t)) return { ok: false, reason: 'expected object' };
  const r = t;
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

export function validateTodayMenu(m: unknown): ValidationResult {
  if (!isRecord(m)) return { ok: false, reason: 'expected object' };
  const r = m;
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

export function validateLedgerAuditEvent(e: unknown): ValidationResult {
  if (!isRecord(e)) return { ok: false, reason: 'expected object' };
  const r = e;
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

export function validateDailySettlement(s: unknown): ValidationResult {
  if (!isRecord(s)) return { ok: false, reason: 'expected object' };
  const r = s;
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

export function validateVendor(v: unknown): ValidationResult {
  if (!isRecord(v)) return { ok: false, reason: 'expected object' };
  const r = v;
  if (!hasStr(r, 'vendorId')) return { ok: false, reason: 'missing vendorId' };
  if (!hasStr(r, 'name')) return { ok: false, reason: 'missing name' };
  if (!hasStr(r, 'createdAt')) return { ok: false, reason: 'missing createdAt' };
  if (!hasStr(r, 'updatedAt')) return { ok: false, reason: 'missing updatedAt' };
  if (!hasNum(r, 'revision')) return { ok: false, reason: 'missing revision' };
  if (r.revision < 1) return { ok: false, reason: 'invalid revision' };
  if (!VALID_VENDOR_STATUSES.has(r.status as string)) return { ok: false, reason: `invalid status: ${String(r.status)}` };
  return { ok: true };
}

export function validatePersistedState(
  raw: unknown,
  opts?: { skipDeepValidation?: boolean },
): PersistedStateValidationResult {
  if (!isRecord(raw)) {
    return { ok: false, reason: raw === null || raw === undefined ? 'persisted state is null or undefined' : `expected object, got ${typeof raw}` };
  }

  const state = raw;

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

  // When schema version matches CURRENT_SCHEMA_VERSION, data has already
  // passed through migrateState(). Skip deep per-item validation to avoid
  // blocking the main thread on large datasets (1000+ transactions, hundreds
  // of students).
  if (opts?.skipDeepValidation) {
    // Structure already validated above; narrow via guard for type safety.
    if (!isWirePersistedState(state)) return { ok: false, reason: 'structural guard failed' };
    return { ok: true, state };
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

  if (!isWirePersistedState(state)) return { ok: false, reason: 'structural guard failed after deep validation' };
  return { ok: true, state };
}

export function migrateState(raw: unknown): MigrationResult {
  if (!isRecord(raw)) {
    return { ok: false, reason: raw === null || raw === undefined ? 'persisted state is null or undefined' : `expected object, got ${typeof raw}` };
  }

  const state = raw;
  const version = typeof state.schemaVersion === 'number' ? state.schemaVersion : 0;

  if (version >= CURRENT_SCHEMA_VERSION) {
    state.schemaVersion = CURRENT_SCHEMA_VERSION;
    // Shallow structure check: report which key/shape is wrong
    for (const key of REQUIRED_KEYS) {
      if (!(key in state)) return { ok: false, reason: `missing required key: ${key}` };
    }
    for (const key of ARRAY_KEYS) {
      if (!Array.isArray(state[key])) return { ok: false, reason: `expected array for key: ${key}` };
    }
    for (const key of OBJECT_KEYS) {
      const val = state[key];
      if (val === null || typeof val !== 'object' || Array.isArray(val)) return { ok: false, reason: `expected object for key: ${key}` };
    }
    if (!isWirePersistedState(state)) return { ok: false, reason: 'structural guard failed for v2+ state' };
    return { ok: true, state: { ...state, schemaVersion: CURRENT_SCHEMA_VERSION } };
  }

  const rawTx = state.transactions as unknown[];
  if (!rawTx || !Array.isArray(rawTx)) {
    return { ok: false, reason: 'transactions is not an array' };
  }

  // Type remapping: topup→payment, cancel/correction/void→drop
  const migratedTx = (rawTx as Array<Record<string, unknown>>)
    .filter((t) => {
      const type = String(t.type);
      if (type === 'cancel' || type === 'correction' || type === 'void') return false;
      return true;
    })
    .map((t) => {
      const type = String(t.type);
      if (type === 'topup') return { ...t, type: 'payment' };
      return t;
    });

  state.transactions = migratedTx;

  // Recalculate student balances using shared domain logic
  const rawStudents = state.students;
  if (Array.isArray(rawStudents)) {
    // Compute amount for each migrated transaction before recalc
    for (const tx of migratedTx) {
      const paidAmount = typeof tx.paidAmount === 'number' ? tx.paidAmount : 0;
      const mealPrice = typeof tx.mealPrice === 'number' ? tx.mealPrice : 0;
      tx.amount = (paidAmount - mealPrice);
    }

    // At this point the data is structurally validated by migration logic;
    // recalculateStudentBalances expects domain types which are structurally
    // identical to the wire records after migration.
    const result = recalculateStudentBalances(
      rawStudents as StudentAccount[],
      migratedTx as unknown as LedgerTransaction[],
    );

    state.students = result.students;
    state.transactions = result.transactions;
  }

  state.schemaVersion = CURRENT_SCHEMA_VERSION;
  if (!isWirePersistedState(state)) return { ok: false, reason: 'structural guard failed after migration' };
  return { ok: true, state: { ...state, schemaVersion: CURRENT_SCHEMA_VERSION } };
}
