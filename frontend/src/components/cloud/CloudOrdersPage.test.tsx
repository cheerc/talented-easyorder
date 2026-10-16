import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  readCommand: vi.fn(),
}));

vi.mock('../../firebase/cloudOrderRepository', () => ({
  createCloudOrderRepository: () => repositoryMock,
}));

const TODAY = '2026-10-16';
const PENDING_KEY = 'easyorder-cloud-pending-order';

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

function okResult(commandId: string, seq = 10): CommandResult {
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
  } as CommandResult;
}

function errorResult(code: string, message = 'synthetic'): CommandResult {
  return { ok: false, error: { code, message } } as CommandResult;
}

const onNavigationStateChange = vi.fn();

function renderComponent(identityKey = 'uid-1:1') {
  return render(
    <CloudOrdersPage
      db={{} as Firestore}
      leaseEpoch={1}
      identityKey={identityKey}
      onNavigationStateChange={onNavigationStateChange}
    />,
  );
}

async function selectStudent(code: string) {
  const searchInput = await screen.findByLabelText('搜尋編號、姓名或別名');
  fireEvent.change(searchInput, { target: { value: code } });
  fireEvent.click(await screen.findByTestId(`search-result-${code}`));
  await screen.findByTestId('selected-student-card');
}

describe('CloudOrdersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    repositoryMock.loadSnapshot.mockResolvedValue(snapshot());
    repositoryMock.readCommand.mockResolvedValue(null);
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
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull();
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
    const stored = JSON.parse(window.localStorage.getItem(PENDING_KEY) ?? '{}');
    const first = repositoryMock.createOrder.mock.calls[0][0];
    expect(stored).toEqual({ uid: 'uid-1', datasetId: 'ds-1', commandId: first.commandId });
    expect(onNavigationStateChange).toHaveBeenLastCalledWith('uid-1:1', 'recovering');

    fireEvent.click(screen.getByTestId('order-recovery-retry'));
    await waitFor(() => expect(repositoryMock.createOrder).toHaveBeenCalledTimes(2));
    const second = repositoryMock.createOrder.mock.calls[1][0];
    expect(second).toEqual(first);
    expect(await screen.findByText(/已確認 002 李小華 訂餐完成（命令序號 11）/)).toBeVisible();
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull();
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
    expect(window.localStorage.getItem(PENDING_KEY)).not.toBeNull();
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
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull();
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

  it('checks an unresolved command left by an earlier page load with the same commandId', async () => {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify({ uid: 'uid-1', datasetId: 'ds-1', commandId: 'cmd-old' }));
    repositoryMock.readCommand.mockResolvedValue({ commandId: 'cmd-old', seq: 8 });
    renderComponent();
    expect(await screen.findByText(/上次未確認的登記已確認入帳（命令序號 8）/)).toBeVisible();
    expect(repositoryMock.readCommand).toHaveBeenCalledWith('cmd-old');
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it('keeps warning about an earlier unresolved command the server has not found', async () => {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify({ uid: 'uid-1', datasetId: 'ds-1', commandId: 'cmd-old' }));
    renderComponent();
    const panel = await screen.findByTestId('stored-pending-panel');
    expect(panel).toHaveTextContent('勿重新收款');
    expect(await screen.findByText(/伺服器目前沒有這筆命令/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '確認未入帳並清除提醒' }));
    await waitFor(() => expect(screen.queryByTestId('stored-pending-panel')).toBeNull());
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull();
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
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull();
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
    expect(await screen.findByTestId('order-recovery-panel')).toHaveTextContent('李小華 的繳費已送出');
    fireEvent.click(screen.getByTestId('order-recovery-retry'));
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
    expect(panel).toHaveTextContent('櫃台支出 $80 的櫃台收支已送出');
    expect(panel).toHaveTextContent('勿重新收款');
    expect(screen.getByTestId('submit-cash-movement-button')).toBeDisabled();
    const first = repositoryMock.createCashMovement.mock.calls[0][0];
    expect(JSON.parse(window.localStorage.getItem(PENDING_KEY) ?? '{}')).toEqual({ uid: 'uid-1', datasetId: 'ds-1', commandId: first.commandId });

    fireEvent.click(screen.getByTestId('order-recovery-retry'));
    await waitFor(() => expect(repositoryMock.createCashMovement).toHaveBeenCalledTimes(2));
    expect(repositoryMock.createCashMovement.mock.calls[1][0]).toEqual(first);
    expect(await screen.findByText(/已確認櫃台支出 \$80入帳（命令序號 16）/)).toBeVisible();
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull();
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
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull();
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
    expect(await screen.findByTestId('order-recovery-panel')).toHaveTextContent('001 王小明 的退款已送出');
    fireEvent.click(screen.getByTestId('order-recovery-retry'));
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
});
