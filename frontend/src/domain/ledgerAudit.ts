import type { LedgerTransaction, LedgerSyncStatus } from './ledger';

export type LedgerAuditEventType =
  | 'transaction_edited'
  | 'transaction_corrected'
  | 'transaction_voided'
  | 'transaction_hard_deleted'
  | 'business_date_closed'
  | 'business_date_reopened'
  | 'csv_exported'
  | 'report_printed';

export interface LedgerAuditEvent {
  auditEventId: string;
  eventType: LedgerAuditEventType;
  entityType: 'transaction' | 'settlement' | 'business_date' | 'export';
  entityId: string;
  businessDate: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string;
  operatorId: string;
  createdAt: string;
}

export type LedgerMutationDecision =
  | { action: 'direct_edit'; reasonRequired: boolean }
  | { action: 'append_correction'; reasonRequired: true }
  | { action: 'hard_delete'; reasonRequired: true }
  | { action: 'append_void'; reasonRequired: true }
  | { action: 'blocked'; message: string };

export interface AuditEventInput {
  auditEventId: string;
  eventType: LedgerAuditEventType;
  entityType: 'transaction' | 'settlement' | 'business_date' | 'export';
  entityId: string;
  businessDate: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string;
  operatorId: string;
  createdAt: string;
}

type BusinessDateStatus = 'open' | 'closed' | 'reopened';

export function decideLedgerEditPolicy(
  tx: { syncStatus: LedgerSyncStatus },
  dateStatus: BusinessDateStatus,
): LedgerMutationDecision {
  if (dateStatus === 'closed') {
    return { action: 'blocked', message: '此日期已關閉，請先 reopen 後再做更正' };
  }
  if (tx.syncStatus === 'local') {
    return { action: 'direct_edit', reasonRequired: true };
  }
  return { action: 'append_correction', reasonRequired: true };
}

export function decideLedgerDeletePolicy(
  tx: { syncStatus: LedgerSyncStatus },
  dateStatus: BusinessDateStatus,
): LedgerMutationDecision {
  if (dateStatus === 'closed') {
    return { action: 'blocked', message: '此日期已關閉，無法刪除' };
  }
  if (tx.syncStatus === 'local') {
    return { action: 'hard_delete', reasonRequired: true };
  }
  return { action: 'append_void', reasonRequired: true };
}

export function createLedgerAuditEvent(input: AuditEventInput): LedgerAuditEvent {
  return {
    auditEventId: input.auditEventId,
    eventType: input.eventType,
    entityType: input.entityType,
    entityId: input.entityId,
    businessDate: input.businessDate,
    before: input.before,
    after: input.after,
    reason: input.reason,
    operatorId: input.operatorId,
    createdAt: input.createdAt,
  };
}

export function createCorrectionTransaction(
  original: LedgerTransaction,
  updates: { mealPrice: number; paidAmount: number; note: string; type: 'order' | 'topup' | 'cancel' },
  previousBalance: number,
  input: AuditEventInput,
): LedgerTransaction {
  const amount = updates.paidAmount - updates.mealPrice;
  const newAfterBalance = previousBalance + amount;
  return {
    transactionId: `corrects-${original.transactionId}-${input.createdAt}`,
    businessDate: original.businessDate,
    createdAt: input.createdAt,
    studentId: original.studentId,
    studentNameSnapshot: original.studentNameSnapshot,
    type: 'correction',
    mealPrice: updates.mealPrice,
    paidAmount: updates.paidAmount,
    amount,
    afterBalance: newAfterBalance,
    menuNameSnapshot: original.menuNameSnapshot,
    vendorNameSnapshot: original.vendorNameSnapshot,
    sourceDevice: original.sourceDevice,
    operatorId: input.operatorId,
    syncStatus: 'local',
    revision: 1,
    note: updates.note,
  };
}

export function createVoidTransaction(
  original: LedgerTransaction,
  reason: string,
  operatorId: string,
  createdAt: string,
): LedgerTransaction {
  return {
    transactionId: `voids-${original.transactionId}-${createdAt}`,
    businessDate: original.businessDate,
    createdAt,
    studentId: original.studentId,
    studentNameSnapshot: original.studentNameSnapshot,
    type: 'void',
    mealPrice: -original.mealPrice || 0,
    paidAmount: -original.paidAmount || 0,
    amount: -original.amount || 0,
    afterBalance: 0,
    menuNameSnapshot: original.menuNameSnapshot,
    vendorNameSnapshot: original.vendorNameSnapshot,
    sourceDevice: original.sourceDevice,
    operatorId,
    syncStatus: 'local',
    revision: 1,
    note: `voids ${original.transactionId}`,
  };
}

export function recalculateStudentAfterBalances(
  transactions: LedgerTransaction[],
  studentId: string,
  openingBalance: number,
): LedgerTransaction[] {
  const sorted = [...transactions].sort((a, b) => {
    if (a.businessDate !== b.businessDate) return a.businessDate.localeCompare(b.businessDate);
    if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
    return a.transactionId.localeCompare(b.transactionId);
  });

  let running = openingBalance;
  return sorted.map(tx => {
    if (tx.studentId === studentId) {
      running += tx.amount;
      return { ...tx, afterBalance: running };
    }
    return tx;
  });
}