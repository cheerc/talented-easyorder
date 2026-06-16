/**
 * Ref: #319 — Replaced wildcard `export *` with named re-exports.
 * This barrel is currently unused (no files import from 'domain' or 'domain/index'),
 * but explicit exports prevent unintended symbol leakage if imports are added later.
 */

// student.ts
export type { StudentStatus, FaceEnrollmentStatus, StudentAccount, StudentSnapshot, StudentImportRow } from './student';

// menu.ts
export type { RecordStatus, Vendor, TodayMenu, MenuSnapshot, MenuCatalogItem } from './menu';

// ledger.ts
export type { LedgerTransaction, CreateLedgerTransactionInput, TransactionEditView } from './ledger';
export { CASHIER_SENTINEL, isStudentTransaction, recalculateStudentBalances, calculateTransactionAmount } from './ledger';

// businessDate.ts
export type { BusinessDateStatus } from './businessDate';
export { isHistoricalBusinessDate, canWriteBusinessDate } from './businessDate';

// syncStatus.ts
export type { SyncStatus } from './syncStatus';

// posFlow.ts
export type { PosMode, PosSelectionSource, PosSourceDevice, PosFlowState, ExpenseDirection } from './posFlow';

// posSearch.ts
export type { PosSearchMode, PosSearchResult, ScannerInput } from './posSearch';
export { searchPosStudents, resolveScannedStudent } from './posSearch';

// posTransaction.ts
export type { PosTransactionIntent, PosTransactionSnapshotInput, PosTransactionDraft, BuildPosTransactionDraftArgs } from './posTransaction';
export { parsePaidAmount } from './posTransaction';

// ipadHandoff.ts
export type { HandoffAction, IpadHandoffMessage, ValidateHandoffResult } from './ipadHandoff';
export { validateIpadHandoffMessage, toHandoffScannerInput, writeHandoffIntent, readHandoffIntent, subscribeHandoffChannel } from './ipadHandoff';

// ledgerReport.ts
export type { LedgerDateRangeKind, LedgerDateRange, LedgerTotals, LedgerGroup } from './ledgerReport';
export { createLedgerDateRange } from './ledgerReport';

// ledgerAudit.ts
export type { LedgerAuditEventType, LedgerAuditEvent, LedgerMutationDecision, AuditEventInput } from './ledgerAudit';
export { decideLedgerEditPolicy, createLedgerAuditEvent } from './ledgerAudit';

// cashClose.ts
export type { DailySettlement, CashCloseDraft } from './cashClose';
export { createCashCloseDraft, validateCashClose } from './cashClose';

// ledgerExport.ts
export { TRANSACTION_CSV_COLUMNS, SETTLEMENT_CSV_COLUMNS, buildTransactionCsvRows, buildSettlementCsvRows, serializeCsv } from './ledgerExport';

// ledgerSyncBoundary.ts
export type { QueueableLedgerPayload, CloseBlockingSyncSummary } from './ledgerSyncBoundary';
export { buildTransactionQueuePayload, buildSettlementQueuePayload, buildAuditEventQueuePayload } from './ledgerSyncBoundary';

// operatorId.ts
export { SYSTEM_OPERATOR_ID } from './operatorId';
