import { describe, expect, it, vi } from 'vitest';
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
    expect(screen.getByText('1筆')).toBeInTheDocument();
  });

  it('expands to show detail rows on click, collapses on second click', async () => {
    const groups = [
      makeGroup('S001', '王小明', [
        makeTx({ transactionId: 't1', studentId: 'S001', type: 'order', mealPrice: 90, createdAt: '2026-01-01T10:00:00Z' }),
        makeTx({ transactionId: 't2', studentId: 'S001', type: 'payment', paidAmount: 90, createdAt: '2026-01-01T10:05:00Z' }),
      ], 0),
    ];
    render(<RecentStrip groups={groups} dateStatus="open" />);

    // Initially collapsed — no detail rows
    expect(screen.queryByText('10:00:00')).not.toBeInTheDocument();

    // Click to expand
    await userEvent.click(screen.getByText('王小明'));
    expect(screen.getByText('10:00:00')).toBeInTheDocument();
    expect(screen.getByText('10:05:00')).toBeInTheDocument();

    // Click to collapse
    await userEvent.click(screen.getByText('王小明'));
    expect(screen.queryByText('10:00:00')).not.toBeInTheDocument();
  });

  it('shows edit and delete buttons in expanded detail rows', async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const tx1 = makeTx({ transactionId: 't1', studentId: 'S001', type: 'order', mealPrice: 90 });
    const groups = [makeGroup('S001', '王小明', [tx1], -90)];

    render(<RecentStrip groups={groups} dateStatus="open" onEditClick={onEdit} onDeleteClick={onDelete} />);
    await userEvent.click(screen.getByText('王小明'));

    const editBtn = screen.getByRole('button', { name: '編輯' });
    const deleteBtn = screen.getByRole('button', { name: '刪除' });

    await userEvent.click(editBtn);
    expect(onEdit).toHaveBeenCalledWith(tx1);

    await userEvent.click(deleteBtn);
    expect(onDelete).toHaveBeenCalledWith(tx1);
  });

  it('hides edit/delete when dateStatus is closed', async () => {
    const tx1 = makeTx({ transactionId: 't1', studentId: 'S001', type: 'order', mealPrice: 90 });
    const groups = [makeGroup('S001', '王小明', [tx1], -90)];

    render(<RecentStrip groups={groups} dateStatus="closed" onEditClick={vi.fn()} onDeleteClick={vi.fn()} />);
    await userEvent.click(screen.getByText('王小明'));

    expect(screen.queryByRole('button', { name: '編輯' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刪除' })).not.toBeInTheDocument();
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

  it('hides edit button for expense type transactions', async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const tx1 = makeTx({ transactionId: 't1', studentId: 'S001', type: 'expense', mealPrice: 100 });
    const groups = [makeGroup('S001', '王小明', [tx1], -100)];

    render(<RecentStrip groups={groups} dateStatus="open" onEditClick={onEdit} onDeleteClick={onDelete} />);
    await userEvent.click(screen.getByText('王小明'));

    // Edit button should be hidden for expense type
    expect(screen.queryByRole('button', { name: '編輯' })).not.toBeInTheDocument();
    // Delete button should still be visible
    expect(screen.getByRole('button', { name: '刪除' })).toBeInTheDocument();
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
  const mockMenu = { itemName: '排骨便當', price: 90, vendorId: 'v1', vendorNameSnapshot: '老王便當' };

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

<<<<<<< HEAD
  it('renders E button with 訂餐狀況 label', () => {
    render(
      <ActionBar mode="order" setMode={vi.fn()} onStatusMode={vi.fn()} focusZone="mode-order" />
    );
    expect(screen.getByText('訂餐狀況')).toBeInTheDocument();
    expect(screen.getByText('E')).toBeInTheDocument();
  });

  it('calls onStatusMode when E button clicked', () => {
    const onStatusMode = vi.fn();
    render(
      <ActionBar mode="order" setMode={vi.fn()} onStatusMode={onStatusMode} focusZone="mode-order" />
=======
  it('renders 訂餐狀況 button when onStatusMode provided', () => {
    render(
      <ActionBar
        mode="order"
        setMode={() => {}}
        onStatusMode={() => {}}
        focusZone="mode-order"
      />
    );
    expect(screen.getByText('訂餐狀況')).toBeInTheDocument();
  });

  it('calls onStatusMode when 訂餐狀況 button clicked', () => {
    const onStatusMode = vi.fn();
    render(
      <ActionBar
        mode="order"
        setMode={() => {}}
        onStatusMode={onStatusMode}
        focusZone="mode-order"
      />
>>>>>>> origin/dev
    );
    fireEvent.click(screen.getByText('訂餐狀況'));
    expect(onStatusMode).toHaveBeenCalled();
  });
});

describe('IdleHero', () => {
  const mockMenu = { itemName: '排骨便當', price: 90, vendorId: 'v1', vendorNameSnapshot: '老王便當' };

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
});

describe('ExpensePanel smoke', () => {
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
