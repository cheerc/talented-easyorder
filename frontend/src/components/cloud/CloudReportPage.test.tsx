import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudLedgerReport, CloudAuditRangeSnapshot } from '../../domain/cloudLedgerReport';

const mocks = vi.hoisted(() => ({
  readSummary: vi.fn(),
  readReport: vi.fn(),
  readAuditRange: vi.fn(),
  recordExport: vi.fn(),
  recordPrint: vi.fn(),
  readCommand: vi.fn(),
}));

vi.mock('../../firebase/cloudReadRepository', () => ({
  createCloudReadRepository: () => ({
    readSummary: mocks.readSummary,
    readReport: mocks.readReport,
    readAuditRange: mocks.readAuditRange,
  }),
}));
vi.mock('../../firebase/cloudReportActionRepository', () => ({
  createCloudReportActionRepository: () => ({
    recordExport: mocks.recordExport,
    recordPrint: mocks.recordPrint,
    readCommand: mocks.readCommand,
  }),
}));

import { CloudReportPage } from './CloudReportPage';

const range = { kind: 'today' as const, startDate: '2026-10-19', endDate: '2026-10-19' };
const report = {
  datasetId: 'dataset-a', sourceSeq: 11, goLiveDate: '2026-10-01', leaseToday: '2026-10-19', leaseEpoch: 4,
  range, scope: { studentId: null }, complete: true,
  summary: {
    activeTransactionCount: 1, orderCount: 1, bentoCount: 1, otherMealCount: 0, mealTotal: 55,
    orderUnpaid: null, totalIncome: 20, totalExpense: 0, totalRefund: 0, netCash: 20,
  },
  students: [{ studentId: 'student-a', studentCode: '001', displayName: '林小明', aliases: ['小明'] }],
  days: [{ businessDate: '2026-10-19', exists: true, status: 'open', revision: 3, openingCash: 100,
    totals: { activeTransactionCount: 1, bentoCount: 1, otherMealCount: 0, mealTotal: 55,
      retainedReceipts: 20, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0 },
    lastSettlementRevision: 0, backfillReason: null, settlements: [], postCloseEntries: [], effectiveCash: null }],
  transactions: [{ transactionId: 'transaction-a', studentId: 'student-a', businessDate: '2026-10-19',
    type: 'order', mealKind: 'bento', mealPrice: 55, paidAmount: 20, amount: -35,
    studentNameSnapshot: '林小明', menuNameSnapshot: '雞腿便當', vendorNameSnapshot: '阿姨',
    status: 'active', createdAt: '2026-10-19T04:00:00.000Z', createdSeq: 10, operatorUid: 'operator-a',
    operatorEmail: 'a@example.test', sourceDevice: 'pc', note: '', revision: 1, lastCommandId: 'create-a',
    updatedAt: '2026-10-19T04:00:00.000Z', backfilled: false, sourceSeq: 10, afterBalance: 965,
    balanceApplicability: 'verified' }],
  mergedTransactions: [], settlements: [], postCloseEntries: [],
} as unknown as CloudLedgerReport;
const audit = {
  datasetId: 'dataset-a', sourceSeq: 11, goLiveDate: '2026-10-01', leaseToday: '2026-10-19', leaseEpoch: 4,
  range, scope: { studentId: null }, complete: true,
  rows: [{ commandId: 'cmd-a', kind: 'CreateOrder', seq: 10, leaseEpoch: 4, businessDate: '2026-10-19',
    studentId: 'student-a', actorUid: 'operator-a', actorEmail: 'a@example.test',
    committedAt: '2026-10-19T04:00:00.000Z', reason: null, before: null, after: null,
    attributedDate: '2026-10-19', dateBasis: 'business-date' }],
} as unknown as CloudAuditRangeSnapshot;

describe('CloudReportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readSummary.mockResolvedValue({ leaseToday: '2026-10-19' });
    mocks.readReport.mockResolvedValue(report);
    mocks.readAuditRange.mockResolvedValue(audit);
    mocks.recordExport.mockImplementation(async input => ({ ok: true, receipt: { commandId: input.commandId, seq: 12, kind: 'RecordExport' } }));
    mocks.recordPrint.mockResolvedValue({ ok: true, receipt: { commandId: 'print-a', seq: 12, kind: 'RecordPrint' } });
  });

  it('keeps exports disabled until the complete report and matching audit snapshot are loaded', async () => {
    let finishReport!: (value: CloudLedgerReport) => void;
    mocks.readReport.mockReturnValueOnce(new Promise(resolve => { finishReport = resolve; }));
    render(<CloudReportPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4" />);

    expect(screen.queryByRole('button', { name: '匯出稽核 CSV' })).toBeNull();
    await act(async () => { finishReport(report); });
    await screen.findByText('來源序號 H=11');
    expect(screen.getByRole('button', { name: '匯出稽核 CSV' })).toBeEnabled();
  });

  it('records the frozen H/range/scope before downloading the full audit CSV', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<CloudReportPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4" />);
    await screen.findByText('來源序號 H=11');

    fireEvent.click(screen.getByRole('button', { name: '匯出稽核 CSV' }));
    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
    expect(mocks.recordExport).toHaveBeenCalledWith(expect.objectContaining({
      exportType: 'audit', sourceSeq: 11, leaseEpoch: 4, range, scope: { studentId: null },
    }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toContain('已發起匯出');
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    anchorClick.mockRestore();
  });

  it('does not combine report and audit snapshots with different source sequence numbers', async () => {
    mocks.readAuditRange.mockResolvedValueOnce({ ...audit, sourceSeq: 12 });
    render(<CloudReportPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('報表與稽核版本不一致');
    expect(screen.queryByRole('button', { name: '匯出稽核 CSV' })).toBeNull();
  });

  it('routes a date to day close and the selected account plus range to account history', async () => {
    const onOpenDayClose = vi.fn();
    const onOpenAccountHistory = vi.fn();
    mocks.readReport.mockImplementation(async input => ({ ...report, scope: { studentId: input.studentId } }));
    mocks.readAuditRange.mockImplementation(async input => ({ ...audit, scope: { studentId: input.studentId } }));
    render(<CloudReportPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4"
      onOpenDayClose={onOpenDayClose} onOpenAccountHistory={onOpenAccountHistory} />);
    await screen.findByText('來源序號 H=11');
    fireEvent.change(screen.getByLabelText('搜尋帳戶'), { target: { value: '001' } });
    fireEvent.click(screen.getByRole('button', { name: '選取 林小明（001）' }));
    await waitFor(() => expect(mocks.readReport).toHaveBeenCalledWith(expect.objectContaining({
      studentId: 'student-a', range,
    })));
    fireEvent.click(screen.getByRole('button', { name: '開啟查帳：林小明' }));
    expect(onOpenAccountHistory).toHaveBeenCalledWith('student-a', range);
    fireEvent.click(screen.getAllByRole('button', { name: '開啟日結 2026-10-19' }).at(-1)!);
    expect(onOpenDayClose).toHaveBeenCalledWith('2026-10-19');
  });
});
