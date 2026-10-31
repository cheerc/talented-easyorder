import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from '../EmptyState';

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(<EmptyState title="尚無資料" description="目前沒有任何紀錄" />);
    expect(screen.getByText('尚無資料')).toBeDefined();
    expect(screen.getByText('目前沒有任何紀錄')).toBeDefined();
  });

  it('renders children when provided', () => {
    render(
      <EmptyState title="尚無資料" description="目前沒有任何紀錄">
        <button>新增</button>
      </EmptyState>
    );
    expect(screen.getByRole('button', { name: '新增' })).toBeDefined();
  });
});

describe('EmptyState 圖示', () => {
  it('以 SVG 圖示呈現且對輔助技術隱藏，不用 emoji', () => {
    const { container } = render(<EmptyState title="沒有資料" />);
    const icon = container.querySelector('.empty-icon');
    expect(icon?.querySelector('svg')).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(container.textContent).not.toContain('📭');
  });
});
