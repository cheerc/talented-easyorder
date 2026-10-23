import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { CloudDayClosePage } from './CloudDayClosePage';

// The real BackupScreen inside the real CloudDayClosePage: only the Firebase edges are replaced.
const mocks = vi.hoisted(() => {
  const db = { name: 'day-close-db' };
  return {
    db,
    firebase: {
      fb: { db },
      access: { ok: true as const, profile: { uid: 'uid-a' } },
      lease: { isHolder: true, epoch: 4 },
    },
    loadSnapshot: vi.fn(),
    commitDayCloseIntent: vi.fn(),
    exportRange: vi.fn(),
    commitRecordBackupIntent: vi.fn(),
    confirmPendingIntent: vi.fn(),
    cleanupConfirmedIntent: vi.fn(),
    encryptBackup: vi.fn(),
    sha256Hex: vi.fn(),
    verifyBackupFile: vi.fn(),
  };
});

vi.mock('../../providers/FirebaseProvider', () => ({ useFirebaseOptional: () => mocks.firebase }));
vi.mock('../../firebase/cloudRecoveryReader', () => ({ getCloudRecoveryReader: () => ({ assertCurrent: vi.fn() }) }));
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: { uid: 'uid-a' } }) }));
vi.mock('../../firebase/cloudDayCloseRepository', () => ({
  createCloudDayCloseRepository: () => ({
    loadSnapshot: mocks.loadSnapshot,
    commitDayCloseIntent: mocks.commitDayCloseIntent,
    confirmPendingIntent: vi.fn(async () => ({ status: 'not-found' })),
    cleanupConfirmedIntent: vi.fn(async () => true),
    hasOtherUnresolvedCommands: vi.fn(async () => false),
  }),
}));
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

const today = '2026-10-17';
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

function snapshot() {
  return {
    datasetId: 'dataset-a',
    overview: {
      selectionDate: today, goLiveDate: '2026-10-01', seq: 20,
      unclosedDays: [{ dayId: today, status: 'open', openingCash: 1000, activeTransactionCount: 4, kind: 'needs-close', backfill: null }],
    },
    dayId: today,
    day: {
      dayId: today, status: 'open', revision: 6, openingCash: 1000,
      totals: {
        activeTransactionCount: 4, bentoCount: 2, otherMealCount: 0, mealTotal: 180,
        retainedReceipts: 200, cashierIncome: 50, cashierExpense: 80, accountRefunds: 0,
      },
      lastSettlementRevision: 0, expectedCash: 1170, settlements: [], postCloseEntries: [], effectiveCash: null, seq: 20,
    },
    backfill: null, previous: null, align: null,
  };
}

async function renderReadyPage() {
  const report = vi.fn();
  render(
    <CloudDayClosePage
      db={mocks.db as unknown as Firestore}
      leaseEpoch={4}
      identityKey="uid-a:4"
      onNavigationStateChange={report}
    />,
  );
  await flush();
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('備份密碼'), 'fixture-passphrase');
  await user.click(screen.getByRole('button', { name: '產生加密備份' }));
  const reselect = await screen.findByLabelText('重新選取剛存下的備份檔');
  return { report, reselect, user };
}

describe('embedded backup single flight with the real BackupScreen', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue('00000000-0000-4000-8000-0000000000c1') });
    mocks.loadSnapshot.mockResolvedValue(snapshot());
    mocks.exportRange.mockResolvedValue({ fromSeq: 0, toSeq: 1, manifest });
    mocks.encryptBackup.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.sha256Hex.mockResolvedValue(sha);
    mocks.verifyBackupFile.mockResolvedValue(manifest);
    mocks.commitRecordBackupIntent.mockResolvedValue({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
  });

  it('locks the day-close commands from the start of file verification, before any RecordBackup exists', async () => {
    const { report, reselect } = await renderReadyPage();
    const form = screen.getByRole('form', { name: `${today} 關帳` });
    expect(within(form).getByTestId('close-submit')).toBeEnabled();

    const verification = deferred<typeof manifest>();
    mocks.verifyBackupFile.mockReturnValueOnce(verification.promise);
    fireEvent.change(reselect, { target: { files: [new File(['fixture'], 'backup.eobackup')] } });
    await flush();

    expect(mocks.commitRecordBackupIntent).not.toHaveBeenCalled();
    expect(within(form).getByTestId('close-submit')).toBeDisabled();
    expect(report).toHaveBeenLastCalledWith('uid-a:4', 'recovering');
    fireEvent.change(within(form).getByRole('textbox', { name: '實點現金（元）' }), { target: { value: '1170' } });
    fireEvent.submit(form);
    await flush();
    expect(mocks.commitDayCloseIntent).not.toHaveBeenCalled();

    verification.resolve(manifest);
    await flush();
    expect(mocks.commitRecordBackupIntent).toHaveBeenCalledTimes(1);
    expect(mocks.commitDayCloseIntent).not.toHaveBeenCalled();
  });

  it('releases the lock when the file verification fails, without any command', async () => {
    const { report, reselect } = await renderReadyPage();
    mocks.verifyBackupFile.mockRejectedValueOnce(new Error('密碼或檔案不符'));
    fireEvent.change(reselect, { target: { files: [new File(['fixture'], 'backup.eobackup')] } });
    await flush();

    expect(await screen.findByText('密碼或檔案不符')).toBeVisible();
    expect(mocks.commitRecordBackupIntent).not.toHaveBeenCalled();
    expect(report).toHaveBeenLastCalledWith('uid-a:4', 'resolved');
    expect(within(screen.getByRole('form', { name: `${today} 關帳` })).getByTestId('close-submit')).toBeEnabled();
  });
});
