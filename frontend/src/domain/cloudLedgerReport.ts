export const CLOUD_REPORT_MAX_DAYS = 31;

export type CloudLedgerDateRangeKind = 'today' | 'week' | 'month' | 'custom';

export interface CloudLedgerDateRange {
  kind: CloudLedgerDateRangeKind;
  startDate: string;
  endDate: string;
}

export interface CloudReportTransaction {
  transactionId: string;
  studentId: string;
  businessDate: string;
  type: 'order' | 'payment' | 'expense' | 'refund';
  mealKind: 'bento' | 'other' | null;
  mealPrice: number;
  paidAmount: number;
  amount: number;
  studentNameSnapshot: string;
  menuNameSnapshot: string;
  vendorNameSnapshot: string;
  otherItemName?: string | null;
  status: 'active' | 'voided';
  createdAt: string;
  createdSeq: number;
  operatorUid: string;
  operatorEmail: string;
  sourceDevice: string;
  note: string;
  revision: number;
  lastCommandId: string;
  updatedAt: string;
  backfilled: boolean;
  sourceSeq: number;
  /** Present only when the complete account prefix was read and reconciled. */
  afterBalance?: number;
  balanceApplicability?: 'verified' | 'not-applicable' | 'unavailable';
}

export interface CloudReportStudent {
  studentId: string;
  studentCode: string;
  displayName: string;
  aliases: readonly string[];
}

export interface CloudReportGroup {
  businessDate: string;
  studentId: string;
  studentNameSnapshot: string;
  transactionIds: string[];
  transactions: CloudReportTransaction[];
  activeCount: number;
  voidedCount: number;
  activeMealTotal: number;
  activePaidTotal: number;
  activeNetAmount: number;
}

export interface CloudMergedTransaction {
  kind: 'merged-order' | 'payment' | 'refund' | 'cashier' | 'voided';
  transactionId: string;
  transactionIds: string[];
  transactions: CloudReportTransaction[];
  businessDate: string;
  studentId: string;
  studentNameSnapshot: string;
  type: CloudReportTransaction['type'];
  mealKind: CloudReportTransaction['mealKind'];
  mealPrice: number;
  paidAmount: number;
  amount: number;
  balanceDelta?: number;
  afterBalance?: number;
  depositAmount: number;
  unpaidAmount: number;
  orderCount: number;
  bentoOrderCount: number;
  otherMealItems: string[];
  status: CloudReportTransaction['status'];
  backfilled: boolean;
  balanceApplicability?: 'verified' | 'not-applicable' | 'unavailable';
  backfilledTransactionIds: string[];
  createdAt: string;
  menuNameSnapshot: string;
  vendorNameSnapshot: string;
  sourceDevice: string;
  operatorUid: string;
  operatorEmail: string;
  revision: number;
  note: string;
  sourceSeq: number;
}

export interface CloudReportDayTotals {
  activeTransactionCount: number;
  bentoCount: number;
  otherMealCount: number;
  mealTotal: number;
  retainedReceipts: number;
  cashierIncome: number;
  cashierExpense: number;
  accountRefunds: number;
}

export interface CloudReportSettlement {
  businessDate: string;
  revision: number;
  status: 'closed' | 'reopened';
  totals: CloudReportDayTotals;
  openingCash: number;
  expectedCash: number;
  countedCash: number | null;
  difference: number | null;
  note: string;
  actorUid: string;
  actorEmail: string;
  sourceSeq: number;
  committedAt: string;
  lastCommandId: string;
}

export interface CloudReportPostCloseEntry {
  entryId: string;
  businessDate: string;
  settlementRevision: number;
  direction: 'income' | 'expense';
  amount: number;
  reason: string;
  createdBy: string;
  createdAt: string;
  commandId: string;
  countedInEffectiveCash: boolean;
}

export interface CloudReportDay {
  businessDate: string;
  exists: boolean;
  status: 'open' | 'closed' | 'reopened' | null;
  revision: number | null;
  openingCash: number | null;
  totals: CloudReportDayTotals | null;
  lastSettlementRevision: number;
  backfillReason: string | null;
  settlements: CloudReportSettlement[];
  postCloseEntries: CloudReportPostCloseEntry[];
  effectiveCash: number | null;
}

export interface CloudReportTotals {
  activeTransactionCount: number;
  orderCount: number;
  bentoCount: number;
  otherMealCount: number;
  mealTotal: number;
  /** Day heads do not contain order-unpaid; summaries intentionally leave it unavailable. */
  orderUnpaid: number | null;
  totalIncome: number;
  totalExpense: number;
  totalRefund: number;
  netCash: number;
}

export interface CloudLedgerReport {
  datasetId: string;
  sourceSeq: number;
  goLiveDate: string;
  leaseToday: string;
  leaseEpoch: number;
  range: CloudLedgerDateRange;
  scope: { studentId: string | null };
  complete: true;
  summary: CloudReportTotals;
  students: CloudReportStudent[];
  days: CloudReportDay[];
  transactions: CloudReportTransaction[];
  mergedTransactions: CloudMergedTransaction[];
  settlements: CloudReportSettlement[];
  postCloseEntries: CloudReportPostCloseEntry[];
}

export interface CloudAuditRow {
  commandId: string;
  kind: string;
  seq: number;
  leaseEpoch: number;
  businessDate: string | null;
  studentId: string | null;
  actorUid: string;
  actorEmail: string;
  committedAt: string;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface CloudAuditSnapshot {
  datasetId: string;
  sourceSeq: number;
  goLiveDate: string;
  leaseToday: string;
  leaseEpoch: number;
  scope: { dayId: string } | { studentId: string };
  complete: true;
  rows: CloudAuditRow[];
}

export interface CloudAccountHistory {
  datasetId: string;
  sourceSeq: number;
  goLiveDate: string;
  leaseToday: string;
  leaseEpoch: number;
  range: CloudLedgerDateRange;
  scope: { studentId: string };
  complete: true;
  student: CloudReportStudent;
  openingBalance: number;
  currentBalance: number;
  transactions: CloudReportTransaction[];
}

export function isValidCloudGregorianDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function utcDate(value: string): Date {
  if (!isValidCloudGregorianDate(value)) throw new RangeError('營業日必須是有效的 Gregorian YYYY-MM-DD 日期');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function formatUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function shiftUtcDate(value: string, days: number): string {
  const date = utcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatUtcDate(date);
}

export function validateCloudLedgerRange(range: CloudLedgerDateRange): CloudLedgerDateRange {
  if (!range || !['today', 'week', 'month', 'custom'].includes(range.kind)
    || !isValidCloudGregorianDate(range.startDate) || !isValidCloudGregorianDate(range.endDate)) {
    throw new RangeError('報表日期區間格式不正確');
  }
  if (range.startDate > range.endDate) throw new RangeError('報表開始日期不可晚於結束日期');
  const dayCount = (utcDate(range.endDate).getTime() - utcDate(range.startDate).getTime()) / 86_400_000 + 1;
  if (dayCount > CLOUD_REPORT_MAX_DAYS) throw new RangeError('報表日期區間最多 31 天');
  return { ...range };
}

export function createCloudLedgerDateRange(
  kind: CloudLedgerDateRangeKind,
  anchorDate: string,
  custom?: { startDate: string; endDate: string },
): CloudLedgerDateRange {
  utcDate(anchorDate);
  let range: CloudLedgerDateRange;
  if (kind === 'today') {
    range = { kind, startDate: anchorDate, endDate: anchorDate };
  } else if (kind === 'week') {
    const weekday = utcDate(anchorDate).getUTCDay();
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    const startDate = shiftUtcDate(anchorDate, mondayOffset);
    range = { kind, startDate, endDate: shiftUtcDate(startDate, 6) };
  } else if (kind === 'month') {
    const [year, month] = anchorDate.split('-').map(Number);
    const startDate = `${year.toString().padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(0);
    lastDay.setUTCHours(0, 0, 0, 0);
    lastDay.setUTCFullYear(year, month, 0);
    const endDate = formatUtcDate(lastDay);
    range = { kind, startDate, endDate };
  } else if (kind === 'custom' && custom) {
    range = { kind, startDate: custom.startDate, endDate: custom.endDate };
  } else {
    throw new RangeError('自訂日期區間需要開始與結束日期');
  }
  return validateCloudLedgerRange(range);
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function buildCloudLedgerGroups(transactions: readonly CloudReportTransaction[]): CloudReportGroup[] {
  const groups = new Map<string, CloudReportTransaction[]>();
  for (const transaction of transactions) {
    const key = `${transaction.businessDate}\u0000${transaction.studentId}`;
    const group = groups.get(key);
    if (group) group.push(transaction);
    else groups.set(key, [transaction]);
  }
  return [...groups.values()].map(rows => {
    const active = rows.filter(row => row.status === 'active');
    return {
      businessDate: rows[0].businessDate,
      studentId: rows[0].studentId,
      studentNameSnapshot: rows.at(-1)?.studentNameSnapshot ?? '',
      transactionIds: rows.map(row => row.transactionId),
      transactions: [...rows],
      activeCount: active.length,
      voidedCount: rows.length - active.length,
      activeMealTotal: active.reduce((sum, row) => sum + (row.type === 'order' ? row.mealPrice : 0), 0),
      activePaidTotal: active.reduce((sum, row) => sum + row.paidAmount, 0),
      activeNetAmount: active.reduce((sum, row) => sum + (row.type === 'refund' ? -row.amount : row.amount), 0),
    };
  }).sort((left, right) => compareAscii(left.businessDate, right.businessDate)
    || compareAscii(left.studentId, right.studentId));
}

function standaloneMergedRow(transaction: CloudReportTransaction): CloudMergedTransaction {
  const cashier = transaction.studentId === '__cashier__';
  const kind: CloudMergedTransaction['kind'] = cashier ? 'cashier'
    : transaction.status === 'voided' ? 'voided'
      : transaction.type === 'refund' ? 'refund' : 'payment';
  return {
    kind,
    transactionId: transaction.transactionId,
    transactionIds: [transaction.transactionId],
    transactions: [transaction],
    businessDate: transaction.businessDate,
    studentId: transaction.studentId,
    studentNameSnapshot: transaction.studentNameSnapshot,
    type: transaction.type,
    mealKind: transaction.mealKind,
    mealPrice: transaction.status === 'active' ? transaction.mealPrice : 0,
    paidAmount: transaction.status === 'active' ? transaction.paidAmount : 0,
    amount: transaction.status === 'active' ? transaction.amount : 0,
    ...(cashier ? {} : { balanceDelta: transaction.status === 'active'
      ? transaction.type === 'refund' ? -transaction.amount : transaction.amount
      : 0 }),
    ...(transaction.afterBalance === undefined ? {} : { afterBalance: transaction.afterBalance }),
    balanceApplicability: cashier ? 'not-applicable'
      : transaction.afterBalance === undefined ? 'unavailable' : 'verified',
    depositAmount: transaction.status === 'active' && transaction.type === 'payment' ? transaction.paidAmount : 0,
    unpaidAmount: 0,
    orderCount: 0,
    bentoOrderCount: 0,
    otherMealItems: [],
    status: transaction.status,
    backfilled: transaction.backfilled,
    backfilledTransactionIds: transaction.backfilled ? [transaction.transactionId] : [],
    createdAt: transaction.createdAt,
    menuNameSnapshot: transaction.menuNameSnapshot,
    vendorNameSnapshot: transaction.vendorNameSnapshot,
    sourceDevice: transaction.sourceDevice,
    operatorUid: transaction.operatorUid,
    operatorEmail: transaction.operatorEmail,
    revision: transaction.revision,
    note: transaction.note,
    sourceSeq: transaction.sourceSeq,
  };
}

/**
 * Cloud variant of `mergeLedgerTransactions`: input is already in validated Firestore order, so grouping
 * never sorts ISO timestamps or document IDs locally. Orders combine with same-day payments, payment-only
 * rows remain separate, refunds and cashier rows stay independent, and voided rows remain visible as audit rows.
 */
export function buildCloudMergedTransactions(transactions: readonly CloudReportTransaction[]): CloudMergedTransaction[] {
  const groups = new Map<string, Array<{ transaction: CloudReportTransaction; index: number }>>();
  transactions.forEach((transaction, index) => {
    const key = `${transaction.businessDate}\u0000${transaction.studentId}`;
    const group = groups.get(key);
    if (group) group.push({ transaction, index });
    else groups.set(key, [{ transaction, index }]);
  });

  const projected: Array<{ index: number; row: CloudMergedTransaction }> = [];
  for (const rows of groups.values()) {
    const source = rows.map(item => item.transaction);
    const activeOrders = source.filter(transaction => transaction.status === 'active' && transaction.type === 'order');
    const activePayments = source.filter(transaction => transaction.status === 'active' && transaction.type === 'payment');
    let merged: CloudMergedTransaction | null = null;
    let mergedIndex = -1;
    if (activeOrders.length > 0) {
      const orderIds = new Set([...activeOrders, ...activePayments].map(transaction => transaction.transactionId));
      const constituents = rows.filter(item => orderIds.has(item.transaction.transactionId));
      const earliestOrder = activeOrders[0];
      const latest = source.at(-1)!;
      const mealPrice = activeOrders.reduce((total, transaction) => total + transaction.mealPrice, 0);
      const paidAmount = [...activeOrders, ...activePayments].reduce((total, transaction) => total + transaction.paidAmount, 0);
      const bentoOrderCount = activeOrders.filter(transaction => transaction.mealKind === 'bento').length;
      const otherMealItems = activeOrders.filter(transaction => transaction.mealKind === 'other')
        .map(transaction => transaction.otherItemName ?? transaction.menuNameSnapshot ?? '其他餐點');
      merged = {
        kind: 'merged-order',
        transactionId: earliestOrder.transactionId,
        transactionIds: constituents.map(item => item.transaction.transactionId),
        transactions: constituents.map(item => item.transaction),
        businessDate: earliestOrder.businessDate,
        studentId: earliestOrder.studentId,
        studentNameSnapshot: earliestOrder.studentNameSnapshot,
        type: 'order',
        mealKind: null,
        mealPrice,
        paidAmount,
        amount: paidAmount - mealPrice,
        balanceDelta: paidAmount - mealPrice,
        ...(latest.afterBalance === undefined ? {} : { afterBalance: latest.afterBalance }),
        balanceApplicability: latest.afterBalance === undefined ? 'unavailable' : 'verified',
        depositAmount: Math.max(0, paidAmount - mealPrice),
        unpaidAmount: Math.max(0, mealPrice - paidAmount),
        orderCount: activeOrders.length,
        bentoOrderCount,
        otherMealItems,
        status: 'active',
        backfilled: constituents.some(item => item.transaction.backfilled),
        backfilledTransactionIds: constituents.filter(item => item.transaction.backfilled)
          .map(item => item.transaction.transactionId),
        createdAt: earliestOrder.createdAt,
        menuNameSnapshot: earliestOrder.menuNameSnapshot,
        vendorNameSnapshot: earliestOrder.vendorNameSnapshot,
        sourceDevice: earliestOrder.sourceDevice,
        operatorUid: earliestOrder.operatorUid,
        operatorEmail: earliestOrder.operatorEmail,
        revision: earliestOrder.revision,
        note: activeOrders.map(transaction => transaction.note).filter(Boolean).join(', ') || earliestOrder.note,
        sourceSeq: earliestOrder.sourceSeq,
      };
      mergedIndex = rows.find(item => item.transaction.transactionId === earliestOrder.transactionId)!.index;
    }
    for (const item of rows) {
      const transaction = item.transaction;
      if (merged && transaction.status === 'active'
        && (transaction.type === 'order' || transaction.type === 'payment')) {
        if (item.index === mergedIndex) projected.push({ index: item.index, row: merged });
        continue;
      }
      projected.push({ index: item.index, row: standaloneMergedRow(transaction) });
    }
  }
  return projected.sort((left, right) => left.index - right.index).map(item => item.row);
}

export function searchCloudReportStudentIds(
  students: readonly CloudReportStudent[],
  transactions: readonly Pick<CloudReportTransaction, 'studentId' | 'studentNameSnapshot'>[],
  search: string,
): string[] {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return [];
  const ids = new Set<string>();
  for (const student of students) {
    if ([student.studentCode, student.displayName, ...student.aliases]
      .some(value => value.toLocaleLowerCase().includes(query))) ids.add(student.studentId);
  }
  for (const transaction of transactions) {
    if (transaction.studentNameSnapshot.toLocaleLowerCase().includes(query)) ids.add(transaction.studentId);
  }
  return [...ids].sort(compareAscii);
}

export function summarizeCloudReportDays(days: readonly CloudReportDay[]): CloudReportTotals {
  const sum = (read: (totals: CloudReportDayTotals) => number) => days.reduce(
    (total, day) => total + (day.totals ? read(day.totals) : 0), 0,
  );
  const activeTransactionCount = sum(totals => totals.activeTransactionCount);
  const bentoCount = sum(totals => totals.bentoCount);
  const otherMealCount = sum(totals => totals.otherMealCount);
  const mealTotal = sum(totals => totals.mealTotal);
  const totalIncome = sum(totals => totals.retainedReceipts + totals.cashierIncome);
  const totalExpense = sum(totals => totals.cashierExpense);
  const totalRefund = sum(totals => totals.accountRefunds);
  return {
    activeTransactionCount,
    orderCount: bentoCount + otherMealCount,
    bentoCount,
    otherMealCount,
    mealTotal,
    orderUnpaid: null,
    totalIncome,
    totalExpense,
    totalRefund,
    netCash: totalIncome - totalExpense - totalRefund,
  };
}
