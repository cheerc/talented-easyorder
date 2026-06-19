import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { ReopenDialog } from '../ReopenDialog';

describe('ReopenDialog', () => {
  it('displays businessDate in title', () => {
    render(
      <ReopenDialog businessDate="2026-05-30" onReopen={vi.fn()} onCancel={vi.fn()} />
    );
    expect(screen.getByText(/2026-05-30/)).toBeInTheDocument();
  });

  it('確認重開 button disabled when reason is empty', () => {
    render(
      <ReopenDialog businessDate="2026-05-30" onReopen={vi.fn()} onCancel={vi.fn()} />
    );
    const btn = screen.getByText('確認重開') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('確認重開 button enabled when reason has text', () => {
    render(
      <ReopenDialog businessDate="2026-05-30" onReopen={vi.fn()} onCancel={vi.fn()} />
    );
    const input = screen.getByPlaceholderText('請說明重新開啟的原因') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'need to fix' } });
    const btn = screen.getByText('確認重開') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('calls onReopen(reason) when confirm clicked', () => {
    const onReopen = vi.fn();
    render(
      <ReopenDialog businessDate="2026-05-30" onReopen={onReopen} onCancel={vi.fn()} />
    );
    const input = screen.getByPlaceholderText('請說明重新開啟的原因') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'wrong total' } });
    fireEvent.click(screen.getByText('確認重開'));
    expect(onReopen).toHaveBeenCalledWith('wrong total');
  });

  it('calls onCancel when cancel clicked', () => {
    const onCancel = vi.fn();
    render(
      <ReopenDialog businessDate="2026-05-30" onReopen={vi.fn()} onCancel={onCancel} />
    );
    fireEvent.click(screen.getByText('取消'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel when overlay clicked', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ReopenDialog businessDate="2026-05-30" onReopen={vi.fn()} onCancel={onCancel} />
    );
    const overlay = container.querySelector('.modal-overlay') as HTMLElement;
    fireEvent.click(overlay);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('dialog panel click does NOT call onCancel', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ReopenDialog businessDate="2026-05-30" onReopen={vi.fn()} onCancel={onCancel} />
    );
    const panel = container.querySelector('.modal-panel') as HTMLElement;
    fireEvent.click(panel);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('shows required field hint on reason input', () => {
    render(
      <ReopenDialog businessDate="2026-05-30" onReopen={vi.fn()} onCancel={vi.fn()} />
    );
    expect(screen.getByText('必填')).toBeInTheDocument();
  });
});
