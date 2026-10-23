import type { Firestore } from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloudBackupCommandRepository, type RecordBackupIntent } from '../cloudBackupCommandRepository';
import type { CloudRecoveryReader } from '../cloudRecoveryReader';

const commands = vi.hoisted(() => ({
  commitCommand: vi.fn(),
  confirmPendingIntent: vi.fn(),
  cleanupConfirmedIntent: vi.fn(),
}));

vi.mock('../cloudCommandRepository', () => ({
  createCloudCommandRepository: () => commands,
}));

const db = {} as Firestore;
const recoveryReader = { assertCurrent: vi.fn() } as unknown as CloudRecoveryReader;
const intent: RecordBackupIntent = {
  commandId: '00000000-0000-4000-8000-0000000000b1', leaseEpoch: 3,
  payload: { backupType: 'command-incremental', sourceSeq: 7, fromSeq: 2, toSeq: 7, sha256: 'b'.repeat(64) },
};
const expectedCommand = {
  commandId: intent.commandId, kind: 'RecordBackup', leaseEpoch: 3, targets: {}, expectedRevisions: {},
  payload: { backupType: 'command-incremental', sourceSeq: 7, fromSeq: 2, toSeq: 7, sha256: 'b'.repeat(64) },
};

describe('RecordBackup command repository adapter', () => {
  beforeEach(() => {
    commands.commitCommand.mockReset().mockResolvedValue({ ok: true });
    commands.confirmPendingIntent.mockReset().mockResolvedValue({ status: 'not-found' });
    commands.cleanupConfirmedIntent.mockReset().mockResolvedValue(true);
  });

  it('derives the same canonical command for the writer, the read-only check and the cleanup', async () => {
    const repository = createCloudBackupCommandRepository(db, { recoveryReader });
    const isCurrent = () => true;

    await repository.commitRecordBackupIntent(intent);
    await repository.confirmPendingIntent(intent, 'dataset-a', 'uid-a');
    await repository.cleanupConfirmedIntent(intent, 'dataset-a', 'uid-a', isCurrent);

    expect(commands.commitCommand).toHaveBeenCalledWith(expectedCommand);
    expect(commands.confirmPendingIntent).toHaveBeenCalledWith(expectedCommand, 3, 'dataset-a', 'uid-a', recoveryReader);
    expect(commands.cleanupConfirmedIntent).toHaveBeenCalledWith(expectedCommand, 3, 'dataset-a', 'uid-a', recoveryReader, isCurrent);
  });
});
