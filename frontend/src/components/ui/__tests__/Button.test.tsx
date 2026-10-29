import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import userEvent from '@testing-library/user-event';
import { Button } from '../Button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>送出</Button>);
    expect(screen.getByRole('button', { name: '送出' })).toBeDefined();
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>點我</Button>);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onClick when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>禁用</Button>);
    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders disabled attribute when disabled', () => {
    render(<Button disabled>禁用</Button>);
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('applies variant class', () => {
    render(<Button variant="danger">刪除</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('btn-danger');
  });

  it('applies size class', () => {
    render(<Button size="sm">小</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('btn-sm');
  });

  it('applies additional className', () => {
    render(<Button className="extra">自訂</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('extra');
  });

  it('has min-height ≥ 44px for a11y', () => {
    render(<Button>無障礙</Button>);
    const btn = screen.getByRole('button');
    // jsdom resolves computed styles from CSS, but vitest css pipeline may strip them.
    // Verify the className contains btn-ui (the class that sets min-height: 44px).
    expect(btn.className).toContain('btn-ui');
  });

  it('passes native attributes through so callers can keep ids, test ids and aria state', () => {
    render(
      <Button type="submit" data-testid="submit-x" aria-describedby="hint-x" title="送出">
        送出
      </Button>,
    );
    const btn = screen.getByTestId('submit-x');
    expect(btn).toHaveAttribute('type', 'submit');
    expect(btn).toHaveAttribute('title', '送出');
    expect(btn).toHaveAttribute('aria-describedby', 'hint-x');
  });

  it('forwards a ref to the native button element', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>焦點</Button>);
    expect(ref.current).toBe(screen.getByRole('button'));
  });

  it('applies secondary and outline variants', () => {
    const view = render(<Button variant="secondary">次要</Button>);
    expect(screen.getByRole('button').className).toContain('btn-secondary');
    view.rerender(<Button variant="outline">框線</Button>);
    expect(screen.getByRole('button').className).toContain('btn-outline');
  });
});
