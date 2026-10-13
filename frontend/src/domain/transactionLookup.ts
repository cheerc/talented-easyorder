import type { LedgerTransaction } from './ledger';
import { CASHIER_SENTINEL, sortLedgerChronologically } from './ledger';
import type { LedgerAuditEvent } from './ledgerAudit';
import type { StudentAccount } from './student';

/**
 * M3 F12／D05：F5「交易查詢」。依帳戶、營業日區間找交易，
 * 已刪除的原單從稽核紀錄找回來一起列出；三種餘額分開命名：
 * 「現在餘額」＝帳戶目前餘額；「這筆之後」＝該筆交易後的結餘；「區間結束時餘額」＝區間最後一天結束時的結餘。
 */
export interface LookupRow {
  transactionId: string;
  businessDate: string;
  createdAt: string;
  studentId: string;
  studentName: string;
  type: LedgerTransaction['type'];
  mealPrice: number;
  paidAmount: number;
  note: string;
  /** 這筆之後的結餘；已刪除的原單沒有。 */
  afterBalance: number | null;
  /** 原單已刪除（刪除、撤回、取消訂餐退款），內容取自稽核紀錄。 */
  deleted: boolean;
  /** 這筆有幾次更正、刪除紀錄。 */
  auditCount: number;
}

export const CASHIER_QUERY = '櫃台';

/** 帳戶查詢：比對編號、姓名、別名；停用的帳戶也列出（歷史要查得到）。輸入「櫃台」時找櫃台收支。 */
export function findLookupAccountIds(students: StudentAccount[], query: string): string[] | null {
  const q = query.trim().toLowerCase();
  if (!q) return null; // 全部帳戶
  if (q === CASHIER_QUERY) return [CASHIER_SENTINEL];
  const exact = students.find(s => s.studentId.toLowerCase() === q);
  if (exact) return [exact.studentId];
  return students
    .filter(s =>
      s.studentId.toLowerCase().includes(q) ||
      s.displayName.toLowerCase().includes(q) ||
      s.aliases.some(a => a.toLowerCase().includes(q)))
    .map(s => s.studentId);
}

const isDeleteEvent = (e: LedgerAuditEvent) => e.eventType === 'transaction_deleted' || e.eventType === 'transaction_hard_deleted';

function str(v: unknown, fallback = ''): string { return typeof v === 'string' ? v : fallback; }
function num(v: unknown): number { return typeof v === 'number' ? v : 0; }

/** 依帳戶（null＝全部）與營業日區間列出交易，舊的在前；包含稽核裡已刪除的原單。 */
export function buildLookupRows(args: {
  transactions: LedgerTransaction[];
  auditEvents: LedgerAuditEvent[];
  accountIds: string[] | null;
  start: string;
  end: string;
}): LookupRow[] {
  const { transactions, auditEvents, accountIds, start, end } = args;
  const ids = accountIds ? new Set(accountIds) : null;
  const inRange = (date: string, sid: string) => date >= start && date <= end && (!ids || ids.has(sid));

  const auditCount = new Map<string, number>();
  for (const e of auditEvents) {
    if (e.entityType !== 'transaction') continue;
    auditCount.set(e.entityId, (auditCount.get(e.entityId) ?? 0) + 1);
  }

  const live: LookupRow[] = transactions
    .filter(t => inRange(t.businessDate, t.studentId))
    .map(t => ({
      transactionId: t.transactionId,
      businessDate: t.businessDate,
      createdAt: t.createdAt,
      studentId: t.studentId,
      studentName: t.studentNameSnapshot,
      type: t.type,
      mealPrice: t.mealPrice,
      paidAmount: t.paidAmount,
      note: t.note,
      afterBalance: t.studentId === CASHIER_SENTINEL ? null : t.afterBalance,
      deleted: false,
      auditCount: auditCount.get(t.transactionId) ?? 0,
    }));

  // 已在交易裡的不重複列；同一筆有兩個刪除紀錄時只列一次。
  const liveIds = new Set(transactions.map(t => t.transactionId));
  const deleted: LookupRow[] = [];
  for (const e of auditEvents) {
    if (!isDeleteEvent(e) || !e.before || liveIds.has(e.entityId)) continue;
    const b = e.before;
    const businessDate = str(b.businessDate, e.businessDate);
    const studentId = str(b.studentId);
    if (!studentId || !inRange(businessDate, studentId)) continue;
    liveIds.add(e.entityId);
    deleted.push({
      transactionId: e.entityId,
      businessDate,
      createdAt: str(b.createdAt, e.createdAt),
      studentId,
      studentName: str(b.studentNameSnapshot),
      type: (str(b.type, 'payment') as LedgerTransaction['type']),
      mealPrice: num(b.mealPrice),
      paidAmount: num(b.paidAmount),
      note: str(b.note),
      afterBalance: null,
      deleted: true,
      auditCount: auditCount.get(e.entityId) ?? 0,
    });
  }

  return sortLedgerChronologically([...live, ...deleted], 'oldest-first');
}

/** 區間最後一天結束時的結餘：該日（含）以前最後一筆有效交易的結餘；沒有交易時是期初。 */
export function balanceAtEndOf(transactions: LedgerTransaction[], account: StudentAccount, end: string): number {
  const mine = sortLedgerChronologically(transactions.filter(t => t.studentId === account.studentId && t.businessDate <= end));
  const last = mine[mine.length - 1];
  return last ? last.afterBalance : account.openingBalance?.amount ?? 0;
}
