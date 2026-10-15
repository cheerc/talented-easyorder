import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  RecentStrip, ExpensePanel, SearchBox,
  TopBar, MidnightBanner, CustomerCard, ActionBar,
  IdleHero, DuplicateWarningBanner, ConfirmBanner,
} from '../pos-components';
import type { StudentAccount } from '../../domain/student';
import type { LedgerGroup } from '../../domain/ledgerReport';
import type { LedgerTransaction } from '../../domain/ledger';


function makeTx(overrides: Partial<LedgerTransaction> & { transactionId: string; studentId: string; type: string }): LedgerTransaction {
  return {
    businessDate: '2026-01-01',
    createdAt: '2026-01-01T10:00:00Z',
    studentNameSnapshot: 'Test Student',
    mealPrice: 0,
    paidAmount: 0,
    amount: 0,
    afterBalance: 0,
    menuNameSnapshot: '',
    vendorNameSnapshot: '',
    sourceDevice: 'pc' as const,
    syncStatus: 'synced' as const,
    revision: 1,
    note: '',
    ...overrides,
  } as LedgerTransaction;
}

function makeGroup(studentId: string, name: string, transactions: LedgerTransaction[], balance: number): LedgerGroup {
  return {
    studentId,
    studentNameSnapshot: name,
    latestCreatedAt: transactions[transactions.length - 1]?.createdAt ?? '',
    mealTotal: transactions.filter(t => t.type === 'order').reduce((s, t) => s + t.mealPrice, 0),
    paidTotal: transactions.reduce((s, t) => s + t.paidAmount, 0),
    afterBalance: balance,
    recordCount: transactions.length,
    transactions,
  };
}

describe('RecentStrip', () => {
  it('renders student group rows with name and balance', () => {
    const groups = [
      makeGroup('S001', '王小明', [
        makeTx({ transactionId: 't1', studentId: 'S001', type: 'order', mealPrice: 90, afterBalance: -90 }),
      ], -90),
    ];
    render(<RecentStrip groups={groups} dateStatus="open" />);
    expect(screen.getByText('王小明')).toBeInTheDocument();
    expect(screen.getByText(/餘額/)).toBeInTheDocument();
    expect(screen.getByText('今日餐點 1')).toBeInTheDocument();
  });

  it('M2 F03：有目前餘額時顯示它，不用這串交易最後一筆的舊結餘', () => {
    const groups = [
      makeGroup('S001', '王小明', [
        makeTx({ transactionId: 't1', studentId: 'S001', type: 'order', mealPrice: 90, afterBalance: -90 }),
      ], -90),
    ];
    render(<RecentStrip groups={groups} balances={new Map([['S001', 30]])} dateStatus="open" />);
    expect(screen.getByText(/餘額/).textContent).toContain('+30');
  });

  it('does not show expand icons or detail rows', () => {
    const groups = [
      makeGroup('S001', '王小明', [
        makeTx({ transactionId: 't1', studentId: 'S001', type: 'order', mealPrice: 90, createdAt: '2026-01-01T10:00:00Z' }),
      ], -90),
    ];
    render(<RecentStrip groups={groups} dateStatus="open" />);
    // No expand icons
    expect(screen.queryByText('▸')).not.toBeInTheDocument();
    expect(screen.queryByText('▾')).not.toBeInTheDocument();
    // No detail rows (time is never shown)
    expect(screen.queryByText('10:00:00')).not.toBeInTheDocument();
  });

  it('clicking only triggers onStudentClick without expanding', async () => {
    const onStudentClick = vi.fn();
    const groups = [
      makeGroup('S001', '王小明', [
        makeTx({ transactionId: 't1', studentId: 'S001', type: 'order', mealPrice: 90, createdAt: '2026-01-01T10:00:00Z' }),
      ], -90),
    ];
    render(<RecentStrip groups={groups} dateStatus="open" onStudentClick={onStudentClick} />);

    await userEvent.click(screen.getByText('王小明'));
    expect(onStudentClick).toHaveBeenCalledWith('S001');
    // No detail rows appear
    expect(screen.queryByText('10:00:00')).not.toBeInTheDocument();
  });

  it('shows empty state when no groups', () => {
    render(<RecentStrip groups={[]} dateStatus="open" />);
    expect(screen.getByText('尚無交易')).toBeInTheDocument();
  });

  it('renders multiple student groups', () => {
    const groups = [
      makeGroup('S001', '王小明', [makeTx({ transactionId: 't1', studentId: 'S001', type: 'order', mealPrice: 90 })], -90),
      makeGroup('S002', '李小華', [makeTx({ transactionId: 't2', studentId: 'S002', type: 'payment', paidAmount: 500 })], 500),
    ];
    render(<RecentStrip groups={groups} dateStatus="open" />);
    expect(screen.getByText('王小明')).toBeInTheDocument();
    expect(screen.getByText('李小華')).toBeInTheDocument();
  });

  it('applies neg class for negative balance', () => {
    const groups = [makeGroup('S001', '王小明', [
      makeTx({ transactionId: 't1', studentId: 'S001', type: 'order', mealPrice: 90 }),
    ], -90)];
    render(<RecentStrip groups={groups} dateStatus="open" />);
    const amtEl = screen.getByText(/餘額/).closest('.recent-amt');
    expect(amtEl?.className).toContain('neg');
  });

  it('applies pos class for non-negative balance', () => {
    const groups = [makeGroup('S001', '王小明', [
      makeTx({ transactionId: 't1', studentId: 'S001', type: 'payment', paidAmount: 500 }),
    ], 500)];
    render(<RecentStrip groups={groups} dateStatus="open" />);
    const amtEl = screen.getByText(/餘額/).closest('.recent-amt');
    expect(amtEl?.className).toContain('pos');
  });

  it('calls onStudentClick when group row is clicked', async () => {
    const onStudentClick = vi.fn();
    const groups = [makeGroup('S001', '王小明', [
      makeTx({ transactionId: 't1', studentId: 'S001', type: 'order', mealPrice: 90 }),
    ], -90)];
    render(<RecentStrip groups={groups} dateStatus="open" onStudentClick={onStudentClick} />);

    await userEvent.click(screen.getByText('王小明'));
    expect(onStudentClick).toHaveBeenCalledWith('S001');
  });

  it('shows order count (not total record count) in summary', () => {
    const groups = [makeGroup('S001', '王小明', [
      makeTx({ transactionId: 't1', studentId: 'S001', type: 'order', mealPrice: 90 }),
      makeTx({ transactionId: 't2', studentId: 'S001', type: 'payment', paidAmount: 500 }),
    ], 410)];
    render(<RecentStrip groups={groups} dateStatus="open" />);
    // Should show "今日餐點 1" (only order type counted), not "2筆"
    expect(screen.getByText('今日餐點 1')).toBeInTheDocument();
  });

  it('U2a #2: 依有效交易顯示其他餐點、兩種都有或僅繳費', () => {
    // 只有其他餐點
    const otherGroup = [makeGroup('S001', '王小明', [
      makeTx({ transactionId: 't1', studentId: 'S001', type: 'order', mealPrice: 110, otherItemName: '雞腿' }),
    ], -110)];
    const { unmount } = render(<RecentStrip groups={otherGroup} dateStatus="open" />);
    expect(screen.getByText('其他餐點 1')).toBeInTheDocument();
    unmount();

    // 兩種都有
    const bothGroup = [makeGroup('S001', '王小明', [
      makeTx({ transactionId: 't1', studentId: 'S001', type: 'order', mealPrice: 90 }),
      makeTx({ transactionId: 't2', studentId: 'S001', type: 'order', mealPrice: 110, otherItemName: '雞腿' }),
    ], -200)];
    const { unmount: unmount2 } = render(<RecentStrip groups={bothGroup} dateStatus="open" />);
    expect(screen.getByText('今日餐點 1・其他餐點 1')).toBeInTheDocument();
    unmount2();

    // 沒有訂餐只有繳費
    const payGroup = [makeGroup('S001', '王小明', [
      makeTx({ transactionId: 't1', studentId: 'S001', type: 'payment', paidAmount: 500 }),
    ], 500)];
    render(<RecentStrip groups={payGroup} dateStatus="open" />);
    expect(screen.getByText('僅繳費')).toBeInTheDocument();
  });

  it('shows positive sign prefix for non-negative balance', () => {
    const groups = [makeGroup('S001', '王小明', [
      makeTx({ transactionId: 't1', studentId: 'S001', type: 'payment', paidAmount: 500 }),
    ], 500)];
    render(<RecentStrip groups={groups} dateStatus="open" />);
    expect(screen.getByText(/餘額/).textContent).toContain('+');
  });

  it('does not render edit or delete buttons (removed from RecentStrip)', () => {
    const groups = [makeGroup('S001', '王小明', [
      makeTx({ transactionId: 't1', studentId: 'S001', type: 'order', mealPrice: 90 }),
    ], -90)];
    render(<RecentStrip groups={groups} dateStatus="open" />);
    expect(screen.queryByRole('button', { name: '編輯' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刪除' })).not.toBeInTheDocument();
  });
});

describe('ExpensePanel', () => {
  it('stops propagation of Escape key on note input', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ExpensePanel
        kind="expense_other_note"
        amountText=""
        amount={100}
        onAmountChange={() => {}}
        onAmountConfirm={() => {}}
        onDirectionSelect={() => {}}
        onReasonSelect={() => {}}
        onNoteChange={() => {}}
        onNoteConfirm={() => {}}
        onCancel={onCancel}
      />
    );

    const input = container.querySelector('input');
    expect(input).not.toBeNull();

    const windowListener = vi.fn();
    window.addEventListener('keydown', windowListener);

    const escEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    input!.dispatchEvent(escEvent);

    expect(onCancel).toHaveBeenCalledOnce();
    expect(windowListener).not.toHaveBeenCalled();

    window.removeEventListener('keydown', windowListener);
  });

  it('stops propagation of Escape key on amount input', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ExpensePanel
        kind="expense_input"
        amountText="100"
        amount={0}
        onAmountChange={() => {}}
        onAmountConfirm={() => {}}
        onDirectionSelect={() => {}}
        onReasonSelect={() => {}}
        onNoteChange={() => {}}
        onNoteConfirm={() => {}}
        onCancel={onCancel}
      />
    );

    const input = container.querySelector('input');
    expect(input).not.toBeNull();

    const windowListener = vi.fn();
    window.addEventListener('keydown', windowListener);

    const escEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    input!.dispatchEvent(escEvent);

    expect(onCancel).toHaveBeenCalledOnce();
    expect(windowListener).not.toHaveBeenCalled();

    window.removeEventListener('keydown', windowListener);
  });
});

describe('SearchBox', () => {
  const mockStudents: StudentAccount[] = [
    { studentId: '001', displayName: '王小美', currentBalance: 100, status: 'active' as const, aliases: [], faceEnrollmentStatus: 'none' as const, createdAt: '', updatedAt: '', revision: 1 },
    { studentId: '002', displayName: '李大華', currentBalance: 200, status: 'active' as const, aliases: [], faceEnrollmentStatus: 'none' as const, createdAt: '', updatedAt: '', revision: 1 },
  ];
  const baseProps = {
    value: '001',
    onChange: () => {},
    onSubmit: () => {},
    onEsc: () => {},
    suggestions: [] as StudentAccount[],
    activeIdx: 0,
    onPick: () => {},
    onHover: vi.fn(),
    focusKey: 0,
    disabled: false,
  };

  it('does not call onHover on mouse enter when disableHoverSelection is true', () => {
    const onHover = vi.fn();
    const { container } = render(<SearchBox {...baseProps} suggestions={mockStudents} onHover={onHover} disableHoverSelection={true} />);
    const firstRow = container.querySelector('.sug-row');
    fireEvent.mouseEnter(firstRow!);
    expect(onHover).not.toHaveBeenCalled();
  });

  it('does not call onHover on mouse enter when disableHoverSelection is omitted (default true)', () => {
    const onHover = vi.fn();
    const { container } = render(<SearchBox {...baseProps} suggestions={mockStudents} onHover={onHover} />);
    const firstRow = container.querySelector('.sug-row');
    fireEvent.mouseEnter(firstRow!);
    expect(onHover).not.toHaveBeenCalled();
  });

  it('calls onHover on mouse enter when disableHoverSelection is false', () => {
    const onHover = vi.fn();
    const { container } = render(<SearchBox {...baseProps} suggestions={mockStudents} onHover={onHover} disableHoverSelection={false} />);
    const firstRow = container.querySelector('.sug-row');
    fireEvent.mouseEnter(firstRow!);
    expect(onHover).toHaveBeenCalledWith(0);
  });
});

// === Smoke tests for pos/ components ===

describe('TopBar', () => {
  it('renders without crash with mock props', () => {
    const { container } = render(
      <TopBar
        tab="pos"
        setTab={() => {}}
        online={true}
        syncing={false}
        lastSync="12:00"
        todayCount={3}
        viewDate="2026-05-29"
        setViewDate={() => {}}
      />
    );
    expect(container.textContent).toContain('櫃台');
  });

  const baseTopBarProps = {
    tab: 'pos', setTab: () => {}, online: true, syncing: true, lastSync: '12:00',
    todayCount: 3, viewDate: '2026-05-29', setViewDate: () => {},
  };

  it('shows cloud sync status only in cloud mode', () => {
    const { container } = render(<TopBar {...baseTopBarProps} />);
    expect(container.textContent).toContain('雲端已同步');
  });

  it('never claims cloud sync in prototype mode (M0 F06)', () => {
    const { container } = render(<TopBar {...baseTopBarProps} storageMode="prototype" />);
    expect(container.textContent).toContain('本機練習 · 僅此瀏覽器');
    expect(container.textContent).not.toContain('雲端已同步');
    expect(container.textContent).not.toContain('推送中');
  });

  it('never claims cloud sync in local-only mode (M0 F06)', () => {
    const { container } = render(<TopBar {...baseTopBarProps} storageMode="local-only" />);
    expect(container.textContent).toContain('本機模式 · 未連雲端');
    expect(container.textContent).not.toContain('雲端已同步');
    expect(container.textContent).not.toContain('推送中');
  });

  it('U2a #4: 右上角固定兩行，其他餐點是 0 也顯示，有菜單顯示名稱，無菜單顯示未設定', () => {
    // 有菜單
    const { container, unmount } = render(
      <TopBar {...baseTopBarProps} todayCount={3} todayOtherCount={0} todayMenu={{ itemName: '排骨便當' }} />
    );
    const counter = container.querySelector('.counter')!;
    expect(counter.textContent).toContain('今日餐點（排骨便當）');
    expect(counter.textContent).toContain('3');
    expect(counter.textContent).toContain('其他餐點');
    expect(counter.textContent).toContain('0');
    const nameEl = counter.querySelector('.counter-name')!;
    expect(nameEl.getAttribute('title')).toBe('今日餐點（排骨便當）');
    unmount();

    // 無菜單
    const { container: container2 } = render(
      <TopBar {...baseTopBarProps} todayCount={0} todayOtherCount={2} todayMenu={null} />
    );
    const counter2 = container2.querySelector('.counter')!;
    expect(counter2.textContent).toContain('今日餐點（未設定）');
    expect(counter2.textContent).toContain('0');
    expect(counter2.textContent).toContain('其他餐點');
    expect(counter2.textContent).toContain('2');
  });
});

describe('MidnightBanner', () => {
  it('renders date mismatch banner', () => {
    const { container } = render(
      <MidnightBanner
        viewDate="2026-05-28"
        systemDate="2026-05-29"
        onSwitchToToday={() => {}}
      />
    );
    expect(container.textContent).toBeTruthy();
  });
});

describe('SearchBox smoke', () => {
  it('renders search input', () => {
    const { container } = render(
      <SearchBox
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        onEsc={() => {}}
        suggestions={[]}
        activeIdx={0}
        onPick={() => {}}
        onHover={() => {}}
        focusKey={0}
        disabled={false}
      />
    );
    expect(container.querySelector('input')).toBeTruthy();
  });
});

describe('CustomerCard', () => {
  const mockStudent: StudentAccount = {
    studentId: '001',
    displayName: '王小美',
    currentBalance: 100,
    status: 'active',
    aliases: [],
    faceEnrollmentStatus: 'none',
    createdAt: '',
    updatedAt: '',
    revision: 1,
  };
  const mockMenu = { businessDate: '2026-06-01', itemName: '排骨便當', price: 90, vendorId: 'v1', vendorNameSnapshot: '老王便當', updatedAt: '', revision: 1 };

  it('renders student balance card', () => {
    const { container } = render(
      <CustomerCard
        student={mockStudent}
        todayMenu={mockMenu}
        mode="order"
        orderedTodayCount={0}
        payAmount=""
        setPayAmount={() => {}}
        priceOverride={null}
        priceOverrideLabel=""
        setPriceOverride={() => {}}
        setPriceOverrideLabel={() => {}}
      />
    );
    expect(container.textContent).toContain('王小美');
  });

  // M1 F02：特殊餐子流程按「取消」要整個還原，品項名不能留在明細或下次預填。
  it('cancelling the special meal clears both price and item label', () => {
    function Harness() {
      const [price, setPrice] = React.useState<number | null>(null);
      const [label, setLabel] = React.useState('');
      return (
        <CustomerCard
          student={mockStudent} todayMenu={mockMenu} mode="order" orderedTodayCount={0}
          payAmount="" setPayAmount={() => {}}
          priceOverride={price} priceOverrideLabel={label}
          setPriceOverride={setPrice} setPriceOverrideLabel={setLabel}
        />
      );
    }
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '訂購其他餐點' }));
    fireEvent.change(screen.getByLabelText('品項或原因'), { target: { value: '雞腿便當' } });
    expect(container.textContent).toContain('今日便當 (雞腿便當)');
    fireEvent.click(screen.getByRole('button', { name: '取消其他餐點' }));
    expect(container.textContent).toContain('今日便當 (排骨便當)');
    expect(container.textContent).not.toContain('雞腿便當');
    fireEvent.click(screen.getByRole('button', { name: '訂購其他餐點' }));
    expect((screen.getByLabelText('品項或原因') as HTMLInputElement).value).toBe('');
  });

  it('shows the menu name, not a stale label, when no special price is set', () => {
    const { container } = render(
      <CustomerCard
        student={mockStudent} todayMenu={mockMenu} mode="order" orderedTodayCount={0}
        payAmount="" setPayAmount={() => {}}
        priceOverride={null} priceOverrideLabel="雞腿便當"
        setPriceOverride={() => {}} setPriceOverrideLabel={() => {}}
      />
    );
    expect(container.textContent).toContain('今日便當 (排骨便當)');
  });

  describe('M1：看得到的送出與取消鍵', () => {
    function renderCard(over: Partial<React.ComponentProps<typeof CustomerCard>> = {}) {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();
      render(
        <CustomerCard
          student={mockStudent} todayMenu={mockMenu} mode="order" orderedTodayCount={0}
          payAmount="" setPayAmount={() => {}}
          priceOverride={null} priceOverrideLabel=""
          setPriceOverride={() => {}} setPriceOverrideLabel={() => {}}
          onConfirm={onConfirm} onCancel={onCancel}
          {...over}
        />
      );
      return { onConfirm, onCancel };
    }

    it('按鈕與 Enter／Esc 走同一個動作', () => {
      const { onConfirm, onCancel } = renderCard();
      fireEvent.click(screen.getByRole('button', { name: /確認訂餐/ }));
      fireEvent.click(screen.getByRole('button', { name: /^取消/ }));
      expect(onConfirm).toHaveBeenCalledOnce();
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it('今天已訂過時送出鍵寫明是第幾份', () => {
      renderCard({ orderedTodayCount: 1 });
      expect(screen.getByRole('button', { name: /再訂一份（今日第 2 份）/ })).toBeDefined();
    });

    it('繳費沒有金額時送出鍵停用並提示', () => {
      renderCard({ mode: 'payment' });
      expect((screen.getByRole('button', { name: /確認收款/ }) as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText('請先輸入收款金額。')).toBeDefined();
    });

    it('存檔中兩顆鍵都停用', () => {
      renderCard({ busy: true });
      expect((screen.getByRole('button', { name: /確認訂餐/ }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole('button', { name: /^取消/ }) as HTMLButtonElement).disabled).toBe(true);
    });
  });
});

describe('ActionBar', () => {
  it('renders mode buttons', () => {
    const { container } = render(
      <ActionBar
        mode="order"
        setMode={() => {}}
        focusZone="mode-order"
      />
    );
    expect(container.textContent).toContain('訂便當');
    expect(container.textContent).toContain('繳費');
  });

  it('does not render confirm or cancel buttons', () => {
    const { container } = render(
      <ActionBar
        mode="order"
        setMode={() => {}}
        focusZone="mode-order"
      />
    );
    expect(container.querySelector('.confirm-row')).toBeNull();
    expect(container.textContent).not.toContain('確認');
  });

  it('renders 付款明細 button when onStatusMode provided', () => {
    render(
      <ActionBar
        mode="order"
        setMode={() => {}}
        onStatusMode={() => {}}
        focusZone="mode-order"
      />
    );
    expect(screen.getByText('付款明細')).toBeInTheDocument();
  });

  it('calls onStatusMode when 付款明細 button clicked', () => {
    const onStatusMode = vi.fn();
    render(
      <ActionBar
        mode="order"
        setMode={() => {}}
        onStatusMode={onStatusMode}
        focusZone="mode-order"
      />
    );
    fireEvent.click(screen.getByText('付款明細'));
    expect(onStatusMode).toHaveBeenCalled();
  });
});

describe('IdleHero', () => {
  const mockMenu = { businessDate: '2026-06-01', itemName: '排骨便當', price: 90, vendorId: 'v1', vendorNameSnapshot: '老王便當', updatedAt: '', revision: 1 };

  it('renders today menu info', () => {
    const { container } = render(
      <IdleHero todayMenu={mockMenu} todayCount={3} vendorPhone="0912345678" />
    );
    expect(container.textContent).toContain('排骨便當');
  });
});

describe('DuplicateWarningBanner', () => {
  it('renders warning message', () => {
    const { container } = render(
      <DuplicateWarningBanner
        orderedTodayCount={1}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(container.textContent).toBeTruthy();
  });
});

describe('ConfirmBanner', () => {
  it('null when no flash (conditional render)', () => {
    const { container } = render(
      <ConfirmBanner flash={null} onDismiss={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  describe('M4：送出那一下的 Enter 不能直接帶到下一位，要放開後再按', () => {
    const flash = { id: 1, name: '甲', sid: '001', detail: '訂餐: 便當', amount: -90, after: 110 };
    const down = (repeat = false) => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat }));
    const up = () => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }));
    beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-13T02:00:00.000Z')); });
    afterEach(() => { vi.useRealTimers(); });
    const later = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));

    it('長按 Enter 的重複事件不關閉成功畫面；還沒放開時再來的 Enter 也不算', () => {
      const onDismiss = vi.fn();
      render(<ConfirmBanner flash={flash} onDismiss={onDismiss} />);
      later(600); down(true); down(true);
      later(600); down();
      expect(onDismiss).not.toHaveBeenCalled();
      up(); later(50); down();
      expect(onDismiss).toHaveBeenCalledOnce();
    });

    it('送出後很快的第二下（連按兩下）不關閉成功畫面', () => {
      const onDismiss = vi.fn();
      render(<ConfirmBanner flash={flash} onDismiss={onDismiss} />);
      later(80); up();
      later(80); down(); up();
      expect(onDismiss).not.toHaveBeenCalled();
    });

    it('放開後隔一下再按一次 Enter，照常回下一位（正常流程不變）', () => {
      const onDismiss = vi.fn();
      render(<ConfirmBanner flash={flash} onDismiss={onDismiss} />);
      later(80); up();
      later(500); down();
      expect(onDismiss).toHaveBeenCalledOnce();
    });

    it('用滑鼠送出（沒有按著 Enter）：隔一下按一次 Enter 就回下一位', () => {
      const onDismiss = vi.fn();
      render(<ConfirmBanner flash={flash} onDismiss={onDismiss} />);
      later(500); down();
      expect(onDismiss).toHaveBeenCalledOnce();
    });

    it('Esc 不受影響，馬上可以關閉', () => {
      const onDismiss = vi.fn();
      render(<ConfirmBanner flash={flash} onDismiss={onDismiss} />);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(onDismiss).toHaveBeenCalledOnce();
    });
  });
});

describe('ExpensePanel smoke', () => {
  it('M4：選支出／收入的「←→ 選擇」提示用正文大小的樣式，不再是 12px 淡字', () => {
    const { container } = render(
      <ExpensePanel kind="expense_direction" amountText="50" amount={50}
        onAmountChange={() => {}} onAmountConfirm={() => {}} onDirectionSelect={() => {}}
        onReasonSelect={() => {}} onNoteChange={() => {}} onNoteConfirm={() => {}} onCancel={() => {}} />
    );
    const hint = container.querySelector('.expense-key-hint') as HTMLElement;
    expect(hint.textContent).toContain('選擇');
    expect(hint.style.fontSize).toBe('');
    expect(hint.classList.contains('dim')).toBe(false);
  });

  it('renders amount input in expense_input kind', () => {
    const { container } = render(
      <ExpensePanel
        kind="expense_input"
        amountText=""
        amount={0}
        onAmountChange={() => {}}
        onAmountConfirm={() => {}}
        onDirectionSelect={() => {}}
        onReasonSelect={() => {}}
        onNoteChange={() => {}}
        onNoteConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(container.querySelector('input')).toBeTruthy();
  });
});
