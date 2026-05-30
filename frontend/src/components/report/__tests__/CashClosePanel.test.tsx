import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { CashClosePanel } from '../CashClosePanel';
import type { LedgerTotals } from '../../domain/ledgerReport';

const baseTotals: LedgerTotals = {
  orderCount: 10,
  totalIncome: 900,
  totalExpense: 200,
  netCash: 700,
  newDebt: 900,
  transactionCount: 12,
};

const baseProps = {
  totals: baseTotals,
  businessDate: '2026-05-30',
  dateStatus: 'open' as string,
  hasQueuedRows: false,
  hasFailedConflict: false,
  openingCash: 500,
  onClose: vi.fn(),
};

describe('CashClosePanel', () => {
  it('shows disabled state when dateStatus is closed', () => {
    const { container } = render(<CashClosePanel {...baseProps} dateStatus="closed" />);
    const panel = container.querySelector('.cash-close-panel') as HTMLElement;
    expect(panel.style.opacity).toBe('0.6');
    expect(panel.style.pointerEvents).toBe('none');
  });

  it('shows 已關閉 pill when dateStatus is closed', () => {
    const { container } = render(<CashClosePanel {...baseProps} dateStatus="closed" />);
    expect(container.textContent).toContain('已關閉');
  });

  it('shows 已重開 pill when dateStatus is reopened', () => {
    const { container } = render(<CashClosePanel {...baseProps} dateStatus="reopened" />);
    expect(container.textContent).toContain('已重開');
  });

  it('displays openingCash formatted', () => {
    const { container } = render(<CashClosePanel {...baseProps} openingCash={1234} />);
    expect(container.textContent).toContain('$1,234');
  });

  it('displays netCash from totals', () => {
    const { container } = render(<CashClosePanel {...baseProps} totals={{ ...baseTotals, netCash: 567 }} />);
    expect(container.textContent).toContain('$567');
  });

  it('computes expectedDrawerCash = openingCash + netCash', () => {
    const { container } = render(<CashClosePanel {...baseProps} openingCash={300} totals={{ ...baseTotals, netCash: 200 }} />);
    // expectedDrawerCash = 300 + 200 = 500
    expect(container.textContent).toContain('$500');
  });

  it('shows — difference when no cash entered', () => {
    const { container } = render(<CashClosePanel {...baseProps} />);
    expect(container.textContent).toContain('—');
  });

  it('shows 平 when countedCash equals expectedDrawerCash', () => {
    const { container, getByLabelText } = render(
      <CashClosePanel {...baseProps} openingCash={100} totals={{ ...baseTotals, netCash: 200 }} />
    );
    const input = getByLabelText('實際點算金額') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '300' } });
    expect(container.textContent).toContain('平');
  });

  it('shows positive difference in green when countedCash > expected', () => {
    const { container, getByLabelText } = render(
      <CashClosePanel {...baseProps} openingCash={0} totals={{ ...baseTotals, netCash: 100 }} />
    );
    const input = getByLabelText('實際點算金額') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '150' } });
    expect(container.textContent).toContain('+$50');
    const diffEl = container.querySelector('.pos');
    expect(diffEl).toBeTruthy();
  });

  it('shows negative difference in warn when countedCash < expected', () => {
    const { container, getByLabelText } = render(
      <CashClosePanel {...baseProps} openingCash={0} totals={{ ...baseTotals, netCash: 100 }} />
    );
    const input = getByLabelText('實際點算金額') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '80' } });
    expect(container.textContent).toContain('−$20');
    const diffEl = container.querySelector('.warn');
    expect(diffEl).toBeTruthy();
  });

  it('確認關帳 button disabled when note is empty', () => {
    const { getByText } = render(<CashClosePanel {...baseProps} />);
    const btn = getByText('確認關帳') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('確認關帳 button disabled when hasFailedConflict is true', () => {
    const { getByText } = render(<CashClosePanel {...baseProps} hasFailedConflict />);
    const btn = getByText('確認關帳') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('確認關帳 button disabled when hasQueuedRows and not queuedAccepted', () => {
    const { getByText } = render(<CashClosePanel {...baseProps} hasQueuedRows queuedRowCount={3} />);
    const btn = getByText('確認關帳') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('shows queued rows checkbox when hasQueuedRows and queuedRowCount > 0', () => {
    const { container } = render(<CashClosePanel {...baseProps} hasQueuedRows queuedRowCount={5} />);
    expect(container.textContent).toContain('尚有 5 筆交易未上傳雲端');
  });

  it('確認關帳 button enabled when hasQueuedRows and queuedAccepted', () => {
    const { container, getByText } = render(
      <CashClosePanel {...baseProps} hasQueuedRows queuedRowCount={2} />
    );
    // First fill in the note (required for canClose)
    const noteInput = getByText('備註').nextElementSibling as HTMLInputElement;
    fireEvent.change(noteInput, { target: { value: 'test' } });
    const cb = container.querySelector('#queued-accept') as HTMLInputElement;
    fireEvent.click(cb);
    const btn = getByText('確認關帳') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('shows confirmation dialog on 確認關帳 click', () => {
    const { container, getByText } = render(
      <CashClosePanel {...baseProps} openingCash={100} />
    );
    const noteInput = getByText('備註').nextElementSibling as HTMLInputElement;
    fireEvent.change(noteInput, { target: { value: 'test note' } });
    const closeBtn = container.querySelector('.cash-close-panel .btn-confirm') as HTMLButtonElement;
    fireEvent.click(closeBtn);
    expect(container.querySelector('.dialog-overlay')).toBeTruthy();
    expect(getByText('取消')).toBeTruthy();
    expect(getByText('確定關帳')).toBeTruthy();
  });

  it('confirmation dialog shows businessDate, openingCash, netCash, expectedDrawerCash, countedCash, difference', () => {
    const { container, getByText } = render(
      <CashClosePanel {...baseProps} openingCash={100} totals={{ ...baseTotals, netCash: 400 }} />
    );
    const noteInput = getByText('備註').nextElementSibling as HTMLInputElement;
    fireEvent.change(noteInput, { target: { value: 'test' } });
    fireEvent.click(getByText('確認關帳'));
    expect(container.textContent).toContain('2026-05-30');
    expect(container.textContent).toContain('$100');
    expect(container.textContent).toContain('$400');
    expect(container.textContent).toContain('$500');
    expect(container.textContent).toContain('$0');
  });

  it('confirmation dialog calls onClose(countedCash, note) on confirm', () => {
    const onClose = vi.fn();
    const { getByText, getByLabelText } = render(
      <CashClosePanel {...baseProps} onClose={onClose} />
    );
    const noteInput = getByText('備註').nextElementSibling as HTMLInputElement;
    fireEvent.change(noteInput, { target: { value: 'end of day' } });
    const cashInput = getByLabelText('實際點算金額') as HTMLInputElement;
    fireEvent.change(cashInput, { target: { value: '1200' } });
    fireEvent.click(getByText('確認關帳'));
    fireEvent.click(getByText('確定關帳'));
    expect(onClose).toHaveBeenCalledWith(1200, 'end of day');
  });

  it('clicking overlay dismisses confirmation dialog', () => {
    const { getByText, container } = render(
      <CashClosePanel {...baseProps} />
    );
    const noteInput = getByText('備註').nextElementSibling as HTMLInputElement;
    fireEvent.change(noteInput, { target: { value: 'test' } });
    fireEvent.click(getByText('確認關帳'));
    const overlay = container.querySelector('.dialog-overlay') as HTMLElement;
    fireEvent.click(overlay);
    // Dialog should be dismissed, overlay removed
    expect(container.querySelector('.dialog-overlay')).toBeNull();
  });

  it('shows failed conflict warning when hasFailedConflict', () => {
    const { container } = render(<CashClosePanel {...baseProps} hasFailedConflict />);
    expect(container.textContent).toContain('同步失敗或衝突記錄');
  });

  it('cash input field accepts numeric values', () => {
    const { getByLabelText } = render(<CashClosePanel {...baseProps} />);
    const input = getByLabelText('實際點算金額') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1500' } });
    expect(input.value).toBe('1500');
  });
});
