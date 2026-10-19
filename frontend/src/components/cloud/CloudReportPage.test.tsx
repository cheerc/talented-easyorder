import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('CloudReportPage', () => {
  afterEach(() => vi.restoreAllMocks());

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
    render(<CloudReportPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4:loading" />);

    expect(screen.queryByRole('button', { name: '匯出稽核 CSV' })).toBeNull();
    await act(async () => { finishReport(report); });
    await screen.findByText('來源序號 H=11');
    expect(screen.getByRole('button', { name: '匯出稽核 CSV' })).toBeEnabled();
  });

  it('records the frozen H/range/scope before downloading the full audit CSV', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<CloudReportPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4:audit-export" />);
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

  it('does not download when an export receipt arrives after the page unmounts', async () => {
    let finish!: (result: unknown) => void;
    mocks.recordExport.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:review');
    const view = render(<CloudReportPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4:late-export" />);
    await screen.findByTestId('report-ready');

    fireEvent.click(screen.getByRole('button', { name: '匯出稽核 CSV' }));
    const input = mocks.recordExport.mock.calls[0][0];
    view.unmount();
    await act(async () => {
      finish({ ok: true, receipt: { commandId: input.commandId, kind: 'RecordExport', seq: 12 } });
    });

    expect(click).toHaveBeenCalledTimes(0);
    click.mockRestore();
    vi.restoreAllMocks();
  });

  it('shows the print surface only after the matching receipt and removes it after print starts', async () => {
    const pending = deferred<{ ok: true; receipt: { commandId: string; kind: string; seq: number } }>();
    mocks.recordPrint.mockReturnValueOnce(pending.promise);
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      expect(screen.getByRole('article', { name: '本次固定列印內容' })).toBeInTheDocument();
      expect(screen.getByText(/transaction-a/)).toBeInTheDocument();
    });
    render(<CloudReportPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4:print-gate" />);
    await screen.findByTestId('report-ready');

    fireEvent.click(screen.getByRole('button', { name: '記錄後列印目前完整明細' }));
    await waitFor(() => expect(mocks.recordPrint).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('article', { name: '本次固定列印內容' })).toBeNull();
    expect(print).not.toHaveBeenCalled();

    const input = mocks.recordPrint.mock.calls[0][0];
    await act(async () => {
      pending.resolve({ ok: true, receipt: { commandId: input.commandId, kind: 'RecordPrint', seq: 12 } });
      await pending.promise;
    });

    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('article', { name: '本次固定列印內容' })).toBeNull();
  });

  it('retries an unknown export with the same command and frozen input', async () => {
    mocks.recordExport
      .mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'outcome unknown' } })
      .mockImplementationOnce(async input => ({ ok: true, receipt: { commandId: input.commandId, seq: 12, kind: 'RecordExport' } }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:retry');
    render(<CloudReportPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4:unknown-retry" />);
    await screen.findByTestId('report-ready');

    fireEvent.click(screen.getByRole('button', { name: '匯出稽核 CSV' }));
    await screen.findByRole('region', { name: '輸出命令確認' });
    const firstInput = mocks.recordExport.mock.calls[0][0];
    mocks.readCommand.mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole('button', { name: '查詢原命令並以同 ID 復原' }));

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(mocks.readCommand).toHaveBeenCalledWith(firstInput.commandId);
    expect(mocks.recordExport).toHaveBeenCalledTimes(2);
    expect(mocks.recordExport.mock.calls[1][0]).toEqual(firstInput);
    expect(screen.getByRole('status')).toHaveTextContent('已發起匯出');
  });

  it('requires explicit matching-owner recovery after an unmounted action', async () => {
    const pending = deferred<{ ok: true; receipt: { commandId: string; kind: string; seq: number } }>();
    mocks.recordExport.mockReturnValueOnce(pending.promise);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:remount-recovery');
    const identityKey = 'operator-a:4:remount-recovery';
    const firstView = render(<CloudReportPage db={{} as never} leaseEpoch={4} identityKey={identityKey} />);
    await screen.findByTestId('report-ready');

    fireEvent.click(screen.getByRole('button', { name: '匯出稽核 CSV' }));
    const input = mocks.recordExport.mock.calls[0][0];
    firstView.unmount();
    await act(async () => {
      pending.resolve({ ok: true, receipt: { commandId: input.commandId, kind: 'RecordExport', seq: 12 } });
      await pending.promise;
    });
    expect(click).not.toHaveBeenCalled();

    render(<CloudReportPage db={{} as never} leaseEpoch={4} identityKey={identityKey} />);
    await screen.findByTestId('report-ready');
    await screen.findByRole('region', { name: '輸出命令確認' });
    expect(click).not.toHaveBeenCalled();
    expect(mocks.readCommand).not.toHaveBeenCalled();
    mocks.readCommand.mockResolvedValueOnce({ commandId: input.commandId, kind: 'RecordExport', seq: 12 });

    fireEvent.click(screen.getByRole('button', { name: '查詢原命令並以同 ID 復原' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(mocks.readCommand).toHaveBeenCalledWith(input.commandId);
    expect(mocks.recordExport).toHaveBeenCalledTimes(1);
  });

  it('does not combine report and audit snapshots with different source sequence numbers', async () => {
    mocks.readAuditRange.mockResolvedValueOnce({ ...audit, sourceSeq: 12 });
    render(<CloudReportPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4:mismatch" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('報表與稽核版本不一致');
    expect(screen.queryByRole('button', { name: '匯出稽核 CSV' })).toBeNull();
  });

  it('routes a date to day close and the selected account plus range to account history', async () => {
    const onOpenDayClose = vi.fn();
    const onOpenAccountHistory = vi.fn();
    mocks.readReport.mockImplementation(async input => ({ ...report, scope: { studentId: input.studentId } }));
    mocks.readAuditRange.mockImplementation(async input => ({ ...audit, scope: { studentId: input.studentId } }));
    render(<CloudReportPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4:route"
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

  for (const kind of ['export', 'print'] as const) {
    for (const phase of ['record', 'recovery'] as const) {
      for (const invalidation of ['unmount', 'identity change', 'lease epoch change'] as const) {
        for (const outcome of ['success', 'late rejection'] as const) {
          it(`${kind} ${phase} ignores ${outcome} after ${invalidation}`, async () => {
            const pending = deferred<{
              ok?: boolean;
              receipt?: { commandId: string; kind: string; seq: number };
              error?: { code: string; message: string };
            }>();
            const record = kind === 'export' ? mocks.recordExport : mocks.recordPrint;
            const browserClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
            const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
            vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:owner-check');
            const navigation = vi.fn();
            const originalIdentity = `operator-a:4:${kind}-${phase}-${invalidation}-${outcome}`;
            const view = render(<CloudReportPage db={{} as never} leaseEpoch={4} identityKey={originalIdentity}
              onNavigationStateChange={navigation} />);
            await screen.findByTestId('report-ready');

            if (phase === 'recovery') {
              record.mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
            } else {
              record.mockReturnValueOnce(pending.promise);
            }
            const trigger = kind === 'export'
              ? screen.getByRole('button', { name: '匯出稽核 CSV' })
              : screen.getByRole('button', { name: '記錄後列印目前完整明細' });
            fireEvent.click(trigger);
            const input = record.mock.calls.at(-1)![0];

            if (phase === 'recovery') {
              await screen.findByRole('region', { name: '輸出命令確認' });
              mocks.readCommand.mockReturnValueOnce(pending.promise);
              fireEvent.click(screen.getByRole('button', { name: '查詢原命令並以同 ID 復原' }));
              await waitFor(() => expect(mocks.readCommand).toHaveBeenCalledWith(input.commandId));
            }

            if (invalidation === 'unmount') {
              view.unmount();
            } else {
              mocks.readReport.mockImplementation(async request => ({
                ...report, leaseEpoch: request.leaseEpoch, range: request.range, scope: { studentId: request.studentId },
              }));
              mocks.readAuditRange.mockImplementation(async request => ({
                ...audit, leaseEpoch: request.leaseEpoch, range: request.range, scope: { studentId: request.studentId },
              }));
              view.rerender(<CloudReportPage db={{} as never}
                leaseEpoch={invalidation === 'lease epoch change' ? 5 : 4}
                identityKey={invalidation === 'identity change' ? `${originalIdentity}:changed` : originalIdentity}
                onNavigationStateChange={navigation} />);
              await screen.findByTestId('report-ready');
            }
            navigation.mockClear();

            await act(async () => {
              if (outcome === 'success') {
                pending.resolve({ ok: true, receipt: {
                  commandId: input.commandId, kind: kind === 'export' ? 'RecordExport' : 'RecordPrint', seq: 12,
                } });
              } else {
                pending.reject(Object.assign(new Error('late owner denial'), { code: 'UNAUTHORIZED' }));
              }
            });

            expect(browserClick).not.toHaveBeenCalled();
            expect(print).not.toHaveBeenCalled();
            expect(navigation).not.toHaveBeenCalled();
            if (invalidation !== 'unmount') {
              expect(screen.getByTestId('report-ready')).toBeVisible();
              expect(screen.queryByRole('region', { name: '輸出命令確認' })).toBeNull();
              expect(screen.queryByText(/late owner denial|已發起匯出|已發起列印/)).toBeNull();
            }
          });
        }
      }
    }
  }
});
