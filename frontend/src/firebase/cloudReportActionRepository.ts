import type { CommandReceipt, CommandResult } from '../domain/cloudCommands';
import type { CloudLedgerDateRange } from '../domain/cloudLedgerReport';
import { createCloudCommandRepository, type CloudCommandRepositoryOptions } from './cloudCommandRepository';
import type { Firestore } from 'firebase/firestore';

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

export function createCloudReportActionRepository(db: Firestore, options: CloudCommandRepositoryOptions = {}) {
  const commands = createCloudCommandRepository(db, options);
  return {
    recordExport(input: RecordCloudExportInput): Promise<CommandResult> {
      return commands.commitCommand({
        commandId: input.commandId,
        kind: 'RecordExport',
        leaseEpoch: input.leaseEpoch,
        targets: {},
        expectedRevisions: {},
        payload: {
          exportType: input.exportType,
          dateRange: { start: input.range.startDate, end: input.range.endDate },
          scope: input.scope,
          sourceSeq: input.sourceSeq,
        },
      });
    },
    recordPrint(input: RecordCloudPrintInput): Promise<CommandResult> {
      return commands.commitCommand({
        commandId: input.commandId,
        kind: 'RecordPrint',
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
      });
    },
    readCommand(commandId: string): Promise<CommandReceipt | null> {
      return commands.readCommand(commandId);
    },
  };
}
