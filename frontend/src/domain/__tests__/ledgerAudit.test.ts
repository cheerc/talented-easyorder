import { describe, it, expect } from 'vitest';
import {
  decideLedgerEditPolicy,
  decideLedgerDeletePolicy,
  createLedgerAuditEvent,
} from '../ledgerAudit';
import type { LedgerTransaction } from '../ledger';
import type { AuditEventInput } from '../ledgerAudit';

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

const auditInput: AuditEventInput = {
  auditEventId: 'evt-001',
  eventType: 'transaction_edited',
  entityType: 'transaction',
  entityId: 'tx-1',
  businessDate: '2026-05-15',
  before: { paidAmount: 0 },
  after: { paidAmount: 85 },
  reason: '修正收款金額',
  operatorId: 'op-admin',
  createdAt: '2026-05-15T15:00:00.000Z',
};

/* ------ decideLedgerEditPolicy ------ */

describe('decideLedgerEditPolicy', () => {
  it('open date + local syncStatus → direct_edit', () => {
    const result = decideLedgerEditPolicy(makeTx({ syncStatus: 'local' }), 'open');
    expect(result.action).toBe('direct_edit');
  });

  it('open date + queued syncStatus → direct_edit', () => {
    const result = decideLedgerEditPolicy(makeTx({ syncStatus: 'queued' }), 'open');
    expect(result.action).toBe('direct_edit');
  });

  it('open date + synced syncStatus → direct_edit', () => {
    const result = decideLedgerEditPolicy(makeTx({ syncStatus: 'synced' }), 'open');
    expect(result.action).toBe('direct_edit');
  });

  it('open date + failed syncStatus → direct_edit', () => {
    const result = decideLedgerEditPolicy(makeTx({ syncStatus: 'failed' }), 'open');
    expect(result.action).toBe('direct_edit');
  });

  it('open date + conflict syncStatus → direct_edit', () => {
    const result = decideLedgerEditPolicy(makeTx({ syncStatus: 'conflict' }), 'open');
    expect(result.action).toBe('direct_edit');
  });

  it('closed date → blocked', () => {
    const result = decideLedgerEditPolicy(makeTx(), 'closed');
    expect(result.action).toBe('blocked');
    if (result.action === 'blocked') {
      expect(result.message).toContain('reopen');
    }
  });

  it('reopened date + local → direct_edit', () => {
    const result = decideLedgerEditPolicy(makeTx({ syncStatus: 'local' }), 'reopened');
    expect(result.action).toBe('direct_edit');
  });
});

/* ------ decideLedgerDeletePolicy ------ */

describe('decideLedgerDeletePolicy', () => {
  it('open date + local syncStatus → hard_delete', () => {
    const result = decideLedgerDeletePolicy(makeTx({ syncStatus: 'local' }), 'open');
    expect(result.action).toBe('hard_delete');
  });

  it('open date + queued syncStatus → hard_delete', () => {
    const result = decideLedgerDeletePolicy(makeTx({ syncStatus: 'queued' }), 'open');
    expect(result.action).toBe('hard_delete');
  });

  it('open date + synced syncStatus → hard_delete', () => {
    const result = decideLedgerDeletePolicy(makeTx({ syncStatus: 'synced' }), 'open');
    expect(result.action).toBe('hard_delete');
  });

  it('open date + failed syncStatus → hard_delete', () => {
    const result = decideLedgerDeletePolicy(makeTx({ syncStatus: 'failed' }), 'open');
    expect(result.action).toBe('hard_delete');
  });

  it('open date + conflict syncStatus → hard_delete', () => {
    const result = decideLedgerDeletePolicy(makeTx({ syncStatus: 'conflict' }), 'open');
    expect(result.action).toBe('hard_delete');
  });

  it('closed date → blocked', () => {
    const result = decideLedgerDeletePolicy(makeTx(), 'closed');
    expect(result.action).toBe('blocked');
  });
});

/* ------ createLedgerAuditEvent ------ */

describe('createLedgerAuditEvent', () => {
  it('creates audit event with caller-supplied fields', () => {
    const event = createLedgerAuditEvent(auditInput);
    expect(event.auditEventId).toBe('evt-001');
    expect(event.eventType).toBe('transaction_edited');
    expect(event.entityType).toBe('transaction');
    expect(event.entityId).toBe('tx-1');
    expect(event.businessDate).toBe('2026-05-15');
    expect(event.before).toEqual({ paidAmount: 0 });
    expect(event.after).toEqual({ paidAmount: 85 });
    expect(event.reason).toBe('修正收款金額');
    expect(event.operatorId).toBe('op-admin');
    expect(event.createdAt).toBe('2026-05-15T15:00:00.000Z');
  });
});
