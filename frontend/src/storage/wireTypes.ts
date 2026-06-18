// --- Enum unions (structurally identical to domain) ---
export type WireTransactionType = 'order' | 'payment' | 'expense';
export type WireSyncStatus = 'local' | 'queued' | 'synced' | 'failed' | 'conflict';
export type WireSourceDevice = 'pc' | 'barcode_scanner' | 'ipad_handoff';
export type WireStudentStatus = 'active' | 'inactive';
export type WireFaceEnrollmentStatus = 'none' | 'enrolled' | 'disabled' | 'needs_review';
export type WireRecordStatus = 'active' | 'inactive';
export type WireBusinessDateStatus = 'open' | 'closed' | 'reopened';
export type WireAuditEventType =
  | 'transaction_edited' | 'transaction_deleted' | 'transaction_hard_deleted'
  | 'business_date_closed' | 'business_date_reopened' | 'csv_exported' | 'report_printed';
export type WireCashSessionStatus = 'open' | 'closed';

// --- Data interfaces (structurally identical to domain types) ---
export interface WireLedgerTransaction {
  transactionId: string; businessDate: string; createdAt: string;
  studentId: string; studentNameSnapshot: string;
  type: WireTransactionType; mealPrice: number; paidAmount: number;
  amount: number; afterBalance: number;
  menuNameSnapshot: string; vendorNameSnapshot: string;
  sourceDevice: WireSourceDevice; operatorId?: string;
  syncStatus: WireSyncStatus; revision: number; note: string;
  depositAmount?: number; unpaidAmount?: number;
}

export interface WireStudentAccount {
  studentId: string; displayName: string; status: WireStudentStatus;
  currentBalance: number; aliases: string[];
  className?: string; groupName?: string; faceProfileId?: string;
  faceEnrollmentStatus: WireFaceEnrollmentStatus;
  createdAt: string; updatedAt: string; revision: number;
}

export interface WireVendor {
  vendorId: string; name: string; phone: string; note: string;
  status: WireRecordStatus; createdAt: string; updatedAt: string; revision: number;
}

export interface WireTodayMenu {
  businessDate: string; itemName: string; price: number;
  vendorId: string; vendorNameSnapshot: string;
  catalogItemId?: string; updatedAt: string; revision: number;
}

export interface WireLedgerAuditEvent {
  auditEventId: string; eventType: WireAuditEventType;
  entityType: 'transaction' | 'settlement' | 'business_date' | 'export';
  entityId: string; businessDate: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string; operatorId: string; createdAt: string;
}

export interface WireDailySettlement {
  settlementId: string; businessDate: string;
  status: WireBusinessDateStatus; settlementRevision: number;
  orderCount: number; transactionCount: number;
  totalIncome: number; totalExpense: number;
  openingCash: number; netCash: number; expectedCash: number;
  countedCash: number; difference: number; note: string;
  closedBy: string; closedAt: string;
  reopenedBy?: string; reopenedAt?: string; reopenReason?: string;
  syncStatus: WireSyncStatus; revision: number;
}

export interface WireDailyCashSession {
  cashSessionId: string; businessDate: string;
  openingCash: number; openedBy: string; openedAt: string;
  closedAt?: string; closedBy?: string;
  status: WireCashSessionStatus; revision: number;
}

// --- Wire persisted state (data-only, no store methods/Firestore) ---
export interface WirePersistedState {
  students: WireStudentAccount[];
  transactions: WireLedgerTransaction[];
  vendors: WireVendor[];
  todayMenu: WireTodayMenu;
  auditEvents: WireLedgerAuditEvent[];
  dailySettlements: WireDailySettlement[];
  businessDateStatuses: Record<string, WireBusinessDateStatus>;
  cashSessions: Record<string, WireDailyCashSession>;
  schemaVersion?: number;
}
