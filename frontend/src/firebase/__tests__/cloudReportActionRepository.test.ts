import type { Firestore } from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCloudReportActionRepository,
  type RecordCloudExportInput,
  type RecordCloudPrintInput,
} from '../cloudReportActionRepository';
import type { CloudRecoveryReader } from '../cloudRecoveryReader';

const commands = vi.hoisted(() => ({
  commitCommand: vi.fn(),
  confirmPendingIntent: vi.fn(),
  cleanupConfirmedIntent: vi.fn(),
  getPendingRecoveryContext: vi.fn(),
  readCommand: vi.fn(),
}));

vi.mock('../cloudCommandRepository', () => ({
  createCloudCommandRepository: () => commands,
}));

const db = {} as Firestore;
const recoveryReader = { assertCurrent: vi.fn() } as unknown as CloudRecoveryReader;
const range = { kind: 'today' as const, startDate: '2026-10-19', endDate: '2026-10-19' };
const exportInput: RecordCloudExportInput = {
  commandId: '00000000-0000-4000-8000-0000000000e1', leaseEpoch: 4, range, scope: { studentId: null },
  sourceSeq: 11, exportType: 'audit',
};
const printInput: RecordCloudPrintInput = {
  commandId: '00000000-0000-4000-8000-0000000000e2', leaseEpoch: 4, range, scope: { studentId: 'student-a' },
  sourceSeq: 11, printType: 'ledger-merged', businessDate: '2026-10-19',
};
const expectedExport = {
  commandId: exportInput.commandId, kind: 'RecordExport', leaseEpoch: 4, targets: {}, expectedRevisions: {},
  payload: { exportType: 'audit', dateRange: { start: '2026-10-19', end: '2026-10-19' }, scope: { studentId: null }, sourceSeq: 11 },
};
const expectedPrint = {
  commandId: printInput.commandId, kind: 'RecordPrint', leaseEpoch: 4, targets: {}, expectedRevisions: {},
  payload: {
    printType: 'ledger-merged', businessDate: '2026-10-19',
    dateRange: { start: '2026-10-19', end: '2026-10-19' }, scope: { studentId: 'student-a' }, sourceSeq: 11,
  },
};

describe('RecordExport / RecordPrint command repository', () => {
  beforeEach(() => {
    commands.commitCommand.mockReset().mockResolvedValue({ ok: true });
    commands.confirmPendingIntent.mockReset().mockResolvedValue({ status: 'not-found' });
    commands.cleanupConfirmedIntent.mockReset().mockResolvedValue(true);
    commands.getPendingRecoveryContext.mockReset().mockResolvedValue({});
    commands.readCommand.mockReset();
  });

  it('derives the same canonical command for the writer, the read-only check and the cleanup', async () => {
    const repository = createCloudReportActionRepository(db, { recoveryReader });
    const isCurrent = () => true;

    await repository.recordExport(exportInput);
    await repository.confirmPendingIntent(exportInput, 'dataset-a', 'uid-a');
    await repository.cleanupConfirmedIntent(exportInput, 'dataset-a', 'uid-a', isCurrent);
    await repository.recordPrint(printInput);
    await repository.confirmPendingIntent(printInput, 'dataset-a', 'uid-a');
    await repository.cleanupConfirmedIntent(printInput, 'dataset-a', 'uid-a', isCurrent);

    expect(commands.commitCommand).toHaveBeenNthCalledWith(1, expectedExport);
    expect(commands.commitCommand).toHaveBeenNthCalledWith(2, expectedPrint);
    expect(commands.confirmPendingIntent).toHaveBeenNthCalledWith(1, expectedExport, 4, 'dataset-a', 'uid-a', recoveryReader);
    expect(commands.confirmPendingIntent).toHaveBeenNthCalledWith(2, expectedPrint, 4, 'dataset-a', 'uid-a', recoveryReader);
    expect(commands.cleanupConfirmedIntent).toHaveBeenNthCalledWith(1, expectedExport, 4, 'dataset-a', 'uid-a', recoveryReader, isCurrent);
    expect(commands.cleanupConfirmedIntent).toHaveBeenNthCalledWith(2, expectedPrint, 4, 'dataset-a', 'uid-a', recoveryReader, isCurrent);
  });

  it('reads the pending recovery context through the registered Lite reader', async () => {
    const repository = createCloudReportActionRepository(db, { recoveryReader });
    await repository.getPendingRecoveryContext(4);
    expect(commands.getPendingRecoveryContext).toHaveBeenCalledWith(4, recoveryReader);
  });
});
