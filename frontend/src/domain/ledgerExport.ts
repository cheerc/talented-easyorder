import type { LedgerTransaction } from './ledger';
import type { DailySettlement } from './cashClose';
import type { LedgerTotals, LedgerGroup } from './ledgerReport';

export const TRANSACTION_CSV_COLUMNS = [
  'business_date',
  'transaction_id',
  'created_at',
  'student_id',
  'student_name_snapshot',
  'type',
  'meal_price',
  'paid_amount',
  'amount',
  'after_balance',
  'menu_name_snapshot',
  'vendor_name_snapshot',
  'source_device',
  'operator_id',
  'sync_status',
  'revision',
  'note',
  'voided_at',
  'voided_by',
  'void_reason',
] as const;

export const SETTLEMENT_CSV_COLUMNS = [
  'business_date',
  'settlement_revision',
  'status',
  'order_count',
  'transaction_count',
  'expected_cash',
  'counted_cash',
  'difference',
  'note',
  'closed_by',
  'closed_at',
  'reopened_by',
  'reopened_at',
  'reopen_reason',
  'sync_status',
] as const;

export function buildTransactionCsvRows(transactions: LedgerTransaction[]): string[][] {
  return transactions.map(t => [
    t.businessDate,
    t.transactionId,
    t.createdAt,
    t.studentId,
    t.studentNameSnapshot,
    t.type,
    String(t.mealPrice),
    String(t.paidAmount),
    String(t.amount),
    String(t.afterBalance),
    t.menuNameSnapshot,
    t.vendorNameSnapshot,
    t.sourceDevice,
    t.operatorId ?? '',
    t.syncStatus,
    String(t.revision),
    t.note,
    t.voidedAt ?? '',
    t.voidedBy ?? '',
    t.voidReason ?? '',
  ]);
}

export function buildSettlementCsvRows(settlements: DailySettlement[]): string[][] {
  return settlements.map(s => [
    s.businessDate,
    String(s.settlementRevision),
    s.status,
    String(s.orderCount),
    String(s.transactionCount),
    String(s.expectedCash),
    String(s.countedCash),
    String(s.difference),
    s.note,
    s.closedBy,
    s.closedAt,
    s.reopenedBy ?? '',
    s.reopenedAt ?? '',
    s.reopenReason ?? '',
    s.syncStatus,
  ]);
}

export function serializeCsv(columns: readonly string[], rows: string[][]): string {
  const escape = (val: string): string => {
    if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };
  const header = columns.map(escape).join(',');
  const body = rows.map(row => row.map(escape).join(',')).join('\n');
  return `${header}\n${body}`;
}

export function triggerCsvDownload(filename: string, csvString: string): void {
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvString], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export interface LedgerPrintViewModel {
  businessDate: string;
  totals: LedgerTotals;
  groups: LedgerGroup[];
  dateStatus: string;
  generatedAt: string;
  generatedBy: string;
}

export function buildLedgerPrintViewModel(args: {
  businessDate: string;
  totals: LedgerTotals;
  groups: LedgerGroup[];
  dateStatus: string;
  generatedAt: string;
  generatedBy: string;
}): LedgerPrintViewModel {
  return {
    businessDate: args.businessDate,
    totals: args.totals,
    groups: args.groups,
    dateStatus: args.dateStatus,
    generatedAt: args.generatedAt,
    generatedBy: args.generatedBy,
  };
}