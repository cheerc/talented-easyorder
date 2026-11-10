import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLayoutEffect, useRef } from 'react';
import type { Firestore } from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudPendingRecoveryBoundary } from '../CloudPendingRecoveryBoundary';

const fixture = vi.hoisted(() => ({
  contextUid: 'operator-a',
  contextDataset: 'dataset-a',
  records: [] as Array<{ commandId: string; datasetId: string; uid: string }>,
  listeners: [] as Array<(source: string) => void>,
  journal: {
    migrateLegacyOrderSlot: vi.fn(),
    readAll: vi.fn(),
    removeIf: vi.fn(),
    dismiss: vi.fn(),
    subscribe: vi.fn(),
    isInFlight: vi.fn(),
  },
  repository: {
    getPendingRecoveryContext: vi.fn(),
    confirmPendingPage: vi.fn(),
  },
}));

vi.mock('../../../firebase/cloudPendingJournal', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../firebase/cloudPendingJournal')>();
  return {
    ...actual,
    cloudPendingJournalForRepository: () => fixture.journal,
  };
});

vi.mock('../../../firebase/cloudCommandRepository', () => ({
  createCloudCommandRepository: () => fixture.repository,
}));

const record = {
  commandId: 'a1111111-1111-4111-8111-111111111111',
  datasetId: 'dataset-a',
  uid: 'operator-a',
};
const dbA = { app: { name: '[DEFAULT]', options: { projectId: 'demo-a' } } } as unknown as Firestore;
const dbB = { app: { name: '[DEFAULT]', options: { projectId: 'demo-b' } } } as unknown as Firestore;
const continuationLabel = '暫時略過';

interface LayoutObservation {
  scope: string;
  inert: boolean | null;
}

function ScopeProbe({ scope, observations }: { scope: string; observations: LayoutObservation[] }) {
  const nodeRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    observations.push({ scope, inert: nodeRef.current?.parentElement?.hasAttribute('inert') ?? null });
  }, [observations, scope]);
  return <div ref={nodeRef} data-testid="business-shell">{scope}</div>;
}

function boundary(db: Firestore, uid: string, leaseEpoch: number, scope: string, observations: LayoutObservation[]) {
  return (
    <CloudPendingRecoveryBoundary db={db} uid={uid} leaseEpoch={leaseEpoch}>
      {() => <ScopeProbe scope={scope} observations={observations} />}
    </CloudPendingRecoveryBoundary>
  );
}

async function continueManually(): Promise<void> {
  await screen.findByText(record.commandId);
  fireEvent.click(screen.getByRole('button', { name: continuationLabel }));
  await screen.findByTestId('business-shell');
}

beforeEach(() => {
  fixture.contextUid = 'operator-a';
  fixture.contextDataset = 'dataset-a';
  fixture.records = [{ ...record }];
  fixture.listeners.length = 0;
  vi.clearAllMocks();

  fixture.journal.migrateLegacyOrderSlot.mockResolvedValue('empty');
  fixture.journal.readAll.mockImplementation(async () => ({
    records: [...fixture.records], total: fixture.records.length, complete: true,
  }));
  const removeMatching = async (item: { commandId: string; datasetId: string; uid: string }, guard?: () => boolean) => {
    if (guard && guard() !== true) return false;
    const index = fixture.records.findIndex(candidate => (
      candidate.commandId === item.commandId
        && candidate.datasetId === item.datasetId
        && candidate.uid === item.uid
    ));
    if (index < 0) return false;
    fixture.records.splice(index, 1);
    return true;
  };
  fixture.journal.removeIf.mockImplementation(removeMatching);
  fixture.journal.dismiss.mockImplementation(removeMatching);
  fixture.journal.subscribe.mockImplementation(listener => {
    fixture.listeners.push(listener);
    return () => { fixture.listeners = fixture.listeners.filter(item => item !== listener); };
  });
  fixture.journal.isInFlight.mockReturnValue(false);
  fixture.repository.getPendingRecoveryContext.mockImplementation(async (leaseEpoch: number) => ({
    uid: fixture.contextUid,
    datasetId: fixture.contextDataset,
    leaseEpoch,
  }));
  fixture.repository.confirmPendingPage.mockImplementation(async (records: unknown[]) => (
    records.map(() => ({ status: 'not-found' }))
  ));
});

describe('CloudPendingRecoveryBoundary synchronous scope fence', () => {
  it.each([
    ['new lease epoch', { db: dbA, uid: 'operator-a', leaseEpoch: 2, scope: 'epoch-2' }],
    ['new UID', { db: dbA, uid: 'operator-b', leaseEpoch: 1, scope: 'operator-b' }],
    ['new Firestore app', { db: dbB, uid: 'operator-a', leaseEpoch: 1, scope: 'app-b' }],
  ])('gates the first committed render for a %s before passive recovery effects', async (_label, next) => {
    const observations: LayoutObservation[] = [];
    const view = render(boundary(dbA, 'operator-a', 1, 'epoch-1', observations));
    await continueManually();
    expect(screen.getByTestId('business-shell').parentElement).not.toHaveAttribute('inert');
    fixture.repository.getPendingRecoveryContext.mockImplementation(() => new Promise(() => {}));

    await act(async () => {
      view.rerender(boundary(next.db, next.uid, next.leaseEpoch, next.scope, observations));
      await Promise.resolve();
    });

    const firstNewScopeCommit = observations.find(observation => observation.scope === next.scope);
    expect(firstNewScopeCommit).toEqual({ scope: next.scope, inert: true });
  });

  it('passes a synchronous local cleanup predicate after remote context checks finish', async () => {
    fixture.repository.confirmPendingPage.mockResolvedValue([{
      status: 'matched', receipt: { seq: 1 },
    }]);
    let guardResult: unknown;
    let contextReadsAtGuard = -1;
    fixture.journal.removeIf.mockImplementation(async (_item, guard) => {
      const contextReadsBefore = fixture.repository.getPendingRecoveryContext.mock.calls.length;
      guardResult = guard?.();
      contextReadsAtGuard = fixture.repository.getPendingRecoveryContext.mock.calls.length - contextReadsBefore;
      return guardResult === true;
    });

    const observations: LayoutObservation[] = [];
    render(boundary(dbA, 'operator-a', 1, 'epoch-1', observations));

    await waitFor(() => expect(fixture.journal.removeIf).toHaveBeenCalledTimes(1));
    expect(typeof guardResult).toBe('boolean');
    expect(guardResult).toBe(true);
    expect(contextReadsAtGuard).toBe(0);
  });

  it('preserves same-scope manual continuation through same-tab recovery', async () => {
    const observations: LayoutObservation[] = [];
    render(boundary(dbA, 'operator-a', 1, 'epoch-1', observations));
    await continueManually();
    const confirmationsBefore = fixture.repository.confirmPendingPage.mock.calls.length;

    await act(async () => {
      fixture.listeners[0]?.('same-tab');
    });

    await waitFor(() => expect(fixture.repository.confirmPendingPage.mock.calls.length).toBeGreaterThan(confirmationsBefore));
    expect(screen.getByTestId('business-shell').parentElement).not.toHaveAttribute('inert');
    expect(screen.queryByRole('button', { name: continuationLabel })).not.toBeInTheDocument();
    expect(screen.getByText(record.commandId)).toBeInTheDocument();
  });
});

describe('CloudPendingRecoveryBoundary #648 P8 說明與警示分類', () => {
  it('keeps the pending summary always visible and moves page size and capacity into a HelpTip', async () => {
    render(boundary(dbA, 'operator-a', 1, 'epoch-1', []));
    await screen.findByText(record.commandId);
    const visible = screen.getByText(/請先確認帳務結果後再處理/);
    expect(visible).toBeVisible();
    expect(visible).toHaveTextContent('共有 1 筆待核對紀錄');
    expect(visible).not.toHaveTextContent('每頁最多');
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '待核對容量說明' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent(/每頁最多 \d+ 筆，最多保留 \d+ 筆/);
  });

  it('keeps the duplicate-charge warnings visible, not inside a HelpTip', async () => {
    render(boundary(dbA, 'operator-a', 1, 'epoch-1', []));
    await screen.findByText(record.commandId);
    expect(screen.getByText('前次有一筆送出未收到確認（伺服器查無資料）。若非剛才的操作，請確認無誤後清除。')).toBeVisible();
    expect(screen.getByText('若需先查閱帳務再決定，可暫時略過提醒；確認前請勿重複入帳。')).toBeVisible();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('CloudPendingRecoveryBoundary #676 Phase 1 解除全域黑屏與清除紀錄逃生口', () => {
  it('mounts children without inert when a not-found pending record exists while still passing hasUnresolvedPendingCommands=true', async () => {
    let observedUnresolved: boolean | null = null;
    render(
      <CloudPendingRecoveryBoundary db={dbA} uid="operator-a" leaseEpoch={1}>
        {hasUnresolved => {
          observedUnresolved = hasUnresolved;
          return <div data-testid="business-shell">Main shell content</div>;
        }}
      </CloudPendingRecoveryBoundary>,
    );

    await screen.findByText(record.commandId);
    const shell = screen.getByTestId('business-shell');
    expect(shell).toBeVisible();
    expect(shell.parentElement).not.toHaveAttribute('inert');
    expect(observedUnresolved).toBe(true);
  });

  it('dismisses a not-found pending record from storage, resets total to 0, and clears unresolved state', async () => {
    let observedUnresolved: boolean | null = null;
    render(
      <CloudPendingRecoveryBoundary db={dbA} uid="operator-a" leaseEpoch={1}>
        {hasUnresolved => {
          observedUnresolved = hasUnresolved;
          return <div data-testid="business-shell">Main shell content</div>;
        }}
      </CloudPendingRecoveryBoundary>,
    );

    await screen.findByText(record.commandId);
    const dismissButton = screen.getByRole('button', { name: '清除此紀錄' });
    expect(dismissButton).toBeEnabled();

    fireEvent.click(dismissButton);

    await waitFor(() => expect(fixture.journal.dismiss).toHaveBeenCalledWith(record, expect.any(Function)));
    await waitFor(() => expect(screen.queryByRole('region', { name: '待核對命令' })).not.toBeInTheDocument());
    expect(fixture.records).toEqual([]);
    expect((await fixture.journal.readAll()).total).toBe(0);
    expect(observedUnresolved).toBe(false);
    expect(screen.getByTestId('business-shell')).toBeVisible();
  });
});

describe('CloudPendingRecoveryBoundary #676 Phase 2 頂部警告 Banner、移除 Checkbox 與收合技術資訊', () => {
  it('removes the disclaimer checkbox, folds the raw UUID inside <details><summary>技術資訊</summary>, and allows direct skip', async () => {
    render(boundary(dbA, 'operator-a', 1, 'epoch-1', []));
    const codeNode = await screen.findByText(record.commandId);

    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText(/未決編號不會自動淘汰/)).toBeNull();
    expect(screen.queryByText(/不得重新收款或重登/)).toBeNull();

    const details = codeNode.closest('details');
    expect(details).not.toBeNull();
    expect(details).toHaveClass('cloud-pending-recovery__tech-details');
    expect(details).not.toHaveAttribute('open');
    expect(details?.querySelector('summary')).toHaveTextContent('技術資訊');

    expect(screen.getByRole('button', { name: '再查這筆' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '清除此紀錄' })).toBeEnabled();
    const skipButton = screen.getByRole('button', { name: '暫時略過' });
    expect(skipButton).toBeEnabled();

    fireEvent.click(skipButton);
    expect(screen.queryByRole('button', { name: '暫時略過' })).not.toBeInTheDocument();
    expect(screen.getByTestId('business-shell')).toBeVisible();
  });
});

