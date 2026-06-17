import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { FlashData } from '../MainLayout';

vi.mock('../pos-components', () => ({
  TopBar: vi.fn(() => <div data-testid="topbar">TopBar</div>),
  ConfirmBanner: vi.fn(() => <div data-testid="confirm-banner">ConfirmBanner</div>),
}));

vi.mock('../ui/ConfirmDialog', () => ({
  ConfirmDialog: vi.fn(() => <div data-testid="confirm-dialog">ConfirmDialog</div>),
}));

vi.mock('../CancelOrderDialog', () => ({
  CancelOrderDialog: vi.fn(() => <div data-testid="cancel-order-dialog">CancelOrderDialog</div>),
}));

vi.mock('../TodayDashboard', () => ({
  TodayDashboard: vi.fn(() => <div data-testid="today-dashboard">TodayDashboard</div>),
}));

vi.mock('../PwaInstallBanner', () => ({
  PwaInstallBanner: vi.fn(() => <div data-testid="pwa-banner">PwaBanner</div>),
}));

import { MainLayout } from '../MainLayout';

const baseProps = {
  tab: 'order',
  setTab: vi.fn(),
  online: true,
  syncing: false,
  lastSync: '14:00',
  todayCount: 5,
  viewDate: '2026-05-30',
  setViewDate: vi.fn(),
  systemDate: '2026-05-30',
  queuedCount: 0,
  failedSyncCount: 0,
  conflictSyncCount: 0,
  onDashboard: vi.fn(),
  flashData: null as FlashData | null,
  onDismissFlash: vi.fn(),
  onUndo: vi.fn(),
  undoCountdown: 0,
  cancelDialogOpen: false,
  picked: null,
  orderTx: null,
  onCancelDialogConfirm: vi.fn(),
  onCancelDialogCancel: vi.fn(),
  noOrderDialogOpen: false,
  onNoOrderDialogClose: vi.fn(),
  showDashboard: false,
  onCloseDashboard: vi.fn(),
};

describe('MainLayout', () => {
  it('renders children inside app container', () => {
    const { container } = render(
      <MainLayout {...baseProps}>
        <div data-testid="child">Hello</div>
      </MainLayout>
    );
    expect(container.querySelector('.app')).toBeTruthy();
    expect(container.querySelector('[data-testid="child"]')).toBeTruthy();
    expect(container.textContent).toContain('Hello');
  });

  it('renders TopBar', () => {
    const { container } = render(
      <MainLayout {...baseProps}>
        <div>content</div>
      </MainLayout>
    );
    expect(container.querySelector('[data-testid="topbar"]')).toBeTruthy();
  });

  it('renders TodayDashboard when showDashboard is true', () => {
    const { container } = render(
      <MainLayout {...baseProps} showDashboard={true}>
        <div>content</div>
      </MainLayout>
    );
    expect(container.querySelector('[data-testid="today-dashboard"]')).toBeTruthy();
  });

  it('does not render TodayDashboard when showDashboard is false', () => {
    const { container } = render(
      <MainLayout {...baseProps} showDashboard={false}>
        <div>content</div>
      </MainLayout>
    );
    expect(container.querySelector('[data-testid="today-dashboard"]')).toBeNull();
  });

  it('renders ConfirmBanner', () => {
    const { container } = render(
      <MainLayout {...baseProps}>
        <div>content</div>
      </MainLayout>
    );
    expect(container.querySelector('[data-testid="confirm-banner"]')).toBeTruthy();
  });

  it('renders PwaInstallBanner', () => {
    const { container } = render(
      <MainLayout {...baseProps}>
        <div>content</div>
      </MainLayout>
    );
    expect(container.querySelector('[data-testid="pwa-banner"]')).toBeTruthy();
  });
});
