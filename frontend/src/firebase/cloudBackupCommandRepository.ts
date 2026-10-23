import type { Firestore } from 'firebase/firestore';
import type { CommandResult } from '../domain/cloudCommands';
import {
  createCloudCommandRepository,
  type CloudCommandRepositoryOptions,
  type PendingIntentCheck,
} from './cloudCommandRepository';
import type { CloudRecoveryReader } from './cloudRecoveryReader';

export type CloudBackupCommandRepositoryOptions = CloudCommandRepositoryOptions & {
  /** The page's registered Lite pair; every read-only confirmation of the original command goes through it. */
  recoveryReader?: CloudRecoveryReader;
};

export interface RecordBackupPayload {
  backupType: 'command-incremental';
  sourceSeq: number;
  fromSeq: number;
  toSeq: number;
  sha256: string;
}

/** The frozen RecordBackup the screen keeps for same-ID recovery; the repository derives the command from it. */
export interface RecordBackupIntent {
  commandId: string;
  leaseEpoch: number;
  payload: RecordBackupPayload;
}

/** The one mapping from the screen's intent to the command, shared by the writer and the read-only checks. */
function recordBackupCommand(intent: RecordBackupIntent) {
  return {
    commandId: intent.commandId,
    kind: 'RecordBackup' as const,
    leaseEpoch: intent.leaseEpoch,
    targets: {},
    expectedRevisions: {},
    payload: {
      backupType: intent.payload.backupType,
      sourceSeq: intent.payload.sourceSeq,
      fromSeq: intent.payload.fromSeq,
      toSeq: intent.payload.toSeq,
      sha256: intent.payload.sha256,
    },
  };
}

export function createCloudBackupCommandRepository(db: Firestore, options: CloudBackupCommandRepositoryOptions = {}) {
  const commands = createCloudCommandRepository(db, options);
  return {
    commitRecordBackupIntent(intent: RecordBackupIntent): Promise<CommandResult> {
      return commands.commitCommand(recordBackupCommand(intent));
    },
    confirmPendingIntent(intent: RecordBackupIntent, expectedDatasetId: string, expectedUid: string): Promise<PendingIntentCheck> {
      return commands.confirmPendingIntent(
        recordBackupCommand(intent), intent.leaseEpoch, expectedDatasetId, expectedUid, options.recoveryReader,
      );
    },
    cleanupConfirmedIntent(
      intent: RecordBackupIntent,
      expectedDatasetId: string,
      expectedUid: string,
      isCurrent: () => boolean,
    ): Promise<boolean> {
      return commands.cleanupConfirmedIntent(
        recordBackupCommand(intent), intent.leaseEpoch, expectedDatasetId, expectedUid, options.recoveryReader, isCurrent,
      );
    },
  };
}
