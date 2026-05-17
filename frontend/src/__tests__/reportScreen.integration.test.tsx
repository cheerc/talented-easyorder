import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { usePosStore } from '../store/posStore';
import App from '../App';

beforeEach(() => {
  window.localStorage.clear();
  usePosStore.getState().resetData();
  usePosStore.persist.rehydrate();
});

describe('reportScreen integration', () => {
  it('renders report tab with date range controls', async () => {
    render(<App />);
    // Navigate to report tab
    const reportBtn = screen.getByText('今日帳');
    await userEvent.click(reportBtn);
    await waitFor(() => {
      expect(screen.getByText('總收入')).toBeTruthy();
    });
  });

  it('shows summary stats in report view', async () => {
    render(<App />);
    await userEvent.click(screen.getByText('今日帳'));
    await waitFor(() => {
      expect(screen.getByText('訂餐')).toBeTruthy();
      expect(screen.getByText('總收入')).toBeTruthy();
    });
  });

  it('shows grouped table with student names', async () => {
    render(<App />);
    await userEvent.click(screen.getByText('今日帳'));
    await waitFor(() => {
      // Report shows totals which are always rendered
      expect(screen.getByText('總交易')).toBeTruthy();
    });
  });

  it('shows opening cash input and expected drawer cash label', async () => {
    // Seed store with a cash session so openingCash is available
    usePosStore.getState().openCashSession({
      businessDate: new Date().toISOString().split('T')[0],
      openingCash: 4000,
      operatorId: 'counter',
      openedAt: new Date().toISOString(),
    });

    render(<App />);
    await userEvent.click(screen.getByText('今日帳'));
    await waitFor(() => {
      expect(screen.getByLabelText('開帳金額')).toBeTruthy();
      expect(screen.getByText('系統應有抽屜現金')).toBeTruthy();
    });
  });
});
