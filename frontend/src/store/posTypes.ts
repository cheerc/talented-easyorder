import type { Firestore } from 'firebase/firestore';
import type { StudentAccount } from '../domain/student';
import type { Vendor, TodayMenu } from '../domain/menu';
import type { LedgerTransaction } from '../domain/ledger';
import type { LedgerAuditEvent } from '../domain/ledgerAudit';
import type { PosTransactionDraft } from '../domain/posTransaction';
import type { DailyCashSession } from '../domain/cashSession';
import type { DailySettlement } from '../domain/cashClose';

export interface DeleteOrderResult {
  deleted: boolean;
  refundAmount: number;
  studentName: string;
  wasClosedDate: boolean;
}

export interface CloseBusinessDateInput {
  businessDate: string;
  countedCash: number;
  note: string;
  queuedSettlementAccepted: boolean;
  operatorId: string;
}

export interface ReopenBusinessDateInput {
  businessDate: string;
  reason: string;
  operatorId: string;
}

export interface OpenCashSessionInput {
  businessDate: string;
  openingCash: number;
  operatorId: string;
  openedAt: string;
}

export type BusinessDateStatus = 'open' | 'closed' | 'reopened';

/** Student domain: 學生帳戶管理 */
export interface StudentStateSlice {
  students: StudentAccount[];
}

/** Transaction domain: 每日交易記錄 */
export interface TransactionStateSlice {
  transactions: LedgerTransaction[];
}

/** Menu domain: 菜單與廠商 */
export interface MenuStateSlice {
  vendors: Vendor[];
  todayMenu: TodayMenu;
}

/** Audit domain: 審計追蹤 */
export interface AuditStateSlice {
  auditEvents: LedgerAuditEvent[];
}

/** Settlement domain: 關帳、營業日狀態、現金收銀 */
export interface SettlementStateSlice {
  dailySettlements: DailySettlement[];
  businessDateStatuses: Record<string, BusinessDateStatus>;
  cashSessions: Record<string, DailyCashSession>;
}

export interface PosState
  extends StudentStateSlice,
    TransactionStateSlice,
    MenuStateSlice,
    AuditStateSlice,
    SettlementStateSlice,
    TransactionActions,
    MenuActions,
    SessionActions,
    StudentActions {}

// ─── Per-Domain Action Interfaces (Ref: #264) ───

/** Transaction domain actions */
export interface TransactionActions {
  commitPosTransactionDraft: (draft: PosTransactionDraft) => void;
  processTransaction: (
    studentId: string,
    type: LedgerTransaction['type'],
    mealPrice: number,
    paidAmount: number,
    note?: string
  ) => void;
  updateTransaction: (id: string, updates: Partial<LedgerTransaction>) => void;
  deleteTransaction: (id: string) => void;
  deleteOrderWithRefundCheck: (id: string) => DeleteOrderResult;
  editTransaction: (id: string, updates: { mealPrice?: number; paidAmount?: number; note?: string }) => void;
}

/** Menu domain actions */
export interface MenuActions {
  setTodayMenu: (menu: TodayMenu) => void;
  setVendors: (vendors: Vendor[]) => void;
  resetData: () => void;
}

/** Session domain actions */
export interface SessionActions {
  setBusinessDateStatus: (date: string, status: BusinessDateStatus) => void;
  openCashSession: (input: OpenCashSessionInput) => void;
  updateOpeningCash: (businessDate: string, amount: number) => void;
  closeBusinessDate: (input: CloseBusinessDateInput) => void;
  reopenBusinessDate: (input: ReopenBusinessDateInput) => void;
  getBusinessDateStatus: (businessDate: string) => BusinessDateStatus;
}

/** Student domain actions */
export interface StudentActions {
  addStudent: (db: Firestore, input: { studentId: string; displayName: string; openingBalance: number; operatorId: string }) => Promise<void>;
  disableStudent: (db: Firestore, input: { studentId: string; operatorId: string }) => Promise<void>;
}

