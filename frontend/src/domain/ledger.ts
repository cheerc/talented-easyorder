export type { TransactionType, LedgerSyncStatus } from './types';

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
   * 舊資料沒有這個欄位，改用備註開頭「單筆改價：」判斷（見 ledgerReport 的 isOtherMealOrder）。
   */
  otherItemName?: string;
}

import type { StudentSnapshot } from './student';
import type { MenuSnapshot } from './menu';
import type { StudentAccount } from './student';

export const CASHIER_SENTINEL = '__cashier__' as const;

export function isStudentTransaction(tx: { studentId: string }): boolean {
  return tx.studentId !== CASHIER_SENTINEL;
}

export interface CreateLedgerTransactionInput {
  transactionId: string;
  businessDate: string;
  createdAt: string;
  studentSnapshot: StudentSnapshot;
  menuSnapshot: MenuSnapshot;
  type: TransactionType;
  mealPrice: number;
  paidAmount: number;
  previousBalance: number;
  sourceDevice: LedgerTransaction['sourceDevice'];
  operatorId?: string;
  note: string;
  /** 訂購其他餐點的品項；今日餐點不帶。 */
  otherItemName?: string;
}

export function calculateTransactionAmount(mealPrice: number, paidAmount: number): number {
  return paidAmount - mealPrice;
}

export function createLedgerTransaction(input: CreateLedgerTransactionInput): LedgerTransaction {
  const amount = calculateTransactionAmount(input.mealPrice, input.paidAmount);
  const studentId = input.type === 'expense' ? CASHIER_SENTINEL : input.studentSnapshot.studentId;
  return {
    transactionId: input.transactionId,
    businessDate: input.businessDate,
    createdAt: input.createdAt,
    studentId,
    studentNameSnapshot: input.type === 'expense' ? '櫃台' : input.studentSnapshot.studentNameSnapshot,
    type: input.type,
    mealPrice: input.mealPrice,
    paidAmount: input.paidAmount,
    amount,
    afterBalance: input.type === 'expense' ? 0 : input.previousBalance + amount,
    menuNameSnapshot: input.type === 'expense' ? '' : input.menuSnapshot.menuNameSnapshot,
    vendorNameSnapshot: input.type === 'expense' ? '' : input.menuSnapshot.vendorNameSnapshot,
    sourceDevice: input.sourceDevice,
    operatorId: input.operatorId,
    syncStatus: 'local',
    revision: 1,
    note: input.note,
    ...(input.otherItemName !== undefined ? { otherItemName: input.otherItemName } : {}),
  };
}

export function countActiveOrdersForStudent(
  transactions: LedgerTransaction[],
  studentId: string,
  businessDate: string,
): number {
  return transactions.filter(
    t => t.studentId === studentId && t.businessDate === businessDate && t.type === 'order',
  ).length;
}

/**
 * 帳務的「發生先後」：營業日 → 建立時間 → 同一毫秒依陣列位置。
 * 重算餘額（rebalanceAccounts、recalculateStudentBalances）和 F2 分組取最後一筆都用這一個順序，
 * 補登前一天的交易時，各畫面的逐筆結餘與目前餘額才會一致。
 * inputOrder 說明傳入陣列的方向：store 的交易陣列是新的在前（預設）；畫面上反轉過的清單是舊的在前。
 * 回傳新陣列，舊的在前。
 */
export function sortLedgerChronologically<T extends Pick<LedgerTransaction, 'businessDate' | 'createdAt'>>(
  transactions: readonly T[],
  inputOrder: 'newest-first' | 'oldest-first' = 'newest-first',
): T[] {
  const oldestFirst = inputOrder === 'newest-first' ? [...transactions].reverse() : [...transactions];
  // Array.prototype.sort 是穩定排序，同一毫秒的交易保留上面整理好的先後。
  return oldestFirst.sort((a, b) => {
    if (a.businessDate !== b.businessDate) return a.businessDate.localeCompare(b.businessDate);
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export interface RecalculationResult {
  students: StudentAccount[];
  transactions: LedgerTransaction[];
}

export function recalculateStudentBalances(
  students: StudentAccount[],
  transactions: LedgerTransaction[],
): RecalculationResult {
  const sorted = sortLedgerChronologically(transactions.filter(isStudentTransaction));

  const balanceMap = new Map<string, number>();
  // M0：以期初餘額為起點，重算不可把期初歸零。
  for (const s of students) {
    balanceMap.set(s.studentId, s.openingBalance?.amount ?? 0);
  }

  const updatedTx = sorted.map(tx => {
    const currentBalance = balanceMap.get(tx.studentId) ?? 0;
    const newBalance = currentBalance + tx.amount;
    balanceMap.set(tx.studentId, newBalance);
    return { ...tx, afterBalance: newBalance };
  });

  const updatedStudents = students.map(s => ({
    ...s,
    currentBalance: Math.round(balanceMap.get(s.studentId) ?? s.currentBalance),
  }));

  return { students: updatedStudents, transactions: updatedTx };
}

/**
 * M2 F03／R04：任何一筆交易新增、修改、刪除後，受影響帳戶的整串餘額都從起點重算。
 * 起點：有期初就用期初；舊資料沒有期初時，用「改動前的目前餘額 − 改動前所有交易」反推，避免把沒有交易紀錄的舊餘額歸零。
 * 依營業日、建立時間（同時間依陣列先後）排序後逐筆累加，回寫每筆的 afterBalance 與帳戶 currentBalance；交易陣列維持原本的順序。
 */
export function rebalanceAccounts(
  studentsBefore: StudentAccount[],
  transactionsBefore: LedgerTransaction[],
  transactionsAfter: LedgerTransaction[],
  studentIds: Iterable<string>,
): { students: StudentAccount[]; transactions: LedgerTransaction[] } {
  const ids = new Set([...studentIds].filter(id => id !== CASHIER_SENTINEL));
  if (ids.size === 0) return { students: studentsBefore, transactions: transactionsAfter };

  const base = new Map<string, number>();
  for (const s of studentsBefore) {
    if (!ids.has(s.studentId)) continue;
    if (s.openingBalance) {
      base.set(s.studentId, s.openingBalance.amount);
    } else {
      const sumBefore = transactionsBefore
        .filter(t => t.studentId === s.studentId)
        .reduce((sum, t) => sum + t.amount, 0);
      base.set(s.studentId, s.currentBalance - sumBefore);
    }
  }

  const ordered = sortLedgerChronologically(transactionsAfter.filter(t => ids.has(t.studentId)));

  const running = new Map(base);
  const after = new Map<string, number>();
  for (const t of ordered) {
    const next = Math.round((running.get(t.studentId) ?? 0) + t.amount);
    running.set(t.studentId, next);
    after.set(t.transactionId, next);
  }

  const transactions = transactionsAfter.map(t => {
    const bal = after.get(t.transactionId);
    return bal === undefined || bal === t.afterBalance ? t : { ...t, afterBalance: bal };
  });
  const students = studentsBefore.map(s =>
    ids.has(s.studentId) && base.has(s.studentId)
      ? { ...s, currentBalance: Math.round(running.get(s.studentId) ?? s.currentBalance) }
      : s,
  );
  return { students, transactions };
}

/** 舊資料的「訂購其他餐點」只留在備註開頭。 */
export const OTHER_MEAL_NOTE_PREFIX = '單筆改價：';

/**
 * 這筆訂餐是不是「訂購其他餐點」（不是當天統一的餐點）。新資料看 otherItemName；
 * 舊資料沒有這個欄位，看備註開頭。品項名稱或價格和今天菜單不同不算，避免當天改價後前面的訂單被算成其他餐點。
 */
export function isOtherMealOrder(tx: Pick<LedgerTransaction, 'type' | 'note' | 'otherItemName'>): boolean {
  if (tx.type !== 'order') return false;
  if (tx.otherItemName !== undefined) return true;
  return typeof tx.note === 'string' && tx.note.startsWith(OTHER_MEAL_NOTE_PREFIX);
}

/** 其他餐點的品項名稱。 */
export function otherMealName(tx: Pick<LedgerTransaction, 'note' | 'otherItemName' | 'menuNameSnapshot'>): string {
  if (tx.otherItemName) return tx.otherItemName;
  if (tx.note.startsWith(OTHER_MEAL_NOTE_PREFIX)) return tx.note.slice(OTHER_MEAL_NOTE_PREFIX.length).trim() || '其他餐點';
  return tx.menuNameSnapshot || '其他餐點';
}

/** 份數拆成今日餐點與其他餐點（向供應商叫餐時只看今日餐點）。 */
export function countMeals(transactions: Pick<LedgerTransaction, 'type' | 'note' | 'otherItemName'>[]): { bento: number; other: number } {
  let bento = 0;
  let other = 0;
  for (const tx of transactions) {
    if (tx.type !== 'order') continue;
    if (isOtherMealOrder(tx)) other++; else bento++;
  }
  return { bento, other };
}

export interface MergedTransaction extends LedgerTransaction {
  depositAmount: number;
  unpaidAmount: number;
  orderCount: number;
  displayBalance: number;
  /** 合併列裡今日餐點的份數。 */
  bentoOrderCount: number;
  /** 合併列裡「訂購其他餐點」的品項（每份一個）。 */
  otherMealItems: string[];
}

export interface TransactionEditView {
  transactionId: string;
  mealPrice: number;
  paidAmount: number;
  note: string;
}

export function mergeLedgerTransactions(transactions: LedgerTransaction[]): MergedTransaction[] {
  const cashierTxs: LedgerTransaction[] = [];
  const studentGroups: Record<string, LedgerTransaction[]> = {};

  for (const tx of transactions) {
    if (!isStudentTransaction(tx)) {
      cashierTxs.push(tx);
    } else {
      const key = `${tx.businessDate}_${tx.studentId}`;
      if (!studentGroups[key]) {
        studentGroups[key] = [];
      }
      studentGroups[key].push(tx);
    }
  }

  const mergedList: MergedTransaction[] = [];

  for (const tx of cashierTxs) {
    mergedList.push({
      ...tx,
      depositAmount: 0,
      unpaidAmount: 0,
      orderCount: 0,
      displayBalance: 0,
      bentoOrderCount: 0,
      otherMealItems: [],
    });
  }

  for (const key in studentGroups) {
    const studentTxs = [...studentGroups[key]].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (studentTxs.length === 0) continue;

    const latestTx = studentTxs[studentTxs.length - 1];
    const displayBalance = latestTx.afterBalance;

    const orders = studentTxs.filter(t => t.type === 'order');
    const payments = studentTxs.filter(t => t.type === 'payment');
    const orderCount = orders.length;

    const totalMealPrice = orders.reduce((sum, o) => sum + o.mealPrice, 0);
    const totalPaid = orders.reduce((sum, o) => sum + o.paidAmount, 0) + payments.reduce((sum, p) => sum + p.paidAmount, 0);

    if (orderCount > 0) {
      // Merge all orders and payments into a single order row
      const earliestTx = studentTxs[0];
      const depositAmount = Math.max(0, totalPaid - totalMealPrice);
      const unpaidAmount = Math.max(0, totalMealPrice - totalPaid);
      const mergedNote = orders.map(o => o.note).filter(Boolean).join(', ');

      // 合併列不能沿用第一筆的 otherItemName，份數改看整組訂單。
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 只為了把第一筆的 otherItemName 拿掉。
      const { otherItemName: _firstOther, ...earliestRest } = earliestTx;
      const otherOrders = orders.filter(isOtherMealOrder);
      mergedList.push({
        ...earliestRest,
        type: 'order',
        bentoOrderCount: orderCount - otherOrders.length,
        otherMealItems: otherOrders.map(otherMealName),
        mealPrice: totalMealPrice,
        paidAmount: totalPaid,
        amount: totalPaid - totalMealPrice,
        afterBalance: displayBalance,
        depositAmount,
        unpaidAmount,
        orderCount,
        displayBalance,
        note: mergedNote || earliestTx.note,
      });
    } else {
      // No orders: keep payments as independent rows (for today's report)
      for (const p of payments) {
        mergedList.push({
          ...p,
          depositAmount: p.paidAmount,
          unpaidAmount: 0,
          orderCount: 0,
          displayBalance,
          bentoOrderCount: 0,
          otherMealItems: [],
        });
      }
    }
  }

  return mergedList.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

