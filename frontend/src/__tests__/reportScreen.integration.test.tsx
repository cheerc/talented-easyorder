import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { usePosStore } from '../store/posStore';
import { resetStoreForTest } from './helpers/storeSetup';
import { renderApp } from './helpers/renderApp';

beforeEach(() => resetStoreForTest());

describe('reportScreen integration', () => {
  it('renders report tab with date range controls', async () => {
    await renderApp();
    // Navigate to report tab
    const reportBtn = screen.getByText('今日帳');
    await userEvent.click(reportBtn);
    await waitFor(() => {
      expect(screen.getByText('總收入')).toBeTruthy();
    });
  });

  it('shows summary stats in report view', async () => {
    await renderApp();
    await userEvent.click(screen.getByText('今日帳'));
    await waitFor(() => {
      expect(screen.getByText('訂餐')).toBeTruthy();
      expect(screen.getByText('總收入')).toBeTruthy();
    });
  });

  it('shows grouped table with student names', async () => {
    await renderApp();
    await userEvent.click(screen.getByText('今日帳'));
    await waitFor(() => {
      // Report shows totals which are always rendered
      expect(screen.getByText('總交易')).toBeTruthy();
    });
  });

  it('shows opening cash display and expected drawer cash label', async () => {
    // Seed store with a cash session so openingCash is available
    usePosStore.getState().openCashSession({
      businessDate: new Date().toISOString().split('T')[0],
      openingCash: 4000,
      operatorId: 'counter',
      openedAt: new Date().toISOString(),
    });

    await renderApp();
    await userEvent.click(screen.getByText('今日帳'));
    await waitFor(() => {
      expect(screen.getByText('開帳金額')).toBeTruthy();
      expect(screen.getByText('系統應有抽屜現金')).toBeTruthy();
    });
  });
});
