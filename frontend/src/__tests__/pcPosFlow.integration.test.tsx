import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { usePosStore } from '../store/posStore';

describe('pcPosFlow integration — keyboard flow', () => {
  beforeEach(() => {
    localStorage.clear();
    usePosStore.getState().resetData();
  });

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
      expect(screen.getByText('純繳費 / 儲值')).toBeTruthy();
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
      expect(screen.queryByText('✓')).toBeFalsy();
    });
  });
});
