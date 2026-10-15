import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  OpeningCashConfirmDialog,
} from '../OpeningCashConfirmDialog';
import {
  formatDiff,
  formatMonthDay,
} from '../openingCashConfirmUtils';

describe('OpeningCashConfirmDialog helpers', () => {
  it('formatMonthDay parses YYYY-MM-DD to MM/DD', () => {
    expect(formatMonthDay('2026-10-14')).toBe('10/14');
    expect(formatMonthDay('2026-05-09')).toBe('05/09');
    expect(formatMonthDay('')).toBe('');
    expect(formatMonthDay(undefined)).toBe('');
  });

  it('formatDiff formats positive, negative, and zero differences', () => {
    expect(formatDiff(20)).toBe('+$20');
    expect(formatDiff(-20)).toBe('−$20');
    expect(formatDiff(-1000)).toBe('−$1,000');
    expect(formatDiff(0)).toBe('$0');
  });
});

describe('OpeningCashConfirmDialog', () => {
  it('Situation 1: Different from previous day shows difference and does not require checkbox', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <OpeningCashConfirmDialog
        open={true}
        hasCashSession={false}
        draftAmount={2710}
        suggestedOpeningCash={{
          amount: 2730,
          source: 'previous_day',
          fromDate: '2026-10-14',
        }}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText('設定開帳金額')).toBeTruthy();
    expect(screen.getByText('確定要將今日開帳金額設為 $2,710 嗎？')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('與前一天（10/14）關帳點算的 $2,730 不同，差 −$20。');

    // No checkbox required
    expect(screen.queryByLabelText('我已實際清點')).toBeNull();

    const confirmBtn = screen.getByRole('button', { name: '確認設定' });
    expect(confirmBtn.hasAttribute('disabled')).toBe(false);

    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('Situation 1 (positive difference): displays +$X', () => {
    render(
      <OpeningCashConfirmDialog
        open={true}
        hasCashSession={false}
        draftAmount={2800}
        suggestedOpeningCash={{
          amount: 2730,
          source: 'previous_day',
          fromDate: '2026-10-14',
        }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByRole('alert').textContent).toContain('與前一天（10/14）關帳點算的 $2,730 不同，差 +$70。');
  });

  it('Situation 1 on same day reopened: compares with same day opening cash', () => {
    render(
      <OpeningCashConfirmDialog
        open={true}
        hasCashSession={false}
        draftAmount={3000}
        suggestedOpeningCash={{
          amount: 4000,
          source: 'same_day',
        }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByRole('alert').textContent).toContain('與這一天上次關帳用的開帳金額 $4,000 不同，差 −$1,000。');
  });

  it('Situation 2: Same as previous day requires checking "我已實際清點" before confirming', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <OpeningCashConfirmDialog
        open={true}
        hasCashSession={false}
        draftAmount={2730}
        suggestedOpeningCash={{
          amount: 2730,
          source: 'previous_day',
          fromDate: '2026-10-14',
        }}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText(/開帳金額與前一天（10\/14）關帳點算相同（\$2,730）。請確實清點抽屜現金後再按確認。/)).toBeTruthy();

    const checkbox = screen.getByLabelText('我已實際清點') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    const confirmBtn = screen.getByRole('button', { name: '確認設定' });
    expect(confirmBtn.hasAttribute('disabled')).toBe(true);

    // Enter should not confirm when unchecked
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();

    // Check the box
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(confirmBtn.hasAttribute('disabled')).toBe(false);

    // Now click confirm
    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('Situation 2 on same day reopened: text references same day opening cash', () => {
    render(
      <OpeningCashConfirmDialog
        open={true}
        hasCashSession={false}
        draftAmount={4000}
        suggestedOpeningCash={{
          amount: 4000,
          source: 'same_day',
        }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText(/開帳金額與這一天上次關帳用的開帳金額相同（\$4,000）。請確實清點抽屜現金後再按確認。/)).toBeTruthy();
    expect(screen.getByLabelText('我已實際清點')).toBeTruthy();
  });

  it('Situation 3: No previous day data displays prompt and does not require checkbox', () => {
    const onConfirm = vi.fn();

    render(
      <OpeningCashConfirmDialog
        open={true}
        hasCashSession={false}
        draftAmount={5000}
        suggestedOpeningCash={null}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('確定要將今日開帳金額設為 $5,000 嗎？請確實清點抽屜現金後再按確認。')).toBeTruthy();
    expect(screen.queryByLabelText('我已實際清點')).toBeNull();

    const confirmBtn = screen.getByRole('button', { name: '確認設定' });
    expect(confirmBtn.hasAttribute('disabled')).toBe(false);

    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('Modifying existing session (hasCashSession = true) shows impact warning and confirm label "確認修改"', () => {
    render(
      <OpeningCashConfirmDialog
        open={true}
        hasCashSession={true}
        draftAmount={3000}
        suggestedOpeningCash={{
          amount: 2730,
          source: 'previous_day',
          fromDate: '2026-10-14',
        }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('修改開帳金額')).toBeTruthy();
    expect(screen.getByText('修改開帳金額會影響今日所有帳務計算，確定要繼續嗎？')).toBeTruthy();
    expect(screen.getByRole('button', { name: '確認修改' })).toBeTruthy();
  });

  it('Modifying existing session when same as previous day requires checkbox and shows both warnings', () => {
    const onConfirm = vi.fn();

    render(
      <OpeningCashConfirmDialog
        open={true}
        hasCashSession={true}
        draftAmount={2730}
        suggestedOpeningCash={{
          amount: 2730,
          source: 'previous_day',
          fromDate: '2026-10-14',
        }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('修改開帳金額會影響今日所有帳務計算。')).toBeTruthy();
    expect(screen.getByText(/開帳金額與前一天（10\/14）關帳點算相同（\$2,730）。請確實清點抽屜現金後再按確認。/)).toBeTruthy();

    const checkbox = screen.getByLabelText('我已實際清點') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    const confirmBtn = screen.getByRole('button', { name: '確認修改' });
    expect(confirmBtn.hasAttribute('disabled')).toBe(true);

    fireEvent.click(checkbox);
    expect(confirmBtn.hasAttribute('disabled')).toBe(false);

    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('resets checkbox to unchecked when reopened', () => {
    const { rerender } = render(
      <OpeningCashConfirmDialog
        open={true}
        hasCashSession={false}
        draftAmount={2730}
        suggestedOpeningCash={{
          amount: 2730,
          source: 'previous_day',
          fromDate: '2026-10-14',
        }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const checkbox = screen.getByLabelText('我已實際清點') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    // Close dialog
    rerender(
      <OpeningCashConfirmDialog
        open={false}
        hasCashSession={false}
        draftAmount={2730}
        suggestedOpeningCash={{
          amount: 2730,
          source: 'previous_day',
          fromDate: '2026-10-14',
        }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    // Reopen dialog
    rerender(
      <OpeningCashConfirmDialog
        open={true}
        hasCashSession={false}
        draftAmount={2730}
        suggestedOpeningCash={{
          amount: 2730,
          source: 'previous_day',
          fromDate: '2026-10-14',
        }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const reloadedCheckbox = screen.getByLabelText('我已實際清點') as HTMLInputElement;
    expect(reloadedCheckbox.checked).toBe(false);
  });
});
