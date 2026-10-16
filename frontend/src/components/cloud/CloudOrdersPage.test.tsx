import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { Timestamp } from 'firebase/firestore';
import type { CloudStudentRecord } from '../../firebase/cloudStudentRepository';
import type { CloudDayRecord, CloudDayVendorSnapshot } from '../../firebase/cloudDayVendorRepository';
import type { CloudTransactionDoc } from '../../firebase/firestoreSchema';
import type { CommandResult } from '../../domain/cloudCommands';
import { CloudOrdersPage } from './CloudOrdersPage';

const studentRepoMock = vi.hoisted(() => ({
  list: vi.fn(),
  listStudents: vi.fn(),
}));

const dayVendorRepoMock = vi.hoisted(() => ({
  loadSnapshot: vi.fn(),
  getDay: vi.fn(),
}));

const orderRepoMock = vi.hoisted(() => ({
  createOrder: vi.fn(),
  listDayTransactions: vi.fn(),
}));

vi.mock('../../firebase/cloudStudentRepository', () => ({
  createCloudStudentRepository: () => studentRepoMock,
}));

vi.mock('../../firebase/cloudDayVendorRepository', () => ({
  createCloudDayVendorRepository: () => dayVendorRepoMock,
}));

vi.mock('../../firebase/cloudOrderRepository', () => ({
  createCloudOrderRepository: () => orderRepoMock,
}));

function mockTimestamp(iso: string) {
  const d = new Date(iso);
  return {
    toDate: () => d,
    toMillis: () => d.getTime(),
    seconds: Math.floor(d.getTime() / 1000),
    nanoseconds: 0,
  } as unknown as Timestamp;
}

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
    revision: 1,
    lastCommandId: 'cmd-student-1',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

function mockDay(hasMenu = true): CloudDayRecord {
  return {
    dayId: '2026-10-16',
    status: 'open',
    revision: 1,
    menu: hasMenu ? {
      businessDate: '2026-10-16',
      vendorId: 'v1',
      vendorNameSnapshot: '阿榮便當',
      itemName: '排骨便當',
      price: 90,
      inheritedFromDate: null,
      revision: 1,
      updatedAt: '2026-10-16T00:00:00.000Z',
    } : null,
    openingCash: 3000,
    openedBy: 'operator-1',
    openedAt: '2026-10-16T00:00:00.000Z',
    totals: {
      activeTransactionCount: 0,
      bentoCount: 0,
      otherMealCount: 0,
      mealTotal: 0,
      retainedReceipts: 0,
      cashierIncome: 0,
      cashierExpense: 0,
    },
    lastSettlementRevision: 0,
    lastCommandId: 'cmd-day-1',
    updatedAt: '2026-10-16T00:00:00.000Z',
  };
}

function mockTx(txId: string, studentId: string, mealKind: 'bento' | 'other', mealPrice: number, paidAmount: number, otherItemName: string | null = null): CloudTransactionDoc {
  return {
    transactionId: txId,
    studentId,
    businessDate: '2026-10-16',
    type: 'order',
    mealKind,
    mealPrice,
    paidAmount,
    amount: paidAmount - mealPrice,
    studentNameSnapshot: '王小明',
    menuNameSnapshot: mealKind === 'bento' ? '排骨便當' : '',
    menuPriceSnapshot: mealKind === 'bento' ? mealPrice : 0,
    vendorIdSnapshot: mealKind === 'bento' ? 'v1' : '',
    vendorNameSnapshot: mealKind === 'bento' ? '阿榮便當' : '',
    otherItemName,
    status: 'active',
    revision: 1,
    createdAt: mockTimestamp('2026-10-16T04:30:00.000Z'),
    createdSeq: 1,
    operatorUid: 'op-1',
    operatorEmail: 'op@example.com',
    sourceDevice: 'pc',
    note: '',
    lastCommandId: 'cmd-tx-1',
    updatedAt: mockTimestamp('2026-10-16T04:30:00.000Z'),
  };
}

function renderComponent(identityKey = 'uid-1:1') {
  return render(
    <CloudOrdersPage
      db={{} as Firestore}
      leaseEpoch={1}
      identityKey={identityKey}
    />
  );
}

describe('CloudOrdersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const studentListResult = {
      students: [
        mockStudent('s1', '001', '王小明', 100),
        mockStudent('s2', '002', '李小華', 50),
        mockStudent('s3', '003', '張小停', 0, 'inactive'),
      ],
      seq: 1,
      datasetId: 'ds-1',
      goLiveDate: '2026-10-01',
    };
    studentRepoMock.list.mockResolvedValue(studentListResult);
    studentRepoMock.listStudents.mockResolvedValue(studentListResult);
    dayVendorRepoMock.loadSnapshot.mockResolvedValue({
      day: mockDay(true),
      vendors: [],
      sourceDays: [],
      seq: 1,
      datasetId: 'ds-1',
      goLiveDate: '2026-10-01',
    } as unknown as CloudDayVendorSnapshot);
    dayVendorRepoMock.getDay.mockResolvedValue(mockDay(true));
    orderRepoMock.listDayTransactions.mockResolvedValue([
      mockTx('tx-1', 's1', 'bento', 90, 100),
      mockTx('tx-2', 's2', 'other', 60, 0, '炒麵'),
    ]);
    orderRepoMock.createOrder.mockResolvedValue({
      ok: true,
      receipt: {
        commandId: 'cmd-new',
        seq: 2,
        committedAt: '2026-10-16T05:00:00.000Z',
        kind: 'CreateOrder',
        targets: { transactionId: 'tx-new', studentId: 's1', dayId: '2026-10-16' },
        result: {},
      },
    } as CommandResult);
  });

  it('renders topbar counts with two rows (U2a contract)', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByTestId('cloud-topbar-counts')).toBeVisible();
    });

    const bentoRow = screen.getByTestId('cloud-topbar-bento');
    expect(bentoRow).toHaveTextContent('今日餐點（排骨便當）');
    expect(bentoRow).toHaveTextContent('1');

    const otherRow = screen.getByTestId('cloud-topbar-other');
    expect(otherRow).toHaveTextContent('其他餐點');
    expect(otherRow).toHaveTextContent('1');
  });

  it('searches and selects student by code and submits a bento order', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByLabelText('搜尋編號、姓名或別名')).toBeVisible();
    });

    const searchInput = screen.getByLabelText('搜尋編號、姓名或別名');
    fireEvent.change(searchInput, { target: { value: '001' } });

    await waitFor(() => {
      expect(screen.getByTestId('search-result-001')).toBeVisible();
    });
    fireEvent.click(screen.getByTestId('search-result-001'));

    // 進入已選學生狀態
    await waitFor(() => {
      expect(screen.getByTestId('selected-student-card')).toHaveTextContent('王小明');
    });

    // 填寫實收金額 90
    const paidInput = screen.getByLabelText(/實收金額/);
    fireEvent.change(paidInput, { target: { value: '90' } });

    // 因為 s1 今天已有一筆訂餐，按下確認登記應彈出加訂確認對話框
    const submitBtn = screen.getByTestId('submit-order-button');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/今天已訂過 1 份餐點， 確定要再加訂 1 份嗎？/)).toBeVisible();
    });

    // 點擊確認加訂
    const confirmAddBtn = screen.getByTestId('confirm-duplicate-button');
    fireEvent.click(confirmAddBtn);

    await waitFor(() => {
      expect(orderRepoMock.createOrder).toHaveBeenCalledWith(expect.objectContaining({
        studentId: 's1',
        mealKind: 'bento',
        mealPrice: 90,
        paidAmount: 90,
        menuRevision: 1,
      }));
      expect(screen.getByText('已確認 001 王小明 訂餐完成')).toBeVisible();
    });
  });

  it('disables order button and shows alert when inactive student is selected', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByLabelText('搜尋編號、姓名或別名')).toBeVisible();
    });

    const searchInput = screen.getByLabelText('搜尋編號、姓名或別名');
    fireEvent.change(searchInput, { target: { value: '003' } });

    await waitFor(() => {
      expect(screen.getByTestId('search-result-003')).toBeVisible();
    });
    fireEvent.click(screen.getByTestId('search-result-003'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('此帳戶已停用，禁止新增餐點');
      expect(screen.queryByTestId('submit-order-button')).toBeNull();
    });
  });

  it('supports ordering other meal when no today menu is configured', async () => {
    dayVendorRepoMock.loadSnapshot.mockResolvedValue({
      day: mockDay(false), // 沒有菜單
      vendors: [],
      sourceDays: [],
      seq: 1,
      datasetId: 'ds-1',
      goLiveDate: '2026-10-01',
    } as unknown as CloudDayVendorSnapshot);
    dayVendorRepoMock.getDay.mockResolvedValue(mockDay(false));
    orderRepoMock.listDayTransactions.mockResolvedValue([]);

    renderComponent();
    await waitFor(() => {
      expect(screen.getByLabelText('搜尋編號、姓名或別名')).toBeVisible();
    });

    // 頂部顯示「今日餐點（未設定）」
    expect(screen.getByTestId('cloud-topbar-bento')).toHaveTextContent('今日餐點（未設定）');

    // 選取 002
    const searchInput = screen.getByLabelText('搜尋編號、姓名或別名');
    fireEvent.change(searchInput, { target: { value: '002' } });
    await waitFor(() => {
      expect(screen.getByTestId('search-result-002')).toBeVisible();
    });
    fireEvent.click(screen.getByTestId('search-result-002'));

    // 今日餐點提示無菜單且提交禁用
    await waitFor(() => {
      expect(screen.getByText('今日尚未設定菜單，無法訂購今日餐點')).toBeVisible();
      expect(screen.getByTestId('submit-order-button')).toBeDisabled();
    });

    // 切換至其他餐點
    fireEvent.click(screen.getByRole('button', { name: '其他餐點' }));

    const nameInput = screen.getByLabelText(/餐點品名/);
    const priceInput = screen.getByLabelText(/餐點單價/);
    fireEvent.change(nameInput, { target: { value: '素食便當' } });
    fireEvent.change(priceInput, { target: { value: '80' } });

    // 002 今日無訂單，直接送出不需加訂確認
    const submitBtn = screen.getByTestId('submit-order-button');
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(orderRepoMock.createOrder).toHaveBeenCalledWith(expect.objectContaining({
        studentId: 's2',
        mealKind: 'other',
        mealPrice: 80,
        paidAmount: 0,
        menuRevision: null,
        otherItemName: '素食便當',
      }));
    });
  });

  it('opens payment details modal (E) and calculates summary correctly', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByLabelText('搜尋編號、姓名或別名')).toBeVisible();
    });

    const searchInput = screen.getByLabelText('搜尋編號、姓名或別名');
    fireEvent.change(searchInput, { target: { value: '001' } });
    await waitFor(() => {
      expect(screen.getByTestId('search-result-001')).toBeVisible();
    });
    fireEvent.click(screen.getByTestId('search-result-001'));

    await waitFor(() => {
      expect(screen.getByTestId('open-payment-details-button')).toBeVisible();
    });

    fireEvent.click(screen.getByTestId('open-payment-details-button'));

    await waitFor(() => {
      expect(screen.getByTestId('payment-details-modal')).toBeVisible();
      expect(screen.getByText('王小明 今日付款明細')).toBeVisible();
      expect(screen.getByText('今日餐點：排骨便當')).toBeVisible();
      expect(screen.getByTestId('payment-details-summary')).toHaveTextContent('今日餐費：$90');
      expect(screen.getByTestId('payment-details-summary')).toHaveTextContent('今日收款：$100');
      expect(screen.getByTestId('payment-details-summary')).toHaveTextContent('帳戶餘額：$100');
    });

    // 點擊關閉
    fireEvent.click(screen.getByTestId('close-payment-details-button'));
    await waitFor(() => {
      expect(screen.queryByTestId('payment-details-modal')).toBeNull();
    });
  });

  it('renders recent accounts strip with correct classification tags', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByTestId('recent-accounts-card')).toBeVisible();
    });

    const item001 = screen.getByTestId('recent-item-001');
    expect(item001).toHaveTextContent('001 王小明');
    expect(item001).toHaveTextContent('今日餐點 1');

    const item002 = screen.getByTestId('recent-item-002');
    expect(item002).toHaveTextContent('002 李小華');
    expect(item002).toHaveTextContent('其他餐點 1');
  });
});
