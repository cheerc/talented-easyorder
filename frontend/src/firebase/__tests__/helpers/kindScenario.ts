import type { BusinessCommandKind } from '../../../domain/cloudCommands';
import { UNDO_REASON } from '../../../domain/cloudTransactionMutation';
import { encryptBackup, sha256Hex } from '../../cloudBackup';
import type { createCloudBackupCommandRepository } from '../../cloudBackupCommandRepository';
import type { createCloudBackupRepository } from '../../cloudBackupRepository';
import type { createCloudCommandRepository } from '../../cloudCommandRepository';
import type { createCloudDayCloseRepository } from '../../cloudDayCloseRepository';
import type { CloudTransactionMutationInput, createCloudOrderRepository } from '../../cloudOrderRepository';
import type { createCloudReportActionRepository } from '../../cloudReportActionRepository';
import { shiftDay, taipeiToday, uuid } from './r02Scenario';

/**
 * The one scenario that walks all 27 command kinds through the production writers, one step per kind (S01–S27 of
 * `rulesMatrix.ts`). `cloudRulesMatrix.spec.ts` (P16b) captures each step's batch and attacks it; `cloudCapacity.spec.ts`
 * (P16d) commits each step and meters it. Both use the same steps, so what is measured is what the matrix proves is closed.
 * The steps only call the production repositories; the data they need comes from `deps`, which a spec fills in `beforeAll`.
 */
export const today = taipeiToday();
export const gap = shiftDay(today, -2);
export const alpha = uuid(900_001);
export const beta = uuid(900_002);
export const decoyStudent = uuid(900_010);
export const vendorA = uuid(900_003);
export const vendorB = uuid(900_004);
/** Ten aliases of 100 characters: the most a student may carry, so that every student-touching step runs at the Rules' worst case. */
export const aliasSet = (char: string) => Array.from({ length: 10 }, (_item, index) => `${index}${char.repeat(99)}`);

export interface KindScenarioDeps {
  writer: ReturnType<typeof createCloudCommandRepository>;
  orders: ReturnType<typeof createCloudOrderRepository>;
  closing: ReturnType<typeof createCloudDayCloseRepository>;
  backups: ReturnType<typeof createCloudBackupRepository>;
  backupReceipts: ReturnType<typeof createCloudBackupCommandRepository>;
  reports: ReturnType<typeof createCloudReportActionRepository>;
  epoch: number;
  backupPassword: string;
  /** A document's data as the administrator sees it (security rules off). */
  read(path: string): Promise<Record<string, number & string>>;
  /** A fresh command or transaction id. */
  id(): string;
  ok(result: { ok: boolean }, label: string): void;
  headSeq(): Promise<number>;
  revisions(studentId: string, dayId: string): Promise<{ student: number; day: number }>;
}

export interface KindStep {
  kind: BusinessCommandKind;
  /** Plain production writes the step needs first; they commit for real, outside any capture or meter. */
  setup?: () => Promise<void>;
  /** The production call of the step: it commits one command of `kind`. */
  run: () => Promise<unknown>;
}

export function buildKindSteps(D: KindScenarioDeps): KindStep[] {
  const steps: KindStep[] = [];
  const add = (kind: BusinessCommandKind, run: () => Promise<unknown>, setup?: () => Promise<void>) => {
    steps.push({ kind, run, ...(setup ? { setup } : {}) });
  };

  const plainOrder = async (studentId: string, dayId: string, mealPrice: number, paidAmount: number) => {
    const rev = await D.revisions(studentId, dayId); const commandId = D.id(); const transactionId = D.id();
    D.ok(await D.orders.createOrder({ commandId, transactionId, leaseEpoch: D.epoch, studentId, dayId,
      expectedStudentRevision: rev.student, expectedDayRevision: rev.day, mealKind: 'other', mealPrice, paidAmount,
      menuRevision: null, otherItemName: '自備便當', note: '' }), 'plain CreateOrder');
    return { commandId, transactionId };
  };
  const mutation = async (transactionId: string, spec: Pick<CloudTransactionMutationInput, 'kind' | 'payload'>) => {
    const tx = await D.read(`transactions/${transactionId}`);
    return D.orders.mutateTransaction({ commandId: D.id(), leaseEpoch: D.epoch, transactionId, studentId: tx.studentId, dayId: today,
      expectedTransactionRevision: tx.revision, expectedStudentRevision: (await D.read(`students/${alpha}`)).revision,
      expectedDayRevision: (await D.read(`days/${today}`)).revision, ...spec } as CloudTransactionMutationInput);
  };

  // S01–S04: the student commands
  add('CreateStudent', async () => D.writer.commitCommand({ commandId: D.id(), kind: 'CreateStudent', leaseEpoch: D.epoch,
    targets: { studentId: alpha }, expectedRevisions: { student: 0 },
    payload: { studentCode: '731901', displayName: 'P16b Alpha', aliases: aliasSet('甲'), openingBalance: { amount: 100, asOfDate: '2026-10-01', note: '' } } }));
  add('ChangeStudentCode', async () => D.writer.commitCommand({ commandId: D.id(), kind: 'ChangeStudentCode', leaseEpoch: D.epoch,
    targets: { studentId: alpha }, expectedRevisions: { student: (await D.read(`students/${alpha}`)).revision },
    payload: { studentCode: '731903', reason: 'P16b code change' } }));
  add('EditStudent', async () => D.writer.commitCommand({ commandId: D.id(), kind: 'EditStudent', leaseEpoch: D.epoch,
    targets: { studentId: alpha }, expectedRevisions: { student: (await D.read(`students/${alpha}`)).revision },
    payload: { displayName: 'P16b Alpha Edited', aliases: aliasSet('乙') } }));
  add('SetStudentStatus', async () => D.writer.commitCommand({ commandId: D.id(), kind: 'SetStudentStatus', leaseEpoch: D.epoch,
    targets: { studentId: alpha }, expectedRevisions: { student: (await D.read(`students/${alpha}`)).revision },
    payload: { status: 'inactive', reason: 'P16b pause' } }));

  // S05–S06: vendors (the second one is inactivated first, because only an inactive vendor can be removed)
  add('SaveVendor', async () => D.writer.commitCommand({ commandId: D.id(), kind: 'SaveVendor', leaseEpoch: D.epoch,
    targets: { vendorId: vendorA }, expectedRevisions: { vendor: 0 },
    payload: { vendorId: vendorA, name: 'P16b Vendor', phone: '', note: '', status: 'active' } }));
  add('RemoveVendor', async () => D.writer.commitCommand({ commandId: D.id(), kind: 'RemoveVendor', leaseEpoch: D.epoch,
    targets: { vendorId: vendorB }, expectedRevisions: { vendor: (await D.read(`vendors/${vendorB}`)).revision },
    payload: { reason: 'P16b remove' } }), async () => {
    D.ok(await D.writer.commitCommand({ commandId: D.id(), kind: 'SetStudentStatus', leaseEpoch: D.epoch,
      targets: { studentId: alpha }, expectedRevisions: { student: (await D.read(`students/${alpha}`)).revision },
      payload: { status: 'active', reason: 'P16b resume' } }), 'student active again');
    D.ok(await D.writer.commitCommand({ commandId: D.id(), kind: 'SaveVendor', leaseEpoch: D.epoch,
      targets: { vendorId: vendorB }, expectedRevisions: { vendor: 0 },
      payload: { vendorId: vendorB, name: 'P16b Removed Vendor', phone: '', note: '', status: 'active' } }), 'vendor B');
    D.ok(await D.writer.commitCommand({ commandId: D.id(), kind: 'SaveVendor', leaseEpoch: D.epoch,
      targets: { vendorId: vendorB }, expectedRevisions: { vendor: (await D.read(`vendors/${vendorB}`)).revision },
      payload: { vendorId: vendorB, name: 'P16b Removed Vendor', phone: '', note: '', status: 'inactive' } }), 'vendor B inactive');
  });

  // S07–S11: a back-filled gap day, closed, then a post-close entry
  add('EnsureDay', async () => D.writer.commitCommand({ commandId: D.id(), kind: 'EnsureDay', leaseEpoch: D.epoch,
    targets: { dayId: gap }, expectedRevisions: { day: 0 }, payload: { businessDate: gap } }));
  add('BackfillOpeningCash', async () => D.closing.backfillOpening({ commandId: D.id(), leaseEpoch: D.epoch, dayId: gap,
    expectedDayRevision: (await D.read(`days/${gap}`)).revision, openingCash: 600, reason: 'P16b no system that day' }));
  add('StartBackfill', async () => D.writer.commitCommand({ commandId: D.id(), kind: 'StartBackfill', leaseEpoch: D.epoch,
    targets: { dayId: gap }, expectedRevisions: { day: (await D.read(`days/${gap}`)).revision }, payload: { reason: 'P16b power cut, entered later' } }));
  add('CloseDay', async () => {
    const day = await D.read(`days/${gap}`);
    const expected = (await D.closing.read(gap))!.expectedCash!;
    return D.closing.closeDay({ commandId: D.id(), leaseEpoch: D.epoch, dayId: gap, expectedDayRevision: day.revision,
      expectedSettlementRevision: day.lastSettlementRevision, expectedCash: expected, countedCash: expected, note: '', alignWithDayId: null });
  });
  add('RecordPostCloseEntry', async () => {
    const day = await D.read(`days/${gap}`);
    return D.closing.recordPostCloseEntry({ commandId: D.id(), leaseEpoch: D.epoch, dayId: gap, expectedDayRevision: day.revision,
      expectedSettlementRevision: day.lastSettlementRevision, direction: 'income', amount: 5, reason: 'P16b found after closing' });
  });

  // S12–S13: today's menu and opening cash (today is created plainly: EnsureDay already has its matrix step)
  add('SetDayMenu', async () => D.writer.commitCommand({ commandId: D.id(), kind: 'SetDayMenu', leaseEpoch: D.epoch, targets: { dayId: today },
    expectedRevisions: { day: (await D.read(`days/${today}`)).revision, headSeq: await D.headSeq() },
    payload: { selectionDate: today, itemName: 'P16b Menu', price: 80, vendorId: vendorA, vendorNameSnapshot: 'P16b Vendor', inheritedFromDate: null } }),
  async () => {
    D.ok(await D.writer.commitCommand({ commandId: D.id(), kind: 'EnsureDay', leaseEpoch: D.epoch,
      targets: { dayId: today }, expectedRevisions: { day: 0 }, payload: { businessDate: today } }), 'EnsureDay today');
  });
  add('SetOpeningCash', async () => D.writer.commitCommand({ commandId: D.id(), kind: 'SetOpeningCash', leaseEpoch: D.epoch,
    targets: { dayId: today }, expectedRevisions: { day: (await D.read(`days/${today}`)).revision },
    payload: { openingCash: 1000, reason: 'P16b float' } }));

  // S14: a student whose opening balance is dated today
  add('CorrectOpening', async () => {
    const rev = await D.revisions(beta, today);
    return D.writer.commitCommand({ commandId: D.id(), kind: 'CorrectOpening', leaseEpoch: D.epoch,
      targets: { studentId: beta, dayId: today }, expectedRevisions: { student: rev.student, day: rev.day },
      payload: { amount: 80, note: 'P16b checked', reason: 'P16b typo' } });
  }, async () => {
    D.ok(await D.writer.commitCommand({ commandId: D.id(), kind: 'CreateStudent', leaseEpoch: D.epoch,
      targets: { studentId: beta }, expectedRevisions: { student: 0 },
      payload: { studentCode: '731902', displayName: 'P16b Beta', aliases: [], openingBalance: { amount: 100, asOfDate: today, note: '' } } }), 'beta');
  });

  // S15–S24: orders, payments, cash, refunds and the five changes of a transaction row
  let corrected = '';
  add('CreateOrder', async () => {
    const rev = await D.revisions(alpha, today); const transactionId = D.id(); corrected = transactionId;
    return D.orders.createOrder({ commandId: D.id(), transactionId, leaseEpoch: D.epoch, studentId: alpha, dayId: today,
      expectedStudentRevision: rev.student, expectedDayRevision: rev.day, mealKind: 'other', mealPrice: 80, paidAmount: 100,
      menuRevision: null, otherItemName: '自備便當', note: '' });
  });
  add('CorrectTransaction', async () => mutation(corrected, { kind: 'CorrectTransaction',
    payload: { mealPrice: 70, paidAmount: 100, amount: 30, note: '', reason: 'P16b price typo' } }));
  let keptOrder = '';
  add('CancelKeepDeposit', async () => mutation(keptOrder, { kind: 'CancelKeepDeposit', payload: { reason: 'P16b not eating' } }),
    async () => { keptOrder = (await plainOrder(alpha, today, 80, 100)).transactionId; });
  let refundedOrder = '';
  add('CancelRefund', async () => mutation(refundedOrder, { kind: 'CancelRefund', payload: { reason: 'P16b not eating, cash back' } }),
    async () => { refundedOrder = (await plainOrder(alpha, today, 80, 100)).transactionId; });
  let paymentCommand = ''; let paymentTransaction = '';
  add('CreatePayment', async () => {
    const rev = await D.revisions(alpha, today); paymentCommand = D.id(); paymentTransaction = D.id();
    return D.orders.createPayment({ commandId: paymentCommand, transactionId: paymentTransaction, leaseEpoch: D.epoch, studentId: alpha, dayId: today,
      expectedStudentRevision: rev.student, expectedDayRevision: rev.day, paidAmount: 30, note: '' });
  });
  add('Undo', async () => mutation(paymentTransaction, { kind: 'Undo', payload: { targetCommandId: paymentCommand, reason: UNDO_REASON } }));
  add('CreateCashMovement', async () => D.orders.createCashMovement({ commandId: D.id(), transactionId: D.id(), leaseEpoch: D.epoch, dayId: today,
    expectedDayRevision: (await D.read(`days/${today}`)).revision, direction: 'income', amount: 50, reason: 'P16b float top-up' }));
  let refundTransaction = '';
  add('CreateRefund', async () => {
    const rev = await D.revisions(alpha, today); refundTransaction = D.id();
    return D.orders.createRefund({ commandId: D.id(), transactionId: refundTransaction, leaseEpoch: D.epoch, studentId: alpha, dayId: today,
      expectedStudentRevision: rev.student, expectedDayRevision: rev.day, amount: 20, reason: 'P16b overpaid' });
  });
  add('VoidTransaction', async () => mutation(refundTransaction, { kind: 'VoidTransaction', payload: { reason: 'P16b refund typo' } }));

  // S25–S27: reopening needs a closed day; then the three records of what the operator did
  add('ReopenDay', async () => {
    const closed = await D.read(`days/${today}`);
    return D.closing.reopenDay({ commandId: D.id(), leaseEpoch: D.epoch, dayId: today, expectedDayRevision: closed.revision,
      expectedSettlementRevision: closed.lastSettlementRevision, reason: 'P16b wrong collection' });
  }, async () => {
    const day = await D.read(`days/${today}`);
    const expected = (await D.closing.read(today))!.expectedCash!;
    D.ok(await D.closing.closeDay({ commandId: D.id(), leaseEpoch: D.epoch, dayId: today, expectedDayRevision: day.revision,
      expectedSettlementRevision: day.lastSettlementRevision, expectedCash: expected, countedCash: expected - 10, note: 'P16b short' }), 'close today');
  });
  add('RecordExport', async () => D.reports.recordExport({ commandId: D.id(), leaseEpoch: D.epoch,
    range: { kind: 'custom', startDate: today, endDate: today }, scope: { studentId: null }, sourceSeq: await D.headSeq(), exportType: 'transactions-original' }));
  add('RecordPrint', async () => D.reports.recordPrint({ commandId: D.id(), leaseEpoch: D.epoch,
    range: { kind: 'custom', startDate: today, endDate: today }, scope: { studentId: null }, sourceSeq: await D.headSeq(),
    printType: 'ledger-original', businessDate: today }));
  // The export is a plain read plus an encryption, so it is the step's setup; the metered or captured call is the receipt alone.
  let backup: { toSeq: number; sha256: string } | null = null;
  add('RecordBackup', async () => D.backupReceipts.commitRecordBackupIntent({ commandId: D.id(), leaseEpoch: D.epoch,
    payload: { backupType: 'command-incremental', sourceSeq: backup!.toSeq, fromSeq: 0, toSeq: backup!.toSeq, sha256: backup!.sha256 } }), async () => {
    const exported = await D.backups.exportRange({ fromSeq: 0, generatedAt: '2026-10-23T03:00:00.000Z' });
    backup = { toSeq: exported.toSeq, sha256: await sha256Hex(await encryptBackup(exported.manifest, D.backupPassword)) };
  });
  return steps;
}
