import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from '../Card';

describe('Card', () => {
  it('renders children', () => {
    render(<Card><div>內容</div></Card>);
    expect(screen.getByText('內容')).toBeDefined();
  });

  it('applies default card class', () => {
    render(<Card>卡片</Card>);
    const el = screen.getByText('卡片');
    expect(el.className).toContain('card-ui');
  });

  it('applies additional className', () => {
    render(<Card className="my-card">自訂</Card>);
    const el = screen.getByText('自訂');
    expect(el.className).toContain('my-card');
  });

  it('renders as section by default', () => {
    render(<Card>區塊</Card>);
    const el = screen.getByText('區塊');
    expect(el.tagName).toBe('SECTION');
  });

  it('renders as custom element when as prop provided', () => {
    render(<Card as="article">文章</Card>);
    const el = screen.getByText('文章');
    expect(el.tagName).toBe('ARTICLE');
  });
});
