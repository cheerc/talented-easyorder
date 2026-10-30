import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CloudLedgerSnapshot } from '../firebase/cloudDayCloseRepository';
import type { OpeningMismatchAnomaly } from '../domain/ledgerAnomalies';

const appMocks = vi.hoisted(() => ({
  read: vi.fn(),
  firebase: {
    fbError: null,
    fb: { auth: {}, db: {} },
    access: { ok: true, profile: { uid: 'uid-a', email: 'a@example.test' } },
    lease: { epoch: 4 },
  },
}));

vi.mock('../appMode', async importOriginal => ({
  ...(await importOriginal<typeof import('../appMode')>()),
  isPrototypeMode: false,
  validateAppModeConfig: () => ({ ok: true as const }),
}));
vi.mock('../providers/FirebaseProvider', () => ({
  FirebaseProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../hooks/useFirebase', () => ({ useFirebase: () => appMocks.firebase }));
vi.mock('../auth/AuthGate', () => ({ AuthGate: ({ children }: { children: ReactNode }) => children }));
vi.mock('../components/cloud/CloudPendingRecoveryBoundary', () => ({
  CloudPendingRecoveryBoundary: ({ children }: { children: (hasUnresolvedPendingCommands: boolean) => ReactNode }) => children(false),
}));
vi.mock('../firebase/cloudDayCloseRepository', () => ({
  createCloudLedgerReader: () => ({ read: appMocks.read }),
}));

type NavState = 'recovering' | 'revoked' | 'resolved';
type PageProps = {
  identityKey: string;
  onNavigationStateChange: (identityKey: string, state: NavState) => void;
  ledger?: { status: string };
  onOpenAnomalies?: () => void;
  onLedgerChanged?: () => void;
  initialDayId?: string;
  initialPostCloseEntry?: OpeningMismatchAnomaly;
};

function stubPage(label: string) {
  return ({ identityKey, onNavigationStateChange, ledger, onOpenAnomalies, onLedgerChanged, initialDayId, initialPostCloseEntry }: PageProps) => (
    <section aria-label={label}>
      <span data-testid={`${label}-ledger`}>{ledger?.status ?? 'none'}</span>
      <span data-testid={`${label}-focus`}>{initialDayId ?? ''}</span>
      <span data-testid={`${label}-post-close-focus`}>
        {initialPostCloseEntry ? `${initialPostCloseEntry.dayId}:${initialPostCloseEntry.difference}:${initialPostCloseEntry.previousEffectiveCash}` : ''}
      </span>
      <button type="button" onClick={() => onNavigationStateChange(identityKey, 'recovering')}>{label}：保持待確認命令</button>
      <button type="button" onClick={() => onNavigationStateChange(identityKey, 'resolved')}>{label}：回報已確認</button>
      <button type="button" onClick={() => onOpenAnomalies?.()}>{label}：到異常頁</button>
      <button type="button" onClick={() => onLedgerChanged?.()}>{label}：命令成功</button>
    </section>
  );
}
vi.mock('../components/cloud/CloudStudentsPage', () => ({ CloudStudentsPage: stubPage('students') }));
vi.mock('../components/cloud/CloudDayVendorsPage', () => ({ CloudDayVendorsPage: stubPage('day-vendors') }));
vi.mock('../components/cloud/CloudDayClosePage', () => ({ CloudDayClosePage: stubPage('day-close') }));

import App from '../App';

function snapshot(anomalies: CloudLedgerSnapshot['anomalies']): CloudLedgerSnapshot {
  return { today: '2026-10-17', goLiveDate: '2026-10-01', anomalies, closedDays: [], seq: 5 };
}

const unclosed = (dayId: string) => ({
  kind: 'unclosed-past-day' as const, dayId, status: 'open' as const, openingCash: 100, activeTransactionCount: 2,
});
const mismatch = {
  kind: 'opening-mismatch' as const, dayId: '2026-10-16', openingCash: 800, previousClosedDayId: '2026-10-14',
  previousCountedCash: 870, previousPostCloseNet: 0, previousEffectiveCash: 870, difference: -70, daysApart: 2, gapDays: [], gapDayCount: 0,
};

describe('cloud navigation: ledger anomalies entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the confirmed business date in the shell', async () => {
    appMocks.read.mockResolvedValue(snapshot([]));
    render(<App />);
    expect(await screen.findByText('2026-10-17')).toBeVisible();
  });

  it('keeps account checks available while hiding a zero-count status', async () => {
    let resolve!: (value: CloudLedgerSnapshot) => void;
    appMocks.read.mockReturnValue(new Promise<CloudLedgerSnapshot>(r => { resolve = r; }));
    render(<App />);
    fireEvent.click(screen.getByText('操作員'));
    expect(screen.getByRole('button', { name: '帳務檢查' })).toBeInTheDocument();
    resolve(snapshot([]));
    await waitFor(() => expect(appMocks.read).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: /^異常 \d+/ })).not.toBeInTheDocument();
  });

  it('allows an account check after a read error and shows later anomalies', async () => {
    appMocks.read.mockRejectedValueOnce(new Error('離線'));
    appMocks.read.mockResolvedValueOnce(snapshot([unclosed('2026-10-15'), mismatch]));
    render(<App />);
    await waitFor(() => expect(appMocks.read).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('操作員'));
    fireEvent.click(screen.getByRole('button', { name: '帳務檢查' }));
    expect(await screen.findByRole('button', { name: '異常 2' })).toBeInTheDocument();
    expect(await screen.findByRole('list', { name: '帳務異常清單' })).toBeInTheDocument();
    expect(appMocks.read).toHaveBeenCalledTimes(2);
  });

  it('reads once on entry, not on every page switch, and re-reads on account checks', async () => {
    appMocks.read.mockResolvedValue(snapshot([]));
    render(<App />);
    await waitFor(() => expect(appMocks.read).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(window, { key: 'F3' });
    fireEvent.keyDown(window, { key: 'F2' });
    fireEvent.keyDown(window, { key: 'F3' });
    fireEvent.click(screen.getByRole('button', { name: '學生' }));
    expect(appMocks.read).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('操作員'));
    fireEvent.click(screen.getByRole('button', { name: '帳務檢查' }));
    await waitFor(() => expect(appMocks.read).toHaveBeenCalledTimes(2));
  });

  it('passes the ledger to the open and close pages and re-reads after a successful command', async () => {
    appMocks.read.mockResolvedValue(snapshot([unclosed('2026-10-15')]));
    render(<App />);
    await screen.findByRole('button', { name: '異常 1' });
    fireEvent.keyDown(window, { key: 'F3' });
    expect(screen.getByTestId('day-vendors-ledger')).toHaveTextContent('ready');
    fireEvent.click(screen.getByRole('button', { name: 'day-vendors：命令成功' }));
    await waitFor(() => expect(appMocks.read).toHaveBeenCalledTimes(2));
    fireEvent.keyDown(window, { key: 'F2' });
    expect(screen.getByTestId('day-close-ledger')).toHaveTextContent('ready');
    fireEvent.click(screen.getByRole('button', { name: 'day-close：命令成功' }));
    await waitFor(() => expect(appMocks.read).toHaveBeenCalledTimes(3));
  });

  it('opens the anomalies page from a page banner and sends the day to the close page', async () => {
    appMocks.read.mockResolvedValue(snapshot([unclosed('2026-10-15')]));
    render(<App />);
    await screen.findByRole('button', { name: '異常 1' });
    fireEvent.keyDown(window, { key: 'F2' });
    fireEvent.click(screen.getByRole('button', { name: 'day-close：到異常頁' }));
    fireEvent.click(await screen.findByRole('button', { name: '到日結頁處理 2026-10-15' }));
    expect(screen.getByTestId('day-close-focus')).toHaveTextContent('2026-10-15');
    // Using the plain navigation button again does not keep the focus date.
    fireEvent.keyDown(window, { key: 'F3' });
    fireEvent.click(screen.getByRole('button', { name: '學生' }));
    fireEvent.keyDown(window, { key: 'F2' });
    expect(screen.getByTestId('day-close-focus')).toHaveTextContent('');
  });

  it('routes a gap-free opening difference to its previous closed day with the original cash preview', async () => {
    appMocks.read.mockResolvedValue(snapshot([mismatch]));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '異常 1' }));
    fireEvent.click(screen.getByTestId('post-close-shortcut-2026-10-16'));
    expect(screen.getByTestId('day-close-focus')).toHaveTextContent('2026-10-14');
    expect(screen.getByTestId('day-close-post-close-focus')).toHaveTextContent('2026-10-16:-70:870');

    fireEvent.keyDown(window, { key: 'F3' });
    fireEvent.click(screen.getByRole('button', { name: '學生' }));
    fireEvent.keyDown(window, { key: 'F2' });
    expect(screen.getByTestId('day-close-focus')).toHaveTextContent('');
    expect(screen.getByTestId('day-close-post-close-focus')).toHaveTextContent('');
  });

  it('respects the navigation lock', async () => {
    appMocks.read.mockResolvedValue(snapshot([]));
    render(<App />);
    await waitFor(() => expect(appMocks.read).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('操作員'));
    fireEvent.click(screen.getByRole('button', { name: 'students：保持待確認命令' }));
    expect(screen.getByRole('button', { name: '帳務檢查' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '帳務檢查' }));
    expect(appMocks.read).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'students：回報已確認' }));
    expect(screen.getByRole('button', { name: '帳務檢查' })).toBeEnabled();
  });
});
