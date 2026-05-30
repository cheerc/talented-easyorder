import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ReopenDialog } from '../ReopenDialog';

describe('ReopenDialog', () => {
  it('displays businessDate in title', () => {
    const { container } = render(
      <ReopenDialog businessDate="2026-05-30" onReopen={vi.fn()} onCancel={vi.fn()} />
    );
    expect(container.textContent).toContain('2026-05-30');
  });

  it('確認重開 button disabled when reason is empty', () => {
    const { getByText } = render(
      <ReopenDialog businessDate="2026-05-30" onReopen={vi.fn()} onCancel={vi.fn()} />
    );
    const btn = getByText('確認重開') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('確認重開 button enabled when reason has text', () => {
    const { getByText, container } = render(
      <ReopenDialog businessDate="2026-05-30" onReopen={vi.fn()} onCancel={vi.fn()} />
    );
    const input = container.querySelector('.dialog-body input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'need to fix' } });
    const btn = getByText('確認重開') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('calls onReopen(reason) when confirm clicked', () => {
    const onReopen = vi.fn();
    const { getByText, container } = render(
      <ReopenDialog businessDate="2026-05-30" onReopen={onReopen} onCancel={vi.fn()} />
    );
    const input = container.querySelector('.dialog-body input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'wrong total' } });
    fireEvent.click(getByText('確認重開'));
    expect(onReopen).toHaveBeenCalledWith('wrong total');
  });

  it('calls onCancel when cancel clicked', () => {
    const onCancel = vi.fn();
    const { getByText } = render(
      <ReopenDialog businessDate="2026-05-30" onReopen={vi.fn()} onCancel={onCancel} />
    );
    fireEvent.click(getByText('取消'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel when overlay clicked', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ReopenDialog businessDate="2026-05-30" onReopen={vi.fn()} onCancel={onCancel} />
    );
    const overlay = container.querySelector('.dialog-overlay') as HTMLElement;
    fireEvent.click(overlay);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('dialog box click does NOT call onCancel', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ReopenDialog businessDate="2026-05-30" onReopen={vi.fn()} onCancel={onCancel} />
    );
    const dialogBox = container.querySelector('.dialog-box') as HTMLElement;
    fireEvent.click(dialogBox);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('shows required field hint on reason input', () => {
    const { container } = render(
      <ReopenDialog businessDate="2026-05-30" onReopen={vi.fn()} onCancel={vi.fn()} />
    );
    expect(container.textContent).toContain('必填');
  });
});
