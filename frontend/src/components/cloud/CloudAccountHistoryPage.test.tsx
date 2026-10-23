import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudAccountHistory, CloudAuditRangeSnapshot, CloudLedgerReport } from '../../domain/cloudLedgerReport';

const currentAuth = vi.hoisted(() => ({ uid: 'uid-a' as string | null }));

const mocks = vi.hoisted(() => ({
  repositoryOptions: vi.fn(),
  readSummary: vi.fn(),
  readAccountHistory: vi.fn(),
  readReport: vi.fn(),
  readAuditRange: vi.fn(),
  listStudents: vi.fn(),
  mutateTransaction: vi.fn(),
  confirmPendingIntent: vi.fn(),
  cleanupConfirmedIntent: vi.fn(),
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
  createCloudOrderRepository: (_db: unknown, options: unknown) => {
    mocks.repositoryOptions(options);
    return {
      mutateTransaction: mocks.mutateTransaction,
      confirmPendingIntent: mocks.confirmPendingIntent,
      cleanupConfirmedIntent: mocks.cleanupConfirmedIntent,
    };
  },
}));
vi.mock('../../firebase/cloudRecoveryReader', () => ({
  getCloudRecoveryReader: () => ({ assertCurrent: vi.fn() }),
}));
vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: currentAuth.uid ? { uid: currentAuth.uid } : null }),
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('CloudAccountHistoryPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    currentAuth.uid = 'uid-a';
    mocks.readSummary.mockResolvedValue({ leaseToday: '2026-10-19' });
    mocks.listStudents.mockResolvedValue({ datasetId: 'dataset-a', seq: 11, goLiveDate: '2026-10-01', students: [student] });
    mocks.readAccountHistory.mockResolvedValue(account);
    mocks.readReport.mockResolvedValue(report);
    mocks.readAuditRange.mockResolvedValue(audit);
    mocks.mutateTransaction.mockResolvedValue({ ok: true, receipt: { commandId: 'mutation-a', seq: 12, kind: 'CorrectTransaction' } });
    mocks.confirmPendingIntent.mockResolvedValue({ status: 'not-found' });
    mocks.cleanupConfirmedIntent.mockResolvedValue(true);
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

  describe('paper numbers (P13d2)', () => {
    const numbered = { ...transaction, note: '紙本A-0123：前天補登' };
    const useNumbered = () => {
      mocks.readAccountHistory.mockResolvedValue({ ...account, transactions: [numbered] });
      mocks.readReport.mockResolvedValue({ ...report, transactions: [numbered] });
    };

    it('shows the number apart from the remark text in the transaction details', async () => {
      useNumbered();
      render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4" initialStudentId={studentId} initialRange={range} />);
      await screen.findByTestId('account-history-ready');
      expect(screen.getByTestId('history-paper-ref')).toHaveTextContent('A-0123');
      expect(screen.getByText('前天補登')).toBeVisible();
      expect(screen.queryByText('紙本A-0123：前天補登')).toBeNull();
    });

    it('keeps the number locked in a correction: the form edits only the text, and the sent note keeps the prefix', async () => {
      useNumbered();
      render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4" initialStudentId={studentId} initialRange={range} />);
      await screen.findByTestId('account-history-ready');
      fireEvent.click(screen.getByRole('button', { name: '更正' }));
      expect(screen.getByTestId('correction-paper-ref')).toHaveTextContent('紙本號 A-0123（更正時不能修改）');
      expect(screen.getByLabelText('交易備註')).toHaveValue('前天補登');
      fireEvent.change(screen.getByLabelText('交易備註'), { target: { value: '前天補登（更正金額）' } });
      fireEvent.change(screen.getByLabelText('更正餐費'), { target: { value: '60' } });
      fireEvent.change(screen.getByLabelText('更正理由'), { target: { value: '餐費輸入錯誤' } });
      fireEvent.click(screen.getByRole('button', { name: '確認送出' }));
      await waitFor(() => expect(mocks.mutateTransaction).toHaveBeenCalledTimes(1));
      expect(mocks.mutateTransaction).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'CorrectTransaction',
        payload: { mealPrice: 60, paidAmount: 20, amount: -40, note: '紙本A-0123：前天補登（更正金額）', reason: '餐費輸入錯誤' },
      }));
    });

    it('shows no locked number for a transaction without one', async () => {
      render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4" initialStudentId={studentId} initialRange={range} />);
      await screen.findByTestId('account-history-ready');
      expect(screen.queryByTestId('history-paper-ref')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '更正' }));
      expect(screen.queryByTestId('correction-paper-ref')).toBeNull();
    });
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

  it('queries an unknown correction read-only and resends the frozen command only after an explicit retry click', async () => {
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
    expect(screen.queryByRole('button', { name: '以相同命令編號重試' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));

    await screen.findByText(/伺服器目前尚未找到這筆命令/);
    expect(mocks.confirmPendingIntent).toHaveBeenCalledWith(
      expect.objectContaining({ commandId: '00000000-0000-4000-8000-000000000003' }), 'dataset-a', 'uid-a',
    );
    expect(mocks.mutateTransaction).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '以相同命令編號重試' }));
    await waitFor(() => expect(mocks.mutateTransaction).toHaveBeenCalledTimes(2));
    expect(mocks.mutateTransaction.mock.calls[0][0]).toEqual(mocks.mutateTransaction.mock.calls[1][0]);
    await waitFor(() => expect(mocks.cleanupConfirmedIntent).toHaveBeenCalledTimes(1));
    vi.restoreAllMocks();
  });

  it('clears an open correction draft and account candidates after a read loses the lease', async () => {
    const navigation = vi.fn();
    render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4"
      initialStudentId={studentId} initialRange={range} onNavigationStateChange={navigation} />);
    await screen.findByTestId('account-history-ready');
    fireEvent.click(screen.getByRole('button', { name: '更正' }));
    fireEvent.change(screen.getByLabelText('更正理由'), { target: { value: 'private draft' } });
    fireEvent.change(screen.getByLabelText('搜尋目前學生帳戶'), { target: { value: '林小明' } });

    mocks.readAccountHistory.mockRejectedValueOnce(Object.assign(new Error('lost lease'), { code: 'LEASE_LOST' }));
    fireEvent.click(screen.getByRole('button', { name: '查詢完整歷史' }));
    await screen.findByRole('alert');

    expect(navigation).toHaveBeenLastCalledWith('operator-a:4', 'revoked');
    expect(screen.queryByRole('form', { name: '歷史交易更正' })).toBeNull();
    expect(screen.queryByRole('button', { name: '林小明（001）' })).toBeNull();
    expect(screen.getByLabelText('搜尋目前學生帳戶')).toHaveValue('');
    expect(screen.queryByText('林小明')).toBeNull();
  });

  it('does not refill revoked account UI when sibling reads finish later', async () => {
    const navigation = vi.fn();
    const view = render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4"
      initialStudentId={studentId} initialRange={range} onNavigationStateChange={navigation} />);
    await screen.findByTestId('account-history-ready');
    fireEvent.click(screen.getByRole('button', { name: '更正' }));
    fireEvent.change(screen.getByLabelText('更正理由'), { target: { value: 'late private draft' } });
    fireEvent.change(screen.getByLabelText('搜尋目前學生帳戶'), { target: { value: '小明' } });

    const lateAccount = deferred<CloudAccountHistory>();
    const lateAudit = deferred<CloudAuditRangeSnapshot>();
    const lateStudents = deferred<{ datasetId: string; seq: number; goLiveDate: string; students: typeof student[] }>();
    mocks.readAccountHistory.mockReturnValueOnce(lateAccount.promise);
    mocks.readReport.mockRejectedValueOnce(Object.assign(new Error('unauthorized'), { code: 'UNAUTHORIZED' }));
    mocks.readAuditRange.mockReturnValueOnce(lateAudit.promise);
    mocks.listStudents.mockReturnValueOnce(lateStudents.promise);
    fireEvent.click(screen.getByRole('button', { name: '查詢完整歷史' }));
    await screen.findByRole('alert');
    expect(navigation).toHaveBeenLastCalledWith('operator-a:4', 'revoked');

    await act(async () => {
      lateAccount.resolve(account);
      lateAudit.resolve(audit);
      lateStudents.resolve({ datasetId: 'dataset-a', seq: 11, goLiveDate: '2026-10-01', students: [student] });
    });
    expect(screen.queryByRole('form', { name: '歷史交易更正' })).toBeNull();
    expect(screen.getByLabelText('搜尋目前學生帳戶')).toHaveValue('');
    expect(screen.queryByRole('button', { name: '林小明（001）' })).toBeNull();
    expect(screen.queryByText('目前帳戶餘額')).toBeNull();
    expect(screen.queryByText('late private draft')).toBeNull();
    view.unmount();
  });

  it('clears sensitive account UI when bootstrap is unauthorized', async () => {
    const navigation = vi.fn();
    const view = render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4"
      initialStudentId={studentId} initialRange={range} onNavigationStateChange={navigation} />);
    await screen.findByTestId('account-history-ready');
    fireEvent.click(screen.getByRole('button', { name: '更正' }));
    fireEvent.change(screen.getByLabelText('更正理由'), { target: { value: 'bootstrap private draft' } });
    fireEvent.change(screen.getByLabelText('搜尋目前學生帳戶'), { target: { value: '林小明' } });

    mocks.readSummary.mockRejectedValueOnce(Object.assign(new Error('lease lost'), { code: 'LEASE_LOST' }));
    view.rerender(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-b:4"
      initialStudentId={studentId} initialRange={range} onNavigationStateChange={navigation} />);
    await screen.findByRole('alert');

    expect(navigation).toHaveBeenLastCalledWith('operator-b:4', 'revoked');
    expect(screen.queryByRole('form', { name: '歷史交易更正' })).toBeNull();
    expect(screen.getByLabelText('搜尋目前學生帳戶')).toHaveValue('');
    expect(screen.queryByText('林小明')).toBeNull();
    expect(screen.queryByText('bootstrap private draft')).toBeNull();
  });

  it('clears the entire correction form and candidate list when a mutation is denied', async () => {
    const navigation = vi.fn();
    mocks.mutateTransaction.mockResolvedValueOnce({ ok: false, error: { code: 'UNAUTHORIZED', message: 'lease lost' } });
    render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4"
      initialStudentId={studentId} initialRange={range} onNavigationStateChange={navigation} />);
    await screen.findByTestId('account-history-ready');
    fireEvent.click(screen.getByRole('button', { name: '更正' }));
    fireEvent.change(screen.getByLabelText('更正餐費'), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText('更正理由'), { target: { value: 'mutation private draft' } });
    fireEvent.change(screen.getByLabelText('搜尋目前學生帳戶'), { target: { value: '林小明' } });
    fireEvent.click(screen.getByRole('button', { name: '確認送出' }));

    await waitFor(() => expect(navigation).toHaveBeenLastCalledWith('operator-a:4', 'revoked'));
    expect(screen.queryByRole('form', { name: '歷史交易更正' })).toBeNull();
    expect(screen.getByLabelText('搜尋目前學生帳戶')).toHaveValue('');
    expect(screen.queryByRole('button', { name: '林小明（001）' })).toBeNull();
    expect(screen.queryByText('mutation private draft')).toBeNull();
    expect(screen.queryByText('目前帳戶餘額')).toBeNull();
  });

  it('keeps only non-renderable recovery identity after recovery is denied', async () => {
    const navigation = vi.fn();
    mocks.mutateTransaction.mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
    mocks.confirmPendingIntent.mockRejectedValueOnce(Object.assign(new Error('unauthorized'), { code: 'UNAUTHORIZED' }));
    render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4"
      initialStudentId={studentId} initialRange={range} onNavigationStateChange={navigation} />);
    await screen.findByTestId('account-history-ready');
    fireEvent.click(screen.getByRole('button', { name: '更正' }));
    fireEvent.change(screen.getByLabelText('更正理由'), { target: { value: 'recovery private draft' } });
    fireEvent.click(screen.getByRole('button', { name: '確認送出' }));
    await screen.findByRole('region', { name: '歷史更正命令恢復' });
    fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));

    await waitFor(() => expect(navigation).toHaveBeenLastCalledWith('operator-a:4', 'revoked'));
    expect(screen.queryByRole('region', { name: '歷史更正命令恢復' })).toBeNull();
    expect(screen.queryByRole('form', { name: '歷史交易更正' })).toBeNull();
    expect(screen.queryByText('22222222-2222-4222-8222-222222222222')).toBeNull();
    expect(screen.queryByText('recovery private draft')).toBeNull();
    expect(screen.getByLabelText('搜尋目前學生帳戶')).toHaveValue('');
  });

  it('resolves a confirmed minimal recovery without a selected account and allows a fresh account query', async () => {
    mocks.mutateTransaction.mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
    const identityKey = 'operator-a:4:minimal-recovery-no-account';
    const firstView = render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey={identityKey}
      initialStudentId={studentId} initialRange={range} />);
    await screen.findByTestId('account-history-ready');
    fireEvent.click(screen.getByRole('button', { name: '更正' }));
    fireEvent.change(screen.getByLabelText('更正理由'), { target: { value: 'pending correction' } });
    fireEvent.click(screen.getByRole('button', { name: '確認送出' }));
    await screen.findByRole('region', { name: '歷史更正命令恢復' });
    const input = mocks.mutateTransaction.mock.calls[0][0];
    firstView.unmount();

    mocks.readAccountHistory.mockImplementation(async request => ({ ...account, range: request.range, scope: { studentId: request.studentId } }));
    mocks.readReport.mockImplementation(async request => ({ ...report, range: request.range, scope: { studentId: request.studentId } }));
    mocks.readAuditRange.mockImplementation(async request => ({ ...audit, range: request.range, scope: { studentId: request.studentId } }));
    const navigation = vi.fn();
    render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey={identityKey} onNavigationStateChange={navigation} />);
    await screen.findByText('請搜尋並選取目前學生名單中的帳戶。');
    mocks.confirmPendingIntent.mockResolvedValueOnce({ status: 'matched', receipt: { commandId: input.commandId, kind: 'CorrectTransaction', seq: 12 } });
    fireEvent.click(screen.getByRole('button', { name: '查詢原命令收據' }));
    await screen.findByText('原命令收據已確認；依目前完整資料重新讀取帳戶歷史。');

    const search = screen.getByLabelText('搜尋目前學生帳戶');
    await waitFor(() => expect(search).toBeEnabled());
    expect(screen.getByLabelText('查帳日期範圍')).toBeEnabled();
    expect(screen.getByRole('button', { name: '查詢完整歷史' })).toBeEnabled();
    expect(navigation).toHaveBeenLastCalledWith(identityKey, 'resolved');
    expect(mocks.cleanupConfirmedIntent).toHaveBeenCalledTimes(1);
    expect(mocks.cleanupConfirmedIntent).toHaveBeenCalledWith(
      expect.objectContaining({ commandId: input.commandId }), 'dataset-a', 'uid-a', expect.any(Function),
    );
    expect(mocks.confirmPendingIntent).toHaveBeenCalledWith(expect.objectContaining({ commandId: input.commandId }), 'dataset-a', 'uid-a');
    expect(mocks.mutateTransaction).toHaveBeenCalledTimes(1);

    fireEvent.change(search, { target: { value: '001' } });
    fireEvent.click(await screen.findByRole('button', { name: '林小明（001）' }));
    await screen.findByTestId('account-history-ready');
    expect(mocks.readAccountHistory).toHaveBeenCalledWith(expect.objectContaining({ studentId, range, leaseEpoch: 4 }));
    expect(mocks.mutateTransaction).toHaveBeenCalledTimes(1);
  });

  it('keeps an unconfirmed minimal correction identity available for the same receipt lookup', async () => {
    mocks.mutateTransaction.mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
    const identityKey = 'operator-a:4:minimal-recovery-no-receipt';
    const firstView = render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey={identityKey}
      initialStudentId={studentId} initialRange={range} />);
    await screen.findByTestId('account-history-ready');
    fireEvent.click(screen.getByRole('button', { name: '更正' }));
    fireEvent.change(screen.getByLabelText('更正理由'), { target: { value: 'pending correction' } });
    fireEvent.click(screen.getByRole('button', { name: '確認送出' }));
    await screen.findByRole('region', { name: '歷史更正命令恢復' });
    const input = mocks.mutateTransaction.mock.calls[0][0];
    firstView.unmount();

    render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey={identityKey} />);
    await screen.findByText('請搜尋並選取目前學生名單中的帳戶。');
    mocks.confirmPendingIntent.mockRejectedValueOnce(new Error('temporary receipt read failure'));
    fireEvent.click(screen.getByRole('button', { name: '查詢原命令收據' }));
    await screen.findByText('目前無法安全確認原命令；查詢錯誤不代表命令不存在，暫不可重試。');
    expect(screen.getByRole('button', { name: '查詢原命令收據' })).toBeEnabled();
    expect(mocks.confirmPendingIntent).toHaveBeenLastCalledWith(expect.objectContaining({ commandId: input.commandId }), 'dataset-a', 'uid-a');

    mocks.confirmPendingIntent.mockResolvedValueOnce({ status: 'not-found' });
    fireEvent.click(screen.getByRole('button', { name: '查詢原命令收據' }));
    await screen.findByText('伺服器查無原命令收據；原更正內容未保留，請依目前完整資料重新確認。');
    expect(screen.getByRole('button', { name: '查詢原命令收據' })).toBeEnabled();
    expect(mocks.confirmPendingIntent).toHaveBeenNthCalledWith(2, expect.objectContaining({ commandId: input.commandId }), 'dataset-a', 'uid-a');

    mocks.confirmPendingIntent.mockResolvedValueOnce({ status: 'matched', receipt: { commandId: input.commandId, kind: 'CorrectTransaction', seq: 12 } });
    fireEvent.click(screen.getByRole('button', { name: '查詢原命令收據' }));
    await screen.findByText('原命令收據已確認；依目前完整資料重新讀取帳戶歷史。');
    expect(mocks.confirmPendingIntent).toHaveBeenNthCalledWith(3, expect.objectContaining({ commandId: input.commandId }), 'dataset-a', 'uid-a');
    expect(mocks.mutateTransaction).toHaveBeenCalledTimes(1);
  });

  describe('same-page command recovery (P13b2b3c)', () => {
    type Outcome = { ok: boolean; receipt?: { commandId: string; kind: string; seq: number }; error?: { code: string; message: string } };
    const flush = () => act(async () => { for (let index = 0; index < 20; index += 1) await Promise.resolve(); });
    const advancePrompt = () => act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    const receiptFor = (commandId: string) => ({ commandId, kind: 'CorrectTransaction', seq: 12 });

    afterEach(() => { vi.useRealTimers(); });

    async function startPending(onNavigationStateChange?: (identityKey: string, state: string) => void) {
      const original = deferred<Outcome>();
      mocks.mutateTransaction.mockReturnValueOnce(original.promise);
      render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4:pending"
        initialStudentId={studentId} initialRange={range} onNavigationStateChange={onNavigationStateChange} />);
      await screen.findByTestId('account-history-ready');
      fireEvent.click(screen.getByRole('button', { name: '更正' }));
      fireEvent.change(screen.getByLabelText('更正理由'), { target: { value: '同頁復原' } });
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      fireEvent.click(screen.getByRole('button', { name: '確認送出' }));
      await flush();
      const input = mocks.mutateTransaction.mock.calls[0][0];
      return { original, input };
    }

    it('creates the order repository with the registered Lite recovery reader', async () => {
      render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4:reader-option"
        initialStudentId={studentId} initialRange={range} />);
      await screen.findByTestId('account-history-ready');
      expect(mocks.repositoryOptions).toHaveBeenCalledWith(expect.objectContaining({
        recoveryReader: expect.objectContaining({ assertCurrent: expect.any(Function) }),
      }));
    });

    it('clears the screen and sends nothing when the authenticated uid is unavailable', async () => {
      const navigation = vi.fn();
      render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4:no-uid"
        initialStudentId={studentId} initialRange={range} onNavigationStateChange={navigation} />);
      await screen.findByTestId('account-history-ready');
      fireEvent.click(screen.getByRole('button', { name: '更正' }));
      fireEvent.change(screen.getByLabelText('更正理由'), { target: { value: 'no uid' } });
      currentAuth.uid = null;
      fireEvent.click(screen.getByRole('button', { name: '確認送出' }));
      await waitFor(() => expect(navigation).toHaveBeenLastCalledWith('operator-a:4:no-uid', 'revoked'));
      expect(mocks.mutateTransaction).not.toHaveBeenCalled();
      expect(screen.queryByTestId('account-history-ready')).toBeNull();
    });

    it('shows the ten-second prompt with the original ID and lets a read-only query run while the original is in flight', async () => {
      const { original, input } = await startPending();
      expect(screen.queryByRole('button', { name: '查詢原命令結果' })).toBeNull();
      expect(screen.getByRole('region', { name: '歷史更正命令恢復' })).toHaveTextContent('命令送出中，請勿重複操作。');

      await advancePrompt();
      const region = screen.getByRole('region', { name: '歷史更正命令恢復' });
      expect(region).toHaveTextContent('結果確認中，勿重新收款');
      expect(region).toHaveTextContent(input.commandId);

      fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
      await flush();
      expect(mocks.confirmPendingIntent).toHaveBeenCalledTimes(1);
      expect(mocks.confirmPendingIntent).toHaveBeenCalledWith(
        expect.objectContaining({ commandId: input.commandId }), 'dataset-a', 'uid-a',
      );
      expect(screen.getByRole('region', { name: '歷史更正命令恢復' })).toHaveTextContent('原命令仍在送出中');
      expect(screen.queryByRole('button', { name: '以相同命令編號重試' })).toBeNull();
      expect(mocks.mutateTransaction).toHaveBeenCalledTimes(1);

      // Nothing was confirmed early: the original, once it lands, completes the correction and reloads once.
      const readsBefore = mocks.readAccountHistory.mock.calls.length;
      await act(async () => { original.resolve({ ok: true, receipt: receiptFor(input.commandId) }); });
      await flush();
      expect(mocks.readAccountHistory).toHaveBeenCalledTimes(readsBefore + 1);
      expect(mocks.cleanupConfirmedIntent).toHaveBeenCalledTimes(1);
      expect(mocks.mutateTransaction).toHaveBeenCalledTimes(1);
    });

    it('a query-confirmed receipt cleans the journal once, keeps the page locked until the fresh read, and ignores the late original', async () => {
      const navigation = vi.fn();
      const { original, input } = await startPending(navigation);
      await advancePrompt();
      const reload = deferred<CloudAccountHistory>();
      mocks.readAccountHistory.mockReturnValueOnce(reload.promise);
      mocks.confirmPendingIntent.mockResolvedValueOnce({ status: 'matched', receipt: receiptFor(input.commandId) });
      fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
      await flush();

      expect(mocks.cleanupConfirmedIntent).toHaveBeenCalledTimes(1);
      expect(mocks.cleanupConfirmedIntent).toHaveBeenCalledWith(
        expect.objectContaining({ commandId: input.commandId }), 'dataset-a', 'uid-a', expect.any(Function),
      );
      expect(screen.queryByRole('region', { name: '歷史更正命令恢復' })).toBeNull();
      expect(screen.getByLabelText('搜尋目前學生帳戶')).toBeDisabled();
      expect(screen.queryByRole('button', { name: '更正' })).toBeNull();
      expect(navigation).toHaveBeenLastCalledWith('operator-a:4:pending', 'recovering');

      await act(async () => { reload.resolve({ ...account, sourceSeq: 11 }); });
      await flush();
      expect(navigation).toHaveBeenLastCalledWith('operator-a:4:pending', 'resolved');
      expect(screen.getByLabelText('搜尋目前學生帳戶')).toBeEnabled();

      const readsAfterConfirm = mocks.readAccountHistory.mock.calls.length;
      await act(async () => { original.resolve({ ok: true, receipt: receiptFor(input.commandId) }); });
      await flush();
      expect(mocks.readAccountHistory).toHaveBeenCalledTimes(readsAfterConfirm);
      expect(mocks.cleanupConfirmedIntent).toHaveBeenCalledTimes(1);
      expect(mocks.mutateTransaction).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('region', { name: '歷史更正命令恢復' })).toBeNull();
    });

    it('a late failure of the original submission never overrides a query-confirmed receipt', async () => {
      const { original, input } = await startPending();
      await advancePrompt();
      mocks.confirmPendingIntent.mockResolvedValueOnce({ status: 'matched', receipt: receiptFor(input.commandId) });
      fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
      await flush();
      await act(async () => { original.resolve({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'late unknown' } }); });
      await flush();
      expect(screen.queryByRole('region', { name: '歷史更正命令恢復' })).toBeNull();
      expect(screen.queryByText(/更正結果待確認|late unknown/)).toBeNull();
      expect(mocks.mutateTransaction).toHaveBeenCalledTimes(1);
    });

    it('does not authorize a retry when the original settled while the query was running', async () => {
      const { original } = await startPending();
      await advancePrompt();
      const query = deferred<{ status: 'not-found' }>();
      mocks.confirmPendingIntent.mockReturnValueOnce(query.promise);
      fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
      await flush();
      await act(async () => { original.resolve({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } }); });
      await flush();
      await act(async () => { query.resolve({ status: 'not-found' }); });
      await flush();
      expect(screen.queryByRole('button', { name: '以相同命令編號重試' })).toBeNull();
      expect(screen.getByRole('region', { name: '歷史更正命令恢復' })).toHaveTextContent('不能授權重試');
      expect(mocks.mutateTransaction).toHaveBeenCalledTimes(1);

      mocks.confirmPendingIntent.mockResolvedValueOnce({ status: 'not-found' });
      fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
      await flush();
      expect(screen.getByRole('button', { name: '以相同命令編號重試' })).toBeEnabled();
    });

    it('never unlocks a retry after a different dataset, a failed read or maintenance', async () => {
      mocks.mutateTransaction.mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
      render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4:no-unlock"
        initialStudentId={studentId} initialRange={range} />);
      await screen.findByTestId('account-history-ready');
      fireEvent.click(screen.getByRole('button', { name: '更正' }));
      fireEvent.change(screen.getByLabelText('更正理由'), { target: { value: 'no unlock' } });
      fireEvent.click(screen.getByRole('button', { name: '確認送出' }));
      await screen.findByRole('region', { name: '歷史更正命令恢復' });

      mocks.confirmPendingIntent.mockResolvedValueOnce({ status: 'different-dataset' });
      fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
      await screen.findByText(/資料集已變更/);
      expect(screen.queryByRole('button', { name: '以相同命令編號重試' })).toBeNull();

      mocks.confirmPendingIntent.mockRejectedValueOnce(Object.assign(new Error('maintenance'), { code: 'MAINTENANCE' }));
      fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
      await screen.findByText(/系統維護中/);
      expect(screen.queryByRole('button', { name: '以相同命令編號重試' })).toBeNull();

      mocks.confirmPendingIntent.mockRejectedValueOnce(new Error('read failed'));
      fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
      await screen.findByText(/目前無法安全確認原命令/);
      expect(screen.queryByRole('button', { name: '以相同命令編號重試' })).toBeNull();
      expect(mocks.mutateTransaction).toHaveBeenCalledTimes(1);
    });

    it('still reloads and reports the leftover when the local journal cleanup fails after a confirmed receipt', async () => {
      mocks.mutateTransaction.mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
      render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4:cleanup-failure"
        initialStudentId={studentId} initialRange={range} />);
      await screen.findByTestId('account-history-ready');
      fireEvent.click(screen.getByRole('button', { name: '更正' }));
      fireEvent.change(screen.getByLabelText('更正理由'), { target: { value: 'cleanup failure' } });
      fireEvent.click(screen.getByRole('button', { name: '確認送出' }));
      await screen.findByRole('region', { name: '歷史更正命令恢復' });
      const input = mocks.mutateTransaction.mock.calls[0][0];
      const readsBefore = mocks.readAccountHistory.mock.calls.length;
      mocks.confirmPendingIntent.mockResolvedValueOnce({ status: 'matched', receipt: receiptFor(input.commandId) });
      mocks.cleanupConfirmedIntent.mockRejectedValueOnce(new Error('journal busy'));
      fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
      await screen.findByText(/本機命令追蹤清理未完成/);
      await waitFor(() => expect(mocks.readAccountHistory).toHaveBeenCalledTimes(readsBefore + 1));
      expect(screen.queryByRole('region', { name: '歷史更正命令恢復' })).toBeNull();
    });
  });
});
