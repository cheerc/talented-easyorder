import { describe, it, expect } from 'vitest';
import {
  decideLedgerEditPolicy,
  decideLedgerDeletePolicy,
  createLedgerAuditEvent,
  createCorrectionTransaction,
  createVoidTransaction,
  recalculateStudentAfterBalances,
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

  it('open date + queued syncStatus → append_correction', () => {
    const result = decideLedgerEditPolicy(makeTx({ syncStatus: 'queued' }), 'open');
    expect(result.action).toBe('append_correction');
  });

  it('open date + synced syncStatus → append_correction', () => {
    const result = decideLedgerEditPolicy(makeTx({ syncStatus: 'synced' }), 'open');
    expect(result.action).toBe('append_correction');
  });

  it('open date + failed syncStatus → append_correction', () => {
    const result = decideLedgerEditPolicy(makeTx({ syncStatus: 'failed' }), 'open');
    expect(result.action).toBe('append_correction');
  });

  it('open date + conflict syncStatus → append_correction', () => {
    const result = decideLedgerEditPolicy(makeTx({ syncStatus: 'conflict' }), 'open');
    expect(result.action).toBe('append_correction');
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

  it('open date + queued syncStatus → append_void', () => {
    const result = decideLedgerDeletePolicy(makeTx({ syncStatus: 'queued' }), 'open');
    expect(result.action).toBe('append_void');
  });

  it('open date + synced syncStatus → append_void', () => {
    const result = decideLedgerDeletePolicy(makeTx({ syncStatus: 'synced' }), 'open');
    expect(result.action).toBe('append_void');
  });

  it('open date + failed syncStatus → append_void', () => {
    const result = decideLedgerDeletePolicy(makeTx({ syncStatus: 'failed' }), 'open');
    expect(result.action).toBe('append_void');
  });

  it('open date + conflict syncStatus → append_void', () => {
    const result = decideLedgerDeletePolicy(makeTx({ syncStatus: 'conflict' }), 'open');
    expect(result.action).toBe('append_void');
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

/* ------ createCorrectionTransaction ------ */

describe('createCorrectionTransaction', () => {
  it('creates correction row referencing original transaction', () => {
    const input = { ...auditInput };
    const correctionTx = createCorrectionTransaction(
      makeTx({ transactionId: 'tx-orig', studentId: '015', businessDate: '2026-05-15', afterBalance: 100 }),
      { mealPrice: 85, paidAmount: 50, note: '更正', type: 'order' as const },
      130,
      input,
    );
    expect(correctionTx.type).toBe('correction');
    expect(correctionTx.studentId).toBe('015');
    expect(correctionTx.mealPrice).toBe(85);
    expect(correctionTx.paidAmount).toBe(50);
    expect(correctionTx.amount).toBe(50 - 85); // paidAmount - mealPrice = -35
    expect(correctionTx.afterBalance).toBe(95); // 130 + (50-85) = 95
    expect(correctionTx.note).toBe('更正');
  });
});

/* ------ createVoidTransaction ------ */

describe('createVoidTransaction', () => {
  it('creates void row reversing the original', () => {
    const original = makeTx({
      transactionId: 'tx-orig',
      studentId: '015',
      type: 'order',
      mealPrice: 85,
      paidAmount: 0,
      amount: -85,
      afterBalance: 15,
      businessDate: '2026-05-15',
    });
    const voidTx = createVoidTransaction(original, '操作錯誤', 'op-admin', '2026-05-15T16:00:00.000Z');
    expect(voidTx.type).toBe('void');
    expect(voidTx.studentId).toBe('015');
    expect(voidTx.mealPrice).toBe(-85); // reversed
    expect(voidTx.paidAmount).toBe(0);
    expect(voidTx.amount).toBe(85); // reversed -(-85) = 85
    expect(voidTx.note).toBe('voids tx-orig');
    expect(voidTx.syncStatus).toBe('local');
    expect(voidTx.revision).toBe(1);
  });
});

/* ------ recalculateStudentAfterBalances ------ */

describe('recalculateStudentAfterBalances', () => {
  it('recalculates later rows for the same student', () => {
    const txs: LedgerTransaction[] = [
      { ...makeTx({ transactionId: 'tx-1', studentId: '015', businessDate: '2026-05-14', createdAt: '2026-05-14T10:00:00.000Z', amount: -85, afterBalance: 15 }) },
      { ...makeTx({ transactionId: 'tx-2', studentId: '015', businessDate: '2026-05-15', createdAt: '2026-05-15T12:00:00.000Z', amount: -85, afterBalance: -70 }) },
      { ...makeTx({ transactionId: 'tx-3', studentId: '016', businessDate: '2026-05-15', createdAt: '2026-05-15T13:00:00.000Z', amount: -85, afterBalance: 15 }) },
    ];
    const recalc = recalculateStudentAfterBalances(txs, '015', 100);
    expect(recalc[0].afterBalance).toBe(15);  // unchanged, opening not applied
    expect(recalc[1].afterBalance).toBe(-70); // unchanged, consistent
    expect(recalc[2].afterBalance).toBe(15);  // different student, unchanged
  });

  it('leaves other students unchanged', () => {
    const txs: LedgerTransaction[] = [
      { ...makeTx({ transactionId: 'tx-1', studentId: '015', amount: -50, afterBalance: 50 }) },
      { ...makeTx({ transactionId: 'tx-2', studentId: '016', amount: -85, afterBalance: 15 }) },
    ];
    const recalc = recalculateStudentAfterBalances(txs, '015', 100);
    // student 016 should be untouched
    expect(recalc.find(t => t.studentId === '016')!.afterBalance).toBe(15);
  });
});