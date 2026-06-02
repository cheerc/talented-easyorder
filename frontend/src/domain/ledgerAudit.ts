import type { LedgerSyncStatus } from './types';

export type LedgerAuditEventType =
  | 'transaction_edited'
  | 'transaction_deleted'
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
  | { action: 'hard_delete'; reasonRequired: true }
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
  return { action: 'direct_edit', reasonRequired: true };
}

export function decideLedgerDeletePolicy(
  tx: { syncStatus: LedgerSyncStatus },
  dateStatus: BusinessDateStatus,
): LedgerMutationDecision {
  if (dateStatus === 'closed') {
    return { action: 'blocked', message: '此日期已關閉，需先 reopen 後才能刪除' };
  }
  return { action: 'hard_delete', reasonRequired: true };
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

