import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CustomerCard } from '../../pos/CustomerCard';

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

  it('U2a #6: 不再顯示檢視歷史按鈕', () => {
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
  describe('view-status mode (#400, U2a #5/#6/#9)', () => {
    it('shows TransactionStatusView with student displayName and empty state when no transactions', () => {
      renderCard({ focusZone: 'view-status', studentTransactions: [] });
      expect(screen.getByText('王小明 今日付款明細')).toBeDefined();
      expect(screen.getByText('今日無交易紀錄')).toBeDefined();
    });

    it('renders "查看全部紀錄" button and calls onViewAllHistory on click', () => {
      const onViewAllHistory = vi.fn();
      renderCard({ focusZone: 'view-status', studentTransactions: [], onViewAllHistory });
      const btn = screen.getByRole('button', { name: '查看全部紀錄' });
      expect(btn).toBeDefined();
      fireEvent.click(btn);
      expect(onViewAllHistory).toHaveBeenCalledTimes(1);
    });

    it('hides bill summary and pay panel when focusZone is view-status', () => {
      const { container } = renderCard({ focusZone: 'view-status', studentTransactions: [] });
      expect(container.querySelector('.bill-item')).toBeNull();
      expect(container.querySelector('.pay-panel')).toBeNull();
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

  // Ref: #423 — full-width alignment (Fix 1)
  describe('full-width alignment (#423)', () => {
    it('adds full-width class to bill-summary when focusZone is view-status', () => {
      const { container } = renderCard({ focusZone: 'view-status', studentTransactions: [] });
      const billSummary = container.querySelector('.bill-summary');
      expect(billSummary?.className).toContain('full-width');
    });

    it('does not add full-width class when focusZone is mode-order', () => {
      const { container } = renderCard({ focusZone: 'mode-order' });
      const billSummary = container.querySelector('.bill-summary');
      expect(billSummary?.className).not.toContain('full-width');
    });
  });

  describe('M1 K07：收款欄是負數', () => {
    const actions = { onConfirm: vi.fn(), onCancel: vi.fn() };
    it('繳費模式輸入 -5：送出鍵停用，說明不能是負數，不當成 5', () => {
      renderCard({ ...actions, mode: 'payment', focusZone: 'mode-payment', payAmount: '-5' });
      expect(screen.getByRole('button', { name: /確認收款/ })).toBeDisabled();
      expect(screen.getByText(/收款金額不能是負數/)).toBeDefined();
      expect((screen.getByLabelText('付款金額') as HTMLInputElement).value).toBe('-5');
    });

    it('訂餐模式輸入 -5：也不能送出（不會悄悄記成 0 元記帳）', () => {
      renderCard({ ...actions, payAmount: '-5', todayMenu: { itemName: '便當', price: 60, vendorNameSnapshot: 'A', businessDate: '2026-06-01' } });
      expect(screen.getByRole('button', { name: /確認訂餐/ })).toBeDisabled();
      expect(screen.getByText(/收款金額不能是負數/)).toBeDefined();
    });
  });
});
