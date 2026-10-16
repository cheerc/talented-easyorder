/**
 * 零費用正式後端：Typed Business Command 型別系統
 * 規格來源：docs/superpowers/specs/2026-10-13-free-production-backend-spec.md §5–§6
 * 計畫來源：docs/superpowers/plans/2026-10-13-free-production-backend-plan.md §P02
 */

export const CLOUD_SCHEMA_VERSION = 1 as const;
export const schemaVersion = 1 as const;

export type CommandReasonKind =
  | 'collection'
  | 'payout'
  | 'refund'
  | 'correction'
  | 'reversal'
  | 'none';

export interface CommandCashEffect {
  before: number;
  after: number;
  delta: number;
  reasonKind: CommandReasonKind;
  refundAmount: number;
}

export type CommandErrorCode =
  | 'ACCESS_BUSY'
  | 'LEASE_LOST'
  | 'UNAUTHORIZED'
  | 'OFFLINE'
  | 'UNKNOWN_RESULT'
  | 'REVISION_CONFLICT'
  | 'DAY_CLOSED'
  | 'INVALID_INPUT'
  | 'QUOTA_EXCEEDED'
  | 'MAINTENANCE'
  | 'UNSUPPORTED_SCHEMA';

export const COMMAND_ERROR_CODES: readonly CommandErrorCode[] = [
  'ACCESS_BUSY',
  'LEASE_LOST',
  'UNAUTHORIZED',
  'OFFLINE',
  'UNKNOWN_RESULT',
  'REVISION_CONFLICT',
  'DAY_CLOSED',
  'INVALID_INPUT',
  'QUOTA_EXCEEDED',
  'MAINTENANCE',
  'UNSUPPORTED_SCHEMA',
] as const;

export interface CommandActor {
  uid: string;
  email: string;
}

export interface CommandReceipt<TTargets = Record<string, unknown>, TResult = Record<string, unknown>> {
  commandId: string;
  seq: number;
  committedAt: string;
  kind: BusinessCommandKind;
  targets: TTargets;
  result: TResult;
}

export type CommandResult<TTargets = Record<string, unknown>, TResult = Record<string, unknown>> =
  | {
      ok: true;
      receipt: CommandReceipt<TTargets, TResult>;
    }
  | {
      ok: false;
      error: {
        code: CommandErrorCode;
        message: string;
        details?: unknown;
      };
    };

export type BusinessCommandKind =
  | 'CreateStudent'
  | 'ChangeStudentCode'
  | 'EditStudent'
  | 'SetStudentStatus'
  | 'CorrectOpening'
  | 'SaveVendor'
  | 'RemoveVendor'
  | 'EnsureDay'
  | 'SetDayMenu'
  | 'SetOpeningCash'
  | 'CreateOrder'
  | 'CreatePayment'
  | 'CreateCashMovement'
  | 'CreateRefund'
  | 'CorrectTransaction'
  | 'VoidTransaction'
  | 'CancelKeepDeposit'
  | 'CancelRefund'
  | 'Undo'
  | 'CloseDay'
  | 'ReopenDay'
  | 'RecordExport'
  | 'RecordPrint'
  | 'RecordBackup';

export const ALL_COMMAND_KINDS: readonly BusinessCommandKind[] = [
  'CreateStudent',
  'ChangeStudentCode',
  'EditStudent',
  'SetStudentStatus',
  'CorrectOpening',
  'SaveVendor',
  'RemoveVendor',
  'EnsureDay',
  'SetDayMenu',
  'SetOpeningCash',
  'CreateOrder',
  'CreatePayment',
  'CreateCashMovement',
  'CreateRefund',
  'CorrectTransaction',
  'VoidTransaction',
  'CancelKeepDeposit',
  'CancelRefund',
  'Undo',
  'CloseDay',
  'ReopenDay',
  'RecordExport',
  'RecordPrint',
  'RecordBackup',
] as const;

export interface BaseCommand<TKind extends BusinessCommandKind, TPayload, TTargets> {
  commandId: string;
  kind: TKind;
  seq?: number | null;
  leaseEpoch: number;
  actor: CommandActor;
  committedAt?: string | unknown;
  businessDate: string | null;
  studentId: string | null;
  targets: TTargets;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason: string | null;
  cashEffect: CommandCashEffect;
  payload: TPayload;
  inputFingerprint: string;
  expectedRevision?: number | Record<string, number>;
}

// 1. CreateStudent
export type CreateStudentCommand = BaseCommand<
  'CreateStudent',
  {
    studentCode: string;
    displayName: string;
    aliases: string[];
    openingBalance: {
      amount: number;
      asOfDate: string;
      note?: string;
    };
  },
  { studentId: string }
>;

// 1b. ChangeStudentCode (P06b)
export type ChangeStudentCodeCommand = BaseCommand<
  'ChangeStudentCode',
  {
    studentCode: string;
    reason: string;
  },
  { studentId: string }
>;

// 2. EditStudent
export type EditStudentCommand = BaseCommand<
  'EditStudent',
  {
    displayName?: string;
    aliases?: string[];
  },
  { studentId: string }
>;

// 3. SetStudentStatus
export type SetStudentStatusCommand = BaseCommand<
  'SetStudentStatus',
  { status: 'active' | 'inactive'; reason: string },
  { studentId: string }
>;

// 4. CorrectOpening
export type CorrectOpeningCommand = BaseCommand<
  'CorrectOpening',
  {
    amount: number;
    note: string;
    reason: string;
  },
  { studentId: string; dayId: string }
>;

// 5. SaveVendor
export type SaveVendorCommand = BaseCommand<
  'SaveVendor',
  {
    vendorId: string;
    name: string;
    phone: string;
    note: string;
    status: 'active' | 'inactive';
  },
  { vendorId: string }
>;

// 6. RemoveVendor
export type RemoveVendorCommand = BaseCommand<
  'RemoveVendor',
  { reason: string },
  { vendorId: string }
>;

// 7. EnsureDay
export type EnsureDayCommand = BaseCommand<
  'EnsureDay',
  { businessDate: string },
  { dayId: string }
>;

// 8. SetDayMenu
export type SetDayMenuCommand = BaseCommand<
  'SetDayMenu',
  {
    selectionDate: string;
    itemName: string;
    price: number;
    vendorId: string;
    vendorNameSnapshot: string;
    inheritedFromDate: string | null;
  },
  { dayId: string }
>;

// 9. SetOpeningCash
export type SetOpeningCashCommand = BaseCommand<
  'SetOpeningCash',
  { openingCash: number },
  { dayId: string }
>;

// 10. CreateOrder
export type CreateOrderCommand = BaseCommand<
  'CreateOrder',
  {
    mealPrice: number;
    paidAmount: number;
    mealKind: 'bento' | 'other' | null;
    menuRevision?: number;
    otherItemName?: string;
  },
  { transactionId: string; studentId: string; dayId: string }
>;

// 11. CreatePayment
export type CreatePaymentCommand = BaseCommand<
  'CreatePayment',
  {
    paidAmount: number;
    note?: string;
  },
  { transactionId: string; studentId: string; dayId: string }
>;

// 12. CreateCashMovement
export type CreateCashMovementCommand = BaseCommand<
  'CreateCashMovement',
  {
    mealPrice: number;
    paidAmount: number;
    reason: string;
  },
  { transactionId: string; dayId: string }
>;

// 12b. CreateRefund（P09b）：把學生帳戶的正餘額退成現金，帳戶與櫃台現金各減 amount。
export type CreateRefundCommand = BaseCommand<
  'CreateRefund',
  {
    amount: number;
    reason: string;
  },
  { transactionId: string; studentId: string; dayId: string }
>;

// 13. CorrectTransaction（P10a）：只改 mealPrice／paidAmount／amount／note，不改帳戶、日期、類型或建立時間。
// 櫃台收支列的 studentId 為 `__cashier__`；退款列 mealPrice／paidAmount 為 0、amount 為正整數。
export type CorrectTransactionCommand = BaseCommand<
  'CorrectTransaction',
  {
    mealPrice: number;
    paidAmount: number;
    amount: number;
    note: string;
    reason: string;
  },
  { transactionId: string; studentId: string; dayId: string }
>;

// 14. VoidTransaction
export type VoidTransactionCommand = BaseCommand<
  'VoidTransaction',
  { reason: string },
  { transactionId: string; studentId: string; dayId: string }
>;

// 15. CancelKeepDeposit
export type CancelKeepDepositCommand = BaseCommand<
  'CancelKeepDeposit',
  { reason: string },
  { transactionId: string; studentId: string; dayId: string }
>;

// 16. CancelRefund
export type CancelRefundCommand = BaseCommand<
  'CancelRefund',
  { reason: string },
  { transactionId: string; studentId: string; dayId: string }
>;

// 17. Undo
export type UndoCommand = BaseCommand<
  'Undo',
  {
    targetCommandId: string;
    reason: string;
  },
  { transactionId: string; studentId: string; dayId: string }
>;

// 18. CloseDay
export type CloseDayCommand = BaseCommand<
  'CloseDay',
  {
    countedCash: number;
    note?: string;
    expectedCash?: number;
  },
  { dayId: string; settlementRevision: number }
>;

// 19. ReopenDay
export type ReopenDayCommand = BaseCommand<
  'ReopenDay',
  { reason: string },
  { dayId: string; settlementRevision: number }
>;

// 20. RecordExport
export type RecordExportCommand = BaseCommand<
  'RecordExport',
  {
    exportType: string;
    dateRange?: { start: string; end: string };
    sourceSeq: number;
  },
  Record<string, unknown>
>;

// 21. RecordPrint
export type RecordPrintCommand = BaseCommand<
  'RecordPrint',
  {
    printType: string;
    businessDate: string;
    sourceSeq: number;
  },
  Record<string, unknown>
>;

// 22. RecordBackup
export type RecordBackupCommand = BaseCommand<
  'RecordBackup',
  {
    backupType: string;
    sourceSeq: number;
  },
  Record<string, unknown>
>;

/** Spec §6.1 完整 BusinessCommand discriminated union */
export type BusinessCommand =
  | CreateStudentCommand
  | ChangeStudentCodeCommand
  | EditStudentCommand
  | SetStudentStatusCommand
  | CorrectOpeningCommand
  | SaveVendorCommand
  | RemoveVendorCommand
  | EnsureDayCommand
  | SetDayMenuCommand
  | SetOpeningCashCommand
  | CreateOrderCommand
  | CreatePaymentCommand
  | CreateCashMovementCommand
  | CreateRefundCommand
  | CorrectTransactionCommand
  | VoidTransactionCommand
  | CancelKeepDepositCommand
  | CancelRefundCommand
  | UndoCommand
  | CloseDayCommand
  | ReopenDayCommand
  | RecordExportCommand
  | RecordPrintCommand
  | RecordBackupCommand;

/** 依 spec §7.1 計算 command 的 cashEffect */
export function buildCashEffect(params: {
  beforeContribution: number;
  afterContribution: number;
  reasonKind: CommandReasonKind;
  refundAmount?: number;
}): CommandCashEffect {
  const delta = params.afterContribution - params.beforeContribution;
  return {
    before: params.beforeContribution,
    after: params.afterContribution,
    delta,
    reasonKind: params.reasonKind,
    refundAmount: params.refundAmount ?? (params.reasonKind === 'refund' ? Math.max(0, -delta) : 0),
  };
}

/** 依 spec §6.1 commit 與 read 介面型別 */
export type CommitCommandFn = (input: BusinessCommand) => Promise<CommandResult>;
export type ReadCommandFn = (commandId: string) => Promise<CommandReceipt | null>;
