import type { LedgerTransaction } from './ledger';
import type { DailySettlement } from './cashClose';
import type { LedgerAuditEvent } from './ledgerAudit';

export interface QueueableLedgerPayload {
  entity: 'transaction' | 'settlement' | 'sync_event';
  operation: 'append';
  businessDate: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  dependencyIds?: string[];
}

export interface CloseBlockingSyncSummary {
  queued: number;
  failed: number;
  conflict: number;
}

export function buildTransactionQueuePayload(tx: LedgerTransaction): QueueableLedgerPayload {
  return {
    entity: 'transaction',
    operation: 'append',
    businessDate: tx.businessDate,
    idempotencyKey: `tx:${tx.transactionId}:v${tx.revision}`,
    payload: { ...tx, kind: 'transaction' },
  };
}

export function buildSettlementQueuePayload(
  settlement: DailySettlement,
  dependencyIds: string[],
): QueueableLedgerPayload {
  return {
    entity: 'settlement',
    operation: 'append',
    businessDate: settlement.businessDate,
    idempotencyKey: `settle:${settlement.settlementId}:v${settlement.revision}`,
    dependencyIds,
    payload: { ...settlement, kind: 'settlement' },
  };
}

export function buildAuditEventQueuePayload(
  event: LedgerAuditEvent,
  createdTransactionId: string,
): QueueableLedgerPayload {
  return {
    entity: 'sync_event',
    operation: 'append',
    businessDate: event.businessDate,
    idempotencyKey: `evt:${event.auditEventId}`,
    dependencyIds: [createdTransactionId],
    payload: { ...event, kind: 'audit_event' },
  };
}

export function getCloseBlockingSyncSummary(txs: LedgerTransaction[]): CloseBlockingSyncSummary {
  return {
    queued: txs.filter(t => t.syncStatus === 'queued').length,
    failed: txs.filter(t => t.syncStatus === 'failed').length,
    conflict: txs.filter(t => t.syncStatus === 'conflict').length,
  };
}
