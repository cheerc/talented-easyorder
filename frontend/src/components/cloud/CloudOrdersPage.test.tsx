import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { CloudStudentRecord } from '../../firebase/cloudStudentRepository';
import type { CloudDayRecord } from '../../firebase/cloudDayVendorRepository';
import type { CloudOrderSnapshot, CloudOrderTransactionRecord } from '../../firebase/cloudOrderRepository';
import type { CommandResult } from '../../domain/cloudCommands';
import { CloudOrdersPage } from './CloudOrdersPage';

const repositoryMock = vi.hoisted(() => ({
  loadSnapshot: vi.fn(),
  createOrder: vi.fn(),
  createPayment: vi.fn(),
  createCashMovement: vi.fn(),
  createRefund: vi.fn(),
  mutateTransaction: vi.fn(),
  readCommand: vi.fn(),
  getPendingRecoveryContext: vi.fn(),
  confirmPending: vi.fn(),
  getPendingRecoveryContextWithRecoveryReader: vi.fn(),
  confirmPendingWithRecoveryReader: vi.fn(),
}));

vi.mock('../../firebase/cloudOrderRepository', () => ({
  createCloudOrderRepository: () => repositoryMock,
}));

vi.mock('../../firebase/cloudRecoveryReader', () => ({
  getCloudRecoveryReader: () => ({ assertCurrent: vi.fn() }),
}));

const TODAY = '2026-10-16';
const LEGACY_PENDING_KEY = 'easyorder-cloud-pending-order';

function mockStudent(id: string, code: string, name: string, balance = 100, status: 'active' | 'inactive' = 'active'): CloudStudentRecord {
  return {
    studentId: id,
    studentCode: code,
    displayName: name,
    aliases: ['小名' + code],
    status,
    openingBalance: { amount: balance, asOfDate: '2026-10-01', note: '', createdAt: '2026-10-01T00:00:00.000Z' },
    currentBalance: balance,
    createdAt: '2026-10-01T00:00:00.000Z',
    revision: 3,
    lastCommandId: '00000000-0000-4000-8000-000000000001',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

function mockDay(options: { menu?: boolean; bento?: number; other?: number; status?: CloudDayRecord['status'] } = {}): CloudDayRecord {
  return {
    dayId: TODAY,
    status: options.status ?? 'open',
    revision: 5,
    menu: options.menu === false ? null : {
      businessDate: TODAY,
      vendorId: 'v1',
      vendorNameSnapshot: '阿榮',
      itemName: '排骨飯',
      price: 90,
      inheritedFromDate: null,
      revision: 2,
      updatedAt: '2026-10-16T00:00:00.000Z',
    },
    openingCash: 3000,
    openedBy: 'operator-1',
    openedAt: '2026-10-16T00:00:00.000Z',
    totals: {
      activeTransactionCount: (options.bento ?? 1) + (options.other ?? 1),
      bentoCount: options.bento ?? 1,
      otherMealCount: options.other ?? 1,
      mealTotal: 150,
      retainedReceipts: 100,
      cashierIncome: 0,
      cashierExpense: 0, accountRefunds: 0,
    },
    lastSettlementRevision: 0,
    lastCommandId: '00000000-0000-4000-8000-000000000002',
    updatedAt: '2026-10-16T00:00:00.000Z',
  };
}

function mockTx(txId: string, studentId: string, mealKind: 'bento' | 'other', mealPrice: number, paidAmount: number, otherItemName: string | null = null): CloudOrderTransactionRecord {
  return {
    transactionId: txId,
    studentId,
    businessDate: TODAY,
    type: 'order',
    mealKind,
    mealPrice,
    paidAmount,
    amount: paidAmount - mealPrice,
    studentNameSnapshot: '王小明',
    menuNameSnapshot: mealKind === 'bento' ? '排骨飯' : '',
    menuPriceSnapshot: mealKind === 'bento' ? mealPrice : 0,
    vendorIdSnapshot: mealKind === 'bento' ? 'v1' : '',
    vendorNameSnapshot: mealKind === 'bento' ? '阿榮' : '',
    otherItemName,
    status: 'active',
    revision: 1,
    createdAt: '2026-10-16T04:30:00.000Z',
    createdSeq: 1,
    operatorUid: 'op-1',
    operatorEmail: 'op@example.com',
    sourceDevice: 'pc',
    note: '',
    lastCommandId: '00000000-0000-4000-8000-000000000003',
    updatedAt: '2026-10-16T04:30:00.000Z',
  };
}

function snapshot(overrides: Partial<CloudOrderSnapshot> = {}): CloudOrderSnapshot {
  return {
    today: TODAY,
    businessDate: overrides.today ?? TODAY,
    backfill: null,
    backfillDays: [],
    backfillDaysError: null,
    goLiveDate: '2026-10-01',
    datasetId: 'ds-1',
    seq: 9,
    day: mockDay(),
    students: [
      mockStudent('s1', '001', '王小明', 100),
      mockStudent('s2', '002', '李小華', 50),
      mockStudent('s3', '003', '張小停', 0, 'inactive'),
    ],
    transactions: [
      mockTx('tx-1', 's1', 'bento', 90, 100),
      mockTx('tx-2', 's2', 'other', 60, 0, '炒麵'),
    ],
    ...overrides,
  };
}

function okResult(commandId: string, seq = 10): Extract<CommandResult, { ok: true }> {
  return {
    ok: true,
    receipt: {
      commandId,
      seq,
      committedAt: '2026-10-16T05:00:00.000Z',
      kind: 'CreateOrder',
      targets: { transactionId: 'tx-new', studentId: 's1', dayId: TODAY },
      result: {},
    },
  } as Extract<CommandResult, { ok: true }>;
}

function errorResult(code: string, message = 'synthetic'): CommandResult {
  return { ok: false, error: { code, message } } as CommandResult;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const onNavigationStateChange = vi.fn();

function renderComponent(identityKey = 'uid-1:1', initialBackfillDayId?: string) {
  return render(
    <CloudOrdersPage
      db={{} as Firestore}
      leaseEpoch={1}
      identityKey={identityKey}
      onNavigationStateChange={onNavigationStateChange}
      initialBackfillDayId={initialBackfillDayId}
    />,
  );
}

async function selectStudent(code: string) {
  const searchInput = await screen.findByLabelText('搜尋編號、姓名或別名');
  fireEvent.change(searchInput, { target: { value: code } });
  fireEvent.click(await screen.findByTestId(`search-result-${code}`));
  await screen.findByTestId('selected-student-card');
}

async function queryAndAuthorizeRetry() {
  fireEvent.click(screen.getByTestId('order-recovery-query'));
  await screen.findByTestId('order-recovery-retry');
  fireEvent.click(screen.getByTestId('order-recovery-retry'));
}

describe('CloudOrdersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    repositoryMock.loadSnapshot.mockResolvedValue(snapshot());
    repositoryMock.readCommand.mockResolvedValue(null);
    repositoryMock.getPendingRecoveryContext.mockResolvedValue({ uid: 'uid-1', datasetId: 'ds-1', leaseEpoch: 1, maintenance: false });
    repositoryMock.confirmPending.mockResolvedValue({ status: 'not-found' });
    repositoryMock.getPendingRecoveryContextWithRecoveryReader.mockImplementation((...args) => (
      repositoryMock.getPendingRecoveryContext(...args)
    ));
    repositoryMock.confirmPendingWithRecoveryReader.mockImplementation((...args) => (
      repositoryMock.confirmPending(...args)
    ));
    repositoryMock.createOrder.mockImplementation(async (input: { commandId: string }) => okResult(input.commandId));
    repositoryMock.createPayment.mockImplementation(async (input: { commandId: string }) => okResult(input.commandId, 12));
    repositoryMock.createCashMovement.mockImplementation(async (input: { commandId: string }) => okResult(input.commandId, 13));
    repositoryMock.createRefund.mockImplementation(async (input: { commandId: string }) => okResult(input.commandId, 15));
  });

  it('renders the two-row meal counters from the reconciled server day (U2a contract)', async () => {
    renderComponent();
    const bentoRow = await screen.findByTestId('cloud-topbar-bento');
    expect(bentoRow).toHaveTextContent('今日餐點（排骨飯）');
    expect(bentoRow).toHaveTextContent('1');
    expect(screen.getByTestId('cloud-topbar-other')).toHaveTextContent('其他餐點1');
  });

  it('uses the server business date from the snapshot, not the browser clock (B4)', async () => {
    repositoryMock.loadSnapshot.mockResolvedValue(snapshot({ today: '2031-01-02', day: { ...mockDay(), dayId: '2031-01-02' } }));
    renderComponent();
    expect(await screen.findByText('營業日：2031-01-02')).toBeVisible();
    await selectStudent('002');
    fireEvent.click(screen.getByRole('button', { name: '其他餐點' }));
    fireEvent.change(screen.getByLabelText(/餐點品名/), { target: { value: '水餃' } });
    fireEvent.change(screen.getByLabelText(/餐點單價/), { target: { value: '70' } });
    fireEvent.click(screen.getByTestId('submit-order-button'));
    fireEvent.click(await screen.findByTestId('confirm-duplicate-button'));
    await waitFor(() => expect(repositoryMock.createOrder).toHaveBeenCalledWith(expect.objectContaining({ dayId: '2031-01-02' })));
  });

  it('submits a bento order after duplicate confirmation with frozen IDs and server revisions', async () => {
    renderComponent();
    await selectStudent('001');
    fireEvent.change(screen.getByLabelText(/實收金額/), { target: { value: '90' } });
    fireEvent.click(screen.getByTestId('submit-order-button'));
    expect(await screen.findByText(/今天已訂 1 份餐點，確定要再加訂 1 份嗎？/)).toBeVisible();
    fireEvent.click(screen.getByTestId('confirm-duplicate-button'));

    await waitFor(() => expect(repositoryMock.createOrder).toHaveBeenCalledTimes(1));
    const input = repositoryMock.createOrder.mock.calls[0][0];
    expect(input).toMatchObject({
      studentId: 's1', dayId: TODAY, mealKind: 'bento', mealPrice: 90, paidAmount: 90,
      menuRevision: 2, otherItemName: null, expectedStudentRevision: 3, expectedDayRevision: 5, leaseEpoch: 1,
    });
    expect(input.commandId).toMatch(/^[0-9a-f-]{36}$/);
    expect(input.transactionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(input.transactionId).not.toBe(input.commandId);
    expect(await screen.findByText(/已確認 001 王小明 訂餐完成（命令序號 10）/)).toBeVisible();
    expect(repositoryMock.loadSnapshot).toHaveBeenCalledTimes(2);
    expect(window.localStorage.getItem(LEGACY_PENDING_KEY)).toBeNull();
  });

  it('keeps the same commandId and transactionId when the result is unknown and confirms with the same command (B1)', async () => {
    let attempt = 0;
    repositoryMock.createOrder.mockImplementation(async (input: { commandId: string }) => {
      attempt += 1;
      return attempt === 1 ? errorResult('UNKNOWN_RESULT') : okResult(input.commandId, 11);
    });
    renderComponent();
    await selectStudent('002');
    fireEvent.click(screen.getByRole('button', { name: '其他餐點' }));
    fireEvent.change(screen.getByLabelText(/餐點品名/), { target: { value: '炒麵' } });
    fireEvent.change(screen.getByLabelText(/餐點單價/), { target: { value: '60' } });
    fireEvent.click(screen.getByTestId('submit-order-button'));
    fireEvent.click(await screen.findByTestId('confirm-duplicate-button'));

    const panel = await screen.findByTestId('order-recovery-panel');
    expect(panel).toHaveTextContent('結果確認中，勿重新收款');
    expect(screen.getByTestId('submit-order-button')).toBeDisabled();
    const first = repositoryMock.createOrder.mock.calls[0][0];
    expect(window.localStorage.getItem(LEGACY_PENDING_KEY)).toBeNull();
    expect(onNavigationStateChange).toHaveBeenLastCalledWith('uid-1:1', 'recovering');

    await queryAndAuthorizeRetry();
    await waitFor(() => expect(repositoryMock.createOrder).toHaveBeenCalledTimes(2));
    const second = repositoryMock.createOrder.mock.calls[1][0];
    expect(second).toEqual(first);
    expect(await screen.findByText(/已確認 002 李小華 訂餐完成（命令序號 11）/)).toBeVisible();
    expect(window.localStorage.getItem(LEGACY_PENDING_KEY)).toBeNull();
  });

  it('waits ten seconds before receipt lookup and never resends while the first commit is pending', async () => {
    const original = deferred<CommandResult>();
    const receiptRead = deferred<{ status: 'not-found' }>();
    repositoryMock.createOrder.mockReturnValueOnce(original.promise);
    repositoryMock.confirmPending.mockReturnValueOnce(receiptRead.promise);
    renderComponent();
    await selectStudent('002');
    fireEvent.click(screen.getByRole('button', { name: '其他餐點' }));
    fireEvent.change(screen.getByLabelText(/餐點品名/), { target: { value: '炒麵' } });
    fireEvent.change(screen.getByLabelText(/餐點單價/), { target: { value: '60' } });

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByTestId('submit-order-button'));
      fireEvent.click(screen.getByTestId('confirm-duplicate-button'));
      expect(repositoryMock.createOrder).toHaveBeenCalledTimes(1);
      const first = repositoryMock.createOrder.mock.calls[0][0];

      await act(async () => { await vi.advanceTimersByTimeAsync(9_999); });
      expect(screen.queryByText('結果確認中，勿重新收款。')).toBeNull();
      expect(repositoryMock.confirmPending).not.toHaveBeenCalled();
      expect(screen.getByTestId('submit-order-button')).toBeDisabled();

      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      vi.useRealTimers();
      expect(await screen.findByText('結果確認中，勿重新收款。')).toBeVisible();
      expect(screen.getByTestId('order-recovery-command-id')).toHaveTextContent(first.commandId);
      fireEvent.click(screen.getByTestId('order-recovery-query'));
      await waitFor(() => expect(repositoryMock.confirmPending).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId('order-recovery-query')).toBeDisabled();
      fireEvent.click(screen.getByTestId('order-recovery-query'));
      expect(repositoryMock.confirmPending).toHaveBeenCalledTimes(1);
      expect(repositoryMock.getPendingRecoveryContext).toHaveBeenCalledWith(1);
      expect(repositoryMock.confirmPending).toHaveBeenCalledWith(
        { commandId: first.commandId, datasetId: 'ds-1', uid: 'uid-1' }, 1,
      );
      expect(repositoryMock.createOrder).toHaveBeenCalledTimes(1);
      await act(async () => { original.resolve(errorResult('UNKNOWN_RESULT')); });
      await waitFor(() => expect(screen.getByTestId('order-recovery-panel')).toHaveTextContent('結果確認中，勿重新收款'));
      // The read started while the commit was pending; even a later null result cannot authorize a retry.
      await act(async () => { receiptRead.resolve({ status: 'not-found' }); await receiptRead.promise; });
      expect(screen.getByTestId('order-recovery-panel')).toHaveTextContent('伺服器目前未查到');
      expect(screen.queryByTestId('order-recovery-retry')).toBeNull();

      fireEvent.click(screen.getByTestId('order-recovery-query'));
      await waitFor(() => expect(screen.getByTestId('order-recovery-retry')).toBeVisible());
      fireEvent.click(screen.getByTestId('order-recovery-retry'));
      await waitFor(() => expect(repositoryMock.createOrder).toHaveBeenCalledTimes(2));
      expect(repositoryMock.createOrder.mock.calls[1][0]).toEqual(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it('converges a matched receipt while the original promise is pending and ignores its late success', async () => {
    const original = deferred<CommandResult>();
    const freshHeads = deferred<CloudOrderSnapshot>();
    repositoryMock.createOrder.mockReturnValueOnce(original.promise);
    repositoryMock.loadSnapshot
      .mockImplementationOnce(async () => snapshot())
      .mockImplementationOnce(() => freshHeads.promise);
    repositoryMock.confirmPending.mockImplementation(async (record: { commandId: string }) => ({
      status: 'matched', receipt: okResult(record.commandId, 31).receipt,
    }));
    renderComponent();
    await selectStudent('002');
    fireEvent.click(screen.getByRole('button', { name: '其他餐點' }));
    fireEvent.change(screen.getByLabelText(/餐點品名/), { target: { value: '炒麵' } });
    fireEvent.change(screen.getByLabelText(/餐點單價/), { target: { value: '60' } });

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByTestId('submit-order-button'));
      fireEvent.click(screen.getByTestId('confirm-duplicate-button'));
      const first = repositoryMock.createOrder.mock.calls[0][0];
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      vi.useRealTimers();
      fireEvent.click(screen.getByTestId('order-recovery-query'));
      expect(await screen.findByText('伺服器已確認入帳，正在重新載入資料')).toBeVisible();
      expect(screen.getByTestId('order-recovery-command-id')).toHaveTextContent(first.commandId);
      expect(screen.getByTestId('cloud-orders-loading')).toBeVisible();
      expect(screen.queryByTestId('submit-order-button')).toBeNull();
      expect(screen.queryByTestId('undo-bar')).toBeNull();
      expect(onNavigationStateChange).toHaveBeenLastCalledWith('uid-1:1', 'recovering');
      expect(repositoryMock.createOrder).toHaveBeenCalledTimes(1);
      expect(repositoryMock.confirmPending).toHaveBeenCalledWith(
        { commandId: first.commandId, datasetId: 'ds-1', uid: 'uid-1' }, 1,
      );
      await act(async () => { original.resolve(okResult(first.commandId, 31)); });
      expect(repositoryMock.loadSnapshot).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('order-recovery-panel')).toBeVisible();
      expect(screen.queryByText(/已確認 002 李小華 訂餐完成（命令序號 31）/)).toBeNull();
      await act(async () => { freshHeads.resolve(snapshot({ day: mockDay({ bento: 2 }) })); });
      expect(screen.getAllByText(/已確認 002 李小華 訂餐完成（命令序號 31）/)).toHaveLength(1);
      expect(screen.getByTestId('cloud-topbar-bento')).toHaveTextContent('2');
      expect(screen.queryByTestId('order-recovery-panel')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the confirmed command and a reload action when fresh heads fail', async () => {
    const original = deferred<CommandResult>();
    repositoryMock.createOrder.mockReturnValueOnce(original.promise);
    let snapshotReads = 0;
    repositoryMock.loadSnapshot.mockImplementation(async () => {
      snapshotReads += 1;
      if (snapshotReads === 2) throw Object.assign(new Error('head read unavailable'), { code: 'unavailable' });
      return snapshotReads === 3 ? snapshot({ day: mockDay({ bento: 2 }) }) : snapshot();
    });
    repositoryMock.confirmPending.mockImplementation(async (record: { commandId: string }) => ({
      status: 'matched', receipt: okResult(record.commandId, 32).receipt,
    }));
    renderComponent();
    await selectStudent('002');
    fireEvent.click(screen.getByRole('button', { name: '其他餐點' }));
    fireEvent.change(screen.getByLabelText(/餐點品名/), { target: { value: '炒麵' } });
    fireEvent.change(screen.getByLabelText(/餐點單價/), { target: { value: '60' } });

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByTestId('submit-order-button'));
      fireEvent.click(screen.getByTestId('confirm-duplicate-button'));
      const commandId = repositoryMock.createOrder.mock.calls[0][0].commandId;
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      vi.useRealTimers();
      fireEvent.click(screen.getByTestId('order-recovery-query'));

      expect(await screen.findByTestId('order-recovery-heads-error')).toHaveTextContent('已確認入帳');
      expect(screen.getByTestId('order-recovery-command-id')).toHaveTextContent(commandId);
      expect(screen.getByTestId('order-recovery-heads-reload')).toBeEnabled();
      expect(screen.queryByTestId('submit-order-button')).toBeNull();
      expect(onNavigationStateChange).toHaveBeenLastCalledWith('uid-1:1', 'recovering');
      expect(repositoryMock.createOrder).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId('order-recovery-heads-reload'));
      expect(await screen.findByText(/已確認 002 李小華 訂餐完成（命令序號 32）/)).toBeVisible();
      expect(screen.getByTestId('cloud-topbar-bento')).toHaveTextContent('2');
      expect(repositoryMock.loadSnapshot).toHaveBeenCalledTimes(3);
      expect(repositoryMock.createOrder).toHaveBeenCalledTimes(1);

      await act(async () => { original.resolve(errorResult('UNKNOWN_RESULT')); });
      expect(screen.getAllByText(/已確認 002 李小華 訂餐完成（命令序號 32）/)).toHaveLength(1);
      expect(repositoryMock.loadSnapshot).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a failed receipt read non-retryable', async () => {
    repositoryMock.createOrder.mockResolvedValueOnce(errorResult('UNKNOWN_RESULT'));
    repositoryMock.confirmPending.mockRejectedValueOnce(Object.assign(new Error('read failed'), { code: 'OFFLINE' }));
    renderComponent();
    await selectStudent('002');
    fireEvent.click(screen.getByRole('button', { name: '其他餐點' }));
    fireEvent.change(screen.getByLabelText(/餐點品名/), { target: { value: '炒麵' } });
    fireEvent.change(screen.getByLabelText(/餐點單價/), { target: { value: '60' } });
    fireEvent.click(screen.getByTestId('submit-order-button'));
    fireEvent.click(await screen.findByTestId('confirm-duplicate-button'));
    fireEvent.click(await screen.findByTestId('order-recovery-query'));
    expect(await screen.findByTestId('order-recovery-query-status')).toHaveTextContent('目前無法安全確認伺服器結果');
    expect(screen.queryByTestId('order-recovery-retry')).toBeNull();
    expect(repositoryMock.createOrder).toHaveBeenCalledTimes(1);
  });

  it('revokes the page when the receipt context belongs to a different dataset', async () => {
    repositoryMock.createOrder.mockResolvedValueOnce(errorResult('UNKNOWN_RESULT'));
    repositoryMock.getPendingRecoveryContext.mockResolvedValueOnce({
      uid: 'uid-1', datasetId: 'ds-other', leaseEpoch: 1, maintenance: false,
    });
    renderComponent();
    await selectStudent('002');
    fireEvent.click(screen.getByRole('button', { name: '其他餐點' }));
    fireEvent.change(screen.getByLabelText(/餐點品名/), { target: { value: '炒麵' } });
    fireEvent.change(screen.getByLabelText(/餐點單價/), { target: { value: '60' } });
    fireEvent.click(screen.getByTestId('submit-order-button'));
    fireEvent.click(await screen.findByTestId('confirm-duplicate-button'));
    await screen.findByTestId('order-recovery-panel');
    fireEvent.click(await screen.findByTestId('order-recovery-query'));

    expect(await screen.findByText(/目前使用權已變更，訂餐資料已清除/)).toBeVisible();
    expect(screen.queryByTestId('selected-student-card')).toBeNull();
    expect(screen.queryByTestId('order-recovery-retry')).toBeNull();
    expect(repositoryMock.getPendingRecoveryContext).toHaveBeenCalledWith(1);
    expect(repositoryMock.confirmPending).not.toHaveBeenCalled();
    expect(repositoryMock.createOrder).toHaveBeenCalledTimes(1);
    expect(onNavigationStateChange).toHaveBeenLastCalledWith('uid-1:1', 'revoked');
  });

  it('discards the pending operation on Firestore owner change and ignores its late result and timer', async () => {
    const original = deferred<CommandResult>();
    const receiptRead = deferred<{ status: 'not-found' }>();
    repositoryMock.createOrder.mockReturnValueOnce(original.promise);
    repositoryMock.confirmPending.mockReturnValueOnce(receiptRead.promise);
    const view = renderComponent();
    await selectStudent('002');
    fireEvent.click(screen.getByRole('button', { name: '其他餐點' }));
    fireEvent.change(screen.getByLabelText(/餐點品名/), { target: { value: '炒麵' } });
    fireEvent.change(screen.getByLabelText(/餐點單價/), { target: { value: '60' } });

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByTestId('submit-order-button'));
      fireEvent.click(screen.getByTestId('confirm-duplicate-button'));
      const first = repositoryMock.createOrder.mock.calls[0][0];
      await act(async () => { await vi.advanceTimersByTimeAsync(9_999); });
      expect(screen.queryByTestId('order-recovery-command-id')).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      fireEvent.click(screen.getByTestId('order-recovery-query'));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(repositoryMock.confirmPending).toHaveBeenCalledTimes(1);
      await act(async () => {
        view.rerender(
          <CloudOrdersPage
            db={{} as Firestore}
            leaseEpoch={1}
            identityKey="uid-1:1"
            onNavigationStateChange={onNavigationStateChange}
          />,
        );
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
        original.resolve(errorResult('UNKNOWN_RESULT'));
        receiptRead.resolve({ status: 'not-found' });
      });
      expect(screen.queryByTestId('order-recovery-command-id')).toBeNull();
      expect(screen.queryByTestId('order-recovery-panel')).toBeNull();
      expect(screen.queryByText(first.commandId)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('masks and clears all business data when the lease is lost during submit (B2)', async () => {
    repositoryMock.createOrder.mockResolvedValue(errorResult('LEASE_LOST', 'lease changed'));
    renderComponent();
    await selectStudent('002');
    fireEvent.click(screen.getByRole('button', { name: '其他餐點' }));
    fireEvent.change(screen.getByLabelText(/餐點品名/), { target: { value: '炒麵' } });
    fireEvent.change(screen.getByLabelText(/餐點單價/), { target: { value: '60' } });
    fireEvent.click(screen.getByTestId('submit-order-button'));
    fireEvent.click(await screen.findByTestId('confirm-duplicate-button'));

    expect(await screen.findByText(/目前使用權已變更，訂餐資料已清除/)).toBeVisible();
    expect(screen.queryByTestId('selected-student-card')).toBeNull();
    expect(screen.queryByTestId('recent-accounts-card')).toBeNull();
    expect(screen.queryByTestId('cloud-topbar-counts')).toBeNull();
    expect(screen.queryByText(/李小華/)).toBeNull();
    expect(screen.getByText(/結果尚未確認，勿重新收款/)).toBeVisible();
    expect(onNavigationStateChange).toHaveBeenLastCalledWith('uid-1:1', 'revoked');
    expect(window.localStorage.getItem(LEGACY_PENDING_KEY)).toBeNull();
  });

  it('masks data when the initial server read is denied (B2)', async () => {
    repositoryMock.loadSnapshot.mockRejectedValue(Object.assign(new Error('denied'), { code: 'LEASE_LOST' }));
    renderComponent();
    expect(await screen.findByText(/目前使用權已變更/)).toBeVisible();
    expect(screen.queryByLabelText('搜尋編號、姓名或別名')).toBeNull();
    expect(screen.queryByRole('button', { name: '重新載入' })).toBeNull();
  });

  it('re-reads the server after a revision conflict so the next attempt uses fresh revisions (B3)', async () => {
    repositoryMock.createOrder
      .mockResolvedValueOnce(errorResult('REVISION_CONFLICT'))
      .mockImplementationOnce(async (input: { commandId: string }) => okResult(input.commandId));
    repositoryMock.loadSnapshot
      .mockResolvedValueOnce(snapshot({ transactions: [], day: mockDay({ bento: 0, other: 0 }) }))
      .mockResolvedValueOnce(snapshot({
        transactions: [],
        day: { ...mockDay({ bento: 0, other: 0 }), revision: 6, menu: { ...mockDay().menu!, price: 95, revision: 3 } },
      }));
    renderComponent();
    await selectStudent('001');
    fireEvent.click(screen.getByTestId('submit-order-button'));
    expect(await screen.findByText(/已重新讀取最新資料/)).toBeVisible();
    await waitFor(() => expect(repositoryMock.loadSnapshot).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('selected-student-card')).toHaveTextContent('王小明');
    expect(screen.getByText(/單價：/)).toHaveTextContent('$95');

    fireEvent.click(screen.getByTestId('submit-order-button'));
    await waitFor(() => expect(repositoryMock.createOrder).toHaveBeenCalledTimes(2));
    const [first, second] = repositoryMock.createOrder.mock.calls.map(call => call[0]);
    expect(second).toMatchObject({ expectedDayRevision: 6, menuRevision: 3, mealPrice: 95 });
    expect(second.commandId).not.toBe(first.commandId);
    expect(window.localStorage.getItem(LEGACY_PENDING_KEY)).toBeNull();
  });

  it('rejects amounts that parseInt would truncate, such as 1e3 and 1.5', async () => {
    repositoryMock.loadSnapshot.mockResolvedValue(snapshot({ transactions: [], day: mockDay({ bento: 0, other: 0 }) }));
    renderComponent();
    await selectStudent('002');
    for (const value of ['1e3', '1.5', '-1', '1000001']) {
      fireEvent.change(screen.getByLabelText(/實收金額/), { target: { value } });
      fireEvent.click(screen.getByTestId('submit-order-button'));
      expect(await screen.findByText('實收金額必須是 0 到 1,000,000 的整數')).toBeVisible();
    }
    expect(repositoryMock.createOrder).not.toHaveBeenCalled();
  });

  it('lets an inactive student pay but never order', async () => {
    renderComponent();
    await selectStudent('003');
    expect(screen.getByRole('alert')).toHaveTextContent('此帳戶已停用，禁止新增餐點');
    expect(screen.getByRole('button', { name: '今日餐點（Q）' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '其他餐點' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '繳費（W）' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByLabelText(/繳費金額/), { target: { value: '30' } });
    fireEvent.click(screen.getByTestId('submit-order-button'));
    await waitFor(() => expect(repositoryMock.createPayment).toHaveBeenCalledWith(expect.objectContaining({
      studentId: 's3', paidAmount: 30,
    })));
    expect(repositoryMock.createOrder).not.toHaveBeenCalled();
  });

  it('blocks ordering when today has no business day', async () => {
    repositoryMock.loadSnapshot.mockResolvedValue(snapshot({ day: null, transactions: [] }));
    renderComponent();
    expect(await screen.findByTestId('ordering-blocked')).toHaveTextContent('營業日尚未建立');
  });

  it('supports ordering an other meal when no menu is configured', async () => {
    repositoryMock.loadSnapshot.mockResolvedValue(snapshot({ day: mockDay({ menu: false, bento: 0, other: 0 }), transactions: [] }));
    renderComponent();
    expect(await screen.findByTestId('cloud-topbar-bento')).toHaveTextContent('今日餐點（未設定）');
    await selectStudent('002');
    expect(screen.getByText(/今日尚未設定菜單，無法訂購今日餐點/)).toBeVisible();
    expect(screen.getByTestId('submit-order-button')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '其他餐點' }));
    fireEvent.change(screen.getByLabelText(/餐點品名/), { target: { value: '素食餐' } });
    fireEvent.change(screen.getByLabelText(/餐點單價/), { target: { value: '80' } });
    fireEvent.click(screen.getByTestId('submit-order-button'));
    await waitFor(() => expect(repositoryMock.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      studentId: 's2', mealKind: 'other', mealPrice: 80, paidAmount: 0, menuRevision: null, otherItemName: '素食餐',
    })));
  });

  it('shows payment details from snapshots without inventing a menu name (B7)', async () => {
    repositoryMock.loadSnapshot.mockResolvedValue(snapshot({
      transactions: [{ ...mockTx('tx-1', 's1', 'bento', 90, 100), menuNameSnapshot: '雞腿飯' }],
    }));
    renderComponent();
    await selectStudent('001');
    fireEvent.click(screen.getByTestId('open-payment-details-button'));
    const modal = await screen.findByTestId('payment-details-modal');
    expect(modal).toHaveTextContent('王小明 今日付款明細');
    expect(modal).toHaveTextContent('今日餐點：雞腿飯');
    expect(modal).not.toHaveTextContent('便當');
    expect(screen.getByTestId('payment-details-summary')).toHaveTextContent('今日餐費：$90');
    expect(screen.getByTestId('payment-details-summary')).toHaveTextContent('今日收款：$100');
    expect(screen.getByTestId('payment-details-summary')).toHaveTextContent('帳戶餘額：$100');
    expect(screen.queryByRole('button', { name: '查看全部紀錄' })).toBeNull();
    fireEvent.click(screen.getByTestId('close-payment-details-button'));
    await waitFor(() => expect(screen.queryByTestId('payment-details-modal')).toBeNull());
  });

  it('renders recent accounts with meal classification tags, newest first', async () => {
    renderComponent();
    const list = await screen.findByTestId('recent-accounts-list');
    expect(list.firstElementChild).toHaveAttribute('data-testid', 'recent-item-002');
    expect(screen.getByTestId('recent-item-001')).toHaveTextContent('今日餐點 1');
    expect(screen.getByTestId('recent-item-002')).toHaveTextContent('其他餐點 1');
  });

  it('leaves legacy pending-slot migration and recovery to the shared boundary', async () => {
    const legacy = JSON.stringify({ uid: 'uid-1', datasetId: 'ds-1', commandId: '00000000-0000-4000-8000-000000000099' });
    window.localStorage.setItem(LEGACY_PENDING_KEY, legacy);
    renderComponent();
    await screen.findByTestId('cloud-topbar-counts');
    expect(repositoryMock.readCommand).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(LEGACY_PENDING_KEY)).toBe(legacy);
    expect(screen.queryByRole('button', { name: /確認未入帳並清除提醒/ })).toBeNull();
  });
  it('W switches to payment; a payment freezes IDs and revisions and confirms only after the server receipt', async () => {
    renderComponent();
    await selectStudent('001');
    fireEvent.keyDown(window, { key: 'w' });
    expect(screen.getByRole('button', { name: '繳費（W）' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByLabelText(/繳費金額/), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText(/備註/), { target: { value: '預存' } });
    expect(screen.getByText(/預估結餘：/)).toHaveTextContent('$300');
    fireEvent.click(screen.getByTestId('submit-order-button'));

    await waitFor(() => expect(repositoryMock.createPayment).toHaveBeenCalledTimes(1));
    const input = repositoryMock.createPayment.mock.calls[0][0];
    expect(input).toEqual({
      commandId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      transactionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      leaseEpoch: 1, studentId: 's1', dayId: TODAY,
      expectedStudentRevision: 3, expectedDayRevision: 5, paidAmount: 200, note: '預存',
    });
    expect(screen.queryByTestId('confirm-duplicate-button')).toBeNull();
    expect(await screen.findByText(/已確認 001 王小明 繳費 \$200 完成（命令序號 12）/)).toBeVisible();
    expect(repositoryMock.createOrder).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(LEGACY_PENDING_KEY)).toBeNull();
  });

  it('rejects a zero, decimal or oversized payment before sending', async () => {
    renderComponent();
    await selectStudent('001');
    fireEvent.click(screen.getByRole('button', { name: '繳費（W）' }));
    for (const value of ['0', '1.5', '1e3', '1000001']) {
      fireEvent.change(screen.getByLabelText(/繳費金額/), { target: { value } });
      fireEvent.click(screen.getByTestId('submit-order-button'));
      expect(await screen.findByText('繳費金額必須是 1 到 1,000,000 的整數')).toBeVisible();
    }
    expect(repositoryMock.createPayment).not.toHaveBeenCalled();
  });

  it('keeps the same payment command when its result is unknown', async () => {
    repositoryMock.createPayment
      .mockResolvedValueOnce(errorResult('UNKNOWN_RESULT'))
      .mockImplementationOnce(async (input: { commandId: string }) => okResult(input.commandId, 14));
    renderComponent();
    await selectStudent('002');
    fireEvent.click(screen.getByRole('button', { name: '繳費（W）' }));
    fireEvent.change(screen.getByLabelText(/繳費金額/), { target: { value: '100' } });
    fireEvent.click(screen.getByTestId('submit-order-button'));
    expect(await screen.findByTestId('order-recovery-panel')).toHaveTextContent('李小華 的繳費尚未確認');
    await queryAndAuthorizeRetry();
    await waitFor(() => expect(repositoryMock.createPayment).toHaveBeenCalledTimes(2));
    expect(repositoryMock.createPayment.mock.calls[1][0]).toEqual(repositoryMock.createPayment.mock.calls[0][0]);
    expect(await screen.findByText(/繳費 \$100 完成（命令序號 14）/)).toBeVisible();
  });

  it('A opens counter cash; an expense with a reason is sent as a cash movement, never a student row', async () => {
    renderComponent();
    await screen.findByTestId('cloud-cash-summary');
    fireEvent.keyDown(window, { key: 'a' });
    const card = await screen.findByTestId('cash-movement-card');
    expect(card).toHaveTextContent('不影響任何學生餘額');
    fireEvent.change(screen.getByLabelText(/金額（必填）/), { target: { value: '80' } });
    expect(screen.getByTestId('submit-cash-movement-button')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '付餐費給廠商' }));
    expect(card).toHaveTextContent('現金影響：−$80');
    fireEvent.click(screen.getByTestId('submit-cash-movement-button'));

    await waitFor(() => expect(repositoryMock.createCashMovement).toHaveBeenCalledTimes(1));
    expect(repositoryMock.createCashMovement.mock.calls[0][0]).toEqual({
      commandId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      transactionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      leaseEpoch: 1, dayId: TODAY, expectedDayRevision: 5, direction: 'expense', amount: 80, reason: '付餐費給廠商',
    });
    expect(await screen.findByText(/已確認櫃台支出 \$80入帳（命令序號 13）/)).toBeVisible();
    expect(repositoryMock.createOrder).not.toHaveBeenCalled();
    expect(repositoryMock.createPayment).not.toHaveBeenCalled();
  });

  it('requires a counter cash reason and a positive whole amount', async () => {
    renderComponent();
    fireEvent.click(await screen.findByTestId('open-cash-movement-button'));
    fireEvent.click(screen.getByRole('button', { name: '收入' }));
    fireEvent.change(screen.getByLabelText(/原因（必填）/), { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText(/金額（必填）/), { target: { value: '50' } });
    fireEvent.submit(screen.getByRole('form', { name: '櫃台收支' }));
    expect(await screen.findByText('櫃台收支原因必填，且不能超過 500 字')).toBeVisible();
    fireEvent.change(screen.getByLabelText(/原因（必填）/), { target: { value: '零錢補充' } });
    fireEvent.change(screen.getByLabelText(/金額（必填）/), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('submit-cash-movement-button'));
    expect(await screen.findByText('櫃台收支金額必須是 1 到 1,000,000 的整數')).toBeVisible();
    expect(repositoryMock.createCashMovement).not.toHaveBeenCalled();
  });

  it('shows L05 expected cash from the reconciled day and lists counter rows without adding them to recent accounts', async () => {
    const day = mockDay();
    repositoryMock.loadSnapshot.mockResolvedValue(snapshot({
      day: {
        ...day,
        openingCash: 1000,
        totals: { ...day.totals, activeTransactionCount: 4, retainedReceipts: 200, cashierIncome: 50, cashierExpense: 80 },
      },
      transactions: [
        mockTx('tx-1', 's1', 'bento', 90, 0),
        { ...mockTx('tx-2', 's1', 'bento', 0, 200), type: 'payment', mealKind: null, menuNameSnapshot: '', menuPriceSnapshot: 0, vendorIdSnapshot: '', vendorNameSnapshot: '', amount: 200 },
        { ...mockTx('tx-3', '__cashier__', 'other', 0, 50), type: 'expense', mealKind: null, otherItemName: null, studentNameSnapshot: '櫃台', note: '零錢補充' },
        { ...mockTx('tx-4', '__cashier__', 'other', 80, 0), type: 'expense', mealKind: null, otherItemName: null, studentNameSnapshot: '櫃台', note: '付餐費給廠商', amount: -80 },
      ],
    }));
    renderComponent();
    const summary = await screen.findByTestId('cloud-cash-summary');
    expect(summary).toHaveTextContent('開帳現金$1000');
    expect(summary).toHaveTextContent('學生收款$200');
    expect(summary).toHaveTextContent('櫃台收入$50');
    expect(summary).toHaveTextContent('櫃台支出$80');
    expect(screen.getByTestId('cloud-expected-cash')).toHaveTextContent('$1170');
    const rows = screen.getByTestId('cash-movement-list');
    expect(rows).toHaveTextContent('收入 $50');
    expect(rows).toHaveTextContent('支出 $80');
    expect(rows).toHaveTextContent('付餐費給廠商');
    expect(screen.getByTestId('recent-accounts-list').children).toHaveLength(1);
    expect(screen.getByTestId('recent-item-001')).toHaveTextContent('今日餐點 1');

    await selectStudent('001');
    fireEvent.click(screen.getByTestId('open-payment-details-button'));
    const modal = await screen.findByTestId('payment-details-modal');
    expect(modal).toHaveTextContent('繳費');
    expect(screen.getByTestId('payment-details-summary')).toHaveTextContent('今日收款：$200');
  });

  it('does not compute expected cash before the opening cash is confirmed', async () => {
    repositoryMock.loadSnapshot.mockResolvedValue(snapshot({
      day: { ...mockDay(), openingCash: null, openedBy: null, openedAt: null },
    }));
    renderComponent();
    expect(await screen.findByTestId('cloud-expected-cash')).toHaveTextContent('開帳現金未確認，無法計算');
  });

  it('keeps the same counter cash command when its result is unknown and confirms it with the same commandId', async () => {
    repositoryMock.createCashMovement
      .mockResolvedValueOnce(errorResult('UNKNOWN_RESULT'))
      .mockImplementationOnce(async (input: { commandId: string }) => okResult(input.commandId, 16));
    renderComponent();
    fireEvent.click(await screen.findByTestId('open-cash-movement-button'));
    fireEvent.change(screen.getByLabelText(/金額（必填）/), { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: '付餐費給廠商' }));
    fireEvent.click(screen.getByTestId('submit-cash-movement-button'));

    const panel = await screen.findByTestId('order-recovery-panel');
    expect(panel).toHaveTextContent('櫃台支出 $80 的櫃台收支尚未確認');
    expect(panel).toHaveTextContent('勿重新收款');
    expect(screen.getByTestId('submit-cash-movement-button')).toBeDisabled();
    const first = repositoryMock.createCashMovement.mock.calls[0][0];
    expect(window.localStorage.getItem(LEGACY_PENDING_KEY)).toBeNull();

    await queryAndAuthorizeRetry();
    await waitFor(() => expect(repositoryMock.createCashMovement).toHaveBeenCalledTimes(2));
    expect(repositoryMock.createCashMovement.mock.calls[1][0]).toEqual(first);
    expect(await screen.findByText(/已確認櫃台支出 \$80入帳（命令序號 16）/)).toBeVisible();
    expect(window.localStorage.getItem(LEGACY_PENDING_KEY)).toBeNull();
  });

  it('P09b: refunds from the W panel after confirmation, defaulting to the full balance', async () => {
    renderComponent();
    await selectStudent('001');
    fireEvent.keyDown(window, { key: 'w' });
    fireEvent.click(screen.getByTestId('open-refund-button'));
    const card = await screen.findByTestId('refund-card');
    expect(screen.getByLabelText(/退款金額/)).toHaveValue('100');
    expect(screen.getByTestId('submit-refund-button')).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/退款金額/), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText(/退款原因/), { target: { value: '學期結束' } });
    expect(card).toHaveTextContent('現金影響：−$60');
    expect(card).toHaveTextContent('退款後餘額：$40');
    fireEvent.click(screen.getByTestId('submit-refund-button'));

    const modal = await screen.findByTestId('refund-confirm-modal');
    expect(modal).toHaveTextContent('確定從 王小明 的帳戶退還 $60 現金嗎？退款後餘額 $40');
    expect(repositoryMock.createRefund).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('confirm-refund-button'));

    await waitFor(() => expect(repositoryMock.createRefund).toHaveBeenCalledTimes(1));
    expect(repositoryMock.createRefund.mock.calls[0][0]).toEqual({
      commandId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      transactionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      leaseEpoch: 1, studentId: 's1', dayId: TODAY,
      expectedStudentRevision: 3, expectedDayRevision: 5, amount: 60, reason: '學期結束',
    });
    expect(await screen.findByText(/已確認 001 王小明 退款 \$60 完成（命令序號 15）/)).toBeVisible();
    expect(repositoryMock.createPayment).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(LEGACY_PENDING_KEY)).toBeNull();
  });

  it('P09b: rejects refunds over the balance, zero, decimals or without a reason before sending', async () => {
    renderComponent();
    await selectStudent('002');
    fireEvent.click(screen.getByRole('button', { name: '繳費（W）' }));
    fireEvent.click(screen.getByTestId('open-refund-button'));
    fireEvent.change(screen.getByLabelText(/退款原因/), { target: { value: '退餘額' } });
    for (const value of ['51', '0', '1.5', '-10', '1e2']) {
      fireEvent.change(screen.getByLabelText(/退款金額/), { target: { value } });
      fireEvent.click(screen.getByTestId('submit-refund-button'));
      expect(await screen.findByText('退款金額必須是 1 到 50 的整數（不能超過目前餘額）')).toBeVisible();
      expect(screen.queryByTestId('refund-confirm-modal')).toBeNull();
    }
    fireEvent.change(screen.getByLabelText(/退款金額/), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/退款原因/), { target: { value: '   ' } });
    fireEvent.submit(screen.getByRole('form', { name: '退款' }));
    expect(await screen.findByText('退款原因必填，且不能超過 500 字')).toBeVisible();
    expect(repositoryMock.createRefund).not.toHaveBeenCalled();
  });

  it('P09b: an inactive account with a positive balance can refund; a zero balance has nothing to refund', async () => {
    repositoryMock.loadSnapshot.mockResolvedValue(snapshot({
      students: [
        mockStudent('s1', '001', '王小明', 0),
        mockStudent('s2', '002', '李小華', 50),
        mockStudent('s3', '003', '張小停', 30, 'inactive'),
      ],
    }));
    renderComponent();
    await selectStudent('003');
    expect(screen.getByText('此帳戶已停用，禁止新增餐點；仍可繳費或退款。')).toBeVisible();
    fireEvent.click(screen.getByTestId('open-refund-button'));
    expect(screen.getByLabelText(/退款金額/)).toHaveValue('30');
    fireEvent.change(screen.getByLabelText(/退款原因/), { target: { value: '離校' } });
    fireEvent.click(screen.getByTestId('submit-refund-button'));
    fireEvent.click(await screen.findByTestId('confirm-refund-button'));
    await waitFor(() => expect(repositoryMock.createRefund).toHaveBeenCalledWith(expect.objectContaining({ studentId: 's3', amount: 30 })));

    expect(await screen.findByText(/已確認 003 張小停 退款 \$30 完成/)).toBeVisible();
    await selectStudent('001');
    fireEvent.click(screen.getByRole('button', { name: '繳費（W）' }));
    fireEvent.click(screen.getByTestId('open-refund-button'));
    expect(screen.getByTestId('refund-no-balance')).toBeVisible();
    expect(screen.getByLabelText(/退款金額/)).toHaveValue('');
    expect(repositoryMock.createRefund).toHaveBeenCalledTimes(1);
  });

  it('P09b: keeps the same refund command when its result is unknown', async () => {
    repositoryMock.createRefund
      .mockResolvedValueOnce(errorResult('UNKNOWN_RESULT'))
      .mockImplementationOnce(async (input: { commandId: string }) => okResult(input.commandId, 17));
    renderComponent();
    await selectStudent('001');
    fireEvent.click(screen.getByRole('button', { name: '繳費（W）' }));
    fireEvent.click(screen.getByTestId('open-refund-button'));
    fireEvent.change(screen.getByLabelText(/退款原因/), { target: { value: '退餘額' } });
    fireEvent.click(screen.getByTestId('submit-refund-button'));
    fireEvent.click(await screen.findByTestId('confirm-refund-button'));
    expect(await screen.findByTestId('order-recovery-panel')).toHaveTextContent('001 王小明 的退款尚未確認');
    await queryAndAuthorizeRetry();
    await waitFor(() => expect(repositoryMock.createRefund).toHaveBeenCalledTimes(2));
    expect(repositoryMock.createRefund.mock.calls[1][0]).toEqual(repositoryMock.createRefund.mock.calls[0][0]);
    expect(await screen.findByText(/退款 \$100 完成（命令序號 17）/)).toBeVisible();
  });

  it('P09b: a negative payment points to refund instead of being sent', async () => {
    renderComponent();
    await selectStudent('001');
    fireEvent.click(screen.getByRole('button', { name: '繳費（W）' }));
    fireEvent.change(screen.getByLabelText(/繳費金額/), { target: { value: '-50' } });
    fireEvent.click(screen.getByTestId('submit-order-button'));
    expect(await screen.findByText('收款金額不能是負數。要退錢給學生請用「退款」。')).toBeVisible();
    expect(repositoryMock.createPayment).not.toHaveBeenCalled();
  });

  it('P09b: expected cash subtracts account refunds once; details list refunds apart from receipts', async () => {
    const day = mockDay();
    repositoryMock.loadSnapshot.mockResolvedValue(snapshot({
      students: [mockStudent('s1', '001', '王小明', 40), mockStudent('s2', '002', '李小華', 50)],
      day: {
        ...day,
        openingCash: 1000,
        totals: { ...day.totals, activeTransactionCount: 3, retainedReceipts: 200, cashierIncome: 50, cashierExpense: 80, accountRefunds: 60 },
      },
      transactions: [
        { ...mockTx('tx-2', 's1', 'bento', 0, 200), type: 'payment', mealKind: null, menuNameSnapshot: '', menuPriceSnapshot: 0, vendorIdSnapshot: '', vendorNameSnapshot: '', amount: 200 },
        { ...mockTx('tx-5', 's1', 'bento', 0, 0), type: 'refund', mealKind: null, menuNameSnapshot: '', menuPriceSnapshot: 0, vendorIdSnapshot: '', vendorNameSnapshot: '', amount: 60, note: '學期結束' },
      ],
    }));
    renderComponent();
    const summary = await screen.findByTestId('cloud-cash-summary');
    expect(summary).toHaveTextContent('學生收款$200');
    expect(screen.getByTestId('cloud-account-refunds')).toHaveTextContent('$60');
    expect(screen.getByTestId('cloud-expected-cash')).toHaveTextContent('$1110');
    expect(screen.getByTestId('recent-item-001')).toHaveTextContent('繳費・退款');

    await selectStudent('001');
    fireEvent.click(screen.getByTestId('open-payment-details-button'));
    const modal = await screen.findByTestId('payment-details-modal');
    expect(modal).toHaveTextContent('退款：學期結束');
    const totals = screen.getByTestId('payment-details-summary');
    expect(totals).toHaveTextContent('今日收款：$200');
    expect(totals).toHaveTextContent('今日退款：$60');
  });

  describe('P10a corrections, voids, cancels and the 5-second undo', () => {
    const paymentRow = (txId: string, paid: number): CloudOrderTransactionRecord => ({
      ...mockTx(txId, 's1', 'bento', 0, paid), type: 'payment', mealKind: null, menuNameSnapshot: '', menuPriceSnapshot: 0,
      vendorIdSnapshot: '', vendorNameSnapshot: '', amount: paid,
    });

    beforeEach(() => {
      repositoryMock.mutateTransaction.mockImplementation(async (input: { commandId: string }) => okResult(input.commandId, 20));
    });

    async function payOnce() {
      repositoryMock.loadSnapshot.mockImplementation(async () => {
        const created = repositoryMock.createPayment.mock.calls[0]?.[0] as { transactionId: string; commandId: string } | undefined;
        if (!created) return snapshot();
        return snapshot({
          students: [mockStudent('s1', '001', '王小明', 300), mockStudent('s2', '002', '李小華', 50)],
          day: { ...mockDay(), revision: 6 },
          transactions: [mockTx('tx-1', 's1', 'bento', 90, 100), { ...paymentRow(created.transactionId, 200), lastCommandId: created.commandId }],
        });
      });
      renderComponent();
      await selectStudent('001');
      fireEvent.click(screen.getByRole('button', { name: '繳費（W）' }));
      fireEvent.change(screen.getByLabelText(/繳費金額/), { target: { value: '200' } });
      fireEvent.click(screen.getByTestId('submit-order-button'));
      await screen.findByText(/繳費 \$200 完成/);
      return repositoryMock.createPayment.mock.calls[0][0] as { transactionId: string; commandId: string };
    }

    it('offers a 5-second undo after a create, shows its cash impact and sends Undo for that command', async () => {
      const created = await payOnce();
      const bar = await screen.findByTestId('undo-bar');
      expect(bar).toHaveTextContent('5 秒內可撤回 001 王小明 的繳費：現金 −$200，餘額回到 $100');
      fireEvent.click(screen.getByTestId('undo-button'));
      await waitFor(() => expect(repositoryMock.mutateTransaction).toHaveBeenCalledTimes(1));
      expect(repositoryMock.mutateTransaction.mock.calls[0][0]).toMatchObject({
        kind: 'Undo',
        payload: { targetCommandId: created.commandId, reason: '送出後立即撤回' },
        transactionId: created.transactionId,
        studentId: 's1',
        dayId: TODAY,
        expectedTransactionRevision: 1,
        expectedStudentRevision: 3,
        expectedDayRevision: 6,
        leaseEpoch: 1,
      });
      expect(await screen.findByText(/已撤回 001 王小明 的繳費，帳戶餘額與現金已回復（命令序號 20）/)).toBeVisible();
      expect(screen.queryByTestId('undo-bar')).toBeNull();
    });

    it('keeps Undo as one frozen mutation and retries it only after a null receipt check', async () => {
      const created = await payOnce();
      repositoryMock.mutateTransaction
        .mockResolvedValueOnce(errorResult('UNKNOWN_RESULT'))
        .mockImplementationOnce(async (input: { commandId: string }) => okResult(input.commandId, 21));
      fireEvent.click(screen.getByTestId('undo-button'));
      expect(await screen.findByTestId('order-recovery-panel')).toHaveTextContent('結果確認中，勿重新收款');
      const first = repositoryMock.mutateTransaction.mock.calls[0][0];
      expect(first).toMatchObject({
        kind: 'Undo',
        payload: { targetCommandId: created.commandId, reason: '送出後立即撤回' },
      });
      expect(screen.queryByTestId('order-recovery-retry')).toBeNull();
      await queryAndAuthorizeRetry();
      await waitFor(() => expect(repositoryMock.mutateTransaction).toHaveBeenCalledTimes(2));
      expect(repositoryMock.mutateTransaction.mock.calls[1][0]).toEqual(first);
      expect(await screen.findByText(/已撤回 001 王小明 的繳費，帳戶餘額與現金已回復（命令序號 21）/)).toBeVisible();
    });

    it('hides the undo offer after 5 seconds', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      try {
        await payOnce();
        await screen.findByTestId('undo-bar');
        await act(async () => { vi.advanceTimersByTime(4_000); });
        expect(screen.getByTestId('undo-bar')).toBeVisible();
        await act(async () => { vi.advanceTimersByTime(1_100); });
        expect(screen.queryByTestId('undo-bar')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('corrects a meal from 90 to 110 with a reason and previews the new balance (L02)', async () => {
      renderComponent();
      await selectStudent('001');
      fireEvent.click(screen.getByTestId('open-payment-details-button'));
      const row = within(await screen.findByTestId('detail-row-tx-1'));
      fireEvent.click(row.getByRole('button', { name: '更正' }));
      const modal = await screen.findByTestId('edit-transaction-modal');
      fireEvent.change(screen.getByLabelText('餐費'), { target: { value: '110' } });
      const preview = screen.getByTestId('edit-preview');
      expect(preview).toHaveTextContent('現金影響：不變');
      expect(preview).toHaveTextContent('帳戶餘額：$100 → $80');
      expect(screen.getByTestId('submit-edit-button')).toBeDisabled();
      fireEvent.change(screen.getByLabelText(/修改理由/), { target: { value: '價格記錯' } });
      fireEvent.click(within(modal).getByTestId('submit-edit-button'));
      await waitFor(() => expect(repositoryMock.mutateTransaction).toHaveBeenCalledTimes(1));
      expect(repositoryMock.mutateTransaction.mock.calls[0][0]).toMatchObject({
        kind: 'CorrectTransaction',
        payload: { mealPrice: 110, paidAmount: 100, amount: -10, note: '', reason: '價格記錯' },
        transactionId: 'tx-1', studentId: 's1', expectedTransactionRevision: 1, expectedStudentRevision: 3, expectedDayRevision: 5,
      });
      expect(await screen.findByText(/已確認 001 王小明 的更正完成/)).toBeVisible();
    });

    it('cancels a paid order with a refund (L04) or keeping the deposit (L03), with the cash impact shown', async () => {
      renderComponent();
      await selectStudent('001');
      fireEvent.click(screen.getByTestId('open-payment-details-button'));
      fireEvent.click(within(await screen.findByTestId('detail-row-tx-1')).getByRole('button', { name: '取消' }));
      await screen.findByTestId('edit-transaction-modal');
      expect(screen.getByTestId('edit-preview')).toHaveTextContent('現金影響：不變');
      expect(screen.getByTestId('edit-preview')).toHaveTextContent('帳戶餘額：$100 → $190');
      fireEvent.click(screen.getByRole('button', { name: '取消訂餐並退還 $100' }));
      expect(screen.getByTestId('edit-preview')).toHaveTextContent('現金影響：−$100（退還現金給學生）');
      expect(screen.getByTestId('edit-preview')).toHaveTextContent('帳戶餘額：$100 → $90');
      fireEvent.change(screen.getByLabelText(/修改理由/), { target: { value: '學生請假' } });
      fireEvent.click(screen.getByTestId('submit-edit-button'));
      await waitFor(() => expect(repositoryMock.mutateTransaction).toHaveBeenCalledTimes(1));
      expect(repositoryMock.mutateTransaction.mock.calls[0][0]).toMatchObject({ kind: 'CancelRefund', payload: { reason: '學生請假' } });
    });

    it('shows voided rows as 已作廢 without actions and leaves them out of the totals', async () => {
      repositoryMock.loadSnapshot.mockResolvedValue(snapshot({
        transactions: [mockTx('tx-1', 's1', 'bento', 90, 100), { ...paymentRow('tx-9', 50), status: 'voided', revision: 2 }],
      }));
      renderComponent();
      await selectStudent('001');
      fireEvent.click(screen.getByTestId('open-payment-details-button'));
      const voided = await screen.findByTestId('detail-row-tx-9');
      expect(voided).toHaveTextContent('已作廢');
      expect(within(voided).queryByRole('button')).toBeNull();
      expect(screen.getByTestId('payment-details-summary')).toHaveTextContent('今日收款：$100');
    });

    it('corrects a counter expense from 80 to 70 without any student revision', async () => {
      repositoryMock.loadSnapshot.mockResolvedValue(snapshot({
        transactions: [
          { ...mockTx('tx-4', '__cashier__', 'other', 80, 0), type: 'expense', mealKind: null, otherItemName: null, studentNameSnapshot: '櫃台', note: '付餐費給廠商', amount: -80 },
        ],
      }));
      renderComponent();
      const row = within(await screen.findByTestId('cash-row-tx-4'));
      fireEvent.click(row.getByRole('button', { name: '更正' }));
      await screen.findByTestId('edit-transaction-modal');
      fireEvent.change(screen.getByLabelText('支出金額'), { target: { value: '70' } });
      expect(screen.getByTestId('edit-preview')).toHaveTextContent('現金影響：+$10（帳本更正）');
      fireEvent.change(screen.getByLabelText(/修改理由/), { target: { value: '收據金額看錯' } });
      fireEvent.click(screen.getByTestId('submit-edit-button'));
      await waitFor(() => expect(repositoryMock.mutateTransaction).toHaveBeenCalledTimes(1));
      expect(repositoryMock.mutateTransaction.mock.calls[0][0]).toMatchObject({
        kind: 'CorrectTransaction',
        payload: { mealPrice: 70, paidAmount: 0, amount: -70, note: '付餐費給廠商', reason: '收據金額看錯' },
        studentId: '__cashier__', expectedStudentRevision: null, expectedDayRevision: 5,
      });
      expect(await screen.findByText(/已確認 櫃台支出 \$80 的更正完成/)).toBeVisible();
    });

    it('refuses a refund correction that would make the balance negative before sending', async () => {
      repositoryMock.loadSnapshot.mockResolvedValue(snapshot({
        students: [mockStudent('s1', '001', '王小明', 40)],
        transactions: [{ ...paymentRow('tx-5', 0), type: 'refund', amount: 60, note: '學期結束' }],
      }));
      renderComponent();
      await selectStudent('001');
      fireEvent.click(screen.getByTestId('open-payment-details-button'));
      fireEvent.click(within(await screen.findByTestId('detail-row-tx-5')).getByRole('button', { name: '更正' }));
      fireEvent.change(await screen.findByLabelText('退款金額'), { target: { value: '120' } });
      fireEvent.change(screen.getByLabelText(/修改理由/), { target: { value: '少記' } });
      expect(screen.getByTestId('edit-preview')).toHaveTextContent('退款更正後帳戶餘額會變成 $-20，不能是負數');
      expect(screen.getByTestId('submit-edit-button')).toBeDisabled();
      fireEvent.change(screen.getByLabelText('退款金額'), { target: { value: '100' } });
      expect(screen.getByTestId('edit-preview')).toHaveTextContent('現金影響：−$40（帳本更正）');
      expect(screen.getByTestId('edit-preview')).toHaveTextContent('帳戶餘額：$40 → $0');
      expect(screen.queryByTestId('void-ledger-warning')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '作廢（記錯了）' }));
      expect(screen.getByTestId('edit-preview')).toHaveTextContent('現金影響：+$60（帳本更正）');
      expect(screen.getByTestId('void-ledger-warning')).toHaveTextContent('不是今天退現金或收現金');
    });

    it('a revision conflict on a mutation says the change did not take effect and keeps the form', async () => {
      repositoryMock.mutateTransaction.mockResolvedValue(errorResult('REVISION_CONFLICT'));
      renderComponent();
      await selectStudent('001');
      fireEvent.click(screen.getByTestId('open-payment-details-button'));
      fireEvent.click(within(await screen.findByTestId('detail-row-tx-1')).getByRole('button', { name: '更正' }));
      fireEvent.change(await screen.findByLabelText('實收金額'), { target: { value: '90' } });
      fireEvent.change(screen.getByLabelText(/修改理由/), { target: { value: '收款記錯' } });
      fireEvent.click(screen.getByTestId('submit-edit-button'));
      expect(await screen.findByText(/更正沒有生效。已重新讀取最新資料/)).toBeVisible();
      expect(await screen.findByTestId('edit-transaction-modal')).toBeVisible();
      expect(window.localStorage.getItem(LEGACY_PENDING_KEY)).toBeNull();
    });
  });
});

describe('CloudOrdersPage: backfill view (contract §13)', () => {
  const GAP = '2026-10-14';
  const marker = {
    dayId: GAP, reason: '那天斷線', startedBy: 'uid-1', startedAt: new Date('2026-10-16T01:00:00.000Z'),
    commandId: '00000000-0000-4000-8000-0000000000b1',
  };
  const gapDay = (overrides: Partial<CloudDayRecord> = {}): CloudDayRecord => ({
    ...mockDay({ menu: false, bento: 0, other: 0 }), dayId: GAP, openingCash: 870, ...overrides,
  });
  // One row typed on the day itself, one entered two days later (a backfilled row).
  const gapTx = (id: string, createdAt: string, paid = 100): CloudOrderTransactionRecord => ({
    ...mockTx(id, 's1', 'other', 60, paid, '炒麵'), businessDate: GAP, createdAt, updatedAt: createdAt,
  });
  const backfillSnapshot = (overrides: Partial<CloudOrderSnapshot> = {}) => snapshot({
    businessDate: GAP,
    backfill: marker,
    backfillDays: [marker],
    day: gapDay(),
    transactions: [gapTx('tx-live', '2026-10-14T04:30:00.000Z'), gapTx('tx-back', '2026-10-16T05:00:00.000Z')],
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    repositoryMock.readCommand.mockResolvedValue(null);
    repositoryMock.createOrder.mockImplementation(async (input: { commandId: string }) => okResult(input.commandId));
    repositoryMock.createPayment.mockImplementation(async (input: { commandId: string }) => okResult(input.commandId, 12));
    repositoryMock.createCashMovement.mockImplementation(async (input: { commandId: string }) => okResult(input.commandId, 13));
  });

  it('changes nothing for a normal day: no banner, no day switch, no tags', async () => {
    repositoryMock.loadSnapshot.mockResolvedValue(snapshot());
    renderComponent();
    await screen.findByTestId('cloud-topbar-bento');
    expect(repositoryMock.loadSnapshot).toHaveBeenCalledWith({ dayId: null });
    expect(screen.queryByTestId('backfill-banner')).toBeNull();
    expect(screen.queryByTestId('orders-day-select')).toBeNull();
    expect(screen.queryByTestId('backfill-tag-tx-1')).toBeNull();
  });

  it('opens the day App asked for, shows a banner with the reason and tags only the rows entered later', async () => {
    repositoryMock.loadSnapshot.mockResolvedValue(backfillSnapshot());
    renderComponent('uid-1:1', GAP);
    const banner = await screen.findByTestId('backfill-banner');
    expect(repositoryMock.loadSnapshot).toHaveBeenCalledWith({ dayId: GAP });
    expect(banner).toHaveTextContent(`正在回填 ${GAP}（原因：那天斷線）`);
    expect(screen.getByText(`營業日：${GAP}`)).toBeVisible();
    await selectStudent('001');
    fireEvent.click(screen.getByTestId('open-payment-details-button'));
    expect(await screen.findByTestId('backfill-tag-tx-back')).toHaveTextContent('回填');
    expect(screen.queryByTestId('backfill-tag-tx-live')).toBeNull();
  });

  it('switches to a backfilling day from the day selector and leaves with 離開回填', async () => {
    repositoryMock.loadSnapshot.mockImplementation(async (options: { dayId?: string | null } = {}) => (
      options.dayId ? backfillSnapshot() : snapshot({ backfillDays: [marker] })
    ));
    renderComponent();
    const select = await screen.findByTestId('orders-day-select');
    expect(screen.queryByTestId('backfill-banner')).toBeNull();
    fireEvent.change(select, { target: { value: GAP } });
    expect(await screen.findByTestId('backfill-banner')).toBeVisible();
    expect(repositoryMock.loadSnapshot).toHaveBeenLastCalledWith({ dayId: GAP });

    fireEvent.click(screen.getByTestId('leave-backfill-button'));
    await waitFor(() => expect(screen.queryByTestId('backfill-banner')).toBeNull());
    expect(repositoryMock.loadSnapshot).toHaveBeenLastCalledWith({ dayId: null });
    expect(screen.getByText(`營業日：${TODAY}`)).toBeVisible();
  });

  it('records an other-meal order on the backfilled day, and points to the menu setup when the day has none', async () => {
    repositoryMock.loadSnapshot.mockResolvedValue(backfillSnapshot({ transactions: [] }));
    renderComponent('uid-1:1', GAP);
    await selectStudent('002');
    expect(screen.getByText(new RegExp(`${GAP} 尚未設定菜單`))).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '其他餐點' }));
    fireEvent.change(screen.getByLabelText(/餐點品名/), { target: { value: '水餃' } });
    fireEvent.change(screen.getByLabelText(/餐點單價/), { target: { value: '70' } });
    fireEvent.change(screen.getByLabelText(/紙本號/), { target: { value: 'A-0123' } });
    fireEvent.click(screen.getByTestId('submit-order-button'));
    await waitFor(() => expect(repositoryMock.createOrder).toHaveBeenCalledTimes(1));
    expect(repositoryMock.createOrder.mock.calls[0][0]).toMatchObject({
      dayId: GAP, mealKind: 'other', mealPrice: 70, expectedDayRevision: 5, note: '紙本A-0123：',
    });
  });

  it('sends payments on the backfilled day, and offers neither a refund nor the 5-second undo', async () => {
    repositoryMock.loadSnapshot.mockResolvedValue(backfillSnapshot());
    renderComponent('uid-1:1', GAP);
    await selectStudent('001');
    fireEvent.click(screen.getByRole('button', { name: '繳費（W）' }));
    expect(screen.getByTestId('open-refund-button')).toBeDisabled();
    expect(screen.getByTestId('backfill-refund-note')).toHaveTextContent('回填中不能退款');
    fireEvent.change(screen.getByLabelText(/繳費金額/), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/紙本號/), { target: { value: 'A-0124' } });
    fireEvent.click(screen.getByTestId('submit-order-button'));
    await waitFor(() => expect(repositoryMock.createPayment).toHaveBeenCalledTimes(1));
    expect(repositoryMock.createPayment.mock.calls[0][0]).toMatchObject({ dayId: GAP, paidAmount: 50, note: '紙本A-0124：' });
    expect(await screen.findByText(/已確認/)).toBeVisible();
    expect(screen.queryByTestId('undo-bar')).toBeNull();
    expect(screen.queryByRole('button', { name: /撤回/ })).toBeNull();
  });

  it('re-reads the list of backfilling days on a day switch but reuses it after a counter operation (#513 review)', async () => {
    repositoryMock.loadSnapshot.mockResolvedValue(backfillSnapshot());
    renderComponent('uid-1:1', GAP);
    await selectStudent('001');
    fireEvent.click(screen.getByRole('button', { name: '繳費（W）' }));
    fireEvent.change(screen.getByLabelText(/繳費金額/), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/紙本號/), { target: { value: 'A-0130' } });
    fireEvent.click(screen.getByTestId('submit-order-button'));
    expect(await screen.findByText(/已確認/)).toBeVisible();
    // First load: no list passed. After the payment: the list the page already holds is passed on.
    expect(repositoryMock.loadSnapshot).toHaveBeenNthCalledWith(1, { dayId: GAP });
    expect(repositoryMock.loadSnapshot).toHaveBeenNthCalledWith(2, { dayId: GAP, knownBackfillDays: [marker] });
    // Switching the day asks the server again.
    fireEvent.click(screen.getByTestId('leave-backfill-button'));
    await waitFor(() => expect(repositoryMock.loadSnapshot).toHaveBeenLastCalledWith({ dayId: null }));
  });

  it('re-reads the list of backfilling days after the server rejects an operation (P11c3 review)', async () => {
    repositoryMock.loadSnapshot.mockResolvedValue(backfillSnapshot());
    repositoryMock.createPayment.mockResolvedValueOnce(errorResult('REVISION_CONFLICT'));
    renderComponent('uid-1:1', GAP);
    await selectStudent('001');
    fireEvent.click(screen.getByRole('button', { name: '繳費（W）' }));
    fireEvent.change(screen.getByLabelText(/繳費金額/), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/紙本號/), { target: { value: 'A-0130' } });
    fireEvent.click(screen.getByTestId('submit-order-button'));
    await waitFor(() => expect(repositoryMock.createPayment).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(repositoryMock.loadSnapshot).toHaveBeenCalledTimes(2));
    // The reload after a definite rejection passes no known list, so the server is asked again.
    expect(repositoryMock.loadSnapshot).toHaveBeenNthCalledWith(2, { dayId: GAP });
  });

  it('does not reuse a list that could not be read', async () => {
    repositoryMock.loadSnapshot.mockResolvedValue(backfillSnapshot({ backfillDays: [], backfillDaysError: '連線中斷' }));
    renderComponent('uid-1:1', GAP);
    await selectStudent('001');
    fireEvent.click(screen.getByRole('button', { name: '繳費（W）' }));
    fireEvent.change(screen.getByLabelText(/繳費金額/), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/紙本號/), { target: { value: 'A-0130' } });
    fireEvent.click(screen.getByTestId('submit-order-button'));
    expect(await screen.findByText(/已確認/)).toBeVisible();
    expect(repositoryMock.loadSnapshot).toHaveBeenNthCalledWith(2, { dayId: GAP });
  });

  it('records counter cash on the backfilled day', async () => {
    repositoryMock.loadSnapshot.mockResolvedValue(backfillSnapshot());
    renderComponent('uid-1:1', GAP);
    await screen.findByTestId('backfill-banner');
    fireEvent.click(screen.getByTestId('open-cash-movement-button'));
    fireEvent.change(await screen.findByLabelText(/金額/), { target: { value: '80' } });
    fireEvent.change(screen.getByLabelText(/原因/), { target: { value: '補買零錢' } });
    fireEvent.change(screen.getByLabelText(/紙本號/), { target: { value: 'A-0125' } });
    fireEvent.click(screen.getByTestId('submit-cash-movement-button'));
    await waitFor(() => expect(repositoryMock.createCashMovement).toHaveBeenCalledTimes(1));
    expect(repositoryMock.createCashMovement.mock.calls[0][0]).toMatchObject({ dayId: GAP, reason: '紙本A-0125：補買零錢' });
  });

  it('hides 取消訂餐並退還 for a paid order and explains why', async () => {
    repositoryMock.loadSnapshot.mockResolvedValue(backfillSnapshot());
    renderComponent('uid-1:1', GAP);
    await selectStudent('001');
    fireEvent.click(screen.getByTestId('open-payment-details-button'));
    fireEvent.click(within(await screen.findByTestId('detail-row-tx-live')).getByRole('button', { name: '更正' }));
    expect(await screen.findByRole('button', { name: '取消訂餐，錢留在帳戶' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /取消訂餐並退還/ })).toBeNull();
    expect(screen.getByTestId('backfill-cancel-refund-note')).toHaveTextContent('回填中不能');
  });

  it('refuses a day that was closed after being marked, and falls back to today with a button', async () => {
    repositoryMock.loadSnapshot.mockImplementation(async (options: { dayId?: string | null } = {}) => {
      if (options.dayId) throw { code: 'INVALID_INPUT', message: `${options.dayId} 沒有回填標記` };
      return snapshot();
    });
    renderComponent('uid-1:1', GAP);
    expect(await screen.findByText(/沒有回填標記/)).toBeVisible();
    fireEvent.click(screen.getByTestId('back-to-today-button'));
    expect(await screen.findByTestId('cloud-topbar-bento')).toBeVisible();
    expect(repositoryMock.loadSnapshot).toHaveBeenLastCalledWith({ dayId: null });
  });

  it('keeps today usable when only the list of backfilling days could not be read', async () => {
    repositoryMock.loadSnapshot.mockResolvedValue(snapshot({ backfillDays: [], backfillDaysError: '網路中斷' }));
    renderComponent();
    expect(await screen.findByTestId('orders-backfill-list-error')).toHaveTextContent('網路中斷');
    await selectStudent('001');
    expect(screen.getByTestId('submit-order-button')).toBeEnabled();
  });

  describe('P13d2 paper number', () => {
    const fillOtherMeal = async () => {
      await selectStudent('002');
      fireEvent.click(screen.getByRole('button', { name: '其他餐點' }));
      fireEvent.change(screen.getByLabelText(/餐點品名/), { target: { value: '水餃' } });
      fireEvent.change(screen.getByLabelText(/餐點單價/), { target: { value: '70' } });
    };

    it('asks for the number on a backfill day and says so by name when it is missing — nothing is sent', async () => {
      repositoryMock.loadSnapshot.mockResolvedValue(backfillSnapshot({ transactions: [] }));
      renderComponent('uid-1:1', GAP);
      await fillOtherMeal();
      expect(screen.getByLabelText('紙本號（必填）')).toBeVisible();
      fireEvent.click(screen.getByTestId('submit-order-button'));
      expect(await screen.findByText('補登日必須填紙本號（1 至 20 字的英數與 -，例如 A-0123）')).toBeVisible();
      expect(repositoryMock.createOrder).not.toHaveBeenCalled();
      // The typed meal survives the refusal, and a valid number then goes through.
      expect(screen.getByLabelText(/餐點品名/)).toHaveValue('水餃');
      fireEvent.change(screen.getByLabelText(/紙本號/), { target: { value: 'A-0126' } });
      fireEvent.click(screen.getByTestId('submit-order-button'));
      await waitFor(() => expect(repositoryMock.createOrder).toHaveBeenCalledTimes(1));
    });

    it('refuses a malformed number with its own message, for order and payment', async () => {
      repositoryMock.loadSnapshot.mockResolvedValue(backfillSnapshot({ transactions: [] }));
      renderComponent('uid-1:1', GAP);
      await fillOtherMeal();
      fireEvent.change(screen.getByLabelText(/紙本號/), { target: { value: 'A 0123' } });
      fireEvent.click(screen.getByTestId('submit-order-button'));
      expect(await screen.findByText('紙本號只能是 1 至 20 字的英數與 -（例如 A-0123）')).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: '繳費（W）' }));
      fireEvent.change(screen.getByLabelText(/繳費金額/), { target: { value: '50' } });
      fireEvent.change(screen.getByLabelText(/紙本號/), { target: { value: 'a'.repeat(21) } });
      fireEvent.click(screen.getByTestId('submit-order-button'));
      expect(await screen.findByText('紙本號只能是 1 至 20 字的英數與 -（例如 A-0123）')).toBeVisible();
      expect(repositoryMock.createOrder).not.toHaveBeenCalled();
      expect(repositoryMock.createPayment).not.toHaveBeenCalled();
    });

    it('asks for the number on counter cash of a backfill day, and names a malformed one', async () => {
      repositoryMock.loadSnapshot.mockResolvedValue(backfillSnapshot({ transactions: [] }));
      renderComponent('uid-1:1', GAP);
      await screen.findByTestId('backfill-banner');
      fireEvent.click(screen.getByTestId('open-cash-movement-button'));
      fireEvent.change(await screen.findByLabelText(/金額/), { target: { value: '80' } });
      fireEvent.change(screen.getByLabelText(/原因/), { target: { value: '補買零錢' } });
      expect(screen.getByLabelText('紙本號（必填）')).toBeVisible();
      fireEvent.click(screen.getByTestId('submit-cash-movement-button'));
      expect(await screen.findByText('補登日必須填紙本號（1 至 20 字的英數與 -，例如 A-0123）')).toBeVisible();
      fireEvent.change(screen.getByLabelText(/紙本號/), { target: { value: 'A:1' } });
      fireEvent.click(screen.getByTestId('submit-cash-movement-button'));
      expect(await screen.findByText('紙本號只能是 1 至 20 字的英數與 -（例如 A-0123）')).toBeVisible();
      expect(repositoryMock.createCashMovement).not.toHaveBeenCalled();
    });

    it('puts the number in front of the typed remark', async () => {
      repositoryMock.loadSnapshot.mockResolvedValue(backfillSnapshot({ transactions: [] }));
      renderComponent('uid-1:1', GAP);
      await fillOtherMeal();
      fireEvent.change(screen.getByLabelText(/紙本號/), { target: { value: ' A-0127 ' } });
      fireEvent.change(screen.getByLabelText('備註（選填）'), { target: { value: ' 前天停電 ' } });
      fireEvent.click(screen.getByTestId('submit-order-button'));
      await waitFor(() => expect(repositoryMock.createOrder).toHaveBeenCalledTimes(1));
      expect(repositoryMock.createOrder.mock.calls[0][0]).toMatchObject({ note: '紙本A-0127：前天停電' });
    });

    it('shows the number as its own tag on cash rows and payment-detail rows, with the remark text beside it', async () => {
      const cash = {
        ...mockTx('tx-cash', '__cashier__', 'other', 0, 50), type: 'expense' as const, mealKind: null, otherItemName: null,
        studentNameSnapshot: '櫃台', businessDate: GAP, note: '紙本A-0128：零錢補充', amount: 50,
      };
      const paid = { ...gapTx('tx-paper', '2026-10-16T05:00:00.000Z'), note: '紙本B-9：' };
      repositoryMock.loadSnapshot.mockResolvedValue(backfillSnapshot({ transactions: [cash, paid] }));
      renderComponent('uid-1:1', GAP);
      const row = await screen.findByTestId('cash-row-tx-cash');
      expect(within(row).getByTestId('paper-tag-tx-cash')).toHaveTextContent('紙本 A-0128');
      expect(row).toHaveTextContent('零錢補充');
      expect(row).not.toHaveTextContent('紙本A-0128：');
      await selectStudent('001');
      fireEvent.click(screen.getByTestId('open-payment-details-button'));
      expect(within(await screen.findByTestId('detail-row-tx-paper')).getByTestId('paper-tag-tx-paper')).toHaveTextContent('紙本 B-9');
    });

    it('locks the number when a row that carries one is corrected — only the text after it is editable', async () => {
      repositoryMock.mutateTransaction.mockImplementation(async (input: { commandId: string }) => okResult(input.commandId, 20));
      const cash = {
        ...mockTx('tx-cash', '__cashier__', 'other', 0, 50), type: 'expense' as const, mealKind: null, otherItemName: null,
        studentNameSnapshot: '櫃台', businessDate: GAP, note: '紙本A-0128：零錢補充', amount: 50,
      };
      repositoryMock.loadSnapshot.mockResolvedValue(backfillSnapshot({ transactions: [cash] }));
      renderComponent('uid-1:1', GAP);
      fireEvent.click(within(await screen.findByTestId('cash-row-tx-cash')).getByRole('button', { name: '更正' }));
      await screen.findByTestId('edit-transaction-modal');
      expect(screen.getByTestId('edit-paper-ref')).toHaveTextContent('紙本號 A-0128（更正時不能修改）');
      expect(screen.getByLabelText('收支原因')).toHaveValue('零錢補充');
      // The number cannot be typed over, and an empty reason is refused by name.
      fireEvent.change(screen.getByLabelText('收支原因'), { target: { value: '' } });
      fireEvent.change(screen.getByLabelText(/修改理由/), { target: { value: '寫錯了' } });
      fireEvent.click(screen.getByTestId('submit-edit-button'));
      expect(screen.getByTestId('edit-preview')).toHaveTextContent('更正後的收支原因不能空白');
      expect(repositoryMock.mutateTransaction).not.toHaveBeenCalled();
      fireEvent.change(screen.getByLabelText('收支原因'), { target: { value: '零錢補充（更正）' } });
      fireEvent.click(screen.getByTestId('submit-edit-button'));
      await waitFor(() => expect(repositoryMock.mutateTransaction).toHaveBeenCalledTimes(1));
      expect(repositoryMock.mutateTransaction.mock.calls[0][0]).toMatchObject({
        kind: 'CorrectTransaction', payload: { note: '紙本A-0128：零錢補充（更正）' },
      });
    });

    it('corrects a row without a number as before: the note is sent as typed and no number is shown', async () => {
      repositoryMock.mutateTransaction.mockImplementation(async (input: { commandId: string }) => okResult(input.commandId, 20));
      repositoryMock.loadSnapshot.mockResolvedValue(backfillSnapshot());
      renderComponent('uid-1:1', GAP);
      await selectStudent('001');
      fireEvent.click(screen.getByTestId('open-payment-details-button'));
      fireEvent.click(within(await screen.findByTestId('detail-row-tx-live')).getByRole('button', { name: '更正' }));
      await screen.findByTestId('edit-transaction-modal');
      expect(screen.queryByTestId('edit-paper-ref')).toBeNull();
      fireEvent.change(screen.getByLabelText('備註'), { target: { value: '改備註' } });
      fireEvent.change(screen.getByLabelText(/修改理由/), { target: { value: '補寫' } });
      fireEvent.click(screen.getByTestId('submit-edit-button'));
      await waitFor(() => expect(repositoryMock.mutateTransaction).toHaveBeenCalledTimes(1));
      expect(repositoryMock.mutateTransaction.mock.calls[0][0]).toMatchObject({ kind: 'CorrectTransaction', payload: { note: '改備註' } });
    });
  });

  describe('P13d2 paper number on today', () => {
    const payToday = async (paperRef: string) => {
      repositoryMock.loadSnapshot.mockResolvedValue(snapshot());
      renderComponent();
      await selectStudent('002');
      expect(screen.getByLabelText('紙本號（選填）')).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: '繳費（W）' }));
      fireEvent.change(screen.getByLabelText(/繳費金額/), { target: { value: '50' } });
      fireEvent.change(screen.getByLabelText('備註（選填）'), { target: { value: '現金' } });
      if (paperRef) fireEvent.change(screen.getByLabelText(/紙本號/), { target: { value: paperRef } });
      fireEvent.click(screen.getByTestId('submit-order-button'));
      await waitFor(() => expect(repositoryMock.createPayment).toHaveBeenCalledTimes(1));
    };

    it('is optional today: without a number the note is sent exactly as typed', async () => {
      await payToday('');
      expect(repositoryMock.createPayment.mock.calls[0][0]).toMatchObject({ note: '現金' });
    });

    it('accepts a number today as well, and puts it in front of the note', async () => {
      await payToday('A-0200');
      expect(repositoryMock.createPayment.mock.calls[0][0]).toMatchObject({ note: '紙本A-0200：現金' });
    });

    it('still names a malformed number today', async () => {
      repositoryMock.loadSnapshot.mockResolvedValue(snapshot());
      renderComponent();
      await selectStudent('002');
      fireEvent.click(screen.getByRole('button', { name: '繳費（W）' }));
      fireEvent.change(screen.getByLabelText(/繳費金額/), { target: { value: '50' } });
      fireEvent.change(screen.getByLabelText(/紙本號/), { target: { value: '紙本1：' } });
      fireEvent.click(screen.getByTestId('submit-order-button'));
      expect(await screen.findByText('紙本號只能是 1 至 20 字的英數與 -（例如 A-0123）')).toBeVisible();
      expect(repositoryMock.createPayment).not.toHaveBeenCalled();
    });
  });
});
