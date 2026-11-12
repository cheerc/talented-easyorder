import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

// #649 P3: backup lives in F3 › 資料備份. The real App, F2 day-close page, backup page and BackupScreen run together;
// only the Firebase edges are replaced.
const mocks = vi.hoisted(() => {
  const db = { name: 'app-db' };
  return {
    db,
    unresolved: { current: false },
    head: { current: null as { seq: number; lastCommandId: string | null; datasetId: string; targets: Record<string, unknown> } | null },
    firebase: {
      fbError: null,
      fb: { auth: {}, db },
      access: { ok: true as const, profile: { uid: 'uid-a', email: 'a@example.test' } },
      lease: { isHolder: true, epoch: 4 },
    },
    readLedger: vi.fn(),
    loadSnapshot: vi.fn(),
    exportRange: vi.fn(),
    commitRecordBackupIntent: vi.fn(),
    encryptBackup: vi.fn(),
    sha256Hex: vi.fn(),
    verifyBackupFile: vi.fn(),
  };
});

vi.mock('../appMode', async importOriginal => ({
  ...(await importOriginal<typeof import('../appMode')>()),
  validateAppModeConfig: () => ({ ok: true as const }),
}));
vi.mock('../providers/FirebaseProvider', () => ({
  FirebaseProvider: ({ children }: { children: ReactNode }) => children,
  useFirebaseOptional: () => mocks.firebase,
  useDataHead: () => mocks.head.current,
}));
vi.mock('../hooks/useFirebase', () => ({ useFirebase: () => mocks.firebase }));
vi.mock('../auth/AuthGate', () => ({ AuthGate: ({ children }: { children: ReactNode }) => children }));
vi.mock('../components/cloud/CloudPendingRecoveryBoundary', () => ({
  CloudPendingRecoveryBoundary: ({ children }: { children: (hasUnresolvedPendingCommands: boolean) => ReactNode }) => children(mocks.unresolved.current),
}));
vi.mock('../components/cloud/CloudStudentsPage', () => ({ CloudStudentsPage: () => <section aria-label="students stub" /> }));
vi.mock('../firebase/cloudRecoveryReader', () => ({ getCloudRecoveryReader: () => ({ assertCurrent: vi.fn() }) }));
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: { uid: 'uid-a' } }) }));
vi.mock('../firebase/cloudDayCloseRepository', () => ({
  createCloudLedgerReader: () => ({ read: mocks.readLedger }),
  createCloudDayCloseRepository: () => ({
    loadSnapshot: mocks.loadSnapshot,
    commitDayCloseIntent: vi.fn(),
    confirmPendingIntent: vi.fn(async () => ({ status: 'not-found' })),
    cleanupConfirmedIntent: vi.fn(async () => true),
    hasOtherUnresolvedCommands: vi.fn(async () => false),
  }),
}));
vi.mock('../firebase/cloudBackupRepository', () => ({ createCloudBackupRepository: () => ({ exportRange: mocks.exportRange }) }));
vi.mock('../firebase/cloudBackupCommandRepository', () => ({
  createCloudBackupCommandRepository: () => ({
    commitRecordBackupIntent: mocks.commitRecordBackupIntent,
    confirmPendingIntent: vi.fn(),
    cleanupConfirmedIntent: vi.fn(async () => true),
  }),
}));
vi.mock('../firebase/cloudBackup', () => ({
  decryptBackup: vi.fn(), encryptBackup: mocks.encryptBackup, sha256Hex: mocks.sha256Hex, verifyBackupFile: mocks.verifyBackupFile,
}));

import App from '../App';

const today = '2026-10-17';
const manifest = {
  format: 'easyorder-command-backup' as const, formatVersion: 1 as const, datasetId: 'dataset-a',
  commandSchemaVersion: 1, fromSeq: 0, toSeq: 1, recordCount: 1, headCommandId: 'command-1',
  previousPackageSha256: null, generatedAt: '2026-10-17T03:00:00.000Z', records: [], baseState: {}, projectionState: {}, totals: {},
};
const headAt = (seq: number) => ({ seq, lastCommandId: `cmd-${seq}`, datasetId: 'dataset-a', targets: {} });
const flush = async () => act(async () => { for (let index = 0; index < 20; index += 1) await Promise.resolve(); });

function daySnapshot(seq: number) {
  return {
    datasetId: 'dataset-a',
    overview: { selectionDate: today, goLiveDate: '2026-10-01', seq, unclosedDays: [] },
    dayId: today,
    day: {
      dayId: today, status: 'open', revision: 6, openingCash: 1000,
      totals: { activeTransactionCount: 4, bentoCount: 2, otherMealCount: 0, mealTotal: 180, retainedReceipts: 200, cashierIncome: 50, cashierExpense: 80, accountRefunds: 0 },
      lastSettlementRevision: 0, expectedCash: 1170, settlements: [], postCloseEntries: [], effectiveCash: null, seq,
    },
    backfill: null, previous: null, align: null,
  };
}

const settingsNav = () => screen.getByRole('navigation', { name: '今日設定' });

describe('App: 資料備份 in F3', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.unresolved.current = false;
    mocks.head.current = headAt(20);
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue('00000000-0000-4000-8000-0000000000c1') });
    mocks.readLedger.mockResolvedValue({ today, goLiveDate: '2026-10-01', anomalies: [], closedDays: [], seq: 20 });
    mocks.loadSnapshot.mockResolvedValue(daySnapshot(20));
    mocks.exportRange.mockResolvedValue({ fromSeq: 0, toSeq: 1, manifest });
    mocks.encryptBackup.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.sha256Hex.mockResolvedValue('a'.repeat(64));
    mocks.verifyBackupFile.mockResolvedValue(manifest);
  });

  it('lists 資料備份 as the last F3 submenu item and renders the backup page', async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'F3' });
    const buttons = within(settingsNav()).getAllByRole('button').map(button => button.textContent);
    expect(buttons).toEqual(['學生', '菜單與開帳', '本機診斷', '資料備份']);
    fireEvent.click(within(settingsNav()).getByRole('button', { name: '資料備份' }));
    expect(await screen.findByRole('heading', { name: '資料備份' })).toBeVisible();
    expect(within(settingsNav()).getByRole('button', { name: '資料備份' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('main', { name: '資料備份' })).toBeInTheDocument();
  });

  it('F3 returns to 資料備份 after visiting another primary page', async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'F3' });
    fireEvent.click(within(settingsNav()).getByRole('button', { name: '資料備份' }));
    await screen.findByRole('heading', { name: '資料備份' });
    fireEvent.keyDown(window, { key: 'F2' });
    await screen.findByRole('heading', { name: '日結、關帳與重開' });
    fireEvent.keyDown(window, { key: 'F3' });
    expect(await screen.findByRole('heading', { name: '資料備份' })).toBeVisible();
  });

  it('F2 今日 no longer has the 關帳後備份 region or a backup form', async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'F2' });
    await screen.findByRole('heading', { name: '日結、關帳與重開' });
    await flush();
    expect(screen.queryByRole('region', { name: '關帳後備份' })).toBeNull();
    expect(screen.queryByLabelText('備份密碼')).toBeNull();
  });

  it('locks navigation while the backup file is being verified and again unlocks on failure', async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'F3' });
    fireEvent.click(within(settingsNav()).getByRole('button', { name: '資料備份' }));
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('備份密碼'), 'fixture-passphrase');
    await user.click(screen.getByRole('button', { name: '產生加密備份' }));
    const reselect = await screen.findByLabelText('重新選取剛存下的備份檔');
    let rejectVerify!: (error: Error) => void;
    mocks.verifyBackupFile.mockReturnValueOnce(new Promise((_, reject) => { rejectVerify = reject; }));
    fireEvent.change(reselect, { target: { files: [new File(['fixture'], 'backup.eobackup')] } });
    await flush();
    expect(within(settingsNav()).getByRole('button', { name: '學生' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'F2' });
    expect(screen.queryByRole('heading', { name: '日結、關帳與重開' })).toBeNull();
    rejectVerify(new Error('密碼或檔案不符'));
    await flush();
    expect(within(settingsNav()).getByRole('button', { name: '學生' })).toBeEnabled();
  });

  it('does not start a backup while another cloud command is unresolved', async () => {
    mocks.unresolved.current = true;
    render(<App />);
    fireEvent.keyDown(window, { key: 'F3' });
    fireEvent.click(within(settingsNav()).getByRole('button', { name: '資料備份' }));
    await screen.findByRole('heading', { name: '資料備份' });
    expect(screen.getByRole('button', { name: '產生加密備份' })).toBeDisabled();
    expect(mocks.exportRange).not.toHaveBeenCalled();
  });

  it('#596: a backup recorded in F3 does not raise 其他裝置已更新資料 when returning to F2, but another device\'s later write does', async () => {
    mocks.commitRecordBackupIntent.mockImplementation(async (intent: { commandId: string }) => (
      { ok: true, receipt: { commandId: intent.commandId, seq: 21, committedAt: '2026-10-17T03:00:00.000Z', kind: 'RecordBackup', targets: {}, result: {} } }
    ));
    const view = render(<App />);
    fireEvent.keyDown(window, { key: 'F3' });
    fireEvent.click(within(settingsNav()).getByRole('button', { name: '資料備份' }));
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('備份密碼'), 'fixture-passphrase');
    await user.click(screen.getByRole('button', { name: '產生加密備份' }));
    fireEvent.change(await screen.findByLabelText('重新選取剛存下的備份檔'), { target: { files: [new File(['fixture'], 'backup.eobackup')] } });
    await waitFor(() => expect(mocks.commitRecordBackupIntent).toHaveBeenCalledTimes(1));
    await flush();

    // the backup's own receipt moved the head to 21; F2 reads the server again on entry
    mocks.head.current = headAt(21);
    mocks.loadSnapshot.mockResolvedValue(daySnapshot(21));
    fireEvent.keyDown(window, { key: 'F2' });
    await screen.findByRole('heading', { name: '日結、關帳與重開' });
    await flush();
    expect(screen.queryByTestId('data-updated-notice')).toBeNull();

    mocks.head.current = headAt(22);
    view.rerender(<App />);
    await flush();
    expect(screen.getByTestId('data-updated-notice')).toBeInTheDocument();
  });
});
