import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CustomerCard } from '../../pos/CustomerCard';
import type { LedgerTransaction } from '../../../domain/ledger';

// Ref: #350 — Tests for POS CustomerCard component (financial display)

function renderCard(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    student: {
      studentId: 's1',
      displayName: '王小明',
      currentBalance: 500,
    },
    todayMenu: { itemName: '便當', price: 60, vendorNameSnapshot: 'A' },
    mode: 'order' as const,
    orderedTodayCount: 0,
    payAmount: '',
    setPayAmount: vi.fn(),
    priceOverride: null,
    priceOverrideLabel: '',
    setPriceOverride: vi.fn(),
    setPriceOverrideLabel: vi.fn(),
    focusZone: 'mode-order',
    ...overrides,
  };
  return render(<CustomerCard {...defaultProps as Parameters<typeof CustomerCard>[0]} />);
}

describe('CustomerCard', () => {
  it('renders student name and ID', () => {
    renderCard();
    expect(screen.getByText('王小明')).toBeDefined();
    expect(screen.getByText('s1')).toBeDefined();
  });

  it('displays positive balance without warning', () => {
    const { container } = renderCard();
    // $500 shown
    expect(container.querySelector('.bal-num')?.textContent).toContain('500');
  });

  it('shows warning styling for negative balance', () => {
    const { container } = renderCard({ student: { studentId: 's1', displayName: 'B', currentBalance: -100 } });
    const balNum = container.querySelector('.bal-num');
    expect(balNum?.textContent).toContain('100');
    expect(balNum?.className).toContain('warn');
  });

  it('shows ordered-today warning when orderedTodayCount > 0', () => {
    renderCard({ orderedTodayCount: 2 });
    expect(screen.getByText(/今日已訂過/)).toBeDefined();
  });

  it('shows view history button when callback provided', () => {
    renderCard({ onViewHistory: vi.fn() });
    expect(screen.getByText('檢視歷史')).toBeDefined();
  });

  it('does not show view history button when no callback', () => {
    renderCard();
    expect(screen.queryByText('檢視歷史')).toBeNull();
  });

  it('renders redesigned 3-line transaction preview in payment mode', () => {
    const { container } = renderCard({
      mode: 'payment',
      student: { studentId: 's1', displayName: '王小明', currentBalance: -170 },
      payAmount: '100',
    });

    const billItems = container.querySelectorAll('.bill-item');
    expect(billItems).toHaveLength(3);

    // 1st item: 目前帳戶餘額
    const firstItem = billItems[0];
    expect(firstItem.querySelector('.bill-label')?.textContent).toBe('目前帳戶餘額');
    expect(firstItem.querySelector('.bill-val')?.textContent).toBe('−$170');
    expect(firstItem.querySelector('.bill-val')?.className).toContain('neg');

    // 2nd item: 此次繳費金額
    const secondItem = billItems[1];
    expect(secondItem.querySelector('.bill-label')?.textContent).toBe('此次繳費金額');
    expect(secondItem.querySelector('.bill-val')?.textContent).toBe('+$100');
    expect(secondItem.querySelector('.bill-val')?.className).toContain('pos');

    // 3rd item: 預計結帳後餘額
    const thirdItem = billItems[2];
    expect(thirdItem.querySelector('.bill-label')?.textContent).toBe('預計結帳後餘額');
    expect(thirdItem.querySelector('.bill-val')?.textContent).toBe('−$70');
    expect(thirdItem.querySelector('.bill-val')?.className).toContain('neg');
    expect(thirdItem.className).toContain('bill-total');
  });

  it('renders positive projected balance correctly without neg class in payment mode', () => {
    const { container } = renderCard({
      mode: 'payment',
      student: { studentId: 's1', displayName: '王小明', currentBalance: -170 },
      payAmount: '300', // -170 + 300 = 130 > 0
    });

    const billItems = container.querySelectorAll('.bill-item');
    const thirdItem = billItems[2];
    expect(thirdItem.querySelector('.bill-label')?.textContent).toBe('預計結帳後餘額');
    expect(thirdItem.querySelector('.bill-val')?.textContent).toBe('$130');
    expect(thirdItem.querySelector('.bill-val')?.className).not.toContain('neg');
  });

  it('renders redesigned 4-line transaction preview in order mode', () => {
    const { container } = renderCard({
      mode: 'order',
      student: { studentId: 's1', displayName: '王小明', currentBalance: 500 },
      todayMenu: { itemName: '排骨便當', price: 90, vendorNameSnapshot: 'A' },
      payAmount: '100',
    });

    const billItems = container.querySelectorAll('.bill-item');
    expect(billItems).toHaveLength(4);

    // 1st item: 目前帳戶餘額
    const firstItem = billItems[0];
    expect(firstItem.querySelector('.bill-label')?.textContent).toBe('目前帳戶餘額');
    expect(firstItem.querySelector('.bill-val')?.textContent).toBe('$500');
    expect(firstItem.querySelector('.bill-val')?.className).not.toContain('neg');

    // 2nd item: 今日便當 (排骨便當)
    const secondItem = billItems[1];
    expect(secondItem.querySelector('.bill-label')?.textContent).toBe('今日便當 (排骨便當)');
    expect(secondItem.querySelector('.bill-val')?.textContent).toBe('−$90');
    expect(secondItem.querySelector('.bill-val')?.className).toContain('neg');

    // 3rd item: 此次繳費金額
    const thirdItem = billItems[2];
    expect(thirdItem.querySelector('.bill-label')?.textContent).toBe('此次繳費金額');
    expect(thirdItem.querySelector('.bill-val')?.textContent).toBe('+$100');
    expect(thirdItem.querySelector('.bill-val')?.className).toContain('pos');

    // 4th item: 預計結帳後餘額 (500 - 90 + 100 = 510)
    const fourthItem = billItems[3];
    expect(fourthItem.querySelector('.bill-label')?.textContent).toBe('預計結帳後餘額');
    expect(fourthItem.querySelector('.bill-val')?.textContent).toBe('$510');
    expect(fourthItem.querySelector('.bill-val')?.className).not.toContain('neg');
    expect(fourthItem.className).toContain('bill-total');
  });

  // Ref: #395 — focusZone-driven auto-focus
  describe('focusZone auto-focus (#395)', () => {
    it('focuses pay input when focusZone starts with mode-', () => {
      const { container } = renderCard({ focusZone: 'mode-order' });
      const input = container.querySelector('.pay-input-main');
      expect(document.activeElement).toBe(input);
    });

    it('does not focus pay input when focusZone is view-status', () => {
      const { container } = renderCard({ focusZone: 'view-status', studentTransactions: [] });
      const input = container.querySelector('.pay-input-main');
      expect(document.activeElement).not.toBe(input);
    });

    it('re-focuses input when focusZone changes back to mode-order (Q→E→Q)', () => {
      const { container, rerender } = renderCard({ focusZone: 'mode-order' });
      const input = container.querySelector('.pay-input-main') as HTMLElement;
      expect(document.activeElement).toBe(input);

      // Simulate E key: focusZone → view-status
      const rerenderProps = {
        student: { studentId: 's1', displayName: '王小明', currentBalance: 500 },
        todayMenu: { itemName: '便當', price: 60, vendorNameSnapshot: 'A' },
        mode: 'order' as const,
        orderedTodayCount: 0,
        payAmount: '',
        setPayAmount: vi.fn(),
        priceOverride: null,
        priceOverrideLabel: '',
        setPriceOverride: vi.fn(),
        setPriceOverrideLabel: vi.fn(),
        focusZone: 'view-status',
        studentTransactions: [],
      };
      rerender(<CustomerCard {...rerenderProps as Parameters<typeof CustomerCard>[0]} />);
      input.blur();

      // Simulate Q key: focusZone → mode-order again
      rerender(<CustomerCard {...{ ...rerenderProps, focusZone: 'mode-order' } as Parameters<typeof CustomerCard>[0]} />);
      const inputAfter = container.querySelector('.pay-input-main') as HTMLElement;
      expect(document.activeElement).toBe(inputAfter);
    });
  });

  // Ref: #400 — view-status shows TransactionStatusView
  describe('view-status mode (#400)', () => {
    it('shows TransactionStatusView when focusZone is view-status', () => {
      renderCard({ focusZone: 'view-status', studentTransactions: [] });
      expect(screen.getByText('今日無交易紀錄')).toBeDefined();
    });

    it('hides bill summary when focusZone is view-status', () => {
      const { container } = renderCard({ focusZone: 'view-status', studentTransactions: [] });
      expect(container.querySelector('.bill-item')).toBeNull();
    });

    it('does not show TransactionStatusView when focusZone is mode-order', () => {
      renderCard({ focusZone: 'mode-order' });
      expect(screen.queryByText('今日無交易紀錄')).toBeNull();
    });
  });

  // Ref: #396 — no placeholder in payment mode
  describe('placeholder removal (#396)', () => {
    it('has no placeholder in payment mode', () => {
      const { container } = renderCard({ mode: 'payment', focusZone: 'mode-payment' });
      const input = container.querySelector('.pay-input-main');
      expect(input?.getAttribute('placeholder')).toBe('');
    });

    it('has no placeholder in order mode', () => {
      renderCard({ mode: 'order', focusZone: 'mode-order' });
      const input = document.querySelector('.pay-input-main');
      expect(input?.getAttribute('placeholder')).toBe('');
    });
  });

  // Ref: #419 — expense mode must not render bill items (DRY guard)
  describe('expense mode DRY guard (#419)', () => {
    it('does not render bill items in expense mode', () => {
      const { container } = renderCard({ mode: 'expense', focusZone: 'mode-expense' });
      expect(container.querySelector('.bill-item')).toBeNull();
      expect(screen.queryByText('結帳明細')).toBeNull();
    });
  });

  // Ref: #419 — view-history mode
  describe('view-history mode (#419)', () => {
    function makeTx(overrides: Partial<LedgerTransaction> & { transactionId: string }): LedgerTransaction {
      return {
        transactionId: overrides.transactionId,
        businessDate: '2026-06-22',
        createdAt: '2026-06-22T10:00:00Z',
        studentId: 's1',
        studentNameSnapshot: '王小明',
        menuNameSnapshot: '',
        vendorNameSnapshot: '',
        type: 'order',
        mealPrice: 60,
        paidAmount: 0,
        amount: 0,
        afterBalance: 440,
        sourceDevice: 'pc' as const,
        syncStatus: 'synced' as const,
        revision: 1,
        note: '',
        ...overrides,
      } as LedgerTransaction;
    }

    const historyTxs: LedgerTransaction[] = [
      makeTx({ transactionId: 'h1', businessDate: '2026-06-22', createdAt: '2026-06-22T10:00:00Z', type: 'order', mealPrice: 60 }),
      makeTx({ transactionId: 'h2', businessDate: '2026-06-21', createdAt: '2026-06-21T09:00:00Z', type: 'payment', paidAmount: 500 }),
    ];

    it('shows all-date transactions when focusZone is view-history', () => {
      renderCard({ focusZone: 'view-history', allStudentTransactions: historyTxs });
      // Should show date labels
      expect(screen.getByText('2026-06-22')).toBeDefined();
      expect(screen.getByText('2026-06-21')).toBeDefined();
    });

    it('shows back button in view-history mode', () => {
      renderCard({ focusZone: 'view-history', allStudentTransactions: historyTxs });
      expect(screen.getByText('返回')).toBeDefined();
    });

    it('hides bill summary in view-history mode', () => {
      const { container } = renderCard({ focusZone: 'view-history', allStudentTransactions: historyTxs });
      expect(container.querySelector('.bill-item')).toBeNull();
    });

    it('hides pay panel in view-history mode', () => {
      const { container } = renderCard({ focusZone: 'view-history', allStudentTransactions: historyTxs });
      expect(container.querySelector('.pay-panel')).toBeNull();
    });
  });

  // Ref: #423 — full-width alignment (Fix 1)
  describe('full-width alignment (#423)', () => {
    it('adds full-width class to bill-summary when focusZone is view-status', () => {
      const { container } = renderCard({ focusZone: 'view-status', studentTransactions: [] });
      const billSummary = container.querySelector('.bill-summary');
      expect(billSummary?.className).toContain('full-width');
    });

    it('adds full-width class to bill-summary when focusZone is view-history', () => {
      const { container } = renderCard({ focusZone: 'view-history', allStudentTransactions: [] });
      const billSummary = container.querySelector('.bill-summary');
      expect(billSummary?.className).toContain('full-width');
    });

    it('does not add full-width class when focusZone is mode-order', () => {
      const { container } = renderCard({ focusZone: 'mode-order' });
      const billSummary = container.querySelector('.bill-summary');
      expect(billSummary?.className).not.toContain('full-width');
    });
  });

  // Ref: #423 — weekly pagination (Fix 3)
  describe('weekly pagination (#423)', () => {
    function makeTx(overrides: Partial<LedgerTransaction> & { transactionId: string }): LedgerTransaction {
      return {
        transactionId: overrides.transactionId,
        businessDate: '2026-06-22',
        createdAt: '2026-06-22T10:00:00Z',
        studentId: 's1',
        studentNameSnapshot: '王小明',
        menuNameSnapshot: '',
        vendorNameSnapshot: '',
        type: 'order',
        mealPrice: 60,
        paidAmount: 0,
        amount: 0,
        afterBalance: 440,
        sourceDevice: 'pc' as const,
        syncStatus: 'synced' as const,
        revision: 1,
        note: '',
        ...overrides,
      } as LedgerTransaction;
    }

    it('shows week navigation buttons in view-history mode', () => {
      renderCard({ focusZone: 'view-history', allStudentTransactions: [] });
      expect(screen.getByLabelText('上一週')).toBeDefined();
      expect(screen.getByLabelText('下一週')).toBeDefined();
    });

    it('shows week range label in view-history mode', () => {
      renderCard({ focusZone: 'view-history', allStudentTransactions: [] });
      // Should show a range like "YYYY-MM-DD ~ YYYY-MM-DD"
      const label = screen.getByText(/\d{4}-\d{2}-\d{2}\s*~\s*\d{4}-\d{2}-\d{2}/);
      expect(label).toBeDefined();
    });

    it('disables next-week button at current week (offset=0)', () => {
      renderCard({ focusZone: 'view-history', allStudentTransactions: [] });
      const nextBtn = screen.getByLabelText('下一週');
      expect(nextBtn).toHaveProperty('disabled', true);
    });

    it('filters transactions to current week only', () => {
      // Today is 2026-06-22 (Monday). Current week = Mon 2026-06-22 ~ Sun 2026-06-28
      const txs = [
        makeTx({ transactionId: 'w1', businessDate: '2026-06-22' }),  // this week
        makeTx({ transactionId: 'w2', businessDate: '2026-06-15' }),  // last week
      ];
      const { container } = renderCard({ focusZone: 'view-history', allStudentTransactions: txs });
      // Only the current week transaction should be shown in date groups
      const dateLabels = container.querySelectorAll('.tx-history-date-label');
      expect(dateLabels.length).toBe(1);
      expect(dateLabels[0].textContent).toBe('2026-06-22');
    });

    it('shows empty message when no transactions in current week', () => {
      const txs = [
        makeTx({ transactionId: 'old1', businessDate: '2026-06-10' }),  // 2 weeks ago
      ];
      renderCard({ focusZone: 'view-history', allStudentTransactions: txs });
      expect(screen.getByText('本週無交易紀錄')).toBeDefined();
    });
  });
});
