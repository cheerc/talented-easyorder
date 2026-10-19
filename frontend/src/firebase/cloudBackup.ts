/** Versioned, client-side encrypted command archive. No credentials or keys are persisted. */
import { Timestamp } from 'firebase/firestore';
import { CASHIER_STUDENT_ID, SETTLEMENT_KEYS, decodeEnabledCommandDoc, normalizeEnabledCommandInput } from '../domain/cloudCommandSchema';
import { TRANSACTION_MUTATION_KINDS } from '../domain/cloudTransactionMutation';

export const BACKUP_FORMAT = 'easyorder-command-backup' as const;
export const BACKUP_SCHEMA_VERSION = 1 as const;
export const BACKUP_KDF_ITERATIONS = 600_000;
export const BACKUP_MAX_BYTES = 50 * 1024 * 1024;

export interface BackupCommandRecord {
  commandId: string;
  kind: string;
  seq: number;
  leaseEpoch: number;
  datasetId: string;
  schemaVersion: number;
  targets: Record<string, unknown>;
  expectedRevisions: Record<string, unknown>;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  payload: Record<string, unknown>;
  actor: Record<string, unknown>;
  committedAt: unknown;
  businessDate: string | null;
  studentId: string | null;
  reason: string | null;
  cashEffect: Record<string, unknown>;
  inputFingerprint: string;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  datasetId: string;
  commandSchemaVersion: number;
  fromSeq: number;
  toSeq: number;
  headCommandId: string | null;
  previousPackageSha256: string | null;
  generatedAt: string;
  recordCount: number;
  records: BackupCommandRecord[];
  baseState: Record<string, unknown>;
  projectionState: Record<string, unknown>;
  totals: Record<string, unknown> | null;
}

export interface EncryptedBackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  cipher: 'AES-GCM';
  salt: string;
  iv: string;
  ciphertext: string;
}

export class BackupValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'BackupValidationError'; }
}

const TARGET_KEYS_BY_KIND: Record<string, string[]> = {
  EnsureDay: ['dayId'], CreateStudent: ['studentId'], ChangeStudentCode: ['studentId'],
  EditStudent: ['studentId'], SetStudentStatus: ['studentId'], CorrectOpening: ['studentId', 'dayId'],
  SaveVendor: ['vendorId'], RemoveVendor: ['vendorId'], SetDayMenu: ['dayId'], SetOpeningCash: ['dayId'],
  CreateOrder: ['transactionId', 'studentId', 'dayId'], CreatePayment: ['transactionId', 'studentId', 'dayId'],
  CreateCashMovement: ['transactionId', 'dayId'], CreateRefund: ['transactionId', 'studentId', 'dayId'],
  CorrectTransaction: ['transactionId', 'studentId', 'dayId'], VoidTransaction: ['transactionId', 'studentId', 'dayId'],
  CancelKeepDeposit: ['transactionId', 'studentId', 'dayId'], CancelRefund: ['transactionId', 'studentId', 'dayId'],
  Undo: ['transactionId', 'studentId', 'dayId'], CloseDay: ['dayId', 'settlementRevision'],
  ReopenDay: ['dayId', 'settlementRevision'], BackfillOpeningCash: ['dayId'], StartBackfill: ['dayId'], RecordPostCloseEntry: ['dayId'],
  RecordExport: [], RecordPrint: [], RecordBackup: [],
};
const REVISION_KEYS_BY_KIND: Record<string, string[]> = {
  EnsureDay: ['day'], CreateStudent: ['student'], ChangeStudentCode: ['student'], EditStudent: ['student'],
  SetStudentStatus: ['student'], CorrectOpening: ['day', 'student'], SaveVendor: ['vendor'], RemoveVendor: ['vendor'],
  SetDayMenu: ['day', 'headSeq'], SetOpeningCash: ['day'], CreateOrder: ['day', 'student', 'transaction'],
  CreatePayment: ['day', 'student', 'transaction'], CreateCashMovement: ['day', 'transaction'],
  CreateRefund: ['day', 'student', 'transaction'], CorrectTransaction: ['day', 'transaction'],
  VoidTransaction: ['day', 'transaction'], CancelKeepDeposit: ['day', 'transaction'],
  CancelRefund: ['day', 'transaction'], Undo: ['day', 'transaction'],
  CloseDay: ['day', 'settlement'], ReopenDay: ['day', 'settlement'], BackfillOpeningCash: ['day'], StartBackfill: ['day'],
  RecordPostCloseEntry: ['day', 'settlement'],
  RecordExport: [], RecordPrint: [], RecordBackup: [],
};
const PROJECTIONS_BY_KIND: Record<string, string[]> = {
  EnsureDay: ['day'], CreateStudent: ['student'], ChangeStudentCode: ['student'], EditStudent: ['student'],
  SetStudentStatus: ['student'], CorrectOpening: ['day', 'student'], SaveVendor: ['vendor'], RemoveVendor: ['vendor'],
  SetDayMenu: ['day'], SetOpeningCash: ['day'], CreateOrder: ['day', 'student', 'transaction'],
  CreatePayment: ['day', 'student', 'transaction'], CreateCashMovement: ['day', 'transaction'],
  CreateRefund: ['day', 'student', 'transaction'], CorrectTransaction: ['day', 'transaction'],
  VoidTransaction: ['day', 'transaction'], CancelKeepDeposit: ['day', 'transaction'],
  CancelRefund: ['day', 'transaction'], Undo: ['day', 'transaction'],
  CloseDay: ['day', 'settlement'], ReopenDay: ['day', 'settlement'], BackfillOpeningCash: ['day'],
  // The day document stays unchanged; `backfill` is the new immutable marker (contract §12).
  StartBackfill: ['day', 'backfill'],
  // Contract §15: the closed day stays unchanged; `postCloseEntry` is the new immutable entry keyed by the command ID.
  RecordPostCloseEntry: ['day', 'postCloseEntry'],
  RecordExport: [], RecordPrint: [], RecordBackup: [],
};
// P10a transaction mutations always target { transactionId, studentId, dayId }. A counter cash row uses
// the `__cashier__` sentinel and has no student projection or student revision; every other row adds them.
const MUTATION_KINDS = new Set<string>(TRANSACTION_MUTATION_KINDS);
const DECODABLE_COMMAND_KINDS = new Set([
  'EnsureDay', 'CreateStudent', 'ChangeStudentCode', 'EditStudent', 'SetStudentStatus', 'SaveVendor',
  'RemoveVendor', 'SetDayMenu', 'SetOpeningCash', 'CreateOrder', 'CreatePayment', 'CreateCashMovement',
  'CreateRefund', ...MUTATION_KINDS, 'RecordBackup', 'CorrectOpening', 'CloseDay', 'ReopenDay', 'BackfillOpeningCash', 'StartBackfill',
  'RecordPostCloseEntry', 'RecordExport', 'RecordPrint',
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return JSON.stringify(actual) === JSON.stringify([...keys].sort());
}

function revisionOf(projection: string, value: unknown): number | null {
  if (value === null) return 0;
  if (!isPlainRecord(value)) throw new BackupValidationError(`${projection} projection 必須是固定物件或 null`);
  const revision = projection === 'settlement' ? value.revision : value.revision;
  if (!Number.isSafeInteger(revision) || (revision as number) < 1) {
    throw new BackupValidationError(`${projection} projection revision 無效`);
  }
  return revision as number;
}

function signedSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Math.abs(value as number) <= 1_000_000_000;
}

function validBusinessDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isSerializedTimestamp(value: unknown): boolean {
  return isPlainRecord(value) && value._type === 'timestamp'
    && Number.isSafeInteger(value.seconds) && Number.isSafeInteger(value.nanoseconds)
    && (value.nanoseconds as number) >= 0 && (value.nanoseconds as number) < 1_000_000_000;
}

function reviveTimestamps(value: unknown): unknown {
  if (isPlainRecord(value) && value._type === 'timestamp'
    && Number.isSafeInteger(value.seconds) && Number.isSafeInteger(value.nanoseconds)) {
    return new Timestamp(value.seconds as number, value.nanoseconds as number);
  }
  if (Array.isArray(value)) return value.map(reviveTimestamps);
  if (isPlainRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, reviveTimestamps(nested)]));
  return value;
}

function validateEnabledReceiptSemantics(record: BackupCommandRecord): void {
  const input = normalizeEnabledCommandInput({
    commandId: record.commandId, kind: record.kind, leaseEpoch: record.leaseEpoch,
    targets: record.targets, expectedRevisions: record.expectedRevisions, payload: record.payload,
  });
  if (!sameValue(input.targets, record.targets) || !sameValue(input.expectedRevisions, record.expectedRevisions)
    || !sameValue(input.payload, record.payload)) {
    throw new BackupValidationError(`command seq ${record.seq} payload 不是正規化命令值`);
  }
  const committedAt = reviveTimestamps(record.committedAt);
  const decoded = decodeEnabledCommandDoc({
    commandId: record.commandId, kind: record.kind, seq: record.seq, leaseEpoch: record.leaseEpoch,
    actor: record.actor, committedAt, businessDate: record.businessDate, studentId: record.studentId,
    targets: record.targets, expectedRevisions: record.expectedRevisions,
    before: reviveTimestamps(record.before), after: reviveTimestamps(record.after), reason: record.reason,
    cashEffect: record.cashEffect, payload: record.payload, inputFingerprint: record.inputFingerprint,
  });
  if (decoded.commandId !== record.commandId) throw new BackupValidationError(`command seq ${record.seq} receipt commandId 不符`);
}

function validateProjectionSnapshot(
  projection: string, value: unknown, record: BackupCommandRecord, target: Record<string, unknown>, after: boolean,
): void {
  if (value === null) {
    const allowedCreation = !after && (
      projection === 'day' && record.kind === 'EnsureDay'
      || projection === 'student' && record.kind === 'CreateStudent'
      || projection === 'vendor' && record.kind === 'SaveVendor'
      || projection === 'transaction' && ['CreateOrder', 'CreatePayment', 'CreateCashMovement', 'CreateRefund'].includes(record.kind)
      || projection === 'settlement' && record.kind === 'CloseDay'
    );
    if (!allowedCreation) {
      throw new BackupValidationError(`command seq ${record.seq} ${projection} 不可為 null`);
    }
    return;
  }
  if (!isPlainRecord(value)) throw new BackupValidationError(`command seq ${record.seq} ${projection} projection 型別無效`);
  const revision = revisionOf(projection, value);
  if (after && value.lastCommandId !== record.commandId) {
    throw new BackupValidationError(`command seq ${record.seq} ${projection} after lastCommandId 不符`);
  }
  if (projection === 'day') {
    const totalsKeys = ['activeTransactionCount', 'bentoCount', 'otherMealCount', 'mealTotal', 'retainedReceipts', 'cashierIncome', 'cashierExpense', 'accountRefunds'];
    if (!['open', 'closed', 'reopened'].includes(String(value.status)) || !isPlainRecord(value.totals)
      || !hasExactlyKeys(value.totals, totalsKeys)
      || Object.values(value.totals).some(item => !Number.isSafeInteger(item) || (item as number) < 0)
      || !Number.isSafeInteger(value.lastSettlementRevision) || (value.lastSettlementRevision as number) < 0
      || !isSerializedTimestamp(value.updatedAt)) {
      throw new BackupValidationError(`command seq ${record.seq} day projection schema 無效`);
    }
  } else if (projection === 'student') {
    if (value.studentId !== target.studentId || !signedSafeInteger(value.currentBalance)
      || !isPlainRecord(value.openingBalance) || !signedSafeInteger(value.openingBalance.amount)
      || !validBusinessDate(value.openingBalance.asOfDate) || !['active', 'inactive'].includes(String(value.status))
      || !isSerializedTimestamp(value.openingBalance.createdAt) || !isSerializedTimestamp(value.createdAt)
      || !isSerializedTimestamp(value.updatedAt)) {
      throw new BackupValidationError(`command seq ${record.seq} student identity/balance schema 無效`);
    }
  } else if (projection === 'vendor') {
    if (value.vendorId !== target.vendorId || typeof value.deleted !== 'boolean'
      || !['active', 'inactive'].includes(String(value.status))
      || !isSerializedTimestamp(value.createdAt) || !isSerializedTimestamp(value.updatedAt)) {
      throw new BackupValidationError(`command seq ${record.seq} vendor identity/schema 無效`);
    }
  } else if (projection === 'transaction') {
    if (value.transactionId !== target.transactionId || value.businessDate !== target.dayId
      || !['order', 'payment', 'expense', 'refund'].includes(String(value.type))
      || !['active', 'voided'].includes(String(value.status))
      || !signedSafeInteger(value.mealPrice) || !signedSafeInteger(value.paidAmount) || !signedSafeInteger(value.amount)
      || !isSerializedTimestamp(value.createdAt) || !isSerializedTimestamp(value.updatedAt)) {
      throw new BackupValidationError(`command seq ${record.seq} transaction identity/schema 無效`);
    }
    if (target.studentId !== undefined && value.studentId !== target.studentId) {
      throw new BackupValidationError(`command seq ${record.seq} transaction studentId 不符`);
    }
    if (value.type === 'order' && value.amount !== Number(value.paidAmount) - Number(value.mealPrice)
      || value.type === 'payment' && (value.mealPrice !== 0 || value.amount !== value.paidAmount)
      || value.type === 'expense' && value.amount !== Number(value.paidAmount) - Number(value.mealPrice)
      || value.type === 'refund' && (value.mealPrice !== 0 || value.paidAmount !== 0 || (value.amount as number) < 1)) {
      throw new BackupValidationError(`command seq ${record.seq} transaction 金額語義無效`);
    }
  } else if (projection === 'settlement') {
    if (!hasExactlyKeys(value, [...SETTLEMENT_KEYS])
      || value.dayId !== target.dayId || !['closed', 'reopened'].includes(String(value.status))
      || value.previousRevision !== Number(value.revision) - 1
      || (after && (value.revision !== target.settlementRevision || value.sourceSeq !== record.seq))
      || (!after && (value.revision !== Number(target.settlementRevision) - 1 || !Number.isSafeInteger(value.sourceSeq)
        || (value.sourceSeq as number) >= record.seq))
      || !isSerializedTimestamp(value.committedAt)) {
      throw new BackupValidationError(`command seq ${record.seq} settlement identity/schema 無效`);
    }
  }
  if (revision === null) throw new BackupValidationError(`command seq ${record.seq} ${projection} revision 無效`);
}

function balanceContribution(value: unknown): number {
  if (value === null) return 0;
  if (!isPlainRecord(value) || value.status !== 'active') return 0;
  if (value.type === 'order') return Number(value.paidAmount) - Number(value.mealPrice);
  if (value.type === 'payment') return Number(value.paidAmount);
  if (value.type === 'refund') return -Number(value.amount);
  return 0;
}

function resourcePath(projection: string, targets: Record<string, unknown>, commandId?: string): string {
  if (projection === 'day' && typeof targets.dayId === 'string') return `days/${targets.dayId}`;
  if (projection === 'student' && typeof targets.studentId === 'string') return `students/${targets.studentId}`;
  if (projection === 'vendor' && typeof targets.vendorId === 'string') return `vendors/${targets.vendorId}`;
  if (projection === 'transaction' && typeof targets.transactionId === 'string') return `transactions/${targets.transactionId}`;
  if (projection === 'backfill' && typeof targets.dayId === 'string') return `backfillDays/${targets.dayId}`;
  if (projection === 'postCloseEntry' && typeof commandId === 'string' && commandId) return `postCloseEntries/${commandId}`;
  if (projection === 'settlement' && typeof targets.dayId === 'string' && Number.isSafeInteger(targets.settlementRevision)) {
    return `days/${targets.dayId}/settlements/${targets.settlementRevision}`;
  }
  throw new BackupValidationError(`無法從 targets 對映 ${projection} 投影`);
}

function sameValue(left: unknown, right: unknown): boolean { return stableJson(left) === stableJson(right); }

function recalculateDayTotals(projections: Record<string, unknown>): Record<string, Record<string, number>> {
  // Settlement versions live under days/{dayId}/settlements/{n}; only the day documents carry totals.
  const days = Object.entries(projections).filter(([path, value]) => /^days\/[^/]+$/.test(path) && value !== null);
  const transactions = Object.entries(projections).filter(([path, value]) => path.startsWith('transactions/') && value !== null)
    .map(([, value]) => value as Record<string, unknown>);
  const result: Record<string, Record<string, number>> = {};
  for (const [path, rawDay] of days) {
    const dayId = path.slice('days/'.length);
    const dayTransactions = transactions.filter(transaction => transaction.businessDate === dayId);
    const active = dayTransactions.filter(transaction => transaction.status === 'active');
    if (dayTransactions.some(transaction => transaction.status !== 'active' && transaction.status !== 'voided')) {
      throw new BackupValidationError(`營業日 ${dayId} 含未知交易狀態，無法重算 totals`);
    }
    const computed = {
      activeTransactionCount: active.length,
      bentoCount: active.filter(transaction => transaction.type === 'order' && transaction.mealKind === 'bento').length,
      otherMealCount: active.filter(transaction => transaction.type === 'order' && transaction.mealKind === 'other').length,
      mealTotal: active.reduce((sum, transaction) => sum + (transaction.type === 'order' ? Number(transaction.mealPrice) : 0), 0),
      retainedReceipts: active.reduce((sum, transaction) => sum + (transaction.type === 'order' || transaction.type === 'payment' ? Number(transaction.paidAmount) : 0), 0),
      cashierIncome: active.reduce((sum, transaction) => sum + (transaction.type === 'expense' ? Number(transaction.paidAmount) : 0), 0),
      cashierExpense: active.reduce((sum, transaction) => sum + (transaction.type === 'expense' ? Number(transaction.mealPrice) : 0), 0),
      accountRefunds: active.reduce((sum, transaction) => sum + (transaction.type === 'refund' ? Number(transaction.amount) : 0), 0),
    };
    if (Object.values(computed).some(number => !Number.isSafeInteger(number) || number < 0)) {
      throw new BackupValidationError(`營業日 ${dayId} 重算 totals 超出有效整數範圍`);
    }
    const storedDay = rawDay as Record<string, unknown>;
    if (!sameValue(storedDay.totals, computed)) throw new BackupValidationError(`營業日 ${dayId} 的 day totals 與 command 重播結果不同`);
    result[dayId] = computed;
  }
  return result;
}

function taipeiDateOfSerialized(value: unknown): string {
  if (!isSerializedTimestamp(value)) throw new BackupValidationError('時間欄位不是序列化 Timestamp');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date((value as { seconds: number }).seconds * 1000));
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

const TRANSACTION_CREATE_KINDS = new Set(['CreateOrder', 'CreatePayment', 'CreateCashMovement']);

/** Contract §12: how a backfill marker and the backfilled transactions are tied to replayed state. */
function checkBackfillReplay(record: BackupCommandRecord, state: Record<string, unknown>): void {
  const before = record.before ?? {};
  const after = record.after ?? {};
  if (record.kind === 'StartBackfill') {
    const dayId = String(record.targets.dayId);
    const dayBefore = before.day as Record<string, unknown>;
    const marker = after.backfill as Record<string, unknown>;
    const actor = record.actor as Record<string, unknown>;
    if (!(dayId < taipeiDateOfSerialized(record.committedAt))
      || dayBefore.lastSettlementRevision !== 0 || !['open', 'reopened'].includes(String(dayBefore.status))
      || Object.hasOwn(state, `backfillDays/${dayId}`)
      || marker.startedBy !== actor.uid || !sameValue(marker.startedAt, record.committedAt)
      || marker.commandId !== record.commandId || marker.reason !== record.payload.reason) {
      throw new BackupValidationError(`command seq ${record.seq} 回填標記與重播狀態不符`);
    }
    return;
  }
  if (record.kind === 'RecordPostCloseEntry') {
    // Contract §15: the day must be closed in the replayed state, and the entry names that settlement version.
    const dayId = String(record.targets.dayId);
    const entryPath = `postCloseEntries/${record.commandId}`;
    const day = Object.hasOwn(state, `days/${dayId}`) ? state[`days/${dayId}`] as Record<string, unknown> | null : null;
    const entry = after.postCloseEntry as Record<string, unknown>;
    if (!day || day.status !== 'closed' || day.lastSettlementRevision !== entry.settlementRevision
      || Object.hasOwn(state, entryPath)) {
      throw new BackupValidationError(`command seq ${record.seq} 關帳後補記在重播狀態中不是已關帳營業日的目前版本`);
    }
    return;
  }
  if (record.kind === 'CloseDay') {
    // Contract §14: a marked day closes with no difference and `alignWithDayId`; an ordinary day carries none.
    // A close from before P11c3 has no field on a marked day either, and still replays.
    const dayId = String(record.targets.dayId);
    const marked = Object.hasOwn(state, `backfillDays/${dayId}`) && state[`backfillDays/${dayId}`] !== null;
    const align = record.payload.alignWithDayId;
    const aligned = Object.hasOwn(record.payload, 'alignWithDayId');
    if (!marked && aligned) throw new BackupValidationError(`command seq ${record.seq} 沒有回填標記的營業日不得帶對齊日`);
    if (!aligned) return;
    const settlement = after.settlement as Record<string, unknown> | undefined;
    if (!settlement || settlement.difference !== 0 || record.payload.countedCash !== settlement.expectedCash) {
      throw new BackupValidationError(`command seq ${record.seq} 回填日關帳有差額`);
    }
    if (align === null) return;
    const alignDay = typeof align === 'string' && align > dayId && Object.hasOwn(state, `days/${align}`)
      ? state[`days/${align}`] as Record<string, unknown> | null : null;
    if (!alignDay || typeof alignDay.openingCash !== 'number' || alignDay.openingCash !== record.payload.countedCash) {
      throw new BackupValidationError(`command seq ${record.seq} 對齊日 ${String(align)} 在關帳當時沒有相等的開帳現金`);
    }
    return;
  }
  if (TRANSACTION_CREATE_KINDS.has(record.kind) && isPlainRecord(after.transaction)) {
    const dayId = String(record.targets.dayId);
    const committed = taipeiDateOfSerialized(record.committedAt);
    if (dayId > committed) throw new BackupValidationError(`command seq ${record.seq} 交易的營業日晚於提交日期`);
    if (dayId < committed) {
      // A transaction created after its business day needs an earlier marker and a day that never closed.
      const dayBefore = before.day as Record<string, unknown>;
      if (!Object.hasOwn(state, `backfillDays/${dayId}`) || state[`backfillDays/${dayId}`] === null
        || dayBefore.lastSettlementRevision !== 0) {
        throw new BackupValidationError(`command seq ${record.seq} 交易晚於營業日建立，但該日沒有較早的回填標記`);
      }
    }
  }
}

function replayProjections(records: BackupCommandRecord[], initial: Record<string, unknown>): Record<string, unknown> {
  const state = structuredClone(initial);
  for (const record of records) {
    const before = record.before ?? {};
    const after = record.after ?? {};
    checkBackfillReplay(record, state);
    if (record.kind === 'CloseDay' || record.kind === 'ReopenDay') {
      // Each version is a new immutable document; the previous one must be exactly the replayed version n−1.
      const revision = Number(record.targets.settlementRevision);
      const settlementPath = resourcePath('settlement', record.targets);
      const previousPath = `days/${String(record.targets.dayId)}/settlements/${revision - 1}`;
      const previousSettlement = revision > 1 && Object.hasOwn(state, previousPath) ? state[previousPath] : null;
      if (Object.hasOwn(state, settlementPath) || !sameValue(previousSettlement, before.previousSettlement)) {
        throw new BackupValidationError(`command seq ${record.seq} settlement before 與前序重播狀態不符`);
      }
      state[settlementPath] = after.settlement;
    }
    for (const projection of ['day', 'student', 'vendor', 'transaction', 'settlement', 'backfill', 'postCloseEntry']) {
      if (projection === 'settlement' && (record.kind === 'CloseDay' || record.kind === 'ReopenDay')) continue;
      if (!(projection in before) && !(projection in after)) continue;
      if (!(projection in before) || !(projection in after)) {
        throw new BackupValidationError(`command ${record.commandId} 的 ${projection} before/after 投影不完整`);
      }
      const key = resourcePath(projection, record.targets, record.commandId);
      const hasPrevious = Object.hasOwn(state, key);
      const previous = hasPrevious ? state[key] : null;
      if (!sameValue(previous, before[projection])) {
        throw new BackupValidationError(`command seq ${record.seq} ${projection} before 與前序重播狀態不符`);
      }
      state[key] = after[projection];
    }
    const unknownProjection = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter(key => key !== 'head' && !['day', 'student', 'vendor', 'transaction', 'settlement', 'previousSettlement', 'backfill', 'postCloseEntry'].includes(key));
    if (unknownProjection.length) throw new BackupValidationError(`command seq ${record.seq} 含未知投影：${unknownProjection.join(', ')}`);
    recalculateDayTotals(state);
  }
  recalculateDayTotals(state);
  return state;
}

export function replayBackupProjections(records: BackupCommandRecord[], initial: Record<string, unknown> = {}): Record<string, unknown> {
  return replayProjections(records, initial);
}

export function recalculateBackupTotals(projections: Record<string, unknown>): Record<string, Record<string, number>> {
  return recalculateDayTotals(projections);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  try { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
  catch { throw new BackupValidationError('備份加密資料格式損毀'); }
}

function utf8(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(value));
}

function exactBuffer(bytes: Uint8Array<ArrayBufferLike>): ArrayBuffer {
  return Uint8Array.from(bytes).buffer as ArrayBuffer;
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBufferLike>, iterations: number): Promise<CryptoKey> {
  if (typeof password !== 'string' || password.length < 1) throw new BackupValidationError('請輸入備份密碼');
  const material = await crypto.subtle.importKey('raw', utf8(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: exactBuffer(salt), iterations }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`;
}

export async function sha256Hex(value: BufferSource | Uint8Array<ArrayBufferLike> | string): Promise<string> {
  const bytes = typeof value === 'string' ? utf8(value) : value;
  const digestInput = bytes instanceof ArrayBuffer ? bytes : exactBuffer(
    new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  );
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', digestInput));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function validateManifest(value: unknown): asserts value is BackupManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BackupValidationError('備份 manifest 格式不支援');
  const manifest = value as Partial<BackupManifest>;
  const fromSeq = manifest.fromSeq as number;
  const toSeq = manifest.toSeq as number;
  if (manifest.format !== BACKUP_FORMAT || manifest.schemaVersion !== BACKUP_SCHEMA_VERSION
    || typeof manifest.datasetId !== 'string' || manifest.datasetId.length === 0
    || manifest.commandSchemaVersion !== 1
    || !Number.isSafeInteger(manifest.fromSeq) || !Number.isSafeInteger(manifest.toSeq)
    || (manifest.fromSeq as number) < 0 || (manifest.toSeq as number) < (manifest.fromSeq as number)
    || !Array.isArray(manifest.records) || manifest.recordCount !== manifest.records.length
    || toSeq - fromSeq !== manifest.recordCount
    || (toSeq === 0 ? manifest.headCommandId !== null : typeof manifest.headCommandId !== 'string')
    || typeof manifest.generatedAt !== 'string'
    || !manifest.baseState || typeof manifest.baseState !== 'object' || Array.isArray(manifest.baseState)
    || !manifest.projectionState || typeof manifest.projectionState !== 'object' || Array.isArray(manifest.projectionState)
    || !manifest.totals || typeof manifest.totals !== 'object' || Array.isArray(manifest.totals)
    || (manifest.previousPackageSha256 !== null && !/^[a-f0-9]{64}$/.test(manifest.previousPackageSha256 ?? ''))) {
    throw new BackupValidationError('備份 manifest 欄位或範圍不一致');
  }
  const totalsKeys = ['activeTransactionCount', 'bentoCount', 'otherMealCount', 'mealTotal', 'retainedReceipts', 'cashierIncome', 'cashierExpense', 'accountRefunds'];
  for (const [dayId, totals] of Object.entries(manifest.totals)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayId) || !totals || typeof totals !== 'object' || Array.isArray(totals)
      || JSON.stringify(Object.keys(totals).sort()) !== JSON.stringify([...totalsKeys].sort())
      || Object.values(totals).some(item => !Number.isSafeInteger(item) || (item as number) < 0)) {
      throw new BackupValidationError(`備份 totals 的營業日 ${dayId} 格式無效`);
    }
  }
  const ids = new Set<string>();
  const payloadFieldsByKind: Record<string, { required: string[]; optional?: string[] }> = {
    EnsureDay: { required: ['businessDate'] }, CreateStudent: { required: ['studentCode', 'displayName', 'aliases', 'openingBalance'] },
    ChangeStudentCode: { required: ['studentCode', 'reason'] }, EditStudent: { required: [], optional: ['displayName', 'aliases'] },
    SetStudentStatus: { required: ['status', 'reason'] }, CorrectOpening: { required: ['amount', 'note', 'reason'] },
    SaveVendor: { required: ['vendorId', 'name', 'phone', 'note', 'status'] }, RemoveVendor: { required: ['reason'] },
    SetDayMenu: { required: ['selectionDate', 'itemName', 'price', 'vendorId', 'vendorNameSnapshot', 'inheritedFromDate'] },
    SetOpeningCash: { required: ['openingCash'], optional: ['reason'] },
    CreateOrder: { required: ['mealPrice', 'paidAmount', 'mealKind'], optional: ['menuRevision', 'otherItemName', 'note'] },
    CreatePayment: { required: ['paidAmount'], optional: ['note'] },
    CreateCashMovement: { required: ['mealPrice', 'paidAmount', 'reason'] }, CreateRefund: { required: ['amount', 'reason'] },
    CorrectTransaction: { required: ['mealPrice', 'paidAmount', 'amount', 'note', 'reason'] }, VoidTransaction: { required: ['reason'] },
    CancelKeepDeposit: { required: ['reason'] }, CancelRefund: { required: ['reason'] }, Undo: { required: ['targetCommandId', 'reason'] },
    CloseDay: { required: ['countedCash'], optional: ['note', 'expectedCash', 'alignWithDayId'] }, ReopenDay: { required: ['reason'] },
    BackfillOpeningCash: { required: ['openingCash', 'reason'] }, StartBackfill: { required: ['reason'] },
    RecordPostCloseEntry: { required: ['direction', 'amount', 'reason'] },
    RecordExport: { required: ['exportType', 'dateRange', 'scope', 'sourceSeq'] },
    RecordPrint: { required: ['printType', 'businessDate', 'dateRange', 'scope', 'sourceSeq'] },
    RecordBackup: { required: ['backupType', 'sourceSeq', 'fromSeq', 'toSeq', 'sha256'] },
  };
  manifest.records.forEach((record, index) => {
    const seq = fromSeq + index + 1;
    if (!record || !DECODABLE_COMMAND_KINDS.has(record.kind)) {
      throw new BackupValidationError(`command seq ${seq} kind ${record?.kind ?? 'unknown'} 尚無完整備份語義，拒絕匯出`);
    }
    const targets = record?.targets;
    const before = record?.before;
    const after = record?.after;
    const mutationKind = MUTATION_KINDS.has(record.kind);
    const mutationHasStudent = mutationKind && isPlainRecord(targets) && targets.studentId !== CASHIER_STUDENT_ID;
    const expectedTargets = TARGET_KEYS_BY_KIND[record?.kind ?? ''];
    const payloadFields = payloadFieldsByKind[record?.kind ?? ''];
    const payloadNames = record?.payload && typeof record.payload === 'object' ? Object.keys(record.payload) : [];
    const targetNames = targets && typeof targets === 'object' ? Object.keys(targets).sort() : [];
    const expectedRevisions = record?.expectedRevisions as Record<string, unknown> | undefined;
    const expectedRevisionKeys = REVISION_KEYS_BY_KIND[record?.kind ?? '']
      ? [...REVISION_KEYS_BY_KIND[record?.kind ?? ''], ...(mutationHasStudent ? ['student'] : [])] : undefined;
    const headBefore = before?.head as Record<string, unknown> | undefined;
    const headAfter = after?.head as Record<string, unknown> | undefined;
    const requiredProjections = PROJECTIONS_BY_KIND[record?.kind ?? '']
      ? [...PROJECTIONS_BY_KIND[record?.kind ?? ''], ...(mutationHasStudent ? ['student'] : [])] : undefined;
    const requiredBeforeKeys = record?.kind === 'CloseDay' || record?.kind === 'ReopenDay'
      ? ['head', 'day', 'previousSettlement'] : ['head', ...(requiredProjections ?? [])];
    const requiredAfterKeys = record?.kind === 'CloseDay' || record?.kind === 'ReopenDay'
      ? ['head', 'day', 'settlement'] : ['head', ...(requiredProjections ?? [])];
    if (!record || record.seq !== seq || !record.commandId || ids.has(record.commandId)
      || record.datasetId !== manifest.datasetId || record.schemaVersion !== manifest.commandSchemaVersion
      || !record.kind || !isPlainRecord(targets) || !isPlainRecord(expectedRevisions) || !isPlainRecord(record.payload) || !isPlainRecord(record.actor)
      || !record.cashEffect || !/^[a-f0-9]{64}$/.test(record.inputFingerprint)
      || !expectedTargets || !requiredProjections
      || !hasExactlyKeys(targets!, expectedTargets)
      || !hasExactlyKeys(expectedRevisions!, expectedRevisionKeys ?? [])
      || !payloadFields || payloadFields.required.some(key => !payloadNames.includes(key))
      || payloadNames.some(key => ![...payloadFields.required, ...(payloadFields.optional ?? [])].includes(key))
      || !before || !after || !isPlainRecord(before) || !isPlainRecord(after) || !headBefore || !headAfter
      || !hasExactlyKeys(before, requiredBeforeKeys) || !hasExactlyKeys(after, requiredAfterKeys)
      || headBefore.seq !== seq - 1 || headAfter.seq !== seq || headAfter.lastCommandId !== record.commandId
      || headBefore.datasetId !== manifest.datasetId || headAfter.datasetId !== manifest.datasetId
      || headBefore.schemaVersion !== manifest.commandSchemaVersion || headAfter.schemaVersion !== manifest.commandSchemaVersion
      || !hasExactlyKeys(headBefore, ['schemaVersion', 'datasetId', 'seq', 'lastCommandId', 'maintenance', 'goLiveDate', 'updatedAt'])
      || !hasExactlyKeys(headAfter, ['schemaVersion', 'datasetId', 'seq', 'lastCommandId', 'maintenance', 'goLiveDate', 'updatedAt'])
      || (seq === 1 ? headBefore.lastCommandId !== null : typeof headBefore.lastCommandId !== 'string')
      || !validBusinessDate(headBefore.goLiveDate) || !validBusinessDate(headAfter.goLiveDate)
      || !isSerializedTimestamp(headBefore.updatedAt) || !isSerializedTimestamp(headAfter.updatedAt)
      || !isSerializedTimestamp(record.committedAt)
      || typeof headBefore.maintenance !== 'boolean' || typeof headAfter.maintenance !== 'boolean'
      || !Number.isSafeInteger(record.leaseEpoch) || record.leaseEpoch < 0) {
      throw new BackupValidationError(`備份命令鏈在 seq ${seq} 不連續或欄位無效`);
    }
    const normalizedTargetKeys = [...expectedTargets].sort();
    if (JSON.stringify(targetNames) !== JSON.stringify(normalizedTargetKeys)
      || ('dayId' in targets && !validBusinessDate(targets.dayId))
      || ('studentId' in targets && !(mutationKind && targets.studentId === CASHIER_STUDENT_ID)
        && (typeof targets.studentId !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targets.studentId)))
      || ('transactionId' in targets && (typeof targets.transactionId !== 'string' || !targets.transactionId || targets.transactionId.includes('/')))
      || ('vendorId' in targets && (typeof targets.vendorId !== 'string' || !targets.vendorId || targets.vendorId.length > 64 || targets.vendorId.includes('/')))
      || (targets.settlementRevision !== undefined && (!Number.isSafeInteger(targets.settlementRevision) || (targets.settlementRevision as number) < 1))) {
      throw new BackupValidationError(`command seq ${seq} targets schema 無效`);
    }
    const numericPayloadFields: Record<string, string[]> = {
      CorrectOpening: ['amount'], SetDayMenu: ['price'], SetOpeningCash: ['openingCash'], BackfillOpeningCash: ['openingCash'],
      CreateOrder: ['mealPrice', 'paidAmount'], CreatePayment: ['paidAmount'], CreateCashMovement: ['mealPrice', 'paidAmount'],
      CreateRefund: ['amount'], CorrectTransaction: ['mealPrice', 'paidAmount', 'amount'], CloseDay: ['countedCash'],
      RecordPostCloseEntry: ['amount'],
      RecordExport: ['sourceSeq'], RecordPrint: ['sourceSeq'], RecordBackup: ['sourceSeq', 'fromSeq', 'toSeq'],
    };
    if (record.kind === 'CloseDay' && Object.hasOwn(record.payload, 'alignWithDayId')
      && record.payload.alignWithDayId !== null && !validBusinessDate(record.payload.alignWithDayId)) {
      throw new BackupValidationError(`command seq ${seq} payload.alignWithDayId 無效`);
    }
    for (const key of numericPayloadFields[record.kind] ?? []) {
      const maximum = (record.kind === 'RecordExport' || record.kind === 'RecordPrint') && key === 'sourceSeq'
        ? Number.MAX_SAFE_INTEGER : 1_000_000_000;
      if (!Number.isSafeInteger(record.payload[key]) || Math.abs(record.payload[key] as number) > maximum) {
        throw new BackupValidationError(`command seq ${seq} payload.${key} 無效`);
      }
    }
    if (record.kind === 'EnsureDay' && !validBusinessDate(record.payload.businessDate)
      || record.kind === 'CreateStudent' && (!isPlainRecord(record.payload.openingBalance)
        || !signedSafeInteger(record.payload.openingBalance.amount)
        || !validBusinessDate(record.payload.openingBalance.asOfDate))
      || record.kind === 'SetDayMenu' && (!validBusinessDate(record.payload.selectionDate)
        || (record.payload.inheritedFromDate !== null && !validBusinessDate(record.payload.inheritedFromDate)))
      || record.kind === 'RecordBackup' && (record.payload.backupType !== 'command-incremental'
        || record.payload.toSeq !== record.payload.sourceSeq || (record.payload.fromSeq as number) > (record.payload.toSeq as number))) {
      throw new BackupValidationError(`command seq ${seq} payload schema 無效`);
    }
    for (const [key, revision] of Object.entries(expectedRevisions)) {
      if (!Number.isSafeInteger(revision) || (revision as number) < 0
        || key === 'headSeq' && revision !== headBefore.seq) {
        throw new BackupValidationError(`command seq ${seq} expectedRevisions.${key} 無效`);
      }
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.commandId)
      || !/^[a-f0-9]{64}$/.test(record.inputFingerprint)
      || !record.actor || typeof record.actor.uid !== 'string' || !record.actor.uid
      || typeof record.actor.email !== 'string' || !record.actor.email.includes('@')) {
      throw new BackupValidationError(`command seq ${seq} actor、commandId 或 fingerprint 欄位無效`);
    }
    const projections = requiredProjections!;
    const beforeProjectionKey = (projection: string) => projection === 'settlement' ? 'previousSettlement' : projection;
    for (const projection of record.kind === 'StartBackfill' || record.kind === 'RecordPostCloseEntry' ? [] : projections) {
      const beforeValue = before[beforeProjectionKey(projection)];
      const afterValue = after[projection];
      validateProjectionSnapshot(projection, beforeValue, record, targets!, false);
      validateProjectionSnapshot(projection, afterValue, record, targets!, true);
      const expectedRevision = expectedRevisions![projection];
      if (revisionOf(projection, beforeValue) !== expectedRevision
        || revisionOf(projection, afterValue) !== (expectedRevision as number) + 1) {
        throw new BackupValidationError(`command seq ${seq} ${projection} before/after revision 不連續`);
      }
    }
    if (record.kind === 'StartBackfill') {
      // The day does not change; only the marker is new (its fields are checked against the payload,
      // actor and commit time by the receipt semantics below and again during replay).
      validateProjectionSnapshot('day', before.day, record, targets!, false);
      if (!sameValue(before.day, after.day) || revisionOf('day', before.day) !== expectedRevisions!.day
        || before.backfill !== null || !isPlainRecord(after.backfill)
        || !hasExactlyKeys(after.backfill, ['dayId', 'reason', 'startedBy', 'startedAt', 'commandId'])
        || after.backfill.dayId !== targets!.dayId || !isSerializedTimestamp(after.backfill.startedAt)) {
        throw new BackupValidationError(`command seq ${seq} 開始回填的 day／標記 projection 無效`);
      }
    }
    if (record.kind === 'RecordPostCloseEntry') {
      // The closed day does not change; only the immutable entry is new (contract §15). Its fields are bound to
      // the payload, actor and commit time here and again during replay, with the replayed day state.
      validateProjectionSnapshot('day', before.day, record, targets!, false);
      const entry = after.postCloseEntry;
      if (!sameValue(before.day, after.day) || (before.day as Record<string, unknown>).status !== 'closed'
        || revisionOf('day', before.day) !== expectedRevisions!.day
        || (before.day as Record<string, unknown>).lastSettlementRevision !== expectedRevisions!.settlement
        || before.postCloseEntry !== null || !isPlainRecord(entry)
        || !hasExactlyKeys(entry, ['entryId', 'dayId', 'settlementRevision', 'direction', 'amount', 'reason', 'createdBy', 'createdAt', 'commandId'])
        || entry.entryId !== record.commandId || entry.commandId !== record.commandId || entry.dayId !== targets!.dayId
        || entry.settlementRevision !== expectedRevisions!.settlement
        || !['income', 'expense'].includes(String(record.payload.direction)) || entry.direction !== record.payload.direction
        || !Number.isSafeInteger(record.payload.amount) || (record.payload.amount as number) < 1 || (record.payload.amount as number) > 20_000
        || entry.amount !== record.payload.amount
        || typeof record.payload.reason !== 'string' || record.payload.reason.length < 1 || record.payload.reason.length > 500
        || entry.reason !== record.payload.reason || record.reason !== record.payload.reason
        || entry.createdBy !== record.actor.uid || !isSerializedTimestamp(entry.createdAt)
        || !sameValue(entry.createdAt, record.committedAt)
        || String(targets!.dayId) < String(headBefore.goLiveDate)) {
        throw new BackupValidationError(`command seq ${seq} 關帳後補記的 day／補記 projection 無效`);
      }
    }
    if (record.kind === 'CloseDay' || record.kind === 'ReopenDay') {
      const settlementAfter = after.settlement as Record<string, unknown>;
      if (settlementAfter.revision !== targets!.settlementRevision
        || (record.kind === 'CloseDay' && settlementAfter.status !== 'closed')
        || (record.kind === 'ReopenDay' && settlementAfter.status !== 'reopened')) {
        throw new BackupValidationError(`command seq ${seq} settlement revision/status 不符`);
      }
    }
    const beforeStudent = before.student;
    const afterStudent = after.student;
    if (projections.includes('student')) {
      if (record.kind === 'CreateStudent') {
        const studentAfter = afterStudent as Record<string, unknown>;
        const opening = studentAfter.openingBalance as Record<string, unknown>;
        if (studentAfter.currentBalance !== opening.amount) throw new BackupValidationError(`command seq ${seq} 新學生餘額不等於期初`);
      } else if (record.kind === 'CorrectOpening') {
        const studentBefore = beforeStudent as Record<string, unknown>;
        const studentAfter = afterStudent as Record<string, unknown>;
        const openingBefore = studentBefore.openingBalance as Record<string, unknown>;
        const openingAfter = studentAfter.openingBalance as Record<string, unknown>;
        if (Number(studentAfter.currentBalance) - Number(studentBefore.currentBalance)
          !== Number(openingAfter.amount) - Number(openingBefore.amount)) {
          throw new BackupValidationError(`command seq ${seq} CorrectOpening 餘額差額不一致`);
        }
      } else if (projections.includes('transaction')) {
        const expectedDelta = balanceContribution(after.transaction) - balanceContribution(before.transaction);
        if (Number((afterStudent as Record<string, unknown>).currentBalance)
          - Number((beforeStudent as Record<string, unknown>).currentBalance) !== expectedDelta) {
          throw new BackupValidationError(`command seq ${seq} 學生餘額與交易影響不一致`);
        }
      } else if ((afterStudent as Record<string, unknown>).currentBalance
        !== (beforeStudent as Record<string, unknown>).currentBalance) {
        throw new BackupValidationError(`command seq ${seq} 非帳務命令不可改變學生餘額`);
      }
    }
    const cashEffect = record.cashEffect as Record<string, unknown>;
    const cashKeys = ['before', 'after', 'delta', 'reasonKind', 'refundAmount'];
    if (JSON.stringify(Object.keys(cashEffect).sort()) !== JSON.stringify([...cashKeys].sort())
      || cashKeys.filter(key => key !== 'reasonKind').some(key => !Number.isSafeInteger(cashEffect[key]))
      || !['collection', 'payout', 'refund', 'correction', 'reversal', 'none'].includes(String(cashEffect.reasonKind))) {
      throw new BackupValidationError(`command seq ${seq} cashEffect schema 無效`);
    }
    if (record.kind === 'RecordBackup') {
      const payload = record.payload;
      if (headBefore.datasetId !== manifest.datasetId || headAfter.datasetId !== manifest.datasetId
        || headBefore.schemaVersion !== manifest.commandSchemaVersion || headAfter.schemaVersion !== manifest.commandSchemaVersion
        || !hasExactlyKeys(before, ['head']) || !hasExactlyKeys(after, ['head'])
        || payload.backupType !== 'command-incremental' || !Number.isSafeInteger(payload.sourceSeq)
        || (payload.sourceSeq as number) < 0 || (payload.sourceSeq as number) > headBefore.seq
        || payload.toSeq !== payload.sourceSeq || !Number.isSafeInteger(payload.fromSeq)
        || (payload.fromSeq as number) < 0 || (payload.fromSeq as number) > (payload.toSeq as number)
        || !/^[a-f0-9]{64}$/.test(String(payload.sha256))) {
        throw new BackupValidationError(`RecordBackup receipt 在 seq ${seq} 無法驗證`);
      }
    }
    try {
      validateEnabledReceiptSemantics(record);
    } catch (error) {
      throw new BackupValidationError(`command seq ${seq} payload/receipt 語義無效：${error instanceof Error ? error.message : 'unknown error'}`);
    }
    ids.add(record.commandId);
  });
  if (manifest.recordCount > 0 && manifest.records.at(-1)?.commandId !== manifest.headCommandId) {
    throw new BackupValidationError('manifest headCommandId 與最後一筆 command 不一致');
  }
  if (fromSeq === 0 && Object.keys(manifest.baseState).length !== 0) {
    throw new BackupValidationError('首次完整備份的 baseState 必須為空');
  }
  const replayed = replayProjections(manifest.records, manifest.baseState);
  if (!sameValue(replayed, manifest.projectionState)) throw new BackupValidationError('projectionState 與 command 重播結果不同');
  const replayedTotals = recalculateDayTotals(replayed);
  if (!sameValue(replayedTotals, manifest.totals)) throw new BackupValidationError('manifest totals 與 command 重播結果不同');
}

export function validateBackupManifest(value: unknown): BackupManifest {
  validateManifest(value);
  return value;
}

export function createBackupManifest(args: Omit<BackupManifest, 'format' | 'schemaVersion' | 'recordCount'>): BackupManifest {
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT, schemaVersion: BACKUP_SCHEMA_VERSION,
    ...args, recordCount: args.records.length,
  };
  validateManifest(manifest);
  return manifest;
}

export async function encryptBackup(manifest: BackupManifest, password: string): Promise<Uint8Array<ArrayBuffer>> {
  validateManifest(manifest);
  const plaintext = utf8(stableJson(manifest));
  if (plaintext.byteLength > BACKUP_MAX_BYTES) throw new BackupValidationError('備份超過 50 MiB 上限；本次沒有產生備份');
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const key = await deriveKey(password, salt, BACKUP_KDF_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  const container: EncryptedBackupFile = {
    format: BACKUP_FORMAT, schemaVersion: BACKUP_SCHEMA_VERSION,
    kdf: 'PBKDF2-SHA256', iterations: BACKUP_KDF_ITERATIONS,
    cipher: 'AES-GCM', salt: bytesToBase64(salt), iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
  const bytes = utf8(stableJson(container));
  if (bytes.byteLength > BACKUP_MAX_BYTES) throw new BackupValidationError('加密備份超過 50 MiB 上限');
  return bytes;
}

export async function decryptBackup(bytes: BufferSource, password: string): Promise<BackupManifest> {
  const input = bytes instanceof ArrayBuffer
    ? new Uint8Array(bytes)
    : new Uint8Array(exactBuffer(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)));
  if (input.byteLength > BACKUP_MAX_BYTES) throw new BackupValidationError('備份超過 50 MiB 上限');
  let container: EncryptedBackupFile;
  try { container = JSON.parse(new TextDecoder().decode(input)) as EncryptedBackupFile; }
  catch { throw new BackupValidationError('備份檔格式損毀'); }
  if (container.format !== BACKUP_FORMAT || container.schemaVersion !== BACKUP_SCHEMA_VERSION
    || container.kdf !== 'PBKDF2-SHA256' || container.cipher !== 'AES-GCM'
    || !Number.isSafeInteger(container.iterations) || container.iterations < BACKUP_KDF_ITERATIONS
    || typeof container.salt !== 'string' || typeof container.iv !== 'string' || typeof container.ciphertext !== 'string') {
    throw new BackupValidationError('備份加密格式或參數不支援');
  }
  const salt = base64ToBytes(container.salt); const iv = base64ToBytes(container.iv);
  if (salt.length !== 16 || iv.length !== 12) throw new BackupValidationError('備份 salt 或 IV 長度錯誤');
  try {
    const key = await deriveKey(password, salt, container.iterations);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: exactBuffer(iv) }, key, exactBuffer(base64ToBytes(container.ciphertext)));
    const manifest: unknown = JSON.parse(new TextDecoder().decode(plaintext));
    validateManifest(manifest);
    return manifest;
  } catch (error) {
    if (error instanceof BackupValidationError) throw error;
    throw new BackupValidationError('密碼錯誤或備份內容已損毀');
  }
}

export async function verifyBackupFile(file: File, password: string, expectedSha256: string): Promise<BackupManifest> {
  if (file.size > BACKUP_MAX_BYTES) throw new BackupValidationError('備份超過 50 MiB 上限');
  const bytes = await file.arrayBuffer();
  if (await sha256Hex(bytes) !== expectedSha256) throw new BackupValidationError('重新選取的檔案與已產生備份不同');
  return decryptBackup(bytes, password);
}
