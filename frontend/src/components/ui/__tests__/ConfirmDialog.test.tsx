import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from '../ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders title and message when open', () => {
    render(
      <ConfirmDialog
        open
        title="確認刪除"
        message="確定要刪除此項目嗎？"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText('確認刪除')).toBeDefined();
    expect(screen.getByText('確定要刪除此項目嗎？')).toBeDefined();
  });

  it('does not render when closed', () => {
    render(
      <ConfirmDialog
        open={false}
        title="確認刪除"
        message="確定要刪除此項目嗎？"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.queryByText('確認刪除')).toBeNull();
  });

  it('calls onConfirm when confirm button clicked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="確認刪除"
        message="確定要刪除此項目嗎？"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );
    await user.click(screen.getByText('確認'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('calls onCancel when cancel button clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="確認刪除"
        message="確定要刪除此項目嗎？"
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );
    await user.click(screen.getByText('取消'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onConfirm when Enter key pressed while open', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="確認刪除"
        message="確定要刪除此項目嗎？"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );
    await user.keyboard('{Enter}');
    expect(onConfirm).toHaveBeenCalled();
  });

  it('calls onCancel when Escape key pressed while open', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="確認刪除"
        message="確定要刪除此項目嗎？"
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });

  it('renders danger variant confirm button', () => {
    render(
      <ConfirmDialog
        open
        title="確認刪除"
        message="確定要刪除此項目嗎？"
        variant="danger"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    const confirmBtn = screen.getByText('確認');
    expect(confirmBtn.className).toContain('btn-danger');
  });
});
