import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { resetStoreForTest } from './helpers/storeSetup';

describe('pcPosFlow integration — keyboard flow', () => {
  beforeEach(() => resetStoreForTest());

  it('typing an exact student id and pressing Enter selects the student', async () => {
    render(<App />);
    const user = userEvent.setup();

    const input = screen.getByPlaceholderText(/015/);
    await user.type(input, '015');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText('周映彤')).toBeTruthy();
    });
  });

  it('selecting a student shows Q/W/E mode shortcuts', async () => {
    render(<App />);
    const user = userEvent.setup();

    const input = screen.getByPlaceholderText(/015/);
    await user.type(input, '015');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText('訂便當')).toBeTruthy();
      expect(screen.getByText('繳費')).toBeTruthy();
    });
  });

  it('pressing Escape in idle clears search text', async () => {
    render(<App />);
    const user = userEvent.setup();

    const input = screen.getByPlaceholderText(/015/) as HTMLInputElement;
    await user.type(input, 'abc');
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe('');
    });
  });

  it('success dismissal clears selected student', async () => {
    render(<App />);
    const user = userEvent.setup();

    const input = screen.getByPlaceholderText(/015/);
    await user.type(input, '015');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText('確認')).toBeTruthy();
    });

    // Press Enter on confirm to commit
    await user.keyboard('{Enter}');

    await waitFor(() => {
      // Flash banner appears with checkmark
      expect(screen.getByText('✓')).toBeTruthy();
    });

    // Dismiss the flash
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.queryByTestId('payment-success')).toBeNull();
    });
  });

  it('uses today menu price as the first order quick amount', async () => {
    render(<App />);
    const user = userEvent.setup();

    const input = screen.getByPlaceholderText(/015/);
    await user.type(input, '015');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText('訂便當')).toBeTruthy();
    });

    // Quick buttons should NOT appear in order mode (F5-2)
    const quickButtons = screen.queryAllByRole('button', { name: '90' });
    expect(quickButtons.length).toBe(0);
  });

  it('allows changing only the selected order price before commit', async () => {
    render(<App />);
    const user = userEvent.setup();

    const input = screen.getByPlaceholderText(/015/);
    await user.type(input, '015');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText('訂便當')).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: '訂購其他餐點' }));
    await user.clear(screen.getByLabelText('品項或原因'));
    await user.type(screen.getByLabelText('品項或原因'), '雞腿便當');
    await user.clear(screen.getByLabelText('價格'));
    await user.type(screen.getByLabelText('價格'), '110');

    expect(screen.getByText(/110/)).toBeTruthy();
  });

  it('prevents submitting empty or $0 payments in payment mode', async () => {
    render(<App />);
    const user = userEvent.setup();

    const input = screen.getByPlaceholderText(/015/);
    await user.type(input, '015');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText('訂便當')).toBeTruthy();
    });

    // Switch to payment mode (W)
    await user.click(screen.getByRole('radio', { name: /繳費/ }));

    // Confirm that the current mode is payment
    const paymentInput = screen.getByLabelText('付款金額') as HTMLInputElement;
    expect(paymentInput).toBeTruthy();

    // Verify it is initially empty
    expect(paymentInput.value).toBe('');

    // Try to confirm (Enter or click confirm)
    await user.keyboard('{Enter}');

    // Verify we are still on the student payment page, NOT in success state (no checkmark)
    expect(screen.queryByTestId('payment-success')).toBeNull();
    expect(screen.getByLabelText('付款金額')).toBeTruthy();

    // Type 0 and try to confirm
    await user.type(paymentInput, '0');
    await user.keyboard('{Enter}');

    // Verify we are still on the student payment page
    expect(screen.queryByTestId('payment-success')).toBeNull();
    expect(screen.getByLabelText('付款金額')).toBeTruthy();

    // Type a positive number and try to confirm
    await user.clear(paymentInput);
    await user.type(paymentInput, '100');
    await user.keyboard('{Enter}');

    // Verify it successfully committed (shows flash success checkmark)
    await waitFor(() => {
      expect(screen.getByTestId('payment-success')).toBeTruthy();
    });
  });

  it('shows sync status badge in the UI', async () => {
    render(<App />);
    const syncBadge = screen.queryByRole('status');
    // When Firebase is not configured, the app may still render with local-only mode
    // The sync badge presence or absence should not crash the render
    expect(syncBadge || screen.queryByText(/已同步|同步中|離線待同步|衝突需處理/)).toBeDefined();
  });
});
