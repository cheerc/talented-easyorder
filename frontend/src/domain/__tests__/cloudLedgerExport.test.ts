import { describe, expect, it } from 'vitest';
import {
  CLOUD_AUDIT_CSV_COLUMNS,
  CLOUD_SETTLEMENT_CSV_COLUMNS,
  CLOUD_TRANSACTION_CSV_COLUMNS,
  buildCloudAuditCsvRows,
  buildCloudMergedTransactionCsv,
  buildCloudPostCloseCsvRows,
  buildCloudSettlementCsvRows,
  buildCloudTransactionCsv,
  buildCloudTransactionCsvRows,
  serializeCloudCsv,
  type CloudCsvCell,
} from '../cloudLedgerExport';
import {
  buildCloudMergedTransactions,
  type CloudReportDay,
  type CloudReportSettlement,
  type CloudReportTransaction,
} from '../cloudLedgerReport';

const text = (value: string): CloudCsvCell => ({ type: 'text', value });
const number = (value: number): CloudCsvCell => ({ type: 'number', value });

describe('serializeCloudCsv', () => {
  it('keeps validated numeric cells numeric, including negative balances', () => {
    expect(serializeCloudCsv(['balance', 'count'], [[number(-123), number(0)]]))
      .toBe('balance,count\n-123,0');
  });

  it('hardens formula prefixes after leading whitespace and quotes CSV delimiters', () => {
    const csv = serializeCloudCsv(['value'], [
      [text('  =1+1')], [text('\t-1+1')], [text('\r\n@SUM(A1:A2)')],
      [text('a,"b"\nc')], [text('+text')], [text('-text')], [text('@text')],
    ]);
    expect(csv).toBe([
      'value',
      "\"'  =1+1\"",
      "\"'\t-1+1\"",
      "\"'\r\n@SUM(A1:A2)\"",
      "\"a,\"\"b\"\"\nc\"",
      "\"'+text\"",
      "\"'-text\"",
      "\"'@text\"",
    ].join('\n'));
  });

  it('keeps numeric-looking text in the text-cell path', () => {
    expect(serializeCloudCsv(['value'], [[text('001')], [number(1)]]))
      .toBe('value\n"001"\n1');
  });

  it('rejects unsafe numeric cells and malformed row widths', () => {
    expect(() => serializeCloudCsv(['amount'], [[number(Number.MAX_SAFE_INTEGER + 1)]])).toThrow();
    expect(() => serializeCloudCsv(['amount'], [[number(1.5)]])).toThrow();
    expect(() => serializeCloudCsv(['a', 'b'], [[text('only one')]])).toThrow();
  });

  it('keeps cloud transaction export columns in the legacy order and appends cloud metadata', () => {
    const transaction: CloudReportTransaction = {
      transactionId: 'tx-1', studentId: '11111111-1111-4111-8111-111111111111', businessDate: '2026-10-18',
      type: 'order', mealKind: 'bento', mealPrice: 10, paidAmount: 2, amount: -8, studentNameSnapshot: '001',
      menuNameSnapshot: '餐盒', vendorNameSnapshot: '供應商', status: 'active', createdAt: '2026-10-18T04:00:00.000Z',
      createdSeq: 2, operatorUid: 'operator', operatorEmail: 'operator@example.test', sourceDevice: 'pc', note: '',
      revision: 1, lastCommandId: '00000000-0000-4000-8000-000000000001', updatedAt: '2026-10-18T04:00:00.000Z',
      backfilled: true, sourceSeq: 9, afterBalance: -8,
    };
    const [row] = buildCloudTransactionCsvRows([transaction]);
    expect(CLOUD_TRANSACTION_CSV_COLUMNS.slice(0, 24)).toEqual([
      'business_date', 'transaction_id', 'created_at', 'student_id', 'student_name_snapshot', 'type',
      'meal_price', 'paid_amount', 'amount', 'after_balance', 'menu_name_snapshot', 'vendor_name_snapshot',
      'source_device', 'operator_id', 'sync_status', 'revision', 'note', 'voided_at', 'voided_by',
      'void_reason', 'deposit_amount', 'unpaid_amount', 'bento_count', 'other_meal_items',
    ]);
    expect(CLOUD_TRANSACTION_CSV_COLUMNS.slice(24)).toEqual([
      'status', 'backfilled', 'source_seq', 'source_transaction_ids', 'balance_applicability', 'paper_refs',
    ]);
    expect(row[CLOUD_TRANSACTION_CSV_COLUMNS.indexOf('after_balance')]).toEqual(number(-8));
    expect(buildCloudTransactionCsv([transaction])).toContain('"001"');
    expect(buildCloudTransactionCsv([transaction])).toContain(',-8,');
    expect(row[CLOUD_TRANSACTION_CSV_COLUMNS.indexOf('source_transaction_ids')]).toEqual(text('["tx-1"]'));
    const merged = buildCloudMergedTransactions([transaction]);
    expect(buildCloudMergedTransactionCsv(merged)).toContain('[""tx-1""]');
  });

  it('P13d2: appends the paper numbers of a row (all constituents of a merged row) as the last transaction column', () => {
    const base: CloudReportTransaction = {
      transactionId: 'tx-order', studentId: '11111111-1111-4111-8111-111111111111', businessDate: '2026-10-18',
      type: 'order', mealKind: 'bento', mealPrice: 10, paidAmount: 0, amount: -10, studentNameSnapshot: '001',
      menuNameSnapshot: '餐盒', vendorNameSnapshot: '供應商', status: 'active', createdAt: '2026-10-18T04:00:00.000Z',
      createdSeq: 2, operatorUid: 'operator', operatorEmail: 'operator@example.test', sourceDevice: 'pc', note: '紙本A-0001：前天補登',
      revision: 1, lastCommandId: '00000000-0000-4000-8000-000000000001', updatedAt: '2026-10-18T04:00:00.000Z',
      backfilled: true, sourceSeq: 9, afterBalance: -10,
    };
    const payment: CloudReportTransaction = {
      ...base, transactionId: 'tx-payment', type: 'payment', mealKind: null, mealPrice: 0, paidAmount: 10, amount: 10,
      note: '紙本B-0002：', createdSeq: 3, sourceSeq: 10, afterBalance: 0,
    };
    const plain: CloudReportTransaction = { ...base, transactionId: 'tx-plain', note: '一般備註', backfilled: false };
    const last = CLOUD_TRANSACTION_CSV_COLUMNS.indexOf('paper_refs');
    expect(last).toBe(CLOUD_TRANSACTION_CSV_COLUMNS.length - 1);
    expect(buildCloudTransactionCsvRows([base, payment, plain]).map(row => row[last]))
      .toEqual([text('A-0001'), text('B-0002'), text('')]);
    const merged = buildCloudMergedTransactions([base, payment]);
    expect(merged).toHaveLength(1);
    expect(buildCloudTransactionCsvRows(merged)[0]![last]).toEqual(text('A-0001;B-0002'));
    // The free-text note column keeps the stored note, prefix included.
    expect(buildCloudTransactionCsvRows([base])[0]![CLOUD_TRANSACTION_CSV_COLUMNS.indexOf('note')]).toEqual(text('紙本A-0001：前天補登'));
  });

  it('exports effective cash separately from counted cash and keeps post-close rows distinct', () => {
    const totals = {
      activeTransactionCount: 2, bentoCount: 1, otherMealCount: 0, mealTotal: 10,
      retainedReceipts: 2, cashierIncome: 3, cashierExpense: 1, accountRefunds: 0,
    };
    const settlement: CloudReportSettlement = {
      businessDate: '2026-10-18', revision: 2, status: 'closed', totals, openingCash: 100,
      expectedCash: 104, countedCash: 110, difference: 6, note: '', actorUid: 'operator',
      actorEmail: 'operator@example.test', sourceSeq: 8, committedAt: '2026-10-18T08:00:00.000Z',
      lastCommandId: '00000000-0000-4000-8000-000000000002',
    };
    const day: CloudReportDay = {
      businessDate: settlement.businessDate, exists: true, status: 'closed', revision: 3, openingCash: 100,
      totals, lastSettlementRevision: 2, backfillReason: '\u3000', settlements: [settlement],
      postCloseEntries: [], effectiveCash: 125,
    };
    const [row] = buildCloudSettlementCsvRows([settlement], [day]);
    expect(row[CLOUD_SETTLEMENT_CSV_COLUMNS.indexOf('counted_cash')]).toEqual(number(110));
    expect(row[CLOUD_SETTLEMENT_CSV_COLUMNS.indexOf('effective_cash')]).toEqual(number(125));

    const entryRow = buildCloudPostCloseCsvRows([{
      entryId: 'entry-1', businessDate: settlement.businessDate, settlementRevision: 2, direction: 'income',
      amount: 15, reason: '\u3000', createdBy: 'operator', createdAt: settlement.committedAt,
      commandId: 'entry-1', countedInEffectiveCash: true,
    }], 9)[0];
    expect(entryRow[5]).toEqual(text('\u3000'));
    expect(entryRow[3]).toEqual(text('income'));

    const auditRows = buildCloudAuditCsvRows([{
      commandId: 'command-1', kind: 'CreateOrder', seq: 9, leaseEpoch: 7, businessDate: settlement.businessDate,
      studentId: settlement.lastCommandId, actorUid: 'operator', actorEmail: 'operator@example.test',
      committedAt: settlement.committedAt, reason: null, before: { value: 1 }, after: { value: 2 },
    }], 20);
    expect(auditRows[0][10]).toEqual(text('{"value":1}'));
    expect(auditRows[0][11]).toEqual(text('{"value":2}'));
    expect(auditRows[0][2]).toEqual(number(9));
    expect(auditRows[0][12]).toEqual(number(20));
  });

  it('appends audit date attribution while preserving a null command business date', () => {
    const row = {
      commandId: 'command-null', kind: 'RecordExport', seq: 8, leaseEpoch: 7, businessDate: null,
      studentId: null, actorUid: 'operator', actorEmail: 'operator@example.test',
      committedAt: '2026-10-18T16:00:00.000Z', reason: null, before: null, after: null,
      attributedDate: '2026-10-19', dateBasis: 'committed-at' as const,
    };
    const csv = buildCloudAuditCsvRows([row], 20)[0];

    expect(CLOUD_AUDIT_CSV_COLUMNS.slice(-3)).toEqual(['source_seq', 'attributed_date', 'date_basis']);
    expect(csv[CLOUD_AUDIT_CSV_COLUMNS.indexOf('business_date')]).toEqual(text(''));
    expect(csv[CLOUD_AUDIT_CSV_COLUMNS.indexOf('source_seq')]).toEqual(number(20));
    expect(csv[CLOUD_AUDIT_CSV_COLUMNS.indexOf('attributed_date')]).toEqual(text('2026-10-19'));
    expect(csv[CLOUD_AUDIT_CSV_COLUMNS.indexOf('date_basis')]).toEqual(text('committed-at'));
  });
});
