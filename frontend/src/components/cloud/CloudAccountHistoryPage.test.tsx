import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudAccountHistory, CloudAuditRangeSnapshot, CloudLedgerReport } from '../../domain/cloudLedgerReport';

const mocks = vi.hoisted(() => ({
  readSummary: vi.fn(),
  readAccountHistory: vi.fn(),
  readReport: vi.fn(),
  readAuditRange: vi.fn(),
  listStudents: vi.fn(),
  mutateTransaction: vi.fn(),
  readCommand: vi.fn(),
}));

vi.mock('../../firebase/cloudReadRepository', () => ({
  createCloudReadRepository: () => ({
    readSummary: mocks.readSummary,
    readAccountHistory: mocks.readAccountHistory,
    readReport: mocks.readReport,
    readAuditRange: mocks.readAuditRange,
  }),
}));
vi.mock('../../firebase/cloudStudentRepository', () => ({
  createCloudStudentRepository: () => ({ list: mocks.listStudents }),
  listCloudStudents: mocks.listStudents,
}));
vi.mock('../../firebase/cloudOrderRepository', () => ({
  createCloudOrderRepository: () => ({ mutateTransaction: mocks.mutateTransaction, readCommand: mocks.readCommand }),
}));

import { CloudAccountHistoryPage } from './CloudAccountHistoryPage';

const studentId = '11111111-1111-4111-8111-111111111111';
const date = '2026-10-18';
const range = { kind: 'custom' as const, startDate: date, endDate: date };
const student = {
  studentId, studentCode: '001', displayName: '林小明', aliases: ['小明'], status: 'active',
  openingBalance: { amount: 1_000, asOfDate: '2026-10-01', note: '', createdAt: `${date}T00:00:00.000Z` },
  currentBalance: 965, createdAt: `${date}T00:00:00.000Z`, revision: 8, lastCommandId: 'student-command', updatedAt: `${date}T00:00:00.000Z`,
};
const transaction = {
  transactionId: '22222222-2222-4222-8222-222222222222', studentId, businessDate: date, type: 'order', mealKind: 'bento',
  mealPrice: 55, paidAmount: 20, amount: -35, studentNameSnapshot: '林小明', menuNameSnapshot: '雞腿便當',
  vendorNameSnapshot: '阿姨', status: 'active', createdAt: `${date}T04:00:00.000Z`, createdSeq: 4,
  operatorUid: 'operator-a', operatorEmail: 'a@example.test', sourceDevice: 'pc', note: '', revision: 2,
  lastCommandId: 'create-command', updatedAt: `${date}T04:00:00.000Z`, backfilled: true, sourceSeq: 11,
  afterBalance: 965, balanceApplicability: 'verified',
};
const account = {
  datasetId: 'dataset-a', sourceSeq: 11, goLiveDate: '2026-10-01', leaseToday: '2026-10-19', leaseEpoch: 4,
  range, scope: { studentId }, complete: true, student: { studentId, studentCode: '001', displayName: '林小明', aliases: ['小明'] },
  openingBalance: 1_000, currentBalance: 965, transactions: [transaction],
} as unknown as CloudAccountHistory;
const report = {
  datasetId: 'dataset-a', sourceSeq: 11, goLiveDate: '2026-10-01', leaseToday: '2026-10-19', leaseEpoch: 4,
  range, scope: { studentId }, complete: true,
  summary: { activeTransactionCount: 1, orderCount: 1, bentoCount: 1, otherMealCount: 0, mealTotal: 55,
    orderUnpaid: null, totalIncome: 20, totalExpense: 0, totalRefund: 0, netCash: 20 },
  students: [{ studentId, studentCode: '001', displayName: '林小明', aliases: ['小明'] }],
  days: [{ businessDate: date, exists: true, status: 'open', revision: 3, openingCash: 100,
    totals: { activeTransactionCount: 1, bentoCount: 1, otherMealCount: 0, mealTotal: 55,
      retainedReceipts: 20, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0 },
    lastSettlementRevision: 0, backfillReason: '歷史回填', settlements: [], postCloseEntries: [], effectiveCash: null }],
  transactions: [transaction], mergedTransactions: [], settlements: [], postCloseEntries: [],
} as unknown as CloudLedgerReport;
const audit = {
  datasetId: 'dataset-a', sourceSeq: 11, goLiveDate: '2026-10-01', leaseToday: '2026-10-19', leaseEpoch: 4,
  range, scope: { studentId }, complete: true,
  rows: [{ commandId: 'create-command', kind: 'CreateOrder', seq: 4, leaseEpoch: 4, businessDate: date, studentId,
    actorUid: 'operator-a', actorEmail: 'a@example.test', committedAt: `${date}T04:00:00.000Z`, reason: null,
    before: null, after: { transactionId: transaction.transactionId }, attributedDate: date, dateBasis: 'business-date' }],
} as unknown as CloudAuditRangeSnapshot;

describe('CloudAccountHistoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readSummary.mockResolvedValue({ leaseToday: '2026-10-19' });
    mocks.listStudents.mockResolvedValue({ datasetId: 'dataset-a', seq: 11, goLiveDate: '2026-10-01', students: [student] });
    mocks.readAccountHistory.mockResolvedValue(account);
    mocks.readReport.mockResolvedValue(report);
    mocks.readAuditRange.mockResolvedValue(audit);
    mocks.mutateTransaction.mockResolvedValue({ ok: true, receipt: { commandId: 'mutation-a', seq: 12, kind: 'CorrectTransaction' } });
    mocks.readCommand.mockResolvedValue(null);
  });

  it('shows no balance until account history, day records, audit, and current student head agree', async () => {
    mocks.readAuditRange.mockResolvedValueOnce({ ...audit, sourceSeq: 12 });
    render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4" initialStudentId={studentId} initialRange={range} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('版本不一致');
    expect(screen.queryByText('目前帳戶餘額')).toBeNull();
    expect(screen.queryByRole('button', { name: '更正' })).toBeNull();
  });

  it('submits a history correction using the exact transaction, student, and open-day revisions', async () => {
    render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4" initialStudentId={studentId} initialRange={range} />);
    await screen.findByTestId('account-history-ready');
    expect(screen.getByText('依目前更正後資料重算')).toBeVisible();
    expect(screen.getByText('有效 · 回填')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '更正' }));
    fireEvent.change(screen.getByLabelText('更正餐費'), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText('更正理由'), { target: { value: '餐費輸入錯誤' } });
    fireEvent.click(screen.getByRole('button', { name: '確認送出' }));

    await waitFor(() => expect(mocks.mutateTransaction).toHaveBeenCalledTimes(1));
    expect(mocks.mutateTransaction).toHaveBeenCalledWith(expect.objectContaining({
      leaseEpoch: 4, transactionId: transaction.transactionId, studentId, dayId: date,
      expectedTransactionRevision: 2, expectedStudentRevision: 8, expectedDayRevision: 3,
      kind: 'CorrectTransaction', payload: { mealPrice: 60, paidAmount: 20, amount: -40, note: '', reason: '餐費輸入錯誤' },
    }));
  });

  it('keeps closed historical transactions read-only and directs cash differences to day close', async () => {
    mocks.readReport.mockResolvedValueOnce({ ...report, days: [{ ...report.days[0], status: 'reopened', lastSettlementRevision: 2 }] });
    render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4" initialStudentId={studentId} initialRange={range} />);
    await screen.findByTestId('account-history-ready');

    expect(screen.queryByRole('button', { name: '更正' })).toBeNull();
    expect(screen.getByText('唯讀；現金差額請到日結補記')).toBeVisible();
    expect(mocks.mutateTransaction).not.toHaveBeenCalled();
  });

  it('keeps today transactions read-only even when the day is open', async () => {
    const today = '2026-10-19';
    const todayRange = { kind: 'custom' as const, startDate: today, endDate: today };
    const todayTransaction = { ...transaction, businessDate: today, createdAt: `${today}T04:00:00.000Z` };
    mocks.readAccountHistory.mockResolvedValue({ ...account, range: todayRange, transactions: [todayTransaction] });
    mocks.readReport.mockResolvedValue({ ...report, range: todayRange, days: [{ ...report.days[0], businessDate: today, status: 'open', lastSettlementRevision: 0 }], transactions: [todayTransaction] });
    mocks.readAuditRange.mockResolvedValue({ ...audit, range: todayRange, rows: [{ ...audit.rows[0], businessDate: today, attributedDate: today, committedAt: `${today}T04:00:00.000Z` }] });

    render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4" initialStudentId={studentId} initialRange={todayRange} />);
    await screen.findByTestId('account-history-ready');

    expect(screen.queryByRole('button', { name: '更正' })).toBeNull();
    expect(screen.getByText('唯讀')).toBeVisible();
    expect(mocks.mutateTransaction).not.toHaveBeenCalled();
  });

  it('recovers an unknown correction by retrying the frozen command id and revisions', async () => {
    mocks.mutateTransaction
      .mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } })
      .mockResolvedValueOnce({ ok: true, receipt: { commandId: '00000000-0000-4000-8000-000000000003', seq: 12, kind: 'CorrectTransaction' } });
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000003');
    render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4" initialStudentId={studentId} initialRange={range} />);
    await screen.findByTestId('account-history-ready');
    fireEvent.click(screen.getByRole('button', { name: '更正' }));
    fireEvent.change(screen.getByLabelText('更正理由'), { target: { value: '固定重試' } });
    fireEvent.click(screen.getByRole('button', { name: '確認送出' }));
    await screen.findByRole('region', { name: '歷史更正命令恢復' });
    fireEvent.click(screen.getByRole('button', { name: '查詢原命令並以同 ID 復原' }));

    await waitFor(() => expect(mocks.mutateTransaction).toHaveBeenCalledTimes(2));
    expect(mocks.mutateTransaction.mock.calls[0][0]).toEqual(mocks.mutateTransaction.mock.calls[1][0]);
    vi.restoreAllMocks();
  });
});
