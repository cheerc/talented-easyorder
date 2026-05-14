import { describe, it, expect } from 'vitest';
import {
  buildTransactionQueuePayload,
  buildSettlementQueuePayload,
  buildAuditEventQueuePayload,
  getCloseBlockingSyncSummary,
} from '../ledgerSyncBoundary';
import type { LedgerTransaction } from '../ledger';
import type { DailySettlement } from '../cashClose';
import type { LedgerAuditEvent } from '../ledgerAudit';

const makeTx = (overrides: Partial<LedgerTransaction> = {}): LedgerTransaction => ({
  transactionId: 'tx-1',
  businessDate: '2026-05-15',
  createdAt: '2026-05-15T12:00:00.000Z',
  studentId: '015',
  studentNameSnapshot: '王小明',
  type: 'order',
  mealPrice: 85,
  paidAmount: 0,
  amount: -85,
  afterBalance: 15,
  menuNameSnapshot: '雞腿飯',
  vendorNameSnapshot: '便當王',
  sourceDevice: 'pc',
  syncStatus: 'local',
  revision: 1,
  note: '',
  ...overrides,
});

describe('buildTransactionQueuePayload', () => {
  it('maps transaction to queueable payload', () => {
    const payload = buildTransactionQueuePayload(makeTx());
    expect(payload.entity).toBe('transaction');
    expect(payload.operation).toBe('append');
    expect(payload.businessDate).toBe('2026-05-15');
    expect(payload.payload.transactionId).toBe('tx-1');
    expect(payload.idempotencyKey).toContain('tx-1');
  });
});

describe('buildSettlementQueuePayload', () => {
  it('maps settlement to queueable payload', () => {
    const settlement: DailySettlement = {
      settlementId: 's-1',
      businessDate: '2026-05-15',
      status: 'closed',
      settlementRevision: 1,
      orderCount: 10,
      transactionCount: 10,
      expectedCash: 500,
      countedCash: 500,
      difference: 0,
      note: '',
      closedBy: 'op-admin',
      closedAt: '2026-05-15T18:00:00.000Z',
      syncStatus: 'local',
      revision: 1,
    };
    const payload = buildSettlementQueuePayload(settlement, ['tx-1', 'tx-2']);
    expect(payload.entity).toBe('settlement');
    expect(payload.operation).toBe('append');
    expect(payload.dependencyIds).toEqual(['tx-1', 'tx-2']);
  });
});

describe('buildAuditEventQueuePayload', () => {
  it('maps audit event to queueable payload', () => {
    const event: LedgerAuditEvent = {
      auditEventId: 'evt-1',
      eventType: 'transaction_corrected',
      entityType: 'transaction',
      entityId: 'tx-1',
      businessDate: '2026-05-15',
      before: { amount: -85 },
      after: { amount: -35 },
      reason: 'test',
      operatorId: 'op-test',
      createdAt: '2026-05-15T15:00:00.000Z',
    };
    const payload = buildAuditEventQueuePayload(event, 'tx-1');
    expect(payload.entity).toBe('sync_event');
    expect(payload.operation).toBe('append');
    expect(payload.dependencyIds).toContain('tx-1');
  });
});

describe('getCloseBlockingSyncSummary', () => {
  it('returns counts for queued, failed, and conflict', () => {
    const txs: LedgerTransaction[] = [
      makeTx({ transactionId: 't1', syncStatus: 'queued' }),
      makeTx({ transactionId: 't2', syncStatus: 'failed' }),
      makeTx({ transactionId: 't3', syncStatus: 'conflict' }),
      makeTx({ transactionId: 't4', syncStatus: 'local' }),
      makeTx({ transactionId: 't5', syncStatus: 'synced' }),
    ];
    const summary = getCloseBlockingSyncSummary(txs);
    expect(summary.queued).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.conflict).toBe(1);
  });

  it('returns zero counts for clean transactions', () => {
    const summary = getCloseBlockingSyncSummary([
      makeTx({ syncStatus: 'local' }),
      makeTx({ syncStatus: 'synced' }),
    ]);
    expect(summary.queued).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.conflict).toBe(0);
  });
});