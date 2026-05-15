import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '../Modal';

describe('Modal', () => {
  it('renders title and children when open', () => {
    render(
      <Modal open title="確認操作" onClose={() => {}}>
        <p>內容</p>
      </Modal>
    );
    expect(screen.getByText('確認操作')).toBeDefined();
    expect(screen.getByText('內容')).toBeDefined();
  });

  it('does not render when closed', () => {
    render(
      <Modal open={false} title="確認操作" onClose={() => {}}>
        <p>內容</p>
      </Modal>
    );
    expect(screen.queryByText('確認操作')).toBeNull();
  });

  it('calls onClose when backdrop clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal open title="確認操作" onClose={onClose}>
        <p>內容</p>
      </Modal>
    );
    await user.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on Escape key', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal open title="確認操作" onClose={onClose}>
        <p>內容</p>
      </Modal>
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('has accessible dialog role', () => {
    render(
      <Modal open title="確認操作" onClose={() => {}}>
        <p>內容</p>
      </Modal>
    );
    expect(screen.getByRole('dialog')).toBeDefined();
  });
});
