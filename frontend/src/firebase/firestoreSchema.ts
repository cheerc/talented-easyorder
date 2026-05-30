import { serverTimestamp, type FieldValue, type Timestamp } from 'firebase/firestore';
import type { ValidationResult } from '../types/validation';

export type FirestoreTimestamp = Timestamp | FieldValue;
export type FirestoreTransactionType = 'order' | 'payment' | 'refund' | 'cancel' | 'correction' | 'void';
export type FirestoreSyncStatus = 'pending' | 'synced' | 'conflict' | 'voided';

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
