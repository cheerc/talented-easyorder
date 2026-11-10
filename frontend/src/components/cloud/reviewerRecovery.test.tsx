import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PendingJournalUnavailableError } from '../../firebase/cloudPendingJournal';
import { CloudPendingRecoveryBoundary } from './CloudPendingRecoveryBoundary';

const f = vi.hoisted(() => ({
  migrate: vi.fn(),
  context: vi.fn(),
  confirm: vi.fn(),
  remove: vi.fn(),
  records: [] as Array<Record<string, unknown>>,
  inFlight: new Set<string>(),
  listener: null as null | ((source: 'same-tab' | 'other-tab' | 'storage-cleared') => void),
}));

vi.mock('../../firebase/cloudCommandRepository', () => ({
  createCloudCommandRepository: () => ({
    getPendingRecoveryContext: f.context,
    confirmPendingPage: f.confirm,
  }),
}));

vi.mock('../../firebase/cloudPendingJournal', async importOriginal => ({
  ...await importOriginal<typeof import('../../firebase/cloudPendingJournal')>(),
  cloudPendingJournalForRepository: () => ({
    migrateLegacyOrderSlot: f.migrate,
    readAll: async () => ({ records: [...f.records], total: f.records.length, complete: true }),
    isInFlight: (candidate: { commandId: string }) => f.inFlight.has(candidate.commandId),
    removeIf: f.remove,
    subscribe: (listener: typeof f.listener) => {
      f.listener = listener;
      return () => { f.listener = null; };
    },
  }),
}));

const record = {
  commandId: 'a1111111-1111-4111-8111-111111111111',
  datasetId: 'dataset-a',
  uid: 'operator-a',
};
const testDb = {} as never;
const context = { uid: 'operator-a', datasetId: 'dataset-a', leaseEpoch: 1, maintenance: false };
const notFoundText = '前次有一筆送出未收到確認（伺服器查無資料）。若非剛才的操作，請確認無誤後清除。';
const notFound = [{ status: 'not-found' }];
const matched = [{ status: 'matched', receipt: { commandId: record.commandId, seq: 1 } }];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function renderBoundary(uid = 'operator-a', leaseEpoch = 1) {
  return render(
    <CloudPendingRecoveryBoundary db={testDb} uid={uid} leaseEpoch={leaseEpoch}>
      {() => <div data-testid="business-shell">Current operator work</div>}
    </CloudPendingRecoveryBoundary>,
  );
}

async function continueManually() {
  await screen.findByText(notFoundText);
  fireEvent.click(screen.getByRole('button', { name: '暫時略過' }));
  await screen.findByTestId('business-shell');
}

beforeEach(() => {
  f.records = [{ ...record }];
  f.inFlight = new Set();
  f.listener = null;
  f.migrate.mockReset().mockResolvedValue('empty');
  f.context.mockReset().mockResolvedValue(context);
  f.confirm.mockReset().mockResolvedValue(notFound);
  f.remove.mockReset().mockImplementation(async (candidate: Record<string, unknown>, isCurrent?: () => boolean) => {
    if (isCurrent && isCurrent() !== true) return false;
    const index = f.records.findIndex(item => item.commandId === candidate.commandId
      && item.datasetId === candidate.datasetId && item.uid === candidate.uid);
    if (index < 0) return false;
    f.records.splice(index, 1);
    return true;
  });
});

afterEach(cleanup);

describe('CloudPendingRecoveryBoundary asynchronous ownership', () => {
  it('does not remove a matched bulk receipt after unmount while its query is pending', async () => {
    const pending = deferred<typeof matched>();
    f.confirm.mockImplementationOnce(() => pending.promise);
    const view = renderBoundary();
    await waitFor(() => expect(f.confirm).toHaveBeenCalledTimes(1));

    view.unmount();
    await act(async () => pending.resolve(matched));

    expect(f.remove).not.toHaveBeenCalled();
    expect(f.records).toEqual([record]);
  });

  it('does not remove a matched per-row retry after unmount while its query is pending', async () => {
    const view = renderBoundary();
    await screen.findByText(notFoundText);
    const pending = deferred<typeof matched>();
    f.confirm.mockImplementationOnce(() => pending.promise);
    fireEvent.click(screen.getByRole('button', { name: '再查這筆' }));
    await waitFor(() => expect(f.confirm).toHaveBeenCalledTimes(2));

    view.unmount();
    await act(async () => pending.resolve(matched));

    expect(f.remove).not.toHaveBeenCalled();
    expect(f.records).toEqual([record]);
  });

  it('checks ownership again after the journal lock is acquired before removing a bulk receipt', async () => {
    const lock = deferred<void>();
    const removeStarted = deferred<void>();
    f.confirm.mockResolvedValueOnce(matched);
    f.remove.mockImplementationOnce(async (candidate: Record<string, unknown>, isCurrent?: () => boolean) => {
      removeStarted.resolve();
      await lock.promise;
      if (isCurrent && isCurrent() !== true) return false;
      f.records = f.records.filter(item => item.commandId !== candidate.commandId);
      return true;
    });
    const view = renderBoundary();
    await removeStarted.promise;

    view.unmount();
    await act(async () => lock.resolve());

    expect(f.remove).toHaveBeenCalledWith(record, expect.any(Function));
    expect(f.records).toEqual([record]);
  });

  it.each([
    ['holder', { uid: 'operator-b', datasetId: 'dataset-a', leaseEpoch: 1, maintenance: false }],
    ['epoch', { uid: 'operator-a', datasetId: 'dataset-a', leaseEpoch: 2, maintenance: false }],
    ['dataset', { uid: 'operator-a', datasetId: 'dataset-b', leaseEpoch: 1, maintenance: false }],
  ])('preserves the journal when an observed %s change invalidates cleanup while waiting for the lock', async (change, changedContext) => {
    const lock = deferred<void>();
    const removeStarted = deferred<void>();
    const view = renderBoundary();
    await continueManually();
    f.confirm.mockResolvedValueOnce(matched);
    f.remove.mockImplementationOnce(async (candidate: Record<string, unknown>, isCurrent?: () => boolean) => {
      removeStarted.resolve();
      await lock.promise;
      if (isCurrent && isCurrent() !== true) return false;
      f.records = f.records.filter(item => item.commandId !== candidate.commandId);
      return true;
    });
    await act(async () => f.listener?.('other-tab'));
    await removeStarted.promise;

    f.confirm.mockResolvedValue(notFound);
    f.context.mockResolvedValue(changedContext);
    if (change === 'dataset') {
      await act(async () => f.listener?.('other-tab'));
      await waitFor(() => expect(f.context).toHaveBeenCalledTimes(5));
    } else {
      const nextUid = change === 'holder' ? 'operator-b' : 'operator-a';
      const nextEpoch = change === 'epoch' ? 2 : 1;
      view.rerender(
        <CloudPendingRecoveryBoundary db={testDb} uid={nextUid} leaseEpoch={nextEpoch}>
          {() => <div data-testid="business-shell">Current operator work</div>}
        </CloudPendingRecoveryBoundary>,
      );
      await waitFor(() => expect(f.context).toHaveBeenCalledTimes(5));
    }
    await act(async () => lock.resolve());

    expect(f.remove).toHaveBeenCalledWith(record, expect.any(Function));
    expect(f.records).toEqual([record]);
    expect(screen.getByTestId('business-shell')).toBeInTheDocument();
    if (change === 'dataset') {
      expect(screen.getByTestId('business-shell').parentElement).toHaveAttribute('inert');
    } else {
      expect(screen.getByTestId('business-shell').parentElement).not.toHaveAttribute('inert');
    }
  });

  it('keeps the latest external recovery result when an older per-row result resolves late', async () => {
    renderBoundary();
    await continueManually();
    const oldResult = deferred<typeof matched>();
    f.confirm.mockImplementationOnce(() => oldResult.promise);
    fireEvent.click(screen.getByRole('button', { name: '再查這筆' }));
    await waitFor(() => expect(f.confirm).toHaveBeenCalledTimes(2));

    await act(async () => f.listener?.('other-tab'));
    await waitFor(() => expect(f.confirm).toHaveBeenCalledTimes(3));
    expect(screen.getByTestId('business-shell').parentElement).not.toHaveAttribute('inert');
    await act(async () => oldResult.resolve(matched));

    expect(f.remove).not.toHaveBeenCalled();
    expect(f.records).toEqual([record]);
    expect(screen.getByText(notFoundText)).toBeInTheDocument();
    expect(screen.getByTestId('business-shell').parentElement).not.toHaveAttribute('inert');
  });

  it('rechecks on reconnect and requires a new acknowledgement for a still-null receipt', async () => {
    renderBoundary();
    await continueManually();
    expect(screen.getByTestId('business-shell').parentElement).not.toHaveAttribute('inert');
    expect(screen.queryByRole('button', { name: '暫時略過' })).not.toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new Event('offline'));
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
    });

    await waitFor(() => expect(f.confirm).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('business-shell')).toBeInTheDocument();
    expect(screen.getByTestId('business-shell').parentElement).not.toHaveAttribute('inert');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('button', { name: '暫時略過' })).toBeEnabled();
    expect(f.records).toEqual([record]);
  });

  it('ignores a late same-tab matched result when reconnect starts a fresh recovery', async () => {
    renderBoundary();
    await continueManually();
    const lateResult = deferred<typeof matched>();
    f.confirm.mockImplementationOnce(() => lateResult.promise);
    fireEvent.click(screen.getByRole('button', { name: '再查這筆' }));
    await waitFor(() => expect(f.confirm).toHaveBeenCalledTimes(2));

    await act(async () => {
      window.dispatchEvent(new Event('offline'));
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
    });

    await waitFor(() => expect(f.confirm).toHaveBeenCalledTimes(3));
    expect(screen.getByTestId('business-shell').parentElement).not.toHaveAttribute('inert');
    await act(async () => lateResult.resolve(matched));

    expect(f.remove).not.toHaveBeenCalled();
    expect(f.records).toEqual([record]);
    expect(screen.getByText(notFoundText)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '暫時略過' })).toBeEnabled();
    expect(screen.getByTestId('business-shell').parentElement).not.toHaveAttribute('inert');
  });

  it('keeps the current shell mounted and resets acknowledgement when a changed lease epoch is rechecked', async () => {
    const view = renderBoundary();
    await continueManually();
    f.context.mockResolvedValue({ ...context, leaseEpoch: 2 });

    view.rerender(
      <CloudPendingRecoveryBoundary db={testDb} uid="operator-a" leaseEpoch={2}>
        {() => <div data-testid="business-shell">Current operator work</div>}
      </CloudPendingRecoveryBoundary>,
    );

    await waitFor(() => expect(f.confirm).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('business-shell')).toBeInTheDocument();
    expect(screen.getByTestId('business-shell').parentElement).not.toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: '暫時略過' })).toBeEnabled();
    expect(f.records).toEqual([record]);
  });

  it('coalesces an online event burst into one complete recovery pass', async () => {
    renderBoundary();
    await continueManually();

    await act(async () => {
      window.dispatchEvent(new Event('offline'));
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
    });

    await waitFor(() => expect(f.confirm).toHaveBeenCalledTimes(2));
    expect(f.records).toEqual([record]);
    expect(screen.getByTestId('business-shell').parentElement).not.toHaveAttribute('inert');
  });

  it('keeps reconnect verification failures gated', async () => {
    renderBoundary();
    await continueManually();
    f.confirm.mockRejectedValueOnce(new Error('server read failed'));

    await act(async () => {
      window.dispatchEvent(new Event('offline'));
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
    });

    await screen.findByText('目前無法安全確認伺服器結果；保留編號。');
    expect(screen.getByTestId('business-shell')).toBeInTheDocument();
    expect(screen.getByTestId('business-shell').parentElement).toHaveAttribute('inert');
    expect(f.records).toEqual([record]);
  });

  it('does not present an empty journal as healthy after going offline', async () => {
    f.records = [];
    renderBoundary();
    await screen.findByTestId('business-shell');
    await act(async () => window.dispatchEvent(new Event('offline')));
    expect(screen.getByText(/目前離線/)).toBeVisible();
    expect(screen.queryByText('目前沒有待核對命令。')).not.toBeInTheDocument();
    expect(screen.getByTestId('business-shell').parentElement).toHaveAttribute('inert');
  });

  it('preserves the journal and gates immediately while offline', async () => {
    renderBoundary();
    await continueManually();

    await act(async () => window.dispatchEvent(new Event('offline')));

    expect(screen.getByTestId('business-shell')).toBeInTheDocument();
    expect(screen.getByTestId('business-shell').parentElement).toHaveAttribute('inert');
    expect(f.records).toEqual([record]);
    expect(f.remove).not.toHaveBeenCalled();
  });

  it('allows a mounted current owner to remove only the exact matched record', async () => {
    f.confirm.mockResolvedValueOnce(matched);
    renderBoundary();

    await waitFor(() => { expect(screen.getByTestId('business-shell').parentElement).not.toHaveAttribute('inert'); expect(screen.queryByRole('region', { name: '待核對命令' })).not.toBeInTheDocument(); });

    expect(f.remove).toHaveBeenCalledWith(record, expect.any(Function));
    expect(f.records).toEqual([]);
    expect(screen.getByTestId('business-shell')).toBeInTheDocument();
  });

  it.each(['journal', 'context'] as const)(
    'lets the current owner restart a read after a one-time initial %s failure',
    async failure => {
      f.records = [];
      if (failure === 'journal') {
        f.migrate.mockRejectedValueOnce(new PendingJournalUnavailableError());
      } else {
        f.context.mockRejectedValueOnce(new Error('temporary server context failure'));
      }

      const pageDocument = document;
      renderBoundary();
      const retry = await screen.findByRole('button', { name: '重新檢查' });
      expect(retry).toBeEnabled();

      fireEvent.click(retry);

      await waitFor(() => { expect(screen.getByTestId('business-shell').parentElement).not.toHaveAttribute('inert'); expect(screen.queryByRole('region', { name: '待核對命令' })).not.toBeInTheDocument(); });
      expect(document).toBe(pageDocument);
      expect(screen.getByTestId('business-shell').parentElement).not.toHaveAttribute('inert');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(f.migrate).toHaveBeenCalledTimes(2);
      expect(f.context.mock.calls.length).toBe(failure === 'journal' ? 2 : 3);
      expect(f.confirm).not.toHaveBeenCalled();
      expect(f.remove).not.toHaveBeenCalled();
      expect(f.records).toEqual([]);
    },
  );

  it.each(['journal', 'context'] as const)(
    'keeps an unknown-scope business gate when the %s failure persists across retry',
    async failure => {
      f.records = [];
      if (failure === 'journal') {
        f.migrate.mockRejectedValue(new PendingJournalUnavailableError());
      } else {
        f.context.mockRejectedValue(new Error('persistent server context failure'));
      }

      renderBoundary();
      const retry = await screen.findByRole('button', { name: '重新檢查' });
      expect(retry).toBeEnabled();
      fireEvent.click(retry);

      const retryAfterFailure = await screen.findByRole('button', { name: '重新檢查' });
      expect(retryAfterFailure).toBeEnabled();
      expect(screen.queryByTestId('business-shell')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '保留編號，移交人工核對並繼續其他作業' })).not.toBeInTheDocument();
      expect(f.confirm).not.toHaveBeenCalled();
      expect(f.remove).not.toHaveBeenCalled();
      expect(f.records).toEqual([]);
    },
  );

  it('hides retry while offline and lets the online event start one fresh recovery', async () => {
    f.records = [];
    f.migrate.mockRejectedValueOnce(new PendingJournalUnavailableError());
    renderBoundary();
    await screen.findByRole('button', { name: '重新檢查' });

    await act(async () => window.dispatchEvent(new Event('offline')));
    expect(screen.getByText('目前離線；追蹤編號仍保留，恢復連線後會重新核對。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新檢查' })).not.toBeInTheDocument();
    expect(f.migrate).toHaveBeenCalledTimes(1);
    expect(f.records).toEqual([]);

    await act(async () => window.dispatchEvent(new Event('online')));
    await waitFor(() => { expect(screen.getByTestId('business-shell').parentElement).not.toHaveAttribute('inert'); expect(screen.queryByRole('region', { name: '待核對命令' })).not.toBeInTheDocument(); });
    expect(f.migrate).toHaveBeenCalledTimes(2);
    expect(f.confirm).not.toHaveBeenCalled();
    expect(f.remove).not.toHaveBeenCalled();
  });

  it('keeps the current recovery gate while a retry is in flight', async () => {
    f.records = [];
    f.migrate.mockRejectedValueOnce(new PendingJournalUnavailableError());
    renderBoundary();
    const retry = await screen.findByRole('button', { name: '重新檢查' });
    expect(retry).toBeEnabled();

    const migration = deferred<string>();
    f.migrate.mockReturnValueOnce(migration.promise);
    fireEvent.click(retry);

    await screen.findByText('正在檢查本機追蹤編號及伺服器回執；完成前不開放新操作。');
    expect(screen.queryByRole('button', { name: '重新檢查' })).not.toBeInTheDocument();
    expect(f.migrate).toHaveBeenCalledTimes(2);
    expect(f.records).toEqual([]);

    await act(async () => migration.resolve('empty'));
    await waitFor(() => { expect(screen.getByTestId('business-shell').parentElement).not.toHaveAttribute('inert'); expect(screen.queryByRole('region', { name: '待核對命令' })).not.toBeInTheDocument(); });
    expect(screen.getByTestId('business-shell').parentElement).not.toHaveAttribute('inert');
    expect(f.migrate).toHaveBeenCalledTimes(2);
  });
});

// #585 P1b: a command sent from this very tab (a journal row in flight) must not push the page down with the recovery section
// while the system is healthy; any other state keeps the section exactly as before.
describe('CloudPendingRecoveryBoundary quiet same-tab in-flight rows', () => {
  const region = () => screen.queryByRole('region', { name: '待核對命令' });

  async function mountEmptyShell() {
    f.records = [];
    renderBoundary();
    const shell = await screen.findByTestId('business-shell');
    await waitFor(() => expect(region()).toBeNull());
    return shell;
  }

  async function sendFromThisTab() {
    f.records = [{ ...record }];
    f.inFlight.add(record.commandId);
    const calls = f.context.mock.calls.length;
    await act(async () => { f.listener?.('same-tab'); });
    await waitFor(() => expect(f.context.mock.calls.length).toBe(calls + 2));
    await act(async () => {});
  }

  it('S1 does not render the section for a healthy same-tab in-flight row and leaves the shell unlocked', async () => {
    const shell = await mountEmptyShell();
    await sendFromThisTab();
    expect(region()).toBeNull();
    expect(shell.parentElement).not.toHaveAttribute('inert');
    expect(f.confirm).not.toHaveBeenCalled();
  });

  it('S2 shows the section again once the same-tab row has been in flight for ten seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      await mountEmptyShell();
      await sendFromThisTab();
      expect(region()).toBeNull();
      await act(async () => { vi.advanceTimersByTime(9_000); });
      expect(region()).toBeNull();
      await act(async () => { vi.advanceTimersByTime(1_500); });
      expect(region()).not.toBeNull();
      expect(screen.getByText('同分頁的提交仍在執行；保留編號，勿另送。')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('S3 keeps the section when a confirmed row still has a local cleanup to do', async () => {
    await mountEmptyShell();
    f.records = [{ ...record }];
    f.confirm.mockResolvedValueOnce(matched);
    f.remove.mockResolvedValueOnce(false);
    const calls = f.context.mock.calls.length;
    await act(async () => { f.listener?.('same-tab'); });
    await waitFor(() => expect(f.context.mock.calls.length).toBe(calls + 2));
    expect(await screen.findByText(/已確認原命令入帳；本機追蹤編號尚未清除，之後會再核對。/)).toBeInTheDocument();
    expect(region()).not.toBeNull();
  });

  it('S4 keeps the section when the recovery check fails while a row is in flight', async () => {
    const shell = await mountEmptyShell();
    f.records = [{ ...record }];
    f.inFlight.add(record.commandId);
    f.context.mockRejectedValueOnce(Object.assign(new Error('unavailable'), { code: 'UNAVAILABLE' }));
    await act(async () => { f.listener?.('same-tab'); });
    expect(await screen.findByText('目前無法從伺服器安全核對待決命令；結果未確認，請確認連線後重試。')).toBeInTheDocument();
    expect(region()).not.toBeNull();
    expect(shell.parentElement).toHaveAttribute('inert');
  });

  it('keeps the section for an in-flight row found by the startup check', async () => {
    f.inFlight.add(record.commandId);
    renderBoundary();
    expect(await screen.findByText('同分頁的提交仍在執行；保留編號，勿另送。')).toBeInTheDocument();
    expect(region()).not.toBeNull();
  });
});
