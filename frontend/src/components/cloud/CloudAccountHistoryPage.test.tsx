import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudAccountHistory, CloudAuditRangeSnapshot, CloudReportDay } from '../../domain/cloudLedgerReport';

const currentAuth = vi.hoisted(() => ({ uid: 'uid-a' as string | null }));
const headMock = vi.hoisted(() => ({ current: null as { seq: number; lastCommandId: string; datasetId: string; targets: Record<string, unknown> } | null }));

vi.mock('../../providers/FirebaseProvider', () => ({ useDataHead: () => headMock.current }));

const mocks = vi.hoisted(() => ({
  repositoryOptions: vi.fn(),
  readSummary: vi.fn(),
  readAccountHistory: vi.fn(),
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
const days = [{ businessDate: date, exists: true, status: 'open', revision: 3, openingCash: 100,
  totals: { activeTransactionCount: 1, bentoCount: 1, otherMealCount: 0, mealTotal: 55,
    retainedReceipts: 20, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0 },
  lastSettlementRevision: 0, backfillReason: '歷史回填', settlements: [], postCloseEntries: [], effectiveCash: null }] as unknown as CloudReportDay[];
const account = {
  datasetId: 'dataset-a', sourceSeq: 11, goLiveDate: '2026-10-01', leaseToday: '2026-10-19', leaseEpoch: 4,
  range, scope: { studentId }, complete: true, student: { studentId, studentCode: '001', displayName: '林小明', aliases: ['小明'] },
  studentStatus: 'active', studentRevision: 8,
  openingBalance: 1_000, currentBalance: 965, days, settlements: [], postCloseEntries: [], transactions: [transaction],
} as unknown as CloudAccountHistory;
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

function openTransactionMenu() {
  const summary = document.querySelector('details.cloud-account-history__more > summary');
  if (!summary) throw new Error('transaction menu summary is missing');
  fireEvent.click(summary);
}

describe('CloudAccountHistoryPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    currentAuth.uid = 'uid-a';
    mocks.readSummary.mockResolvedValue({ leaseToday: '2026-10-19' });
    mocks.listStudents.mockResolvedValue({ datasetId: 'dataset-a', seq: 11, goLiveDate: '2026-10-01', students: [student] });
    mocks.readAccountHistory.mockResolvedValue(account);
    mocks.readAuditRange.mockResolvedValue(audit);
    mocks.mutateTransaction.mockResolvedValue({ ok: true, receipt: { commandId: 'mutation-a', seq: 12, kind: 'CorrectTransaction' } });
    mocks.confirmPendingIntent.mockResolvedValue({ status: 'not-found' });
    mocks.cleanupConfirmedIntent.mockResolvedValue(true);
  });

  describe('操作人顯示（#668）：一般區塊不顯示原始 UID', () => {
    const self = { uid: 'uid-self', name: '測試操作員甲' };
    const withSettlementAndEntries = () => ({
      ...account,
      days: [{ ...days[0], status: 'closed', lastSettlementRevision: 1 }],
      settlements: [{
        businessDate: date, revision: 1, status: 'closed', totals: days[0].totals!, openingCash: 100,
        expectedCash: 100, countedCash: 100, difference: 0, note: '', actorUid: 'uid-settler',
        actorEmail: 'settler@example.test', sourceSeq: 11, committedAt: `${date}T04:00:00.000Z`, lastCommandId: 'settlement-a',
      }],
      postCloseEntries: [
        { entryId: 'entry-self', dayId: date, businessDate: date, settlementRevision: 1, direction: 'income', amount: 30,
          reason: '補收甲', createdBy: 'uid-self', createdAt: new Date(`${date}T05:00:00.000Z`), commandId: 'cmd-e1', countedInEffectiveCash: true },
        { entryId: 'entry-other', dayId: date, businessDate: date, settlementRevision: 1, direction: 'expense', amount: 10,
          reason: '補付乙', createdBy: 'uid-someone-else', createdAt: new Date(`${date}T06:00:00.000Z`), commandId: 'cmd-e2', countedInEffectiveCash: true },
      ],
    });

    it('日結版本列顯示 actorEmail，補記列依標籤規則顯示名稱，不出現 UID', async () => {
      mocks.readAccountHistory.mockResolvedValue(withSettlementAndEntries());
      render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="uid-self:4" operatorSelf={self} initialStudentId={studentId} initialRange={range} />);
      await screen.findByTestId('account-history-ready');

      const section = screen.getByRole('heading', { name: /日結版本/ }).closest('section') as HTMLElement;
      expect(within(section).getByText(/settler@example\.test/)).toBeInTheDocument();
      expect(within(section).getByText(/補收甲 · 測試操作員甲 ·/)).toBeInTheDocument();
      expect(within(section).getByText(/補付乙 · 其他操作員 ·/)).toBeInTheDocument();
      for (const uid of ['uid-settler', 'uid-self', 'uid-someone-else']) {
        expect(within(section).queryByText(new RegExp(uid))).not.toBeInTheDocument();
      }
    });

    it('帳戶範圍稽核表只顯示 email，不顯示 UID；資料詳情內容不變', async () => {
      render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="uid-self:4" operatorSelf={self} initialStudentId={studentId} initialRange={range} />);
      await screen.findByTestId('account-history-ready');

      const section = screen.getByRole('heading', { name: '帳戶範圍稽核' }).closest('section') as HTMLElement;
      const cells = within(within(section).getAllByRole('row')[1]).getAllByRole('cell');
      expect(cells[2]).toHaveTextContent('a@example.test');
      expect(cells[2]).not.toHaveTextContent('operator-a');
      // 資料詳情（交易與稽核詳情）是查帳資訊，本次不動：仍列出建立者 UID。
      expect(screen.getByText('建立者').nextElementSibling).toHaveTextContent('operator-a · a@example.test');
    });
  });

  it('shows no balance until account history and audit agree', async () => {
    mocks.readAuditRange.mockResolvedValueOnce({ ...audit, sourceSeq: 12 });
    render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4" initialStudentId={studentId} initialRange={range} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('查帳、日結與稽核資料對不上；未顯示部分資料');
    expect(screen.queryByText('目前帳戶餘額')).toBeNull();
    expect(screen.queryByRole('button', { name: '更正' })).toBeNull();
  });

  it('marks negative account balances as debt without warning-coloring a negative transaction amount', async () => {
    const negativeTransaction = { ...transaction, amount: -35, afterBalance: -40 };
    mocks.listStudents.mockResolvedValue({
      datasetId: 'dataset-a', seq: 11, goLiveDate: '2026-10-01',
      students: [{ ...student, openingBalance: { ...student.openingBalance, amount: -20 }, currentBalance: -40 }],
    });
    mocks.readAccountHistory.mockResolvedValue({
      ...account,
      openingBalance: -20,
      currentBalance: -40,
      transactions: [negativeTransaction],
      days: [{ ...days[0], status: 'reopened' }],
      settlements: [{
        businessDate: date, revision: 1, status: 'reopened', totals: days[0].totals!, openingCash: 100,
        expectedCash: 100, countedCash: null, difference: null, note: '', actorUid: 'operator-a',
        actorEmail: 'a@example.test', sourceSeq: 11, committedAt: `${date}T04:00:00.000Z`, lastCommandId: 'settlement-a',
      }],
    });
    render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4" initialStudentId={studentId} initialRange={range} />);

    await screen.findByTestId('account-history-ready');
    const balance = screen.getByText('目前帳戶餘額').nextElementSibling as HTMLElement;
    expect(balance).toHaveTextContent('−$40');
    expect(within(balance).getByText('欠款')).toHaveClass('badge-ui', 'badge-warn');
    const opening = screen.getByText('期初餘額').nextElementSibling as HTMLElement;
    expect(opening).toHaveTextContent('−$20');
    expect(within(opening).getByText('欠款')).toHaveClass('badge-ui', 'badge-warn');
    expect(screen.getByText('使用中')).toHaveClass('badge-ui', 'badge-ok');

    const transactionSection = screen.getByRole('heading', { name: '區間交易與更正入口' }).closest('section') as HTMLElement;
    const row = within(transactionSection).getAllByRole('row')[1];
    const cells = within(row).getAllByRole('cell');
    expect(cells[3]).toHaveTextContent('−$35');
    expect(cells[3].querySelector('.badge-warn')).toBeNull();
    expect(within(cells[4]).getByText('欠款')).toHaveClass('badge-ui', 'badge-warn');
    expect(within(cells[5]).getByText('有效')).toHaveClass('badge-ui', 'badge-ok');
    expect(within(cells[6]).getByText('已重開')).toHaveClass('badge-ui', 'badge-warn');
    const settlementSection = screen.getByRole('heading', { name: /日結版本/ }).closest('section') as HTMLElement;
    expect(within(settlementSection).getByText('已重開')).toHaveClass('badge-ui', 'badge-warn');
  });

  it('uses EmptyState for an unselected account and empty transaction, settlement, and audit ranges', async () => {
    const unselected = render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4" />);
    const chooseAccount = await screen.findByText('請搜尋並選取目前學生名單中的帳戶。');
    expect(chooseAccount.closest('.empty-title')).not.toBeNull();
    unselected.unmount();

    mocks.readAccountHistory.mockResolvedValue({ ...account, transactions: [], settlements: [] });
    mocks.readAuditRange.mockResolvedValue({ ...audit, rows: [] });
    render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4:empty" initialStudentId={studentId} initialRange={range} />);
    await screen.findByTestId('account-history-ready');
    expect(screen.getByText('此範圍沒有帳戶交易；歷史餘額已驗證。').closest('.empty-title')).not.toBeNull();
    expect(screen.getByText('此範圍沒有日結版本。').closest('.empty-title')).not.toBeNull();
    expect(screen.getByText('此範圍沒有帳戶稽核紀錄。').closest('.empty-title')).not.toBeNull();
  });

  it('submits a history correction using the exact transaction, student, and open-day revisions', async () => {
    render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4" initialStudentId={studentId} initialRange={range} />);
    await screen.findByTestId('account-history-ready');
    expect(screen.getByText('依目前更正後資料重算')).toBeVisible();
    const transactionSection = screen.getByRole('heading', { name: '區間交易與更正入口' }).closest('section') as HTMLElement;
    const transactionRow = within(transactionSection).getAllByRole('row')[1];
    const statusCell = within(transactionRow).getAllByRole('cell')[5];
    expect(within(statusCell).getByText('有效')).toHaveClass('badge-ui', 'badge-ok');
    expect(within(statusCell).getByText('回填')).toHaveClass('badge-ui', 'badge-warn');
    openTransactionMenu();
      fireEvent.click(screen.getByRole('button', { name: '更正' }));
    expect(screen.getByRole('form', { name: '歷史交易更正' })).not.toHaveTextContent(/固定交易版本|學生版本|日期版本/);
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

  it('reads the account, its range days and the audit only: no second report and no roster per query (P16f2 S11)', async () => {
    render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4" initialStudentId={studentId} initialRange={range} />);
    await screen.findByTestId('account-history-ready');
    expect(mocks.listStudents).toHaveBeenCalledTimes(1);
    expect(mocks.readAccountHistory).toHaveBeenCalledTimes(1);
    expect(mocks.readAuditRange).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '查詢完整歷史' }));
    await waitFor(() => expect(mocks.readAccountHistory).toHaveBeenCalledTimes(2));
    await screen.findByTestId('account-history-ready');
    expect(mocks.listStudents).toHaveBeenCalledTimes(1);
  });

  // #600 (CheerC 2026-11-03): the P13d2 paper number is removed; a former `紙本X：` prefix is ordinary note text.
  describe('former paper-number notes (#600)', () => {
    const numbered = { ...transaction, note: '紙本A-0123：前天補登' };
    const useNumbered = () => {
      mocks.readAccountHistory.mockResolvedValue({ ...account, transactions: [numbered] });
    };

    it('shows the whole note, prefix included, as the remark in the transaction details', async () => {
      useNumbered();
      render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4" initialStudentId={studentId} initialRange={range} />);
      await screen.findByTestId('account-history-ready');
      expect(screen.queryByTestId('history-paper-ref')).toBeNull();
      expect(screen.getByText('交易備註').nextElementSibling).toHaveTextContent(/^紙本A-0123：前天補登$/);
    });

    it('corrects from the whole note: the former prefix can be removed and the new note is sent as typed', async () => {
      useNumbered();
      render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4" initialStudentId={studentId} initialRange={range} />);
      await screen.findByTestId('account-history-ready');
      openTransactionMenu();
      fireEvent.click(screen.getByRole('button', { name: '更正' }));
      expect(screen.queryByTestId('correction-paper-ref')).toBeNull();
      expect(screen.getByLabelText('交易備註')).toHaveValue('紙本A-0123：前天補登');
      fireEvent.change(screen.getByLabelText('交易備註'), { target: { value: '前天補登（更正金額）' } });
      fireEvent.change(screen.getByLabelText('更正餐費'), { target: { value: '60' } });
      fireEvent.change(screen.getByLabelText('更正理由'), { target: { value: '餐費輸入錯誤' } });
      fireEvent.click(screen.getByRole('button', { name: '確認送出' }));
      await waitFor(() => expect(mocks.mutateTransaction).toHaveBeenCalledTimes(1));
      expect(mocks.mutateTransaction).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'CorrectTransaction',
        payload: { mealPrice: 60, paidAmount: 20, amount: -40, note: '前天補登（更正金額）', reason: '餐費輸入錯誤' },
      }));
    });
  });

  it('keeps closed historical transactions read-only and directs cash differences to day close', async () => {
    mocks.readAccountHistory.mockResolvedValueOnce({ ...account, days: [{ ...days[0], status: 'reopened', lastSettlementRevision: 2 }] });
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
    mocks.readAccountHistory.mockResolvedValue({ ...account, range: todayRange, transactions: [todayTransaction],
      days: [{ ...days[0], businessDate: today, status: 'open', lastSettlementRevision: 0 }] });
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
    openTransactionMenu();
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
    openTransactionMenu();
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
    openTransactionMenu();
      fireEvent.click(screen.getByRole('button', { name: '更正' }));
    fireEvent.change(screen.getByLabelText('更正理由'), { target: { value: 'late private draft' } });
    fireEvent.change(screen.getByLabelText('搜尋目前學生帳戶'), { target: { value: '小明' } });

    const lateAudit = deferred<CloudAuditRangeSnapshot>();
    mocks.readAccountHistory.mockRejectedValueOnce(Object.assign(new Error('unauthorized'), { code: 'UNAUTHORIZED' }));
    mocks.readAuditRange.mockReturnValueOnce(lateAudit.promise);
    fireEvent.click(screen.getByRole('button', { name: '查詢完整歷史' }));
    await screen.findByRole('alert');
    expect(navigation).toHaveBeenLastCalledWith('operator-a:4', 'revoked');

    await act(async () => {
      lateAudit.resolve(audit);
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
    openTransactionMenu();
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
    openTransactionMenu();
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
    openTransactionMenu();
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
    openTransactionMenu();
      fireEvent.click(screen.getByRole('button', { name: '更正' }));
    fireEvent.change(screen.getByLabelText('更正理由'), { target: { value: 'pending correction' } });
    fireEvent.click(screen.getByRole('button', { name: '確認送出' }));
    await screen.findByRole('region', { name: '歷史更正命令恢復' });
    const input = mocks.mutateTransaction.mock.calls[0][0];
    firstView.unmount();

    mocks.readAccountHistory.mockImplementation(async request => ({ ...account, range: request.range, scope: { studentId: request.studentId } }));
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
    openTransactionMenu();
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
      openTransactionMenu();
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
      openTransactionMenu();
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
      // Before ten seconds only the progress bar says "sending" (#585): no recovery region, no sending text.
      expect(screen.queryByRole('region', { name: '歷史更正命令恢復' })).toBeNull();
      expect(screen.queryByText(/命令送出中|正在送出固定版本的歷史更正/)).toBeNull();
      expect(screen.getByTestId('command-progress')).toHaveAttribute('data-active', 'true');

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
      openTransactionMenu();
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
      openTransactionMenu();
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

describe('CloudAccountHistoryPage: #587 P2 data updated elsewhere', () => {
  const head = (seq: number) => ({ seq, lastCommandId: `cmd-${seq}`, datasetId: 'dataset-a', targets: {} });

  beforeEach(() => {
    vi.resetAllMocks();
    currentAuth.uid = 'uid-a';
    headMock.current = null;
    mocks.readSummary.mockResolvedValue({ leaseToday: '2026-10-19' });
    mocks.listStudents.mockResolvedValue({ datasetId: 'dataset-a', seq: 11, goLiveDate: '2026-10-01', students: [student] });
    mocks.readAccountHistory.mockResolvedValue(account);
    mocks.readAuditRange.mockResolvedValue(audit);
    mocks.confirmPendingIntent.mockResolvedValue({ status: 'not-found' });
    mocks.cleanupConfirmedIntent.mockResolvedValue(true);
  });

  it('shows the notice when the data head is ahead of the account history, and its button reads it again', async () => {
    headMock.current = head(12);
    render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4:p587-notice" initialStudentId={studentId} initialRange={range} />);
    const notice = await screen.findByTestId('data-updated-notice');
    expect(notice).toHaveTextContent('其他裝置已更新資料。');
    expect(mocks.readAccountHistory).toHaveBeenCalledTimes(1);
    mocks.readAccountHistory.mockResolvedValue({ ...account, sourceSeq: 12 } as unknown as CloudAccountHistory);
    mocks.readAuditRange.mockResolvedValue({ ...audit, sourceSeq: 12 } as unknown as CloudAuditRangeSnapshot);
    fireEvent.click(within(notice).getByRole('button', { name: '重新載入' }));
    await waitFor(() => expect(mocks.readAccountHistory).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('account-history-ready')).toHaveAttribute('data-source-seq', '12'));
    expect(screen.queryByTestId('data-updated-notice')).toBeNull();
  });

  it('shows nothing when the history is at the head, or there is no head', async () => {
    headMock.current = head(11);
    render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4:p587-at-head" initialStudentId={studentId} initialRange={range} />);
    await screen.findByTestId('account-history-ready');
    expect(screen.queryByTestId('data-updated-notice')).toBeNull();
  });
});

describe('CloudAccountHistoryPage: #648 P8 統一風格', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    currentAuth.uid = 'uid-a';
    headMock.current = null;
    mocks.readSummary.mockResolvedValue({ leaseToday: '2026-10-19' });
    mocks.listStudents.mockResolvedValue({ datasetId: 'dataset-a', seq: 11, goLiveDate: '2026-10-01', students: [student] });
    mocks.readAccountHistory.mockResolvedValue(account);
    mocks.readAuditRange.mockResolvedValue(audit);
    mocks.confirmPendingIntent.mockResolvedValue({ status: 'not-found' });
    mocks.cleanupConfirmedIntent.mockResolvedValue(true);
  });

  const renderReady = async (key: string) => {
    const view = render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey={key} initialStudentId={studentId} initialRange={range} />);
    await screen.findByTestId('account-history-ready');
    return view;
  };

  it('turns the source/balance intro into a HelpTip and keeps one short always-visible balance sentence', async () => {
    const { container } = await renderReady('operator-a:4:p8-intro');
    expect(container.querySelector('details.cloud-account-history__intro')).toBeNull();
    const tip = screen.getByRole('button', { name: '資料來源與餘額說明' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(tip);
    expect(screen.getByRole('tooltip')).toHaveTextContent('使用目前學生名單映射帳戶 ID');
    fireEvent.click(tip);
    const visible = screen.getByText(/不是交易當時餘額/);
    expect(visible.closest('.callout-ui')).not.toBeNull();
    expect(visible).toBeVisible();
  });

  it('shows no engineering terms on screen but keeps the data version in data attributes', async () => {
    const { container } = await renderReady('operator-a:4:p8-terms');
    expect(container).not.toHaveTextContent(/H=\d|來源序號|dataset /);
    expect(container).not.toHaveTextContent(/學生版本/);
    const ready = screen.getByTestId('account-history-ready');
    expect(ready).toHaveAttribute('data-source-seq', '11');
    expect(ready).toHaveAttribute('data-dataset-id', 'dataset-a');
    const auditSection = screen.getByRole('heading', { name: '帳戶範圍稽核' }).closest('section') as HTMLElement;
    const headers = within(auditSection).getAllByRole('columnheader').map(th => th.textContent);
    expect(headers.join('|')).not.toMatch(/seq|before \/ after/);
  });

  it('right-aligns the amount and balance columns of the transaction table', async () => {
    await renderReady('operator-a:4:p8-num');
    const section = screen.getByRole('heading', { name: '區間交易與更正入口' }).closest('section') as HTMLElement;
    const heads = within(section).getAllByRole('columnheader');
    const numHeads = heads.filter(th => th.classList.contains('dt-num')).map(th => th.textContent);
    expect(numHeads).toEqual(['金額', '重算後餘額']);
    const cells = within(within(section).getAllByRole('row')[1]).getAllByRole('cell');
    expect(cells[3]).toHaveClass('dt-num');
    expect(cells[4]).toHaveClass('dt-num');
  });

  it('keeps the audit scope limit visible as a Callout and puts the date-basis note in a HelpTip', async () => {
    await renderReady('operator-a:4:p8-audit');
    const scope = screen.getByText(/本次稽核只涵蓋此帳戶與選定區間/);
    expect(scope.closest('.callout-ui')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '稽核日期歸屬說明' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('沒有營業日的操作依台北記錄日期列入');
  });

  it('keeps 查詢完整歷史 as a button and shows the closed-day restriction as a visible Callout in the correction form', async () => {
    await renderReady('operator-a:4:p8-form');
    expect(screen.getByRole('button', { name: '查詢完整歷史' })).toBeEnabled();
    openTransactionMenu();
    fireEvent.click(screen.getByRole('button', { name: '更正' }));
    const form = screen.getByRole('form', { name: '歷史交易更正' });
    expect(within(form).getByText(/此頁只允許仍未曾關帳的營業日/).closest('.callout-ui')).not.toBeNull();
  });
});

describe('CloudAccountHistoryPage: #682 提示與錯誤訊息不含工程用語', () => {
  // 來源序號、資料版本、學生／營業日／交易版本、revision(s)、payload、command、seq 不可出現在畫面提示。
  const ENGINEERING_TERMS = /來源序號|資料序號|資料版本|學生版本|營業日版本|交易版本|revisions?|payload|command(?!\s*編號)|\bseq\b/i;
  const flush = () => act(async () => { for (let index = 0; index < 20; index += 1) await Promise.resolve(); });

  beforeEach(() => {
    vi.resetAllMocks();
    currentAuth.uid = 'uid-a';
    headMock.current = null;
    mocks.readSummary.mockResolvedValue({ leaseToday: '2026-10-19' });
    mocks.listStudents.mockResolvedValue({ datasetId: 'dataset-a', seq: 11, goLiveDate: '2026-10-01', students: [student] });
    mocks.readAccountHistory.mockResolvedValue(account);
    mocks.readAuditRange.mockResolvedValue(audit);
    mocks.confirmPendingIntent.mockResolvedValue({ status: 'not-found' });
    mocks.cleanupConfirmedIntent.mockResolvedValue(true);
  });

  async function submitCorrection(key: string) {
    const view = render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey={key} initialStudentId={studentId} initialRange={range} />);
    await screen.findByTestId('account-history-ready');
    openTransactionMenu();
    fireEvent.click(screen.getByRole('button', { name: '更正' }));
    fireEvent.change(screen.getByLabelText('更正理由'), { target: { value: '文案檢查' } });
    fireEvent.click(screen.getByRole('button', { name: '確認送出' }));
    await flush();
    return view;
  }

  it('資料不一致時只說明對不上並未顯示部分資料，沒有工程用語', async () => {
    mocks.readAuditRange.mockResolvedValueOnce({ ...audit, sourceSeq: 12 });
    render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4:w1" initialStudentId={studentId} initialRange={range} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('查帳、日結與稽核資料對不上；未顯示部分資料，請重新讀取。');
    expect(alert.textContent).not.toMatch(ENGINEERING_TERMS);
    expect(screen.queryByTestId('account-history-ready')).toBeNull();
  });

  it('更正遇到資料衝突：說明資料已被其他操作更新並重新載入，仍不自動重送', async () => {
    mocks.mutateTransaction.mockResolvedValueOnce({ ok: false, error: { code: 'REVISION_CONFLICT', message: '資料已被其他操作更新' } });
    const reload = deferred<CloudAccountHistory>();
    const readsBefore = () => mocks.readAccountHistory.mock.calls.length;
    const view = render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4:w2" initialStudentId={studentId} initialRange={range} />);
    await screen.findByTestId('account-history-ready');
    openTransactionMenu();
    fireEvent.click(screen.getByRole('button', { name: '更正' }));
    fireEvent.change(screen.getByLabelText('更正理由'), { target: { value: '衝突' } });
    const before = readsBefore();
    mocks.readAccountHistory.mockReturnValueOnce(reload.promise);
    fireEvent.click(screen.getByRole('button', { name: '確認送出' }));
    await flush();

    expect(view.container).toHaveTextContent('資料已被其他操作更新，已重新載入完整歷史。請檢視新資料後重新開啟更正並確認，不會自動重送舊內容。');
    expect(view.container.textContent).not.toMatch(ENGINEERING_TERMS);
    expect(readsBefore()).toBeGreaterThan(before);
    expect(mocks.mutateTransaction).toHaveBeenCalledTimes(1);
    await act(async () => { reload.resolve(account); });
  });

  it('更正結果未知：保留原命令編號與更正內容、只提供唯讀查詢，沒有工程用語', async () => {
    mocks.mutateTransaction.mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
    await submitCorrection('operator-a:4:w3');
    // 資料詳情區的命令編號值（例如 create-command）屬排除項，只檢查恢復提示區。
    const recovery = screen.getByRole('region', { name: '歷史更正命令恢復' });
    expect(recovery).toHaveTextContent('更正結果還不確定；已保留原命令編號與更正內容。請先查詢原命令結果；查詢失敗或查無結果都不會自動重送。');
    expect(recovery.textContent).not.toMatch(ENGINEERING_TERMS);
    expect(screen.getByRole('button', { name: '查詢原命令結果' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '以相同命令編號重試' })).toBeNull();
    expect(mocks.mutateTransaction).toHaveBeenCalledTimes(1);
  });

  it('更正收據確認後重新讀取期間：提示不含來源序號', async () => {
    const reload = deferred<CloudAccountHistory>();
    mocks.mutateTransaction.mockImplementationOnce(async (input: { commandId: string }) => ({ ok: true, receipt: { commandId: input.commandId, seq: 12, kind: 'CorrectTransaction' } }));
    const view = render(<CloudAccountHistoryPage db={{} as never} leaseEpoch={4} identityKey="operator-a:4:w4" initialStudentId={studentId} initialRange={range} />);
    await screen.findByTestId('account-history-ready');
    openTransactionMenu();
    fireEvent.click(screen.getByRole('button', { name: '更正' }));
    fireEvent.change(screen.getByLabelText('更正理由'), { target: { value: '收據' } });
    mocks.readAccountHistory.mockReturnValueOnce(reload.promise);
    fireEvent.click(screen.getByRole('button', { name: '確認送出' }));
    await flush();

    expect(view.container).toHaveTextContent('更正收據已確認；正在重新讀取最新完整歷史。');
    expect(view.container.textContent).not.toMatch(ENGINEERING_TERMS);
    await act(async () => { reload.resolve(account); });
  });
});
