// TODO: [#289] Split into domain-specific stores for full decoupling
import type { StudentAccount } from '../domain/student';
import type { Vendor, TodayMenu } from '../domain/menu';
import type { LedgerTransaction } from '../domain/ledger';
import type { LedgerAuditEvent, LedgerMutationOptions, LedgerMutationResult, LedgerCommitResult } from '../domain/ledgerAudit';
import type { PosTransactionDraft } from '../domain/posTransaction';
import type { DailyCashSession } from '../domain/cashSession';
import type { DailySettlement } from '../domain/cashClose';
import type { PracticeDataset } from '../domain/practiceSnapshot';

export interface DeleteOrderResult {
  deleted: boolean;
  refundAmount: number;
  studentName: string;
  wasClosedDate: boolean;
  /** deleted=false 時給櫃台人員看的原因（關帳日、缺理由、找不到）。 */
  message?: string;
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
  /** M0：依營業日保存的晚餐設定；沒有設定的日子沿用較早日期（見 resolveMenuForDate）。 */
  menusByDate: Record<string, TodayMenu>;
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
    StudentActions,
    PracticeStateSlice,
    PracticeDataActions {}

// ─── Per-Domain Action Interfaces (Ref: #264) ───

/** Transaction domain actions */
export interface TransactionActions {
  /** M2：關帳日回傳失敗、不寫入。 */
  commitPosTransactionDraft: (draft: PosTransactionDraft) => LedgerCommitResult;
  processTransaction: (
    studentId: string,
    type: LedgerTransaction['type'],
    mealPrice: number,
    paidAmount: number,
    note?: string
  ) => void;
  /** M2：理由必填、已關帳的日期擋下；原單整筆寫進稽核。 */
  deleteTransaction: (id: string, opts: LedgerMutationOptions) => LedgerMutationResult;
  deleteOrderWithRefundCheck: (id: string, opts: LedgerMutationOptions & { keepPaymentAsDeposit?: boolean }) => DeleteOrderResult;
  editTransaction: (id: string, updates: { mealPrice?: number; paidAmount?: number; note?: string }, opts: LedgerMutationOptions) => LedgerMutationResult;
}

/** Menu domain actions */
export interface MenuActions {
  setTodayMenu: (menu: TodayMenu) => void;
  /** 儲存某個營業日的晚餐設定，同時更新 todayMenu 為最近儲存的設定。 */
  setMenuForDate: (date: string, menu: Omit<TodayMenu, 'businessDate' | 'revision' | 'updatedAt'>, now: string) => void;
  setVendors: (vendors: Vendor[]) => void;
  resetData: () => void;
}

/** Session domain actions */
export interface SessionActions {
  setBusinessDateStatus: (date: string, status: BusinessDateStatus) => void;
  openCashSession: (input: OpenCashSessionInput) => void;
  updateOpeningCash: (businessDate: string, amount: number) => void;
  /** M3：回傳結果；開帳金額未設定、差額沒寫原因、已關帳等情況回傳原因，不再無聲失敗。 */
  closeBusinessDate: (input: CloseBusinessDateInput) => LedgerMutationResult;
  reopenBusinessDate: (input: ReopenBusinessDateInput) => void;
  getBusinessDateStatus: (businessDate: string) => BusinessDateStatus;
}

/** Student domain actions */
export interface StudentActions {
  addStudent: (input: { studentId: string; displayName: string; openingBalance: number; operatorId: string }) => Promise<void>;
  disableStudent: (input: { studentId: string; operatorId: string }) => Promise<void>;
}


/** M0：練習模式的模擬營業日；null 表示使用今天的實際日期。 */
export interface PracticeStateSlice {
  simulationDate: string | null;
}

/** M0：本機練習資料 actions（只在本機模式的 F3 使用） */
export interface PracticeDataActions {
  /** 清空名單、供應商、交易、稽核、結帳與今日菜單。 */
  startBlankData: () => void;
  /** 載入固定的匿名驗收範例（含供應商）。 */
  loadSampleData: () => void;
  /** 新增一個本機帳戶；重複編號時不變更。 */
  addLocalStudent: (account: StudentAccount) => void;
  /** 以已驗證的快照一次替換整個資料集。 */
  restoreDataset: (dataset: PracticeDataset) => void;
  /** 只清除交易、稽核、關帳與開帳；保留名單、期初、供應商與菜單。 */
  clearPracticeTransactions: () => void;
  /** 設定模擬營業日（YYYY-MM-DD）；null 回到實際日期。 */
  setSimulationDate: (date: string | null) => void;
  /** 修改本機帳戶的姓名與別名；交易內的姓名快照不變。 */
  updateLocalStudent: (studentId: string, changes: { displayName: string; aliases: string[] }, now: string) => void;
  /** 停用或恢復本機帳戶。停用者不出現在訂餐搜尋，歷史仍可查。 */
  setLocalStudentStatus: (studentId: string, status: StudentAccount['status'], now: string) => void;
}
