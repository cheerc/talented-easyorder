import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

// Mock usePosStore for all screen components
const mockState = {
  transactions: [],
  students: [],
  vendors: [],
  todayMenu: { itemName: '排骨便當', price: 90, vendorId: 'v1', vendorNameSnapshot: '老王便當' },
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

vi.mock('../../store/posStore', () => {
  const usePosStore = (selector: Parameters<typeof import('../../store/posStore').usePosStore>[0]) => selector(mockState);
  usePosStore.getState = () => mockState;
  return { usePosStore };
});

import { ReportScreen } from '../screens/ReportScreen';
import { AdminScreen } from '../screens/AdminScreen';
import { VendorsScreen } from '../screens/VendorsScreen';
import { BackupScreen } from '../screens/BackupScreen';
import { HistoryScreen } from '../screens/HistoryScreen';

const mockMenu = { itemName: '排骨便當', price: 90, vendorId: 'v1', vendorNameSnapshot: '老王便當' };

describe('ReportScreen', () => {
  it('renders with mock store', () => {
    const { container } = render(
      <ReportScreen
        todayMenu={mockMenu}
        viewDate="2026-05-29"
      />
    );
    expect(container).toBeTruthy();
  });
});

describe('AdminScreen', () => {
  it('renders settings card', () => {
    const { container } = render(
      <AdminScreen
        todayMenu={mockMenu}
        setTodayMenu={() => {}}
        vendors={[]}
        students={[]}
        resetData={() => {}}
        openingCash={0}
        dateStatus="open"
        hasCashSession={false}
        onOpeningCashChange={() => {}}
        onUpdateOpeningCash={() => {}}
        tweaks={{ theme: 'warm', fontSize: 'lg', disableHoverSelection: true }}
        setTweak={() => {}}
      />
    );
    expect(container.textContent).toContain('今日設定');
  });
});

describe('VendorsScreen', () => {
  it('renders vendor list', () => {
    const { container } = render(
      <VendorsScreen vendors={[]} setVendors={() => {}} />
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
