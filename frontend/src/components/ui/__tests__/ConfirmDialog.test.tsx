import { describe, it, expect, vi } from 'vitest';
import React from 'react';
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

  describe('M1 K08：重複訂餐這類確認不能被 Enter 穿過', () => {
    function renderDefaultCancel() {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();
      render(
        <ConfirmDialog open title="已經訂過餐點" message="再訂一份？" onConfirm={onConfirm} onCancel={onCancel}
          confirmLabel="是，再訂一份" cancelLabel="否，不加訂" defaultAction="cancel" />
      );
      return { onConfirm, onCancel };
    }

    it('defaultAction=cancel 時取消鍵取得初始焦點，Enter 等於取消', async () => {
      const user = userEvent.setup();
      const { onConfirm, onCancel } = renderDefaultCancel();
      expect(document.activeElement?.textContent).toBe('否，不加訂');
      await user.keyboard('{Enter}');
      expect(onCancel).toHaveBeenCalledOnce();
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('焦點不在對話框按鈕上時，Enter 也走預設的取消', () => {
      const { onConfirm, onCancel } = renderDefaultCancel();
      (document.activeElement as HTMLElement | null)?.blur();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
      expect(onCancel).toHaveBeenCalledOnce();
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('→ 移到確認鍵再按 Enter 才加訂', async () => {
      const user = userEvent.setup();
      const { onConfirm, onCancel } = renderDefaultCancel();
      await user.keyboard('{ArrowRight}');
      expect(document.activeElement?.textContent).toBe('是，再訂一份');
      await user.keyboard('{Enter}');
      expect(onConfirm).toHaveBeenCalledOnce();
      expect(onCancel).not.toHaveBeenCalled();
      await user.keyboard('{ArrowLeft}');
      expect(document.activeElement?.textContent).toBe('否，不加訂');
    });

    it('長按產生的重複 Enter 與輸入法選字的 Enter 都被吞掉', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();
      render(<ConfirmDialog open title="t" message="m" onConfirm={onConfirm} onCancel={onCancel} />);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, cancelable: true }));
      expect(onConfirm).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
    });

    it('對話框開著時背景的 Enter 監聽收不到這次 Enter', () => {
      const background = vi.fn();
      window.addEventListener('keydown', background);
      try {
        renderDefaultCancel();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
        expect(background).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener('keydown', background);
      }
    });
  });
});

describe('ConfirmDialog focus restore (#581 D3)', () => {
  function Harness() {
    const [open, setOpen] = React.useState(false);
    return (
      <>
        <input aria-label="金額" onKeyDown={event => { if (event.key === 'F2') setOpen(true); }} />
        <ConfirmDialog
          open={open}
          title="離開並捨棄草稿？"
          message="尚未送出的草稿會被捨棄。"
          defaultAction="cancel"
          cancelLabel="取消離開"
          onCancel={() => setOpen(false)}
          onConfirm={() => setOpen(false)}
        />
      </>
    );
  }

  it('returns focus to the opener when cancel had the initial autoFocus', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const amount = screen.getByLabelText('金額');
    amount.focus();
    await user.keyboard('{F2}');
    expect(screen.getByRole('button', { name: '取消離開' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '取消離開' }));
    expect(amount).toHaveFocus();
  });
});
