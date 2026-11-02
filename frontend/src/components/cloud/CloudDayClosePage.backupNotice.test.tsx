import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { CloudDayClosePage } from './CloudDayClosePage';

// #596: the real BackupScreen inside the real CloudDayClosePage; the data head is steerable to show what the notice does.
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
    head: { current: null as { seq: number; lastCommandId: string | null; datasetId: string; targets: Record<string, unknown> } | null },
  };
});

vi.mock('../../providers/FirebaseProvider', () => ({ useFirebaseOptional: () => mocks.firebase, useDataHead: () => mocks.head.current }));
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

const headAt = (seq: number) => ({ seq, lastCommandId: `cmd-${seq}`, datasetId: 'dataset-a', targets: {} });

const renderPage = () => render(
  <CloudDayClosePage db={mocks.db as unknown as Firestore} leaseEpoch={4} identityKey="uid-a:4" onNavigationStateChange={vi.fn()} />,
);

async function recordBackup(user: ReturnType<typeof userEvent.setup>, receiptSeq: number) {
  mocks.commitRecordBackupIntent.mockImplementation(async (intent: { commandId: string }) => (
    { ok: true, receipt: { commandId: intent.commandId, seq: receiptSeq, committedAt: '2026-10-17T03:00:00.000Z', kind: 'RecordBackup', targets: {}, result: {} } }
  ));
  await user.type(screen.getByLabelText('備份密碼'), 'fixture-passphrase');
  await user.click(screen.getByRole('button', { name: '產生加密備份' }));
  const reselect = await screen.findByLabelText('重新選取剛存下的備份檔');
  fireEvent.change(reselect, { target: { files: [new File(['fixture'], 'backup.eobackup')] } });
  await flush();
  expect(mocks.commitRecordBackupIntent).toHaveBeenCalledTimes(1);
}

describe('#596 embedded backup and the data-updated notice', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.head.current = null;
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue('00000000-0000-4000-8000-0000000000c1') });
    mocks.loadSnapshot.mockResolvedValue(snapshot());
    mocks.exportRange.mockResolvedValue({ fromSeq: 0, toSeq: 1, manifest });
    mocks.encryptBackup.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.sha256Hex.mockResolvedValue(sha);
    mocks.verifyBackupFile.mockResolvedValue(manifest);
  });

  it('does not take the page\'s own RecordBackup receipt for another device, but still shows a later write of another device', async () => {
    mocks.head.current = headAt(20);
    const view = renderPage();
    await flush();
    expect(screen.queryByTestId('data-updated-notice')).toBeNull();
    await recordBackup(userEvent.setup(), 21);
    expect(await screen.findByText(/已登記 RecordBackup/)).toBeVisible();

    // the receipt of this very command (seq 21) moves the head, and the page does not read again after it
    mocks.head.current = headAt(21);
    view.rerender(<CloudDayClosePage db={mocks.db as unknown as Firestore} leaseEpoch={4} identityKey="uid-a:4" onNavigationStateChange={vi.fn()} />);
    await flush();
    expect(screen.queryByTestId('data-updated-notice')).toBeNull();

    // another device writing after it still shows the notice
    mocks.head.current = headAt(22);
    view.rerender(<CloudDayClosePage db={mocks.db as unknown as Firestore} leaseEpoch={4} identityKey="uid-a:4" onNavigationStateChange={vi.fn()} />);
    await flush();
    expect(screen.getByTestId('data-updated-notice')).toBeInTheDocument();
  });

  it('still shows the notice when another device wrote before the page\'s own receipt', async () => {
    mocks.head.current = headAt(20);
    const view = renderPage();
    await flush();
    // seq 21 came from another device; the backup receipt is seq 22, so the page never saw 21
    await recordBackup(userEvent.setup(), 22);
    expect(await screen.findByText(/已登記 RecordBackup/)).toBeVisible();
    mocks.head.current = headAt(22);
    view.rerender(<CloudDayClosePage db={mocks.db as unknown as Firestore} leaseEpoch={4} identityKey="uid-a:4" onNavigationStateChange={vi.fn()} />);
    await flush();
    expect(screen.getByTestId('data-updated-notice')).toBeInTheDocument();
  });
});
