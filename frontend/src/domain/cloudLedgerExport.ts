import { SETTLEMENT_CSV_COLUMNS, TRANSACTION_CSV_COLUMNS } from './ledgerExport';
import { paperRefsIn } from './paperRef';
import type {
  CloudAuditRow,
  CloudMergedTransaction,
  CloudReportDay,
  CloudReportPostCloseEntry,
  CloudReportSettlement,
  CloudReportTransaction,
} from './cloudLedgerReport';

export type CloudCsvCell = { type: 'text'; value: string } | { type: 'number'; value: number };

export const CLOUD_TRANSACTION_CSV_COLUMNS = [
  ...TRANSACTION_CSV_COLUMNS,
  'status',
  'backfilled',
  'source_seq',
  'source_transaction_ids',
  'balance_applicability',
  'paper_refs',
] as const;

export const CLOUD_SETTLEMENT_CSV_COLUMNS = [
  ...SETTLEMENT_CSV_COLUMNS,
  'effective_cash',
  'source_seq',
] as const;

export const CLOUD_POST_CLOSE_CSV_COLUMNS = [
  'business_date', 'entry_id', 'settlement_revision', 'direction', 'amount', 'reason',
  'created_by', 'created_at', 'counted_in_effective_cash', 'command_id', 'source_seq',
] as const;

export const CLOUD_AUDIT_CSV_COLUMNS = [
  'command_id', 'kind', 'seq', 'lease_epoch', 'business_date', 'student_id', 'actor_uid',
  'actor_email', 'committed_at', 'reason', 'before', 'after', 'source_seq', 'attributed_date', 'date_basis',
] as const;

const text = (value: string): CloudCsvCell => ({ type: 'text', value });
const numeric = (value: number): CloudCsvCell => ({ type: 'number', value });

export function serializeCloudCsv(columns: readonly string[], rows: readonly (readonly CloudCsvCell[])[]): string {
  const escapeText = (value: string, forceQuote: boolean): string => {
    const protectedValue = /^[\s\uFEFF]*[=+\-@]/.test(value) ? "'" + value : value;
    return forceQuote || /[",\r\n]/.test(protectedValue)
      ? '"' + protectedValue.replace(/"/g, '""') + '"'
      : protectedValue;
  };
  const escape = (cell: CloudCsvCell): string => {
    if (cell.type === 'number') {
      if (!Number.isSafeInteger(cell.value)) throw new RangeError('CSV 數值欄必須是 safe integer');
      return String(cell.value);
    }
    return escapeText(cell.value, true);
  };
  for (const row of rows) {
    if (row.length !== columns.length) throw new RangeError('CSV 每列欄位數必須與標題一致');
  }
  const header = columns.map(value => escapeText(value, false)).join(',');
  const body = rows.map(row => row.map(escape).join(',')).join('\n');
  return header + '\n' + body;
}

function optionalNumber(value: number | undefined): CloudCsvCell {
  return value === undefined ? text('') : numeric(value);
}

export function buildCloudTransactionCsvRows(
  transactions: readonly (CloudReportTransaction | CloudMergedTransaction)[],
): CloudCsvCell[][] {
  return transactions.map(transaction => {
    const merged = 'kind' in transaction;
    const orderActive = transaction.status === 'active' && transaction.type === 'order';
    const otherItems = merged
      ? transaction.otherMealItems.join('、')
      : orderActive && transaction.mealKind === 'other' ? transaction.otherItemName ?? '' : '';
    const bentoCount = merged ? transaction.bentoOrderCount
      : orderActive && transaction.mealKind === 'bento' ? 1 : 0;
    const depositAmount = merged ? numeric(transaction.depositAmount)
      : orderActive ? numeric(Math.max(0, transaction.paidAmount - transaction.mealPrice)) : text('');
    const unpaidAmount = merged ? numeric(transaction.unpaidAmount)
      : orderActive ? numeric(Math.max(0, transaction.mealPrice - transaction.paidAmount)) : text('');
    const transactionIds = merged ? transaction.transactionIds : [transaction.transactionId];
    return [
    text(transaction.businessDate),
    text(transaction.transactionId),
    text(transaction.createdAt),
    text(transaction.studentId),
    text(transaction.studentNameSnapshot),
    text(transaction.type),
    numeric(transaction.mealPrice),
    numeric(transaction.paidAmount),
    numeric(transaction.amount),
    optionalNumber(transaction.afterBalance),
    text(transaction.menuNameSnapshot),
    text(transaction.vendorNameSnapshot),
    text(transaction.sourceDevice),
    text(transaction.operatorUid),
    text('cloud'),
    numeric(transaction.revision),
    text(transaction.note),
    text(''), text(''), text(''), depositAmount, unpaidAmount,
    numeric(bentoCount),
    text(otherItems),
    text(transaction.status),
    text(transaction.backfilled ? 'true' : 'false'),
    numeric(transaction.sourceSeq),
    text(JSON.stringify(transactionIds)),
    text(transaction.balanceApplicability ?? (transaction.studentId === '__cashier__' ? 'not-applicable' : 'unavailable')),
    text(paperRefsIn(merged ? transaction.transactions.map(item => item.note) : [transaction.note]).join(';')),
    ];
  });
}

export function buildCloudSettlementCsvRows(
  settlements: readonly CloudReportSettlement[],
  days: readonly CloudReportDay[],
): CloudCsvCell[][] {
  const dayById = new Map(days.map(day => [day.businessDate, day]));
  return settlements.map(settlement => {
    const day = dayById.get(settlement.businessDate);
    const effectiveCash = day?.status === 'closed' && settlement.revision === day.lastSettlementRevision
      ? day.effectiveCash : null;
    return [
    text(settlement.businessDate), numeric(settlement.revision), text(settlement.status),
    numeric(settlement.totals.bentoCount + settlement.totals.otherMealCount),
    numeric(settlement.totals.activeTransactionCount), numeric(settlement.expectedCash),
    settlement.countedCash === null ? text('') : numeric(settlement.countedCash),
    settlement.difference === null ? text('') : numeric(settlement.difference), text(settlement.note),
    text(settlement.status === 'closed' ? settlement.actorUid : ''), text(settlement.status === 'closed' ? settlement.committedAt : ''),
    text(settlement.status === 'reopened' ? settlement.actorUid : ''), text(settlement.status === 'reopened' ? settlement.committedAt : ''),
    text(''), text('cloud'),
    effectiveCash === null || effectiveCash === undefined ? text('') : numeric(effectiveCash),
    numeric(settlement.sourceSeq),
    ];
  });
}

export function buildCloudPostCloseCsvRows(entries: readonly CloudReportPostCloseEntry[], sourceSeq: number): CloudCsvCell[][] {
  return entries.map(entry => [
    text(entry.businessDate), text(entry.entryId), numeric(entry.settlementRevision), text(entry.direction),
    numeric(entry.amount), text(entry.reason), text(entry.createdBy), text(entry.createdAt),
    text(entry.countedInEffectiveCash ? 'true' : 'false'), text(entry.commandId), numeric(sourceSeq),
  ]);
}

export function buildCloudAuditCsvRows(rows: readonly CloudAuditRow[], sourceSeq: number): CloudCsvCell[][] {
  return rows.map(row => [
    text(row.commandId), text(row.kind), numeric(row.seq), numeric(row.leaseEpoch),
    text(row.businessDate ?? ''), text(row.studentId ?? ''), text(row.actorUid), text(row.actorEmail),
    text(row.committedAt), text(row.reason ?? ''), text(row.before === null ? '' : JSON.stringify(row.before)),
    text(row.after === null ? '' : JSON.stringify(row.after)), numeric(sourceSeq),
    text(row.attributedDate ?? ''), text(row.dateBasis ?? ''),
  ]);
}

export function buildCloudTransactionCsv(transactions: readonly CloudReportTransaction[]): string {
  return serializeCloudCsv(CLOUD_TRANSACTION_CSV_COLUMNS, buildCloudTransactionCsvRows(transactions));
}

export function buildCloudMergedTransactionCsv(transactions: readonly CloudMergedTransaction[]): string {
  return serializeCloudCsv(CLOUD_TRANSACTION_CSV_COLUMNS, buildCloudTransactionCsvRows(transactions));
}

export function buildCloudSettlementCsv(settlements: readonly CloudReportSettlement[], days: readonly CloudReportDay[]): string {
  return serializeCloudCsv(CLOUD_SETTLEMENT_CSV_COLUMNS, buildCloudSettlementCsvRows(settlements, days));
}

export function buildCloudPostCloseCsv(entries: readonly CloudReportPostCloseEntry[], sourceSeq: number): string {
  return serializeCloudCsv(CLOUD_POST_CLOSE_CSV_COLUMNS, buildCloudPostCloseCsvRows(entries, sourceSeq));
}

export function buildCloudAuditCsv(rows: readonly CloudAuditRow[], sourceSeq: number): string {
  return serializeCloudCsv(CLOUD_AUDIT_CSV_COLUMNS, buildCloudAuditCsvRows(rows, sourceSeq));
}
