import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TRANSACTION_CSV_COLUMNS,
  SETTLEMENT_CSV_COLUMNS,
  buildTransactionCsvRows,
  buildSettlementCsvRows,
  serializeCsv,
  buildLedgerPrintViewModel,
  triggerCsvDownload,
} from '../ledgerExport';
import type { LedgerTransaction } from '../ledger';
import type { DailySettlement } from '../cashClose';
import type { LedgerGroup, LedgerTotals } from '../ledgerReport';

const makeTx = (overrides: Partial<LedgerTransaction> = {}): LedgerTransaction => ({
  transactionId: 'tx-1',
  businessDate: '2026-05-15',
  createdAt: '2026-05-15T12:00:00.000Z',
  studentId: '015',
  studentNameSnapshot: '王小明',
  type: 'order',
  mealPrice: 85,
  paidAmount: 0,
  amount: -85,
  afterBalance: 15,
  menuNameSnapshot: '雞腿飯',
  vendorNameSnapshot: '便當王',
  sourceDevice: 'pc',
  syncStatus: 'local',
  revision: 1,
  note: '',
  ...overrides,
});

describe('CSV column definitions', () => {
  it('transaction CSV has exactly 22 columns', () => {
    expect(TRANSACTION_CSV_COLUMNS).toHaveLength(22);
  });

  it('transaction CSV columns match documented order', () => {
    expect(TRANSACTION_CSV_COLUMNS[0]).toBe('business_date');
    expect(TRANSACTION_CSV_COLUMNS[1]).toBe('transaction_id');
    expect(TRANSACTION_CSV_COLUMNS[19]).toBe('void_reason');
  });

  it('settlement CSV has exactly 15 columns', () => {
    expect(SETTLEMENT_CSV_COLUMNS).toHaveLength(15);
  });
});

describe('buildTransactionCsvRows', () => {
  it('maps one ledger row to one CSV row', () => {
    const rows = buildTransactionCsvRows([makeTx()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(22);
    expect(rows[0][0]).toBe('2026-05-15');
    expect(rows[0][1]).toBe('tx-1');
    expect(rows[0][4]).toBe('王小明');
  });

  it('defaults depositAmount and unpaidAmount to 0 when missing', () => {
    const tx = makeTx();
    delete (tx as Partial<LedgerTransaction>).depositAmount;
    delete (tx as Partial<LedgerTransaction>).unpaidAmount;
    const rows = buildTransactionCsvRows([tx]);
    expect(rows[0][20]).toBe('0');
    expect(rows[0][21]).toBe('0');
  });

  it('outputs depositAmount and unpaidAmount when present', () => {
    const tx = makeTx({ depositAmount: 150, unpaidAmount: 50 });
    const rows = buildTransactionCsvRows([tx]);
    expect(rows[0][20]).toBe('150');
    expect(rows[0][21]).toBe('50');
  });

  it('handles empty array', () => {
    const rows = buildTransactionCsvRows([]);
    expect(rows).toHaveLength(0);
  });
});

describe('buildSettlementCsvRows', () => {
  it('maps settlement revision to CSV row', () => {
    const settlement: DailySettlement = {
      settlementId: 's-1',
      businessDate: '2026-05-15',
      status: 'closed',
      settlementRevision: 1,
      orderCount: 10,
      transactionCount: 10,
      totalIncome: 500,
      totalExpense: 0,
      openingCash: 0,
      netCash: 500,
      expectedCash: 500,
      countedCash: 500,
      difference: 0,
      note: '',
      closedBy: 'op-admin',
      closedAt: '2026-05-15T18:00:00.000Z',
      syncStatus: 'local',
      revision: 1,
    };
    const rows = buildSettlementCsvRows([settlement]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(15);
  });
});

describe('serializeCsv', () => {
  it('joins columns with comma', () => {
    const csv = serializeCsv(['a', 'b', 'c'], [['1', '2', '3']]);
    expect(csv).toContain('a,b,c');
    expect(csv).toContain('1,2,3');
  });

  it('quotes values containing comma', () => {
    const csv = serializeCsv(['col'], [['val,ue']]);
    expect(csv).toContain('"val,ue"');
  });

  it('quotes values containing quote by doubling', () => {
    const csv = serializeCsv(['col'], [['he said "hello"']]);
    expect(csv).toContain('"he said ""hello"""');
  });

  it('preserves empty string for missing fields', () => {
    const csv = serializeCsv(['a', 'b'], [['', '']]);
    expect(csv).toContain(',');
  });
});

describe('triggerCsvDownload', () => {
  let capturedBlob: Blob | null;
  let anchorClickCount: number;
  let revokeCalls: string[];
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;
  let originalCreateElement: typeof document.createElement;

  beforeEach(() => {
    capturedBlob = null;
    anchorClickCount = 0;
    revokeCalls = [];
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    originalCreateElement = document.createElement;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      capturedBlob = blob;
      return 'blob:test';
    });
    URL.revokeObjectURL = vi.fn((url: string) => {
      revokeCalls.push(url);
    });
    document.createElement = vi.fn((tag: string) => {
      const el = originalCreateElement.call(document, tag);
      if (tag === 'a') {
        vi.spyOn(el, 'click').mockImplementation(() => { anchorClickCount++; });
      }
      return el;
    }) as typeof document.createElement;
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    document.createElement = originalCreateElement;
  });

  it('creates Blob with UTF-8 BOM and text/csv MIME type', async () => {
    triggerCsvDownload('test.csv', 'col1,col2\nv1,v2');

    expect(capturedBlob).toBeInstanceOf(Blob);
    expect(capturedBlob!.type).toBe('text/csv;charset=utf-8');

    const buf = await capturedBlob!.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // UTF-8 BOM: EF BB BF
    expect(bytes[0]).toBe(0xEF);
    expect(bytes[1]).toBe(0xBB);
    expect(bytes[2]).toBe(0xBF);
    // BOM bytes verified above; TextDecoder strips BOM from decoded text
    const text = new TextDecoder('utf-8').decode(buf);
    expect(text).toBe('col1,col2\nv1,v2');
  });

  it('triggers click on anchor and revokes URL', () => {
    triggerCsvDownload('r.csv', 'x');

    expect(anchorClickCount).toBe(1);
    expect(revokeCalls).toEqual(['blob:test']);
  });
});

describe('buildLedgerPrintViewModel', () => {
  it('includes header, totals, and grouped rows', () => {
    const totals: LedgerTotals = {
      orderCount: 1,
      totalIncome: 0,
      totalExpense: 0,
      netCash: 0,
      newDebt: 85,
      transactionCount: 1,
    };
    const groups: LedgerGroup[] = [{
      studentId: '015',
      studentNameSnapshot: '王小明',
      latestCreatedAt: '2026-05-15T12:00:00.000Z',
      mealTotal: 85,
      paidTotal: 0,
      afterBalance: 15,
      recordCount: 1,
      transactions: [makeTx()],
    }];

    const vm = buildLedgerPrintViewModel({
      businessDate: '2026-05-15',
      totals,
      groups,
      dateStatus: 'open',
      generatedAt: '2026-05-15T18:00:00.000Z',
      generatedBy: 'op-report',
    });

    expect(vm.businessDate).toBe('2026-05-15');
    expect(vm.totals.orderCount).toBe(1);
    expect(vm.groups).toHaveLength(1);
    expect(vm.generatedBy).toBe('op-report');
  });
});