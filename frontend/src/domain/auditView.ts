import type { LedgerAuditEvent } from './ledgerAudit';
import type { LedgerTransaction } from './ledger';
import { CASHIER_SENTINEL } from './ledger';
import { operatorLabel } from './operatorId';
import { formatTaipeiDateTime } from '../utils/dateTime';

/**
 * M2 F09：稽核紀錄給人看的樣子。櫃台不必認得 transactionId 或 mealPrice 這類欄位名稱，
 * 每一列說明「誰、對哪個帳戶、改了什麼、為什麼」。
 */
export interface AuditRowView {
  auditEventId: string;
  /** 台北時間 YYYY-MM-DD HH:mm:ss（操作當下），和營業日分開。 */
  time: string;
  businessDate: string;
  typeLabel: string;
  typeClass: string;
  operator: string;
  /** 例如「001 王小明」「櫃台」「營業日 2026-05-30」。 */
  subject: string;
  reason: string;
  changes: string;
  /**
   * 篩選用：帳戶編號、當時的姓名、目前的姓名與別名、營業日。
   * M3：不再比對交易編號，打短數字（例如「01」）不會查到不相干的列。
   */
  searchText: string;
  /** M3 F12：交易類稽核指向的原單編號；關帳、匯出等沒有。 */
  transactionId?: string;
  /** 原單的帳戶編號（櫃台收支是 CASHIER_SENTINEL）。 */
  studentId?: string;
  /** 原單現在還在不在；刪除、撤回或取消訂餐退款後只剩稽核裡的原單內容。 */
  originalExists: boolean;
}

/** 目前帳戶的姓名與別名，讓改名後用新名字也查得到改名前的稽核列。 */
export interface AuditAccountInfo {
  studentId: string;
  displayName: string;
  aliases?: string[];
}

const FIELD_LABELS: Record<string, string> = {
  mealPrice: '應收金額',
  paidAmount: '實收金額',
  amount: '金額',
  note: '備註',
  type: '類型',
};

const TYPE_LABELS: Record<string, string> = {
  order: '訂餐',
  payment: '繳費',
  expense: '櫃台收支',
  refund: '退款',
};

const MONEY_FIELDS = new Set(['mealPrice', 'paidAmount', 'amount']);

function formatValue(key: string, value: unknown): string {
  if (value === undefined || value === null) return '（無）';
  if (MONEY_FIELDS.has(key) && typeof value === 'number') return `$${value.toLocaleString()}`;
  if (key === 'type' && typeof value === 'string') return TYPE_LABELS[value] ?? value;
  if (key === 'note') return value === '' ? '（空白）' : `「${String(value)}」`;
  return String(value);
}

/** 舊版稽核的 reason 只記 'edit'／'delete' 這類代碼，不是人寫的理由。 */
function readableReason(reason: string): string {
  return reason === 'edit' || reason === 'delete' ? '' : reason;
}

function describeChanges(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string {
  if (!before) return after ? '新建' : '-';
  if (!after) {
    // M2：刪除時原單整筆存在 before，列出類型與金額方便對照。
    if (before.type === 'refund') {
      const note = typeof before.note === 'string' && before.note ? `，備註「${before.note}」` : '';
      return `刪除原單：退款、金額 ${formatValue('amount', before.amount ?? 0)}${note}`;
    }
    if (before.mealPrice === undefined && before.paidAmount === undefined) return '刪除原單';
    const parts = [
      before.type ? formatValue('type', before.type) : '',
      `應收 ${formatValue('mealPrice', before.mealPrice ?? 0)}`,
      `實收 ${formatValue('paidAmount', before.paidAmount ?? 0)}`,
    ].filter(Boolean);
    const note = typeof before.note === 'string' && before.note ? `，備註「${before.note}」` : '';
    return `刪除原單：${parts.join('、')}${note}`;
  }
  const changes: string[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const bv = before[key];
    const av = after[key];
    if (bv === av) continue;
    changes.push(`${FIELD_LABELS[key] ?? key} ${formatValue(key, bv)} → ${formatValue(key, av)}`);
  }
  return changes.length > 0 ? changes.join('；') : '沒有變更';
}

function typeOf(e: LedgerAuditEvent): { label: string; cls: string } {
  switch (e.eventType) {
    case 'transaction_edited':
      // 取消訂餐並保留繳費：原單從訂餐改成繳費。
      if (e.before?.type === 'order' && e.after?.type === 'payment') return { label: '取消訂餐', cls: 'pill-warn' };
      return { label: '更正', cls: 'pill-warn' };
    case 'transaction_deleted':
    case 'transaction_hard_deleted':
      return { label: e.before?.type === 'order' ? '取消訂餐' : '刪除', cls: 'pill-err' };
    case 'business_date_closed': return { label: '關帳', cls: 'pill-ok' };
    case 'business_date_reopened': return { label: '重開', cls: 'pill-warn' };
    case 'csv_exported': return { label: '匯出 CSV', cls: 'pill' };
    case 'report_printed': return { label: '列印', cls: 'pill' };
  }
}

interface AccountRef { studentId: string; name: string }

function accountOf(value: Record<string, unknown> | null | undefined): AccountRef | null {
  if (!value || typeof value.studentId !== 'string') return null;
  return { studentId: value.studentId, name: typeof value.studentNameSnapshot === 'string' ? value.studentNameSnapshot : '' };
}

function accountLabel(ref: AccountRef): string {
  if (ref.studentId === CASHIER_SENTINEL) return '櫃台';
  return ref.name ? `${ref.studentId} ${ref.name}` : ref.studentId;
}

export function describeAuditEvents(events: LedgerAuditEvent[], transactions: LedgerTransaction[], currentAccounts: AuditAccountInfo[] = []): AuditRowView[] {
  // 交易的帳戶：先看目前的交易，已刪除的從稽核留下的原單找。
  const accounts = new Map<string, AccountRef>();
  for (const e of events) {
    const ref = accountOf(e.before) ?? accountOf(e.after);
    if (e.entityType === 'transaction' && ref) accounts.set(e.entityId, ref);
  }
  const existing = new Set<string>();
  for (const t of transactions) {
    accounts.set(t.transactionId, { studentId: t.studentId, name: t.studentNameSnapshot });
    existing.add(t.transactionId);
  }
  const currentNames = new Map(currentAccounts.map(a => [a.studentId, [a.displayName, ...(a.aliases ?? [])].join(' ')]));

  return [...events]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(e => {
      const type = typeOf(e);
      let subject: string;
      let ref: AccountRef | undefined;
      if (e.entityType === 'transaction') {
        ref = accounts.get(e.entityId);
        subject = ref ? accountLabel(ref) : '（找不到帳戶）';
      } else if (e.entityType === 'business_date' || e.entityType === 'settlement') {
        subject = `營業日 ${e.businessDate}`;
      } else {
        subject = '匯出';
      }
      return {
        auditEventId: e.auditEventId,
        time: formatTaipeiDateTime(e.createdAt),
        businessDate: e.businessDate,
        typeLabel: type.label,
        typeClass: type.cls,
        operator: operatorLabel(e.operatorId),
        subject,
        reason: readableReason(e.reason),
        changes: describeChanges(e.before, e.after),
        searchText: `${subject} ${ref ? currentNames.get(ref.studentId) ?? '' : ''} ${e.businessDate}`.toLowerCase(),
        transactionId: e.entityType === 'transaction' ? e.entityId : undefined,
        studentId: ref?.studentId,
        originalExists: e.entityType === 'transaction' && existing.has(e.entityId),
      };
    });
}

/**
 * M3：稽核查詢。只打數字時當作帳戶編號，比對編號開頭（「01」查不到「001」以外的帳戶，也不會撞到日期或交易編號）；
 * 其他文字比對帳戶編號、當時與目前的姓名、別名、營業日。
 */
export function matchesAuditQuery(row: AuditRowView, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (/^\d+$/.test(q)) return !!row.studentId && row.studentId.toLowerCase().startsWith(q);
  return row.searchText.includes(q);
}
