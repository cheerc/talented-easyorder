import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupScreen } from '../BackupScreen';

const mocks = vi.hoisted(() => {
  const db = { name: 'backup-db' };
  const firebase = (epoch: number, uid = 'anonymous-operator') => ({
    fb: { db },
    access: { ok: true as const, profile: { uid } },
    lease: { isHolder: true, epoch },
  });
  return {
    db,
    firebase,
    current: { value: firebase(3) as ReturnType<typeof firebase> },
    recoveryReader: { id: 'lite-reader' },
    exportRange: vi.fn(),
    createCommandRepository: vi.fn(),
    commitRecordBackupIntent: vi.fn(),
    confirmPendingIntent: vi.fn(),
    cleanupConfirmedIntent: vi.fn(),
    encryptBackup: vi.fn(),
    sha256Hex: vi.fn(),
    verifyBackupFile: vi.fn(),
  };
});

vi.mock('../../../providers/FirebaseProvider', () => ({
  useFirebaseOptional: () => mocks.current.value,
}));
vi.mock('../../../firebase/cloudRecoveryReader', () => ({
  getCloudRecoveryReader: () => mocks.recoveryReader,
}));
vi.mock('../../../firebase/cloudBackupRepository', () => ({
  createCloudBackupRepository: () => ({ exportRange: mocks.exportRange }),
}));
vi.mock('../../../firebase/cloudBackupCommandRepository', () => ({
  createCloudBackupCommandRepository: (...args: unknown[]) => {
    mocks.createCommandRepository(...args);
    return {
      commitRecordBackupIntent: mocks.commitRecordBackupIntent,
      confirmPendingIntent: mocks.confirmPendingIntent,
      cleanupConfirmedIntent: mocks.cleanupConfirmedIntent,
    };
  },
}));
vi.mock('../../../firebase/cloudBackup', () => ({
  decryptBackup: vi.fn(), encryptBackup: mocks.encryptBackup, sha256Hex: mocks.sha256Hex,
  verifyBackupFile: mocks.verifyBackupFile,
}));

const manifest = {
  format: 'easyorder-command-backup' as const, formatVersion: 1 as const, datasetId: 'anonymous-fixture',
  commandSchemaVersion: 1, fromSeq: 0, toSeq: 1, recordCount: 1, headCommandId: 'command-1',
  previousPackageSha256: null, generatedAt: '2026-10-16T03:00:00.000Z', records: [], baseState: {},
  projectionState: {}, totals: {},
};
const sha = 'a'.repeat(64);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function receipt(commandId: string) {
  return { commandId, seq: 1, committedAt: '2026-10-16T03:00:00.000Z', kind: 'RecordBackup' as const, targets: {}, result: {} };
}

const unknownResult = { ok: false as const, error: { code: 'UNKNOWN_RESULT', message: 'UNKNOWN_RESULT' } };

async function flush() {
  await act(async () => {
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
  });
}

function backupFile() {
  return new File(['fixture'], 'easyorder-backup-0-1.eobackup', { type: 'application/json' });
}

async function reachVerifyStep(props: Parameters<typeof BackupScreen>[0] = {}) {
  const user = userEvent.setup();
  const view = render(<BackupScreen {...props} />);
  await user.type(screen.getByLabelText('備份密碼'), 'fixture-passphrase');
  await user.click(screen.getByRole('button', { name: '產生加密備份' }));
  const reselect = await screen.findByLabelText('重新選取剛存下的備份檔');
  return { view, reselect, user };
}

/** Selects the saved file and waits until the original RecordBackup submission was handed to the repository. */
async function submitBackup(reselect: HTMLElement) {
  fireEvent.change(reselect, { target: { files: [backupFile()] } });
  await flush();
  const intent = mocks.commitRecordBackupIntent.mock.calls[0]?.[0] as { commandId: string; payload: Record<string, unknown> };
  expect(intent).toBeDefined();
  return intent;
}

async function passTenSeconds() {
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
}

describe('BackupScreen verified-local gate', () => {
  beforeEach(() => {
    mocks.current.value = mocks.firebase(3);
    mocks.exportRange.mockReset().mockResolvedValue({ fromSeq: 0, toSeq: 1, manifest });
    mocks.createCommandRepository.mockReset();
    mocks.commitRecordBackupIntent.mockReset().mockImplementation(async (intent: { commandId: string }) => (
      { ok: true, receipt: receipt(intent.commandId) }
    ));
    mocks.confirmPendingIntent.mockReset();
    mocks.cleanupConfirmedIntent.mockReset().mockResolvedValue(true);
    mocks.encryptBackup.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.sha256Hex.mockReset().mockResolvedValue(sha);
    mocks.verifyBackupFile.mockReset().mockResolvedValue(manifest);
  });

  afterEach(() => { vi.useRealTimers(); });

  it('does not record a backup until the downloaded file is selected and verified', async () => {
    const { reselect } = await reachVerifyStep();
    expect(screen.getByRole('status')).toHaveTextContent('固定匯出 head H=1');
    expect(mocks.commitRecordBackupIntent).not.toHaveBeenCalled();

    const file = backupFile();
    fireEvent.change(reselect, { target: { files: [file] } });
    await waitFor(() => expect(mocks.commitRecordBackupIntent).toHaveBeenCalledTimes(1));
    expect(mocks.verifyBackupFile).toHaveBeenCalledWith(file, 'fixture-passphrase', sha);
    expect(mocks.commitRecordBackupIntent.mock.calls[0]?.[0]).toMatchObject({
      leaseEpoch: 3, payload: { backupType: 'command-incremental', fromSeq: 0, toSeq: 1, sourceSeq: 1, sha256: sha },
    });
    expect(await screen.findByText(/已登記 RecordBackup/)).toBeVisible();
  });

  it('does not commit after the screen unmounts while file verification is pending', async () => {
    const user = userEvent.setup();
    const verification = deferred<typeof manifest>();
    mocks.verifyBackupFile.mockReturnValueOnce(verification.promise);
    const view = render(<BackupScreen />);
    await user.type(screen.getByLabelText('備份密碼'), 'fixture-passphrase');
    await user.click(screen.getByRole('button', { name: '產生加密備份' }));
    const reselect = await screen.findByLabelText('重新選取剛存下的備份檔');
    fireEvent.change(reselect, { target: { files: [new File(['fixture'], 'backup.eobackup')] } });
    await waitFor(() => expect(mocks.verifyBackupFile).toHaveBeenCalledTimes(1));
    view.unmount();
    verification.resolve(manifest);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mocks.commitRecordBackupIntent).not.toHaveBeenCalled();
  });

  it('builds its command repository on the registered Lite recovery reader', async () => {
    const { reselect } = await reachVerifyStep();
    await submitBackup(reselect);
    expect(mocks.createCommandRepository).toHaveBeenCalledWith(mocks.db, expect.objectContaining({ recoveryReader: mocks.recoveryReader }));
  });

  describe('same-page command recovery', () => {
    it('shows the ten-second prompt with the original command ID and never resends by itself', async () => {
      const original = deferred<unknown>();
      mocks.commitRecordBackupIntent.mockReturnValueOnce(original.promise);
      const onRecoveryChange = vi.fn();
      const { reselect } = await reachVerifyStep({ onRecoveryChange });
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const intent = await submitBackup(reselect);

      expect(screen.queryByText('結果確認中，勿重新收款')).toBeNull();
      await passTenSeconds();

      const recovery = screen.getByRole('alert', { name: '命令結果確認' });
      expect(recovery).toHaveTextContent('結果確認中，勿重新收款');
      expect(recovery).toHaveTextContent(intent.commandId);
      expect(mocks.commitRecordBackupIntent).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('button', { name: '以相同命令編號重試' })).toBeNull();
      expect(onRecoveryChange).toHaveBeenLastCalledWith(true);
    });

    it('allows a read-only query while the original attempt is in flight but unlocks retry only after it settled and a fresh not-found', async () => {
      const original = deferred<unknown>();
      mocks.commitRecordBackupIntent.mockReturnValueOnce(original.promise);
      mocks.confirmPendingIntent.mockResolvedValue({ status: 'not-found' });
      const { reselect } = await reachVerifyStep();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const intent = await submitBackup(reselect);
      await passTenSeconds();

      fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
      await flush();
      expect(mocks.confirmPendingIntent).toHaveBeenCalledTimes(1);
      expect(mocks.confirmPendingIntent).toHaveBeenCalledWith(
        expect.objectContaining({ commandId: intent.commandId }), 'anonymous-fixture', 'anonymous-operator',
      );
      // The original request is still in flight: a not-found proves nothing yet.
      expect(screen.queryByRole('button', { name: '以相同命令編號重試' })).toBeNull();
      expect(mocks.commitRecordBackupIntent).toHaveBeenCalledTimes(1);

      original.resolve(unknownResult);
      await flush();
      // Settling alone does not authorise a retry either.
      expect(screen.queryByRole('button', { name: '以相同命令編號重試' })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
      await flush();
      const retry = screen.getByRole('button', { name: '以相同命令編號重試' });
      expect(mocks.commitRecordBackupIntent).toHaveBeenCalledTimes(1);

      fireEvent.click(retry);
      await flush();
      expect(mocks.commitRecordBackupIntent).toHaveBeenCalledTimes(2);
      expect(mocks.commitRecordBackupIntent.mock.calls[1]?.[0]).toEqual(intent);
      expect(screen.getByText(/已登記 RecordBackup/)).toBeVisible();
      expect(mocks.cleanupConfirmedIntent).toHaveBeenCalledTimes(1);
    });

    it('keeps the confirmed result when the original response arrives late with success or failure', async () => {
      const original = deferred<unknown>();
      mocks.commitRecordBackupIntent.mockReturnValueOnce(original.promise);
      const received = (commandId: string) => ({ status: 'matched' as const, receipt: receipt(commandId) });
      const onRecoveryChange = vi.fn();
      const { reselect } = await reachVerifyStep({ onRecoveryChange });
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const intent = await submitBackup(reselect);
      mocks.confirmPendingIntent.mockResolvedValue(received(intent.commandId));
      await passTenSeconds();

      fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
      await flush();
      expect(screen.getByText(/已登記 RecordBackup/)).toBeVisible();
      expect(screen.queryByRole('alert', { name: '命令結果確認' })).toBeNull();
      expect(mocks.cleanupConfirmedIntent).toHaveBeenCalledTimes(1);
      expect(onRecoveryChange).toHaveBeenLastCalledWith(false);

      original.resolve({ ok: true, receipt: receipt(intent.commandId) });
      await flush();
      expect(screen.getByText(/已登記 RecordBackup/)).toBeVisible();
      expect(mocks.cleanupConfirmedIntent).toHaveBeenCalledTimes(1);
      expect(mocks.commitRecordBackupIntent).toHaveBeenCalledTimes(1);
    });

    it('does not let a late original failure overwrite a confirmed receipt', async () => {
      const original = deferred<unknown>();
      mocks.commitRecordBackupIntent.mockReturnValueOnce(original.promise);
      const { reselect } = await reachVerifyStep();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const intent = await submitBackup(reselect);
      mocks.confirmPendingIntent.mockResolvedValue({ status: 'matched', receipt: receipt(intent.commandId) });
      await passTenSeconds();
      fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
      await flush();

      original.resolve(unknownResult);
      await flush();
      expect(screen.getByText(/已登記 RecordBackup/)).toBeVisible();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it.each([
      ['a different dataset', () => mocks.confirmPendingIntent.mockResolvedValue({ status: 'different-dataset' })],
      ['a failed read', () => mocks.confirmPendingIntent.mockRejectedValue({ code: 'UNKNOWN_RESULT', message: 'read failed' })],
      ['maintenance', () => mocks.confirmPendingIntent.mockRejectedValue({ code: 'MAINTENANCE', message: 'maintenance' })],
    ])('never unlocks retry after %s', async (_label, arrange) => {
      mocks.commitRecordBackupIntent.mockResolvedValueOnce(unknownResult);
      arrange();
      const { reselect } = await reachVerifyStep();
      await submitBackup(reselect);
      await flush();

      fireEvent.click(await screen.findByRole('button', { name: '查詢原命令結果' }));
      await flush();
      expect(mocks.confirmPendingIntent).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('button', { name: '以相同命令編號重試' })).toBeNull();
      expect(screen.queryByText(/已登記 RecordBackup/)).toBeNull();
      expect(mocks.commitRecordBackupIntent).toHaveBeenCalledTimes(1);
      expect(mocks.cleanupConfirmedIntent).not.toHaveBeenCalled();
    });

    it('does not resend with the same ID when the file is selected again before any query', async () => {
      mocks.commitRecordBackupIntent.mockResolvedValueOnce(unknownResult);
      const { reselect } = await reachVerifyStep();
      await submitBackup(reselect);
      await flush();
      expect(await screen.findByRole('alert', { name: '命令結果確認' })).toBeVisible();

      fireEvent.change(reselect, { target: { files: [backupFile()] } });
      await flush();
      expect(mocks.commitRecordBackupIntent).toHaveBeenCalledTimes(1);
      expect(mocks.confirmPendingIntent).not.toHaveBeenCalled();
    });

    it('clears the frozen intent without cleanup or resend when the lease epoch changes', async () => {
      const original = deferred<unknown>();
      mocks.commitRecordBackupIntent.mockReturnValueOnce(original.promise);
      const onRecoveryChange = vi.fn();
      const { view, reselect } = await reachVerifyStep({ onRecoveryChange });
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const intent = await submitBackup(reselect);
      await passTenSeconds();
      expect(screen.getByText('結果確認中，勿重新收款')).toBeVisible();

      mocks.current.value = mocks.firebase(4);
      // A new callback identity re-renders the memoised screen, like the context change does in the app.
      view.rerender(<BackupScreen onRecoveryChange={active => onRecoveryChange(active)} />);
      await flush();
      expect(screen.queryByRole('alert', { name: '命令結果確認' })).toBeNull();
      expect(screen.queryByLabelText('重新選取剛存下的備份檔')).toBeNull();
      expect(onRecoveryChange).toHaveBeenLastCalledWith(false);

      original.resolve({ ok: true, receipt: receipt(intent.commandId) });
      await flush();
      expect(screen.queryByText(/已登記 RecordBackup/)).toBeNull();
      expect(mocks.cleanupConfirmedIntent).not.toHaveBeenCalled();
      expect(mocks.confirmPendingIntent).not.toHaveBeenCalled();
      expect(mocks.commitRecordBackupIntent).toHaveBeenCalledTimes(1);
    });

    it('clears the screen without cleanup or resend when the original submission reports LEASE_LOST', async () => {
      mocks.commitRecordBackupIntent.mockResolvedValueOnce({ ok: false, error: { code: 'LEASE_LOST', message: 'lease lost' } });
      const { reselect } = await reachVerifyStep();
      await submitBackup(reselect);
      await flush();

      expect(screen.queryByRole('alert', { name: '命令結果確認' })).toBeNull();
      expect(screen.queryByLabelText('重新選取剛存下的備份檔')).toBeNull();
      expect(mocks.cleanupConfirmedIntent).not.toHaveBeenCalled();
      expect(mocks.commitRecordBackupIntent).toHaveBeenCalledTimes(1);
    });

    it('does not warn about local tracking after a normal confirmed result', async () => {
      const { reselect } = await reachVerifyStep();
      await submitBackup(reselect);
      await flush();
      expect(screen.getByText(/已登記 RecordBackup/)).toBeVisible();
      expect(mocks.cleanupConfirmedIntent).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/本機命令追蹤/)).toBeNull();
    });

    it('warns only when cleanup really kept the local tracking or failed', async () => {
      mocks.cleanupConfirmedIntent.mockResolvedValueOnce(false);
      const first = await reachVerifyStep();
      await submitBackup(first.reselect);
      await flush();
      expect(screen.getByText(/本機命令追蹤尚未清理/)).toBeVisible();
      first.view.unmount();

      mocks.cleanupConfirmedIntent.mockRejectedValueOnce(new Error('journal unavailable'));
      mocks.commitRecordBackupIntent.mockClear();
      const second = await reachVerifyStep();
      await submitBackup(second.reselect);
      await flush();
      expect(screen.getByText(/本機命令追蹤清理未完成/)).toBeVisible();
    });

    it('disables every control while the day-close page holds its own unresolved command', async () => {
      render(<BackupScreen locked />);
      expect(screen.getByLabelText('備份密碼')).toBeDisabled();
      expect(screen.getByLabelText('前次可讀備份（首次完整備份可留空）')).toBeDisabled();
      expect(screen.getByRole('button', { name: '產生加密備份' })).toBeDisabled();
      expect(screen.getByRole('button', { name: '下載備份' })).toBeDisabled();
      expect(screen.getByText(/日結命令確認中/)).toBeVisible();
      expect(mocks.exportRange).not.toHaveBeenCalled();
    });
  });
});
