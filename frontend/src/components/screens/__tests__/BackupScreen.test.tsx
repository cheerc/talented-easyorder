import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupScreen } from '../BackupScreen';

const mocks = vi.hoisted(() => ({
  exportRange: vi.fn(),
  commitCommand: vi.fn(),
  encryptBackup: vi.fn(),
  sha256Hex: vi.fn(),
  verifyBackupFile: vi.fn(),
}));

vi.mock('../../../providers/FirebaseProvider', () => ({
  useFirebaseOptional: () => ({
    fb: { db: {} },
    access: { ok: true, profile: { uid: 'anonymous-operator' } },
    lease: { isHolder: true, epoch: 3 },
  }),
}));
vi.mock('../../../firebase/cloudBackupRepository', () => ({
  createCloudBackupRepository: () => ({ exportRange: mocks.exportRange }),
}));
vi.mock('../../../firebase/cloudCommandRepository', () => ({
  createCloudCommandRepository: () => ({ commitCommand: mocks.commitCommand }),
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

describe('BackupScreen verified-local gate', () => {
  beforeEach(() => {
    mocks.exportRange.mockReset().mockResolvedValue({ fromSeq: 0, toSeq: 1, manifest });
    mocks.commitCommand.mockReset().mockResolvedValue({ ok: true });
    mocks.encryptBackup.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.sha256Hex.mockReset().mockResolvedValue('a'.repeat(64));
    mocks.verifyBackupFile.mockReset().mockResolvedValue(manifest);
  });

  it('does not record a backup until the downloaded file is selected and verified', async () => {
    const user = userEvent.setup();
    render(<BackupScreen />);
    await user.type(screen.getByLabelText('備份密碼'), 'fixture-passphrase');
    await user.click(screen.getByRole('button', { name: '產生加密備份' }));

    const reselect = await screen.findByLabelText('重新選取剛存下的備份檔');
    expect(screen.getByRole('status')).toHaveTextContent('固定匯出 head H=1');
    expect(mocks.commitCommand).not.toHaveBeenCalled();

    const file = new File(['fixture'], 'easyorder-backup-0-1.eobackup', { type: 'application/json' });
    fireEvent.change(reselect, { target: { files: [file] } });
    await waitFor(() => expect(mocks.commitCommand).toHaveBeenCalledTimes(1));
    expect(mocks.verifyBackupFile).toHaveBeenCalledWith(file, 'fixture-passphrase', 'a'.repeat(64));
    expect(mocks.commitCommand.mock.calls[0]?.[0]).toMatchObject({
      kind: 'RecordBackup', payload: { fromSeq: 0, toSeq: 1, sourceSeq: 1, sha256: 'a'.repeat(64) },
    });
    expect(await screen.findByText(/已登記 RecordBackup/)).toBeVisible();
  });
});
