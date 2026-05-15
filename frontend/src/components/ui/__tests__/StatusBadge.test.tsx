import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '../StatusBadge';

describe('StatusBadge', () => {
  it('renders children', () => {
    render(<StatusBadge>已完成</StatusBadge>);
    expect(screen.getByText('已完成')).toBeDefined();
  });

  it('applies variant class', () => {
    render(<StatusBadge variant="warn">警告</StatusBadge>);
    const el = screen.getByText('警告');
    expect(el.className).toContain('badge-warn');
  });

  it('defaults to neutral variant', () => {
    render(<StatusBadge>預設</StatusBadge>);
    const el = screen.getByText('預設');
    expect(el.className).toContain('badge-neutral');
  });
});
