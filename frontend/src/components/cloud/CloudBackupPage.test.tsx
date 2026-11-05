import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudBackupPage } from './CloudBackupPage';

// #649 P3: the backup page is the host of the real BackupScreen (it was embedded in the day-close page before).
// Only the Firebase edges are replaced. These cases carry over the single-flight and navigation-lock behaviours that
// CloudDayClosePage.backupLock.test.tsx used to prove.
const mocks = vi.hoisted(() => ({
  firebase: {
    fb: { db: { name: 'backup-db' } },
    access: { ok: true as const, profile: { uid: 'uid-a' } },
    lease: { isHolder: true, epoch: 4 },
  },
  exportRange: vi.fn(),
  commitRecordBackupIntent: vi.fn(),
  confirmPendingIntent: vi.fn(),
  cleanupConfirmedIntent: vi.fn(),
  encryptBackup: vi.fn(),
  sha256Hex: vi.fn(),
  verifyBackupFile: vi.fn(),
}));

vi.mock('../../providers/FirebaseProvider', () => ({ useFirebaseOptional: () => mocks.firebase, useDataHead: () => null }));
vi.mock('../../firebase/cloudRecoveryReader', () => ({ getCloudRecoveryReader: () => ({ assertCurrent: vi.fn() }) }));
vi.mock('../../firebase/cloudBackupRepository', () => ({ createCloudBackupRepository: () => ({ exportRange: mocks.exportRange }) }));
vi.mock('../../firebase/cloudBackupCommandRepository', () => ({
  createCloudBackupCommandRepository: () => ({
    commitRecordBackupIntent: mocks.commitRecordBackupIntent,
    confirmPendingIntent: mocks.confirmPendingIntent,
    cleanupConfirmedIntent: mocks.cleanupConfirmedIntent,
  }),
}));
vi.mock('../../firebase/cloudBackup', () => ({
  decryptBackup: vi.fn(), encryptBackup: mocks.encryptBackup, sha256Hex: mocks.sha256Hex,
  verifyBackupFile: mocks.verifyBackupFile,
}));

const sha = 'a'.repeat(64);
const manifest = {
  format: 'easyorder-command-backup' as const, formatVersion: 1 as const, datasetId: 'dataset-a',
  commandSchemaVersion: 1, fromSeq: 0, toSeq: 1, recordCount: 1, headCommandId: 'command-1',
  previousPackageSha256: null, generatedAt: '2026-10-17T03:00:00.000Z', records: [], baseState: {},
  projectionState: {}, totals: {},
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

const flush = async () => act(async () => { for (let index = 0; index < 20; index += 1) await Promise.resolve(); });

async function renderReadyPage(hasUnresolvedPendingCommands = false) {
  const report = vi.fn();
  render(<CloudBackupPage identityKey="uid-a:4" onNavigationStateChange={report} hasUnresolvedPendingCommands={hasUnresolvedPendingCommands} />);
  await flush();
  const user = userEvent.setup();
  return { report, user };
}

async function generate(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('備份密碼'), 'fixture-passphrase');
  await user.click(screen.getByRole('button', { name: '產生加密備份' }));
  return screen.findByLabelText('重新選取剛存下的備份檔');
}

describe('CloudBackupPage (F3 資料備份)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue('00000000-0000-4000-8000-0000000000c1') });
    mocks.exportRange.mockResolvedValue({ fromSeq: 0, toSeq: 1, manifest });
    mocks.encryptBackup.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.sha256Hex.mockResolvedValue(sha);
    mocks.verifyBackupFile.mockResolvedValue(manifest);
    mocks.commitRecordBackupIntent.mockResolvedValue({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
  });

  it('titles the page 資料備份 once, without the old 每日 wording in the header', async () => {
    await renderReadyPage();
    expect(screen.getAllByRole('heading', { name: '資料備份' })).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: '每日加密備份' })).toBeNull();
    expect(screen.queryByText(/每日/)).toBeNull();
  });

  it('reports the navigation lock from the start of file verification, before any RecordBackup exists', async () => {
    const { report, user } = await renderReadyPage();
    expect(report).toHaveBeenLastCalledWith('uid-a:4', 'resolved');
    const reselect = await generate(user);

    const verification = deferred<typeof manifest>();
    mocks.verifyBackupFile.mockReturnValueOnce(verification.promise);
    fireEvent.change(reselect, { target: { files: [new File(['fixture'], 'backup.eobackup')] } });
    await flush();

    expect(mocks.commitRecordBackupIntent).not.toHaveBeenCalled();
    expect(report).toHaveBeenLastCalledWith('uid-a:4', 'recovering');

    verification.resolve(manifest);
    await flush();
    expect(mocks.commitRecordBackupIntent).toHaveBeenCalledTimes(1);
    // the RecordBackup result is unknown, so the lock stays until it is confirmed
    expect(report).toHaveBeenLastCalledWith('uid-a:4', 'recovering');
  });

  it('releases the lock when the file verification fails, without any command', async () => {
    const { report, user } = await renderReadyPage();
    const reselect = await generate(user);
    mocks.verifyBackupFile.mockRejectedValueOnce(new Error('密碼或檔案不符'));
    fireEvent.change(reselect, { target: { files: [new File(['fixture'], 'backup.eobackup')] } });
    await flush();

    expect(await screen.findByText('密碼或檔案不符')).toBeVisible();
    expect(mocks.commitRecordBackupIntent).not.toHaveBeenCalled();
    expect(report).toHaveBeenLastCalledWith('uid-a:4', 'resolved');
  });

  it('starts no backup while another cloud command is unresolved (single flight now comes from the App)', async () => {
    const { user } = await renderReadyPage(true);
    await user.type(screen.getByLabelText('備份密碼'), 'fixture-passphrase');
    expect(screen.getByRole('button', { name: '產生加密備份' })).toBeDisabled();
    expect(screen.getByLabelText('備份密碼')).toBeDisabled();
    expect(mocks.exportRange).not.toHaveBeenCalled();
  });

  it('refuses to record a verified file when another command became unresolved meanwhile', async () => {
    const report = vi.fn();
    const view = render(<CloudBackupPage identityKey="uid-a:4" onNavigationStateChange={report} hasUnresolvedPendingCommands={false} />);
    const user = userEvent.setup();
    const reselect = await generate(user);
    const verification = deferred<typeof manifest>();
    mocks.verifyBackupFile.mockReturnValueOnce(verification.promise);
    fireEvent.change(reselect, { target: { files: [new File(['fixture'], 'backup.eobackup')] } });
    await flush();
    view.rerender(<CloudBackupPage identityKey="uid-a:4" onNavigationStateChange={report} hasUnresolvedPendingCommands />);
    verification.resolve(manifest);
    await flush();
    expect(mocks.commitRecordBackupIntent).not.toHaveBeenCalled();
    expect(report).toHaveBeenLastCalledWith('uid-a:4', 'resolved');
  });

  it('shows no data-updated notice of its own (it shows no server data to go stale)', async () => {
    await renderReadyPage();
    expect(screen.queryByTestId('data-updated-notice')).toBeNull();
  });
});
