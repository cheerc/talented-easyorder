import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CancelOrderDialog } from '../CancelOrderDialog';
import type { LedgerTransaction } from '../../domain/ledger';
import type { LedgerMutationResult } from '../../domain/ledgerAudit';

const account = { displayName: '測試甲', currentBalance: 500 };

// 訂 90、當場收 100：本筆淨額 +10。
const orderWithPaid = {
  transactionId: 'tx-1',
  studentId: 's-1',
  studentNameSnapshot: '測試甲',
  type: 'order',
  businessDate: '2026-06-18',
  mealPrice: 90,
  paidAmount: 100,
  amount: 10,
  afterBalance: 500,
  menuNameSnapshot: '晚餐',
  vendorNameSnapshot: '',
  note: '',
  sourceDevice: 'pc',
  syncStatus: 'local',
  revision: 1,
  createdAt: '2026-06-18T10:00:00Z',
} as LedgerTransaction;

const orderNoPaid = { ...orderWithPaid, paidAmount: 0, amount: -90 } as LedgerTransaction;

const REASON_LABEL = '理由（必填，會記在稽核紀錄）';

describe('CancelOrderDialog', () => {
  let onConfirm: ReturnType<typeof vi.fn<(keep: boolean, reason: string) => LedgerMutationResult>>;
  let onCancel: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    onConfirm = vi.fn<(keep: boolean, reason: string) => LedgerMutationResult>(() => ({ ok: true }));
    onCancel = vi.fn<() => void>();
  });

  const renderDialog = (orderTx: LedgerTransaction, open = true) => render(
    <CancelOrderDialog open={open} account={account} orderTx={orderTx} onConfirm={onConfirm} onCancel={onCancel} />,
  );

  const impact = () => document.querySelector('.cancel-impact')!.textContent;

  describe('有收款時（可選退款方式）', () => {
    it('預設「收款留在帳戶」，不會自動退現（規格 L-TRACE）', () => {
      renderDialog(orderWithPaid);
      const radios = screen.getAllByRole('radio');
      expect(radios[1]).toBeChecked();
      expect(radios[0]).not.toBeChecked();
    });

    it('打完理由直接按 Enter：送出的是留在帳戶，不是退現', () => {
      renderDialog(orderWithPaid);
      const reason = screen.getByLabelText(REASON_LABEL);
      fireEvent.change(reason, { target: { value: '家長來電取消' } });
      fireEvent.keyDown(reason, { key: 'Enter' });
      expect(onConfirm).toHaveBeenCalledWith(true, '家長來電取消');
    });

    it('↑／↓ 切換退款方式，停在兩端', () => {
      renderDialog(orderWithPaid);
      const radios = screen.getAllByRole('radio');
      fireEvent.keyDown(window, { key: 'ArrowUp' });
      fireEvent.keyDown(window, { key: 'ArrowUp' });
      expect(radios[0]).toBeChecked();
      fireEvent.keyDown(window, { key: 'ArrowDown' });
      fireEvent.keyDown(window, { key: 'ArrowDown' });
      expect(radios[1]).toBeChecked();
    });

    it('注音選字中的 ↑／↓ 不會切換退款方式', () => {
      renderDialog(orderWithPaid);
      const radios = screen.getAllByRole('radio');
      const reason = screen.getByLabelText(REASON_LABEL);
      fireEvent.keyDown(reason, { key: 'ArrowUp', isComposing: true });
      fireEvent.keyDown(reason, { key: 'ArrowUp', keyCode: 229 });
      expect(radios[1]).toBeChecked();
    });

    it('先說明影響：預設留在帳戶 → 餘額 500 + 90 = 590，現金不變', () => {
      renderDialog(orderWithPaid);
      expect(impact()).toContain('$500 → $590');
      expect(impact()).toContain('櫃台現金不變');
    });

    it('先說明影響：按 ↑ 改成退還收款 → 餘額 500 − 10 = 490，櫃台退 100', () => {
      renderDialog(orderWithPaid);
      fireEvent.keyDown(window, { key: 'ArrowUp' });
      expect(impact()).toContain('$500 → $490');
      expect(impact()).toContain('櫃台退還現金 $100');
    });

    it('按 ↑ 選退還後按確認，送出 keepPaymentAsDeposit=false 與理由', () => {
      renderDialog(orderWithPaid);
      fireEvent.keyDown(window, { key: 'ArrowUp' });
      fireEvent.change(screen.getByLabelText(REASON_LABEL), { target: { value: '要退錢' } });
      fireEvent.click(screen.getByText('確認取消'));
      expect(onConfirm).toHaveBeenCalledWith(false, '要退錢');
    });
  });

  describe('沒有收款時', () => {
    it('沒有退款選項；餘額 500 + 90 = 590，現金不變', () => {
      renderDialog(orderNoPaid);
      expect(screen.queryAllByRole('radio')).toHaveLength(0);
      expect(impact()).toContain('$500 → $590');
      expect(impact()).toContain('櫃台現金不變');
    });

    it('按確認取消送出 keepPaymentAsDeposit=false', () => {
      renderDialog(orderNoPaid);
      fireEvent.change(screen.getByLabelText(REASON_LABEL), { target: { value: '訂錯人' } });
      fireEvent.click(screen.getByText('確認取消'));
      expect(onConfirm).toHaveBeenCalledWith(false, '訂錯人');
    });
  });

  it('理由欄自動取得焦點，輸入法選字的 Enter 不送出', () => {
    renderDialog(orderNoPaid);
    const reason = screen.getByLabelText(REASON_LABEL);
    expect(document.activeElement).toBe(reason);
    fireEvent.keyDown(reason, { key: 'Enter', keyCode: 229 });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('送出失敗（缺理由、已關帳）時留在對話框並顯示原因', () => {
    onConfirm.mockReturnValue({ ok: false, message: '請填寫理由。' });
    renderDialog(orderNoPaid);
    fireEvent.click(screen.getByText('確認取消'));
    expect(screen.getByRole('alert').textContent).toBe('請填寫理由。');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('關閉時不處理按鍵', () => {
    renderDialog(orderWithPaid, false);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Esc 經由 Modal 呼叫 onCancel', () => {
    renderDialog(orderWithPaid);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});
