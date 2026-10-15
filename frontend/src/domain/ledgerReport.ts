import type { LedgerTransaction } from './ledger';
import { countMeals, isStudentTransaction, sortLedgerChronologically } from './ledger';

export type LedgerDateRangeKind = 'today' | 'week' | 'month' | 'custom';

export interface LedgerDateRange {
  kind: LedgerDateRangeKind;
  startDate: string;
  endDate: string;
}

/**
 * M2 F08 報表口徑。畫面上的卡片名稱與這裡的欄位一一對應：
 * - orderCount 份數：訂餐筆數（每筆一份）＝ bentoCount 今日餐點 ＋ otherMealCount 其他餐點。
 *   向供應商叫餐看 bentoCount；「訂購其他餐點」另列（isOtherMealOrder）。
 * - mealTotal 餐費：訂餐的應收餐費合計。
 * - orderUnpaid 訂餐當下未收：每筆訂餐「餐費 − 當筆收款」不足的部分合計。之後補繳不會扣回，所以不是帳戶欠款。
 * - totalIncome 收現：實際收進的現金＝訂餐當筆收款＋繳費＋櫃台收入。
 * - totalExpense 支出：櫃台付出的現金。
 * - netCash 淨現金＝收現 − 支出。
 * - transactionCount 筆數：區間內所有交易，包含未付款的訂餐與櫃台收支。
 * 一律用整段區間的交易計算，不能傳畫面上分頁或截斷後的清單。
 */
export interface LedgerTotals {
  orderCount: number;
  bentoCount: number;
  otherMealCount: number;
  mealTotal: number;
  orderUnpaid: number;
  totalIncome: number;
  totalExpense: number;
  netCash: number;
  transactionCount: number;
}

export interface LedgerGroup {
  studentId: string;
  studentNameSnapshot: string;
  latestCreatedAt: string;
  mealTotal: number;
  paidTotal: number;
  afterBalance: number;
  recordCount: number;
  transactions: LedgerTransaction[];
}

function getMonday(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

function getSunday(dateStr: string): string {
  const monday = new Date(getMonday(dateStr));
  monday.setDate(monday.getDate() + 6);
  return monday.toISOString().split('T')[0];
}

function getMonthEnd(dateStr: string): string {
  const [y, m] = dateStr.substring(0, 7).split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

export function createLedgerDateRange(
  kind: LedgerDateRangeKind,
  anchorDate: string,
  custom?: { startDate: string; endDate: string },
): LedgerDateRange {
  if (kind === 'today') {
    return { kind, startDate: anchorDate, endDate: anchorDate };
  }
  if (kind === 'week') {
    return { kind, startDate: getMonday(anchorDate), endDate: getSunday(anchorDate) };
  }
  if (kind === 'month') {
    return { kind, startDate: `${anchorDate.substring(0, 7)}-01`, endDate: getMonthEnd(anchorDate) };
  }
  if (kind === 'custom' && custom) {
    return { kind, startDate: custom.startDate, endDate: custom.endDate };
  }
  return { kind, startDate: anchorDate, endDate: anchorDate };
}

export function filterTransactionsByBusinessDate(
  transactions: LedgerTransaction[],
  range: LedgerDateRange,
): LedgerTransaction[] {
  return transactions.filter(tx => tx.businessDate >= range.startDate && tx.businessDate <= range.endDate);
}

// 其他餐點的判斷放在 ledger.ts（合併列與報表共用）。
export { OTHER_MEAL_NOTE_PREFIX, isOtherMealOrder, otherMealName, countMeals } from './ledger';

export function calculateLedgerTotals(transactions: LedgerTransaction[]): LedgerTotals {
  let orderCount = 0;
  let mealTotal = 0;
  let orderUnpaid = 0;
  let totalIncome = 0;
  let totalExpense = 0;

  for (const tx of transactions) {
    const roundedMealPrice = Math.round(tx.mealPrice);
    const roundedPaidAmount = Math.round(tx.paidAmount);
    if (tx.type === 'order') {
      orderCount++;
      mealTotal += roundedMealPrice;
      totalIncome += roundedPaidAmount;
      orderUnpaid += Math.max(0, roundedMealPrice - roundedPaidAmount);
    } else if (tx.type === 'payment') {
      totalIncome += roundedPaidAmount;
    } else if (tx.type === 'expense') {
      if (roundedPaidAmount > 0) {
        totalIncome += roundedPaidAmount;
      }
      if (roundedMealPrice > 0) {
        totalExpense += roundedMealPrice;
      }
    }
  }

  const meals = countMeals(transactions);
  return {
    orderCount,
    bentoCount: meals.bento,
    otherMealCount: meals.other,
    mealTotal,
    orderUnpaid,
    totalIncome,
    totalExpense,
    netCash: totalIncome - totalExpense,
    transactionCount: transactions.length,
  };
}

/**
 * 依帳戶分組。每組的交易依 sortLedgerChronologically 由舊到新排，afterBalance 取「最後發生」那筆，
 * 補登前一天的交易後仍等於帳戶目前餘額（M2 F03）。inputOrder 說明傳入陣列方向（預設舊的在前，同 F1 畫面清單）；
 * 直接傳 store 交易陣列時請給 'newest-first'。
 */
export function groupLedgerRowsByStudent(
  transactions: LedgerTransaction[],
  inputOrder: 'newest-first' | 'oldest-first' = 'oldest-first',
): LedgerGroup[] {
  const map = new Map<string, LedgerTransaction[]>();
  for (const tx of transactions) {
    if (!isStudentTransaction(tx)) continue;
    const key = tx.studentId;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(tx);
  }

  const groups: LedgerGroup[] = [];
  for (const [studentId, txs] of map) {
    const sorted = sortLedgerChronologically(txs, inputOrder);

    // 分組的排列仍以最近一次登錄的時間為準（補登的那筆也算最近操作）。
    const latestCreatedAt = txs.reduce((max, t) => (t.createdAt > max ? t.createdAt : max), '');
    const lastTx = sorted[sorted.length - 1];
    const studentNameSnapshot = lastTx?.studentNameSnapshot ?? '';

    let mealTotal = 0;
    let paidTotal = 0;
    for (const tx of sorted) {
      if (tx.type === 'order') mealTotal += Math.round(Math.max(0, tx.mealPrice));
      paidTotal += Math.round(Math.max(0, tx.paidAmount));
    }

    groups.push({
      studentId,
      studentNameSnapshot,
      latestCreatedAt,
      mealTotal,
      paidTotal,
      afterBalance: lastTx?.afterBalance ?? 0,
      recordCount: sorted.length,
      transactions: sorted,
    });
  }

  groups.sort((a, b) => b.latestCreatedAt.localeCompare(a.latestCreatedAt));

  return groups;
}
/**
 * F2 帳戶列摘要：依交易「現在」的類型計數。取消訂餐但收款留在帳戶時原單會改成繳費，
 * 要算成繳費而不是訂餐（M4）。兩種都沒有時只寫筆數。
 */
export function groupRecordSummary(transactions: readonly Pick<LedgerTransaction, 'type'>[]): string {
  const orders = transactions.filter(t => t.type === 'order').length;
  const payments = transactions.filter(t => t.type === 'payment').length;
  const parts = [orders > 0 ? `訂餐 ${orders} 筆` : '', payments > 0 ? `繳費 ${payments} 筆` : ''].filter(Boolean);
  return parts.length > 0 ? parts.join('・') : `${transactions.length} 筆`;
}
