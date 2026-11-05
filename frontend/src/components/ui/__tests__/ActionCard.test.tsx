import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ActionCard } from '../ActionCard';

describe('ActionCard', () => {
  it('整張是單一 button，accessible name 為完整句子', () => {
    render(<ActionCard title="今天還沒建立營業日" description="到菜單與開帳設定今天的菜單" actionLabel="前往菜單與開帳" kbd="F3" onClick={() => {}} />);
    const btn = screen.getByRole('button', { name: '今天還沒建立營業日，到菜單與開帳設定今天的菜單，前往菜單與開帳' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('type')).toBe('button');
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('顯示 Kbd 提示，且不污染 accessible name', () => {
    render(<ActionCard title="T" actionLabel="去" kbd="F3" onClick={() => {}} />);
    expect(screen.getByText('F3').tagName).toBe('KBD');
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('T，去');
  });

  it('點擊觸發 onClick；disabled 時不觸發', () => {
    const onClick = vi.fn();
    const { rerender } = render(<ActionCard title="T" actionLabel="去" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<ActionCard title="T" actionLabel="去" onClick={onClick} disabled />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
