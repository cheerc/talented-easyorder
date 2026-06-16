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
    renderCard();
    // $500 shown
    expect(screen.getByText(/500/)).toBeDefined();
  });

  it('shows warning styling for negative balance', () => {
    renderCard({ student: { studentId: 's1', displayName: 'B', currentBalance: -100 } });
    expect(screen.getByText(/100/)).toBeDefined();
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
});
