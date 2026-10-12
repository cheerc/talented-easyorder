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

  it('M1 K09：Esc 只關對話框，背景的 Esc 監聽收不到；onClose 換新函式也照樣有效', () => {
    const background = vi.fn();
    window.addEventListener('keydown', background);
    try {
      const first = vi.fn();
      const second = vi.fn();
      const { rerender } = render(<Modal open title="t" onClose={first}><p>x</p></Modal>);
      rerender(<Modal open title="t" onClose={second}><p>x</p></Modal>);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
      expect(second).toHaveBeenCalledOnce();
      expect(first).not.toHaveBeenCalled();
      expect(background).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', background);
    }
  });

  it('M1 K09：開啟時焦點移進對話框，Tab 從背景拉回，關閉後還給原本的元素', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    try {
      const { rerender } = render(<Modal open title="t" onClose={() => {}}><input aria-label="金額" /><button>儲存</button></Modal>);
      expect(document.activeElement).toBe(screen.getByLabelText('金額'));
      outside.focus();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
      rerender(<Modal open={false} title="t" onClose={() => {}}><input aria-label="金額" /></Modal>);
      expect(document.activeElement).toBe(outside);
    } finally {
      outside.remove();
    }
  });
});

