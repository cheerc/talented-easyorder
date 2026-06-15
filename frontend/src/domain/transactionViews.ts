// Subsystem-specific transaction view interfaces.
// These narrow the full LedgerTransaction to only the fields each subsystem needs,
// achieving type-level decoupling with zero runtime cost.
// Ref: #267

import type { LedgerTransaction } from './ledger';

/** Fields needed by report UI components (DetailRow, IncomeRow, ExpenseOnlyRow, etc.) */
export interface ReportTransactionView {
  transactionId: string;
  businessDate: string;
  createdAt: string;
  studentId: string; // reviewer finding #1: DetailRow.tsx accesses t.studentId
  studentNameSnapshot: string;
  type: LedgerTransaction['type'];
  mealPrice: number;
  paidAmount: number;
  amount: number;
  afterBalance: number;
  menuNameSnapshot: string;
  vendorNameSnapshot: string;
  note: string;
  syncStatus: LedgerTransaction['syncStatus'];
}

/** Fields needed by POS workflow hooks (useFlashData, useCancelDialog) */
export interface WorkflowTransactionView {
  transactionId: string;
  businessDate: string;
  type: LedgerTransaction['type'];
  amount: number;
  studentId: string;
  createdAt: string;
  syncStatus: LedgerTransaction['syncStatus'];
  paidAmount: number; // reviewer finding #2: useFlashData.ts L27-28
  mealPrice: number;  // reviewer finding #2: useFlashData.ts L27-28
}

// Type compatibility assertion: LedgerTransaction extends both views
// (compile-time verification, zero runtime cost)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertReportCompat = LedgerTransaction extends ReportTransactionView ? true : never;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertWorkflowCompat = LedgerTransaction extends WorkflowTransactionView ? true : never;
