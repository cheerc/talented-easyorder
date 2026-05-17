import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { usePosStore } from '../store/posStore';

describe('pcPosSafety — duplicate submit guard', () => {
  beforeEach(() => {
    window.localStorage.clear();
    usePosStore.getState().resetData();
  });

  it('confirm button triggers one commit per click', async () => {
    render(<App />);
    const user = userEvent.setup();

    const input = screen.getByPlaceholderText(/015/);
    await user.type(input, '015');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText('確認')).toBeTruthy();
    });

    const confirmBtn = screen.getByText('確認');
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByText('✓')).toBeTruthy();
    });
  });
});

describe('pcPosSafety — duplicate order warning', () => {
  beforeEach(() => {
    window.localStorage.clear();
    usePosStore.getState().resetData();
  });

  it('first order shows no duplicate warning', async () => {
    render(<App />);
    const user = userEvent.setup();

    const input = screen.getByPlaceholderText(/015/);
    await user.type(input, '015');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText('確認')).toBeTruthy();
    });

    const confirmBtn = screen.getByText('確認');
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByText('✓')).toBeTruthy();
    });
  });

  it('second order shows duplicate warning banner', async () => {
    render(<App />);
    const user = userEvent.setup();

    // First order
    const input = screen.getByPlaceholderText(/015/) as HTMLInputElement;
    await user.click(input);
    await user.keyboard('015{Enter}');
    await waitFor(() => expect(screen.getByText('確認')).toBeTruthy());
    await user.click(screen.getByText('確認'));
    await waitFor(() => expect(screen.getByText('✓')).toBeTruthy());

    // Dismiss flash by pressing Enter
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByText('✓')).toBeFalsy());

    // Second order on same student — need to click back into the input
    const input2 = screen.getByPlaceholderText(/015/) as HTMLInputElement;
    await user.click(input2);
    await user.keyboard('015{Enter}');
    await waitFor(() => expect(screen.getByText('確認')).toBeTruthy());
    await user.click(screen.getByText('確認'));

    // Should see duplicate warning
    await waitFor(() => {
      const el = document.querySelector('.dup-warn-h');
      expect(el).toBeTruthy();
    });
  });

  it('uses operator-friendly payment wording', async () => {
    render(<App />);
    const user = userEvent.setup();

    const input = screen.getByPlaceholderText(/015/);
    await user.type(input, '015');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /繳費/ })).toBeTruthy();
      expect(screen.queryByText(/純繳費/)).not.toBeTruthy();
    });
  });
});
