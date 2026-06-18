import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetStoreForTest } from './helpers/storeSetup';
import { renderApp } from './helpers/renderApp';

describe('pcPosSafety — duplicate submit guard', () => {
  beforeEach(() => resetStoreForTest());

  it('confirm button triggers one commit per click', async () => {
    await renderApp();
    const user = userEvent.setup();

    const input = screen.getByPlaceholderText(/015/);
    await user.type(input, '015');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText('訂便當')).toBeTruthy();
    });

    // Press Enter to commit (keyboard shortcut replaces confirm button)
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText('✓')).toBeTruthy();
    });
  });
});

describe('pcPosSafety — duplicate order warning', () => {
  beforeEach(() => resetStoreForTest());

  it('first order shows no duplicate warning', async () => {
    await renderApp();
    const user = userEvent.setup();

    const input = screen.getByPlaceholderText(/015/);
    await user.type(input, '015');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText('訂便當')).toBeTruthy();
    });

    // Press Enter to commit (keyboard shortcut replaces confirm button)
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText('✓')).toBeTruthy();
    });
  });

  it('second selection defaults to payment when hasOrderToday', async () => {
    await renderApp();
    const user = userEvent.setup();

    // First order
    const input = screen.getByPlaceholderText(/015/) as HTMLInputElement;
    await user.click(input);
    await user.keyboard('015{Enter}');
    await waitFor(() => expect(screen.getByText('訂便當')).toBeTruthy());
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText('✓')).toBeTruthy());

    // Dismiss flash by pressing Enter
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByText('✓')).toBeFalsy());

    // Second selection on same student — hasOrderToday=true → defaults to payment mode
    const input2 = screen.getByPlaceholderText(/015/) as HTMLInputElement;
    await user.click(input2);
    await user.keyboard('015{Enter}');

    // Should be in payment mode, not order mode
    await waitFor(() => {
      expect(screen.getByText('繳費')).toBeTruthy();
    });
  });

  it('uses operator-friendly payment wording', async () => {
    await renderApp();
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
