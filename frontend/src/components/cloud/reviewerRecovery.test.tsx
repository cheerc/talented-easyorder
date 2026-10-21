import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudPendingRecoveryBoundary } from './CloudPendingRecoveryBoundary';

const f = vi.hoisted(() => ({
  context: vi.fn(),
  confirm: vi.fn(),
  remove: vi.fn(),
  records: [] as Array<Record<string, unknown>>,
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
    migrateLegacyOrderSlot: async () => 'empty',
    readAll: async () => ({ records: [...f.records], total: f.records.length, complete: true }),
    isInFlight: () => false,
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
const manualConfirmation = '我確認本筆結果尚未確定，不得重新收款或重登；只繼續其他獨立作業，待保留編號人工核對。';
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
  await screen.findByText('伺服器目前未查到；這不代表確定未入帳。保留編號，不要重新收款。');
  fireEvent.click(screen.getByLabelText(manualConfirmation));
  fireEvent.click(screen.getByRole('button', { name: '保留編號，移交人工核對並繼續其他作業' }));
  await screen.findByTestId('business-shell');
}

beforeEach(() => {
  f.records = [{ ...record }];
  f.listener = null;
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
    await screen.findByText('伺服器目前未查到；這不代表確定未入帳。保留編號，不要重新收款。');
    const pending = deferred<typeof matched>();
    f.confirm.mockImplementationOnce(() => pending.promise);
    fireEvent.click(screen.getByRole('button', { name: '再查這筆編號' }));
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
    expect(screen.getByTestId('business-shell').parentElement).toHaveAttribute('inert');
  });

  it('keeps the latest external recovery result when an older per-row result resolves late', async () => {
    renderBoundary();
    await continueManually();
    const oldResult = deferred<typeof matched>();
    f.confirm.mockImplementationOnce(() => oldResult.promise);
    fireEvent.click(screen.getByRole('button', { name: '再查這筆編號' }));
    await waitFor(() => expect(f.confirm).toHaveBeenCalledTimes(2));

    await act(async () => f.listener?.('other-tab'));
    await waitFor(() => expect(f.confirm).toHaveBeenCalledTimes(3));
    expect(screen.getByTestId('business-shell').parentElement).toHaveAttribute('inert');
    await act(async () => oldResult.resolve(matched));

    expect(f.remove).not.toHaveBeenCalled();
    expect(f.records).toEqual([record]);
    expect(screen.getByText('伺服器目前未查到；這不代表確定未入帳。保留編號，不要重新收款。')).toBeInTheDocument();
    expect(screen.getByTestId('business-shell').parentElement).toHaveAttribute('inert');
  });

  it('rechecks on reconnect and requires a new acknowledgement for a still-null receipt', async () => {
    renderBoundary();
    await continueManually();
    expect(screen.getByTestId('business-shell').parentElement).not.toHaveAttribute('inert');

    await act(async () => {
      window.dispatchEvent(new Event('offline'));
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
    });

    await waitFor(() => expect(f.confirm).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('business-shell')).toBeInTheDocument();
    expect(screen.getByTestId('business-shell').parentElement).toHaveAttribute('inert');
    expect(screen.getByLabelText(manualConfirmation)).not.toBeChecked();
    expect(screen.getByRole('button', { name: '保留編號，移交人工核對並繼續其他作業' })).toBeDisabled();
    expect(f.records).toEqual([record]);
  });

  it('ignores a late same-tab matched result when reconnect starts a fresh recovery', async () => {
    renderBoundary();
    await continueManually();
    const lateResult = deferred<typeof matched>();
    f.confirm.mockImplementationOnce(() => lateResult.promise);
    fireEvent.click(screen.getByRole('button', { name: '再查這筆編號' }));
    await waitFor(() => expect(f.confirm).toHaveBeenCalledTimes(2));

    await act(async () => {
      window.dispatchEvent(new Event('offline'));
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
    });

    await waitFor(() => expect(f.confirm).toHaveBeenCalledTimes(3));
    expect(screen.getByTestId('business-shell').parentElement).toHaveAttribute('inert');
    await act(async () => lateResult.resolve(matched));

    expect(f.remove).not.toHaveBeenCalled();
    expect(f.records).toEqual([record]);
    expect(screen.getByText('伺服器目前未查到；這不代表確定未入帳。保留編號，不要重新收款。')).toBeInTheDocument();
    expect(screen.getByLabelText(manualConfirmation)).not.toBeChecked();
    expect(screen.getByTestId('business-shell').parentElement).toHaveAttribute('inert');
  });

  it('keeps the current shell mounted and inert while a changed lease epoch is rechecked', async () => {
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
    expect(screen.getByTestId('business-shell').parentElement).toHaveAttribute('inert');
    expect(screen.getByLabelText(manualConfirmation)).not.toBeChecked();
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
    expect(screen.getByTestId('business-shell').parentElement).toHaveAttribute('inert');
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

    await screen.findByText('目前沒有待核對命令。');

    expect(f.remove).toHaveBeenCalledWith(record, expect.any(Function));
    expect(f.records).toEqual([]);
    expect(screen.getByTestId('business-shell')).toBeInTheDocument();
  });
});
