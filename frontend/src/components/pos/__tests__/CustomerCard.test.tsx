import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

    it('does not focus pay input when focusZone is btn-delete-order', () => {
      const { container } = renderCard({ focusZone: 'btn-delete-order' });
      const input = container.querySelector('.pay-input-main');
      expect(document.activeElement).not.toBe(input);
    });

    it('re-focuses input when focusZone changes back to mode-order (Q→E→Q)', () => {
      const { container, rerender } = renderCard({ focusZone: 'mode-order' });
      const input = container.querySelector('.pay-input-main') as HTMLElement;
      expect(document.activeElement).toBe(input);

      // Simulate E key: focusZone → btn-delete-order
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
        focusZone: 'btn-delete-order',
      };
      rerender(<CustomerCard {...rerenderProps as Parameters<typeof CustomerCard>[0]} />);
      input.blur();

      // Simulate Q key: focusZone → mode-order again
      rerender(<CustomerCard {...{ ...rerenderProps, focusZone: 'mode-order' } as Parameters<typeof CustomerCard>[0]} />);
      expect(document.activeElement).toBe(input);
    });
  });

  // Ref: #395 — cancel hint UI in E mode
  describe('cancel hint in E mode (#395)', () => {
    it('shows cancel hint when focusZone is btn-delete-order', () => {
      renderCard({ focusZone: 'btn-delete-order' });
      expect(screen.getByText(/即將取消訂餐/)).toBeDefined();
    });

    it('hides bill summary when focusZone is btn-delete-order', () => {
      const { container } = renderCard({ focusZone: 'btn-delete-order' });
      expect(container.querySelector('.bill-item')).toBeNull();
    });

    it('does not show cancel hint when focusZone is mode-order', () => {
      renderCard({ focusZone: 'mode-order' });
      expect(screen.queryByText(/即將取消訂餐/)).toBeNull();
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
});
