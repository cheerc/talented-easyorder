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
  decryptBackup: vi.fn(),
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
  decryptBackup: mocks.decryptBackup, encryptBackup: mocks.encryptBackup, sha256Hex: mocks.sha256Hex,
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

  describe('#648 P7 plain wording', () => {
    it('shows the backup range and state in plain words, with no engineering terms', async () => {
      const { user } = await renderReadyPage();
      await generate(user);
      const status = screen.getByRole('status');
      expect(status).toHaveTextContent('備份範圍：第 1 筆到第 1 筆');
      expect(status).toHaveTextContent('狀態：已產生，等待驗證');
      expect(document.body.textContent).not.toMatch(/head H=|generated|downloadRequested|RecordBackup|\bseq\b/);
    });

    it('says there are no new records when the range is empty (first backup of an empty dataset)', async () => {
      mocks.exportRange.mockResolvedValue({ fromSeq: 0, toSeq: 0, manifest: { ...manifest, toSeq: 0 } });
      const { user } = await renderReadyPage();
      await generate(user);
      const status = screen.getByRole('status');
      expect(status).toHaveTextContent('備份範圍：沒有新紀錄（目前到第 0 筆）');
      expect(status).not.toHaveTextContent('第 0 筆到');
    });

    it('counts an incremental range from the record after the previous backup, consistent with the start line', async () => {
      mocks.decryptBackup.mockResolvedValue({ ...manifest, fromSeq: 0, toSeq: 10 });
      mocks.exportRange.mockResolvedValue({ fromSeq: 10, toSeq: 15, manifest: { ...manifest, fromSeq: 10, toSeq: 15 } });
      const { user } = await renderReadyPage();
      await user.type(screen.getByLabelText('備份密碼'), 'fixture-passphrase');
      fireEvent.change(screen.getByLabelText(/前次可讀備份/), { target: { files: [new File(['prev'], 'prev.eobackup')] } });
      await flush();
      expect(screen.getByText(/前次備份已解密/)).toHaveTextContent('第 1 筆到第 10 筆，這次從第 11 筆開始');
      await user.click(screen.getByRole('button', { name: '產生加密備份' }));
      await screen.findByLabelText('重新選取剛存下的備份檔');
      expect(screen.getByRole('status')).toHaveTextContent('備份範圍：第 11 筆到第 15 筆');
    });

    it('says no new records for an incremental backup whose head did not move', async () => {
      mocks.decryptBackup.mockResolvedValue({ ...manifest, fromSeq: 0, toSeq: 10 });
      mocks.exportRange.mockResolvedValue({ fromSeq: 10, toSeq: 10, manifest: { ...manifest, fromSeq: 10, toSeq: 10 } });
      const { user } = await renderReadyPage();
      await user.type(screen.getByLabelText('備份密碼'), 'fixture-passphrase');
      fireEvent.change(screen.getByLabelText(/前次可讀備份/), { target: { files: [new File(['prev'], 'prev.eobackup')] } });
      await flush();
      await user.click(screen.getByRole('button', { name: '產生加密備份' }));
      await screen.findByLabelText('重新選取剛存下的備份檔');
      expect(screen.getByRole('status')).toHaveTextContent('備份範圍：沒有新紀錄（目前到第 10 筆）');
    });

    it('shows no stale range or state after a failed re-generate', async () => {
      const { user } = await renderReadyPage();
      await generate(user);
      expect(screen.getByRole('status')).toHaveTextContent('狀態：已產生，等待驗證');
      mocks.exportRange.mockRejectedValueOnce(new Error('匯出失敗'));
      await user.click(screen.getByRole('button', { name: '產生加密備份' }));
      expect(await screen.findByText('匯出失敗')).toBeVisible();
      expect(screen.queryByRole('status')).toBeNull();
      expect(document.body.textContent).not.toContain('已產生，等待驗證');
    });

    it('says downloaded-but-unverified after the download request', async () => {
      const { user } = await renderReadyPage();
      await generate(user);
      vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }));
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      await user.click(screen.getByRole('button', { name: '下載備份' }));
      expect(screen.getByRole('status')).toHaveTextContent('狀態：已下載，等待驗證');
    });

    it('keeps the second-copy safety steps in an always visible Callout, apart from the explanation', async () => {
      await renderReadyPage();
      const safety = screen.getByText(/第二份副本/);
      expect(safety.closest('.callout-warn')).not.toBeNull();
      expect(safety).not.toHaveTextContent('手動下載加密增量備份');
      expect(screen.getByRole('button', { name: '備份說明' })).toBeVisible();
      const warning = screen.getByText(/都不代表檔案已存好/);
      expect(warning.closest('.callout-warn')).not.toBeNull();
    });

    it('words the lock for any other unresolved cloud command, not only the day close', async () => {
      await renderReadyPage(true);
      const note = screen.getByRole('note');
      expect(note.closest('.callout-warn')).not.toBeNull();
      expect(note).toHaveTextContent('其他雲端命令確認中');
      expect(document.body.textContent).not.toContain('日結命令確認中');
    });
  });
});
