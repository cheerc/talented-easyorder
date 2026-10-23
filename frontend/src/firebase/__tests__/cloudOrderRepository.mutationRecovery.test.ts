import type { Firestore } from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloudOrderRepository, type CloudTransactionMutationInput } from '../cloudOrderRepository';
import type { CloudRecoveryReader } from '../cloudRecoveryReader';

const commands = vi.hoisted(() => ({
  commitCommand: vi.fn(),
  confirmPendingIntent: vi.fn(),
  cleanupConfirmedIntent: vi.fn(),
  confirmPending: vi.fn(),
  getPendingRecoveryContext: vi.fn(),
  readCommand: vi.fn(),
}));

vi.mock('../cloudCommandRepository', () => ({
  createCloudCommandRepository: () => commands,
}));

const db = {} as Firestore;
const recoveryReader = { assertCurrent: vi.fn() } as unknown as CloudRecoveryReader;
const correction: CloudTransactionMutationInput = {
  commandId: '00000000-0000-4000-8000-0000000000c1', leaseEpoch: 4,
  transactionId: '00000000-0000-4000-8000-0000000000c2', studentId: '00000000-0000-4000-8000-0000000000c3',
  dayId: '2026-10-18', expectedTransactionRevision: 2, expectedStudentRevision: 8, expectedDayRevision: 3,
  kind: 'CorrectTransaction',
  payload: { mealPrice: 60, paidAmount: 20, amount: -40, note: '', reason: '餐費輸入錯誤' },
};
const cashierVoid: CloudTransactionMutationInput = {
  commandId: '00000000-0000-4000-8000-0000000000c4', leaseEpoch: 4,
  transactionId: '00000000-0000-4000-8000-0000000000c5', studentId: '__cashier__',
  dayId: '2026-10-18', expectedTransactionRevision: 1, expectedStudentRevision: null, expectedDayRevision: 3,
  kind: 'VoidTransaction', payload: { reason: '重複' },
};
const expectedCorrection = {
  commandId: correction.commandId, kind: 'CorrectTransaction', leaseEpoch: 4,
  targets: { transactionId: correction.transactionId, studentId: correction.studentId, dayId: '2026-10-18' },
  expectedRevisions: { transaction: 2, student: 8, day: 3 },
  payload: correction.payload,
};
const expectedCashierVoid = {
  commandId: cashierVoid.commandId, kind: 'VoidTransaction', leaseEpoch: 4,
  targets: { transactionId: cashierVoid.transactionId, studentId: '__cashier__', dayId: '2026-10-18' },
  expectedRevisions: { transaction: 1, day: 3 },
  payload: { reason: '重複' },
};

describe('transaction mutation recovery (intent) adapter', () => {
  beforeEach(() => {
    commands.commitCommand.mockReset().mockResolvedValue({ ok: true });
    commands.confirmPendingIntent.mockReset().mockResolvedValue({ status: 'not-found' });
    commands.cleanupConfirmedIntent.mockReset().mockResolvedValue(true);
  });

  it('derives the same canonical command for the writer, the read-only check and the cleanup', async () => {
    const repository = createCloudOrderRepository(db, { recoveryReader });
    const isCurrent = () => true;

    for (const input of [correction, cashierVoid]) {
      await repository.mutateTransaction(input);
      await repository.confirmPendingIntent(input, 'dataset-a', 'uid-a');
      await repository.cleanupConfirmedIntent(input, 'dataset-a', 'uid-a', isCurrent);
    }

    expect(commands.commitCommand).toHaveBeenNthCalledWith(1, expectedCorrection);
    expect(commands.commitCommand).toHaveBeenNthCalledWith(2, expectedCashierVoid);
    expect(commands.confirmPendingIntent).toHaveBeenNthCalledWith(1, expectedCorrection, 4, 'dataset-a', 'uid-a', recoveryReader);
    expect(commands.confirmPendingIntent).toHaveBeenNthCalledWith(2, expectedCashierVoid, 4, 'dataset-a', 'uid-a', recoveryReader);
    expect(commands.cleanupConfirmedIntent).toHaveBeenNthCalledWith(1, expectedCorrection, 4, 'dataset-a', 'uid-a', recoveryReader, isCurrent);
    expect(commands.cleanupConfirmedIntent).toHaveBeenNthCalledWith(2, expectedCashierVoid, 4, 'dataset-a', 'uid-a', recoveryReader, isCurrent);
  });
});
