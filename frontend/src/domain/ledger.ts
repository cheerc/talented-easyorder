import type { LedgerSyncStatus, TransactionType } from './types';

export interface LedgerTransaction {
  transactionId: string;
  businessDate: string;
  createdAt: string;
  studentId: string;
  studentNameSnapshot: string;
  type: TransactionType;
  mealPrice: number;
  paidAmount: number;
  amount: number;
  afterBalance: number;
  menuNameSnapshot: string;
  vendorNameSnapshot: string;
  sourceDevice: 'pc' | 'barcode_scanner' | 'ipad_handoff';
  operatorId?: string;
  syncStatus: LedgerSyncStatus;
  revision: number;
  note: string;
  depositAmount?: number;
  unpaidAmount?: number;
  /**
   * 「訂購其他餐點」的品項（不是當天統一的餐點）。有值時這一份不算進今日餐點份數，另列其他餐點。
   * 舊資料沒有這個欄位，只在備註開頭留「單筆改價：」。
   */
  otherItemName?: string;
}

export const CASHIER_SENTINEL = '__cashier__' as const;
