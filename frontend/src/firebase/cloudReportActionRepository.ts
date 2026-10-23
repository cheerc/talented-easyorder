import type { CommandReceipt, CommandResult } from '../domain/cloudCommands';
import type { CloudLedgerDateRange } from '../domain/cloudLedgerReport';
import {
  createCloudCommandRepository,
  type CloudCommandRepositoryOptions,
  type PendingIntentCheck,
} from './cloudCommandRepository';
import type { CloudRecoveryReader } from './cloudRecoveryReader';
import type { Firestore } from 'firebase/firestore';

export type CloudReportActionRepositoryOptions = CloudCommandRepositoryOptions & {
  /** The page's registered Lite pair; every read-only confirmation of the original command goes through it. */
  recoveryReader?: CloudRecoveryReader;
};

export interface CloudReportActionScope {
  studentId: string | null;
}

interface CloudReportActionInput {
  commandId: string;
  leaseEpoch: number;
  range: CloudLedgerDateRange;
  scope: CloudReportActionScope;
  sourceSeq: number;
}

export interface RecordCloudExportInput extends CloudReportActionInput {
  exportType: 'transactions-original' | 'transactions-merged' | 'settlements' | 'post-close-entries' | 'audit';
}

export interface RecordCloudPrintInput extends CloudReportActionInput {
  printType: 'ledger-original' | 'ledger-merged';
  businessDate: string;
}

export type RecordCloudActionInput = RecordCloudExportInput | RecordCloudPrintInput;

/** The one mapping from the page's frozen input to the command, shared by the writer and the read-only checks. */
function toCommandInput(input: RecordCloudActionInput) {
  if ('exportType' in input) {
    return {
      commandId: input.commandId,
      kind: 'RecordExport' as const,
      leaseEpoch: input.leaseEpoch,
      targets: {},
      expectedRevisions: {},
      payload: {
        exportType: input.exportType,
        dateRange: { start: input.range.startDate, end: input.range.endDate },
        scope: input.scope,
        sourceSeq: input.sourceSeq,
      },
    };
  }
  return {
    commandId: input.commandId,
    kind: 'RecordPrint' as const,
    leaseEpoch: input.leaseEpoch,
    targets: {},
    expectedRevisions: {},
    payload: {
      printType: input.printType,
      businessDate: input.businessDate,
      dateRange: { start: input.range.startDate, end: input.range.endDate },
      scope: input.scope,
      sourceSeq: input.sourceSeq,
    },
  };
}

export function createCloudReportActionRepository(db: Firestore, options: CloudReportActionRepositoryOptions = {}) {
  const commands = createCloudCommandRepository(db, options);
  return {
    recordExport(input: RecordCloudExportInput): Promise<CommandResult> {
      return commands.commitCommand(toCommandInput(input));
    },
    recordPrint(input: RecordCloudPrintInput): Promise<CommandResult> {
      return commands.commitCommand(toCommandInput(input));
    },
    confirmPendingIntent(input: RecordCloudActionInput, expectedDatasetId: string, expectedUid: string): Promise<PendingIntentCheck> {
      return commands.confirmPendingIntent(
        toCommandInput(input), input.leaseEpoch, expectedDatasetId, expectedUid, options.recoveryReader,
      );
    },
    cleanupConfirmedIntent(
      input: RecordCloudActionInput,
      expectedDatasetId: string,
      expectedUid: string,
      isCurrent: () => boolean,
    ): Promise<boolean> {
      return commands.cleanupConfirmedIntent(
        toCommandInput(input), input.leaseEpoch, expectedDatasetId, expectedUid, options.recoveryReader, isCurrent,
      );
    },
    getPendingRecoveryContext(expectedEpoch: number) {
      return commands.getPendingRecoveryContext(expectedEpoch, options.recoveryReader);
    },
    readCommand(commandId: string): Promise<CommandReceipt | null> {
      return commands.readCommand(commandId);
    },
  };
}
