import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CloudLedgerSnapshot } from '../firebase/cloudDayCloseRepository';

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
};

function stubPage(label: string) {
  return ({ identityKey, onNavigationStateChange, ledger, onOpenAnomalies, onLedgerChanged, initialDayId }: PageProps) => (
    <section aria-label={label}>
      <span data-testid={`${label}-ledger`}>{ledger?.status ?? 'none'}</span>
      <span data-testid={`${label}-focus`}>{initialDayId ?? ''}</span>
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
  previousCountedCash: 870, difference: -70, daysApart: 2, gapDays: [], gapDayCount: 0,
};

describe('cloud navigation: ledger anomalies entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading, failure and zero counts on the navigation entry', async () => {
    let resolve!: (value: CloudLedgerSnapshot) => void;
    appMocks.read.mockReturnValue(new Promise<CloudLedgerSnapshot>(r => { resolve = r; }));
    render(<App />);
    expect(screen.getByRole('button', { name: '帳務異常（…）' })).toBeInTheDocument();
    resolve(snapshot([]));
    expect(await screen.findByRole('button', { name: '帳務異常（0）' })).toBeInTheDocument();
  });

  it('shows ? when the read fails and recovers on reload from the anomalies page', async () => {
    appMocks.read.mockRejectedValueOnce(new Error('離線'));
    appMocks.read.mockResolvedValueOnce(snapshot([unclosed('2026-10-15'), mismatch]));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '帳務異常（?）' }));
    expect(await screen.findByRole('button', { name: '帳務異常（2）' })).toBeInTheDocument();
    expect(await screen.findByRole('list', { name: '帳務異常清單' })).toBeInTheDocument();
    expect(appMocks.read).toHaveBeenCalledTimes(2);
  });

  it('reads once on entry, not on every page switch, and re-reads when the anomalies page is opened', async () => {
    appMocks.read.mockResolvedValue(snapshot([]));
    render(<App />);
    await screen.findByRole('button', { name: '帳務異常（0）' });
    fireEvent.click(screen.getByRole('button', { name: '日期與供應商' }));
    fireEvent.click(screen.getByRole('button', { name: '日結' }));
    fireEvent.click(screen.getByRole('button', { name: '學生管理' }));
    expect(appMocks.read).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /^帳務異常/ }));
    await waitFor(() => expect(appMocks.read).toHaveBeenCalledTimes(2));
  });

  it('passes the ledger to the open and close pages and re-reads after a successful command', async () => {
    appMocks.read.mockResolvedValue(snapshot([unclosed('2026-10-15')]));
    render(<App />);
    await screen.findByRole('button', { name: '帳務異常（1）' });
    fireEvent.click(screen.getByRole('button', { name: '日期與供應商' }));
    expect(screen.getByTestId('day-vendors-ledger')).toHaveTextContent('ready');
    fireEvent.click(screen.getByRole('button', { name: 'day-vendors：命令成功' }));
    await waitFor(() => expect(appMocks.read).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '日結' }));
    expect(screen.getByTestId('day-close-ledger')).toHaveTextContent('ready');
    fireEvent.click(screen.getByRole('button', { name: 'day-close：命令成功' }));
    await waitFor(() => expect(appMocks.read).toHaveBeenCalledTimes(3));
  });

  it('opens the anomalies page from a page banner and sends the day to the close page', async () => {
    appMocks.read.mockResolvedValue(snapshot([unclosed('2026-10-15')]));
    render(<App />);
    await screen.findByRole('button', { name: '帳務異常（1）' });
    fireEvent.click(screen.getByRole('button', { name: '日結' }));
    fireEvent.click(screen.getByRole('button', { name: 'day-close：到異常頁' }));
    fireEvent.click(await screen.findByRole('button', { name: '到日結頁處理 2026-10-15' }));
    expect(screen.getByTestId('day-close-focus')).toHaveTextContent('2026-10-15');
    // Using the plain navigation button again does not keep the focus date.
    fireEvent.click(screen.getByRole('button', { name: '學生管理' }));
    fireEvent.click(screen.getByRole('button', { name: '日結' }));
    expect(screen.getByTestId('day-close-focus')).toHaveTextContent('');
  });

  it('respects the navigation lock', async () => {
    appMocks.read.mockResolvedValue(snapshot([]));
    render(<App />);
    await screen.findByRole('button', { name: '帳務異常（0）' });
    fireEvent.click(screen.getByRole('button', { name: 'students：保持待確認命令' }));
    expect(screen.getByRole('button', { name: '帳務異常（0）' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '帳務異常（0）' }));
    expect(appMocks.read).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'students：回報已確認' }));
    expect(screen.getByRole('button', { name: '帳務異常（0）' })).toBeEnabled();
  });
});
