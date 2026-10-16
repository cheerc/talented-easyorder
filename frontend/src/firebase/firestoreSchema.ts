import type { FieldValue, Timestamp } from 'firebase/firestore';
import { getFirestoreMod } from './firebaseModules';
import type { ValidationResult } from '../types/validation';
import type { LedgerTransaction } from '../domain/ledger';
import { STUDENT_CODE_REGEX, type StudentAccount } from '../domain/student';
import type { StoredCloudCommandDoc } from '../domain/cloudCommandSchema';

export type FirestoreTimestamp = Timestamp | FieldValue;
export type FirestoreTransactionType = 'order' | 'payment' | 'refund' | 'cancel' | 'correction' | 'void';
export type FirestoreSyncStatus = 'pending' | 'synced' | 'conflict' | 'voided';

// ---------------------------------------------------------------------------
// 既有舊版 (Prototype / Legacy) Schema
// ---------------------------------------------------------------------------

export interface TransactionDocInput {
  id: string;
  studentId: string;
  studentNameSnapshot: string;
  type: FirestoreTransactionType;
  amount: number;
  balanceBefore: number | null;
  balanceAfter: number | null;
  clientBalanceAfterPreview: number;
  menuNameSnapshot: string;
  price: number;
  paidAmount: number;
  operatorId: string;
  operatorEmail: string;
  deviceId: string;
  businessDate: string;
  sourceDevice: 'pc' | 'barcode_scanner' | 'ipad_handoff';
  note: string;
  status: FirestoreSyncStatus;
}

export interface TransactionDoc extends TransactionDocInput {
  createdAt: FirestoreTimestamp;
  committedAt: FirestoreTimestamp | null;
}

export function buildTransactionDoc(input: TransactionDocInput): TransactionDoc {
  const { serverTimestamp } = getFirestoreMod();
  return {
    ...input,
    createdAt: serverTimestamp(),
    committedAt: input.status === 'synced' ? serverTimestamp() : null,
  };
}

export function validateStudentDoc(input: Record<string, unknown>): ValidationResult {
  if (input.status !== 'active' && input.status !== 'inactive') return { ok: false, reason: 'invalid status' };
  if (typeof input.revision !== 'number' || input.revision < 1) return { ok: false, reason: 'invalid revision' };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 新版 Schema Version 1 (規格 §5–§8)
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION_V1 = 1 as const;

/** operators/{uid} */
export interface CloudOperatorDoc {
  uid: string;
  email: string;
  displayName: string;
  active: boolean;
}

/** system/accessLease */
export interface CloudAccessLeaseDoc {
  holderUid: string | null;
  epoch: number;
  updatedAt: FirestoreTimestamp;
}

/** system/dataHead */
export interface CloudDataHeadDoc {
  schemaVersion: 1;
  datasetId: string;
  seq: number;
  lastCommandId: string | null;
  maintenance: boolean;
  goLiveDate: string;
  updatedAt: FirestoreTimestamp;
}

/** students/{studentId} */
export interface CloudStudentOpeningBalance {
  amount: number;
  asOfDate: string;
  note: string;
  createdAt: FirestoreTimestamp;
}

export interface CloudStudentDoc {
  studentId: string;
  studentCode: string;
  displayName: string;
  aliases: string[];
  status: 'active' | 'inactive';
  openingBalance: CloudStudentOpeningBalance;
  currentBalance: number;
  createdAt: FirestoreTimestamp;
  revision: number;
  lastCommandId: string;
  updatedAt: FirestoreTimestamp;
}

/** studentCodes/{studentCode} */
export interface CloudStudentCodeIndexDoc {
  studentId: string;
  lastCommandId: string;
  updatedAt: FirestoreTimestamp;
}

/** vendors/{vendorId} */
export interface CloudVendorDoc {
  vendorId: string;
  name: string;
  phone: string;
  note: string;
  status: 'active' | 'inactive';
  deleted: boolean;
  createdAt: FirestoreTimestamp;
  revision: number;
  lastCommandId?: string;
  updatedAt: FirestoreTimestamp;
}

/** days/{YYYY-MM-DD} totals */
export interface CloudDayTotalsDoc {
  activeTransactionCount: number;
  bentoCount: number;
  otherMealCount: number;
  mealTotal: number;
  retainedReceipts: number;
  cashierIncome: number;
  cashierExpense: number;
}

/** days/{YYYY-MM-DD} menu */
export interface CloudDayMenuDoc {
  businessDate: string;
  itemName: string;
  price: number;
  vendorId: string;
  vendorNameSnapshot: string;
  updatedAt: FirestoreTimestamp;
  revision: number;
  inheritedFromDate: string | null;
}

/** days/{YYYY-MM-DD} */
export interface CloudDayDoc {
  status: 'open' | 'closed' | 'reopened';
  revision: number;
  menu: CloudDayMenuDoc | null;
  openingCash: number | null;
  openedBy: string | null;
  openedAt: FirestoreTimestamp | null;
  totals: CloudDayTotalsDoc;
  lastSettlementRevision: number;
  lastCommandId: string;
  updatedAt: FirestoreTimestamp;
}

/** transactions/{transactionId} */
export interface CloudTransactionDoc {
  transactionId: string;
  studentId: string;
  businessDate: string;
  type: 'order' | 'payment' | 'expense';
  mealKind: 'bento' | 'other' | null;
  mealPrice: number;
  paidAmount: number;
  amount: number;
  studentNameSnapshot: string;
  menuNameSnapshot: string;
  menuPriceSnapshot: number;
  vendorIdSnapshot: string;
  vendorNameSnapshot: string;
  otherItemName: string | null;
  status: 'active' | 'voided';
  revision: number;
  createdAt: FirestoreTimestamp;
  createdSeq: number;
  operatorUid: string;
  operatorEmail: string;
  sourceDevice: 'pc' | 'barcode_scanner' | 'ipad_handoff';
  note: string;
  lastCommandId: string;
  updatedAt: FirestoreTimestamp;
}

/** commands/{commandId}; full 22-kind typed schema, with runtime enabling limited to P05 kinds. */
export type CloudCommandDoc = StoredCloudCommandDoc;

/** days/{date}/settlements/{revision} */
export interface CloudSettlementDoc {
  dayId: string;
  revision: number;
  status: 'closed' | 'reopened';
  totals: CloudDayTotalsDoc;
  openingCash: number;
  expectedCash: number;
  countedCash: number;
  difference: number;
  note: string;
  actorUid: string;
  actorEmail: string;
  sourceSeq: number;
  committedAt: FirestoreTimestamp;
  previousRevision: number | null;
  lastCommandId: string;
}

// ---------------------------------------------------------------------------
// Adapters: Cloud Doc <-> Domain Types
// ---------------------------------------------------------------------------

function timestampToISOString(ts: unknown): string {
  if (typeof ts === 'string') return ts;
  if (ts && typeof (ts as { toDate?: () => Date }).toDate === 'function') {
    return (ts as { toDate: () => Date }).toDate().toISOString();
  }
  if (ts instanceof Date) return ts.toISOString();
  return new Date().toISOString();
}

/**
 * 將 CloudTransactionDoc 映射為既有前端 domain 交易物件。
 * Cloud 不持久化 afterBalance，若傳入可附上投影計算後的 afterBalance。
 */
export function cloudTransactionToLedgerTransaction(
  doc: CloudTransactionDoc,
  afterBalance = 0,
): LedgerTransaction {
  return {
    transactionId: doc.transactionId,
    businessDate: doc.businessDate,
    createdAt: timestampToISOString(doc.createdAt),
    studentId: doc.studentId,
    studentNameSnapshot: doc.studentNameSnapshot,
    type: doc.type,
    mealPrice: doc.mealPrice,
    paidAmount: doc.paidAmount,
    amount: doc.amount,
    afterBalance,
    menuNameSnapshot: doc.menuNameSnapshot,
    vendorNameSnapshot: doc.vendorNameSnapshot,
    sourceDevice: doc.sourceDevice,
    operatorId: doc.operatorUid,
    syncStatus: doc.status === 'voided' ? 'voided' : 'synced',
    revision: doc.revision,
    note: doc.note,
    otherItemName: doc.mealKind === 'other' ? (doc.otherItemName ?? doc.menuNameSnapshot ?? undefined) : undefined,
  };
}

/**
 * 將 CloudStudentDoc 映射為既有前端 domain 學員物件。
 */
export function cloudStudentToStudentAccount(doc: CloudStudentDoc): StudentAccount {
  return {
    studentId: doc.studentId,
    studentCode: doc.studentCode,
    displayName: doc.displayName,
    status: doc.status,
    currentBalance: doc.currentBalance,
    aliases: doc.aliases ?? [],
    faceEnrollmentStatus: 'none',
    openingBalance: {
      amount: doc.openingBalance.amount,
      asOfDate: doc.openingBalance.asOfDate,
      note: doc.openingBalance.note ?? '',
      createdAt: timestampToISOString(doc.openingBalance.createdAt),
    },
    createdAt: timestampToISOString(doc.createdAt),
    updatedAt: timestampToISOString(doc.updatedAt),
    revision: doc.revision,
  };
}

/** 驗證新版 CloudStudentDoc */
export function validateCloudStudentDoc(input: Record<string, unknown>): ValidationResult {
  if (typeof input.studentId !== 'string' || !input.studentId.trim()) {
    return { ok: false, reason: 'studentId 必須為非空字串' };
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.studentId)) {
    return { ok: false, reason: 'studentId 必須為 UUID 格式' };
  }
  if (typeof input.studentCode !== 'string' || !STUDENT_CODE_REGEX.test(input.studentCode)) {
    return { ok: false, reason: 'studentCode 必須為有效正規化格式（001–999999）' };
  }
  if (input.status !== 'active' && input.status !== 'inactive') {
    return { ok: false, reason: 'status 必須為 active 或 inactive' };
  }
  if (typeof input.displayName !== 'string' || !input.displayName.trim()) {
    return { ok: false, reason: 'displayName 必須為非空字串' };
  }
  if (typeof input.currentBalance !== 'number' || !Number.isFinite(input.currentBalance)) {
    return { ok: false, reason: 'currentBalance 必須為有效數字' };
  }
  if (typeof input.revision !== 'number' || input.revision < 1) {
    return { ok: false, reason: 'revision 必須為正整數' };
  }
  return { ok: true };
}

/** 驗證新版 CloudStudentCodeIndexDoc */
export function validateCloudStudentCodeIndexDoc(input: Record<string, unknown>): ValidationResult {
  if (typeof input.studentId !== 'string' || !input.studentId.trim()) {
    return { ok: false, reason: 'studentId 必須為非空字串' };
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.studentId)) {
    return { ok: false, reason: 'studentId 必須為 UUID 格式' };
  }
  if (typeof input.lastCommandId !== 'string' || !input.lastCommandId.trim()) {
    return { ok: false, reason: 'lastCommandId 必須為非空字串' };
  }
  return { ok: true };
}

/** 驗證新版 CloudTransactionDoc */
export function validateCloudTransactionDoc(input: Record<string, unknown>): ValidationResult {
  if (typeof input.transactionId !== 'string' || !input.transactionId.trim()) {
    return { ok: false, reason: 'transactionId 必須為非空字串' };
  }
  if (input.type !== 'order' && input.type !== 'payment' && input.type !== 'expense') {
    return { ok: false, reason: 'type 必須為 order, payment 或 expense' };
  }
  if (input.status !== 'active' && input.status !== 'voided') {
    return { ok: false, reason: 'status 必須為 active 或 voided' };
  }
  if (typeof input.revision !== 'number' || input.revision < 1) {
    return { ok: false, reason: 'revision 必須為正整數' };
  }
  return { ok: true };
}
