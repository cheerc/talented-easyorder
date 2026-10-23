import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { TransactionActions } from '../../store/posTypes';
import { useUiTweaksStore, UI_TWEAKS_STORAGE_KEY } from '../../store/uiTweaksStore';

// Mock usePosStore for all screen components
const mockState = {
  transactions: [],
  students: [],
  vendors: [],
  todayMenu: { itemName: '排骨餐點', price: 90, vendorId: 'v1', vendorNameSnapshot: '老王便當' },
  closeBusinessDate: vi.fn(),
  reopenBusinessDate: vi.fn(),
  deleteOrderWithRefundCheck: vi.fn(),
  getBusinessDateStatus: vi.fn(() => 'open'),
  cashSessions: {},
  dailySettlements: [],
  deleteTransaction: vi.fn(),
  editTransaction: vi.fn(),
  auditEvents: [],
  resetData: vi.fn(),
  openCashSession: vi.fn(),
  updateOpeningCash: vi.fn(),
  setTodayMenu: vi.fn(),
  setVendors: vi.fn(),
};

vi.mock('../../store/selectors', () => ({
  useSessionActions: () => ({
    closeBusinessDate: mockState.closeBusinessDate,
    reopenBusinessDate: mockState.reopenBusinessDate,
    getBusinessDateStatus: mockState.getBusinessDateStatus,
    setBusinessDateStatus: vi.fn(),
    openCashSession: mockState.openCashSession,
    updateOpeningCash: mockState.updateOpeningCash,
  }),
  useTransactionActions: () => ({
    deleteOrderWithRefundCheck: mockState.deleteOrderWithRefundCheck,
    deleteTransaction: mockState.deleteTransaction,
    editTransaction: mockState.editTransaction,
    commitPosTransactionDraft: vi.fn<TransactionActions['commitPosTransactionDraft']>(() => ({ ok: true, transactionId: 'tx-mock' })),
    processTransaction: vi.fn(),
    updateTransaction: vi.fn(),
  }),
  useTransactions: () => ({ transactions: mockState.transactions }),
  useSession: () => ({
    auditEvents: mockState.auditEvents,
    dailySettlements: mockState.dailySettlements,
    businessDateStatuses: {},
    cashSessions: mockState.cashSessions,
  }),
  useStudents: () => ({ students: mockState.students }),
  useMenu: () => ({ todayMenu: mockState.todayMenu, vendors: mockState.vendors }),
  useMenuForDate: (date: string) => ({ source: 'own', menu: { ...mockState.todayMenu, businessDate: date } }),
  useMenuActions: () => ({ setTodayMenu: mockState.setTodayMenu, setMenuForDate: vi.fn(), setVendors: mockState.setVendors }),
  useGlobalActions: () => ({ resetData: mockState.resetData }),
  usePracticeDataActions: () => ({ startBlankData: vi.fn(), loadSampleData: vi.fn(), addLocalStudent: vi.fn(), setSimulationDate: vi.fn(), updateLocalStudent: vi.fn(), setLocalStudentStatus: vi.fn() }),
  useSimulationDate: () => null,
  useFace: () => ({ faceEvents: [], faceDevices: {} }),
  useFaceActions: () => ({ handleFaceEvent: vi.fn(), applyFaceEnrollment: vi.fn(), setFaceDeviceStatus: vi.fn() }),
}));

vi.mock('../../store/derived/useCashClose', () => ({
  useCashClose: () => ({ openingCash: 0, dateStatus: 'open', currentCashSession: undefined }),
}));

import { ReportScreen } from '../screens/ReportScreen';
import { AdminScreen } from '../screens/AdminScreen';
import { VendorsScreen } from '../screens/VendorsScreen';
import { BackupScreen } from '../screens/BackupScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { FirebaseProvider } from '../../providers/FirebaseProvider';

describe('ReportScreen', () => {
  it('renders with mock store', () => {
    const { container } = render(
      <FirebaseProvider>
        <ReportScreen
          viewDate="2026-05-29"
        />
      </FirebaseProvider>
    );
    expect(container).toBeTruthy();
  });
});

describe('AdminScreen', () => {
  beforeEach(() => {
    localStorage.clear();
    act(() => {
      useUiTweaksStore.getState().resetToDefault();
    });
  });

  it('renders settings card with default tweaks and applies to body', () => {
    const { container } = render(
      <FirebaseProvider>
        <AdminScreen viewDate="2026-05-29" />
      </FirebaseProvider>
    );
    expect(container.textContent).toContain('今日設定');
    expect(container.textContent).toContain('顯示設定');

    const themeSelect = screen.getByLabelText('主題') as HTMLSelectElement;
    const scaleSelect = screen.getByLabelText('字體大小') as HTMLSelectElement;
    const hoverSelect = screen.getByLabelText('停用滑鼠 hover 選取') as HTMLSelectElement;

    expect(themeSelect.value).toBe('warm');
    expect(scaleSelect.value).toBe('large');
    expect(hoverSelect.value).toBe('false');

    expect(document.body.getAttribute('data-theme')).toBe('warm');
    expect(document.body.getAttribute('data-scale')).toBe('large');
    expect(document.body.getAttribute('data-fs')).toBe('lg');
  });

  it('updates theme, scale, and hover in F3 and persists to localStorage and document.body', () => {
    render(
      <FirebaseProvider>
        <AdminScreen viewDate="2026-05-29" />
      </FirebaseProvider>
    );

    const themeSelect = screen.getByLabelText('主題') as HTMLSelectElement;
    const scaleSelect = screen.getByLabelText('字體大小') as HTMLSelectElement;
    const hoverSelect = screen.getByLabelText('停用滑鼠 hover 選取') as HTMLSelectElement;

    fireEvent.change(themeSelect, { target: { value: 'dark' } });
    fireEvent.change(scaleSelect, { target: { value: 'normal' } });
    fireEvent.change(hoverSelect, { target: { value: 'true' } });

    expect(themeSelect.value).toBe('dark');
    expect(scaleSelect.value).toBe('normal');
    expect(hoverSelect.value).toBe('true');

    expect(document.body.getAttribute('data-theme')).toBe('dark');
    expect(document.body.getAttribute('data-scale')).toBe('normal');
    expect(document.body.getAttribute('data-fs')).toBe('md');

    const stored = JSON.parse(localStorage.getItem(UI_TWEAKS_STORAGE_KEY) || '{}');
    expect(stored).toEqual({
      theme: 'dark',
      scale: 'normal',
      disableHoverSelection: true,
    });
  });

  it('preserves tweaks when AdminScreen unmounts and remounts without resetting to defaults', () => {
    const { unmount } = render(
      <FirebaseProvider>
        <AdminScreen viewDate="2026-05-29" />
      </FirebaseProvider>
    );

    fireEvent.change(screen.getByLabelText('主題'), { target: { value: 'light' } });
    fireEvent.change(screen.getByLabelText('字體大小'), { target: { value: 'normal' } });
    fireEvent.change(screen.getByLabelText('停用滑鼠 hover 選取'), { target: { value: 'true' } });

    unmount();

    // Re-mount AdminScreen (simulating switching back from another tab)
    render(
      <FirebaseProvider>
        <AdminScreen viewDate="2026-05-29" />
      </FirebaseProvider>
    );

    expect((screen.getByLabelText('主題') as HTMLSelectElement).value).toBe('light');
    expect((screen.getByLabelText('字體大小') as HTMLSelectElement).value).toBe('normal');
    expect((screen.getByLabelText('停用滑鼠 hover 選取') as HTMLSelectElement).value).toBe('true');

    expect(document.body.getAttribute('data-theme')).toBe('light');
    expect(document.body.getAttribute('data-scale')).toBe('normal');
  });
});

describe('VendorsScreen', () => {
  it('renders vendor list', () => {
    const { container } = render(
      <VendorsScreen />
    );
    expect(container).toBeTruthy();
  });
});

describe('BackupScreen', () => {
  it('renders backup options', () => {
    const { container } = render(<BackupScreen />);
    expect(container).toBeTruthy();
  });
});

describe('HistoryScreen', () => {
  it('renders tab switcher', () => {
    const { container } = render(<HistoryScreen />);
    expect(container.textContent).toContain('結帳歷史');
    expect(container.textContent).toContain('稽核軌跡');
  });
});
