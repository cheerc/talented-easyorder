import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLayoutEffect, useRef } from 'react';
import type { Firestore } from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudPendingRecoveryBoundary } from '../CloudPendingRecoveryBoundary';

const fixture = vi.hoisted(() => ({
  contextUid: 'operator-a',
  contextDataset: 'dataset-a',
  listeners: [] as Array<(source: string) => void>,
  journal: {
    migrateLegacyOrderSlot: vi.fn(),
    readAll: vi.fn(),
    removeIf: vi.fn(),
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
const confirmationLabel = '我確認本筆結果尚未確定，不得重新收款或重登；只繼續其他獨立作業，待保留編號人工核對。';
const continuationLabel = '保留編號，移交人工核對並繼續其他作業';

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
  fireEvent.click(screen.getByLabelText(confirmationLabel));
  fireEvent.click(screen.getByRole('button', { name: continuationLabel }));
  await screen.findByTestId('business-shell');
}

beforeEach(() => {
  fixture.contextUid = 'operator-a';
  fixture.contextDataset = 'dataset-a';
  fixture.listeners.length = 0;
  vi.clearAllMocks();

  fixture.journal.migrateLegacyOrderSlot.mockResolvedValue('empty');
  fixture.journal.readAll.mockImplementation(async () => ({
    records: [{ ...record }], total: 1, complete: true,
  }));
  fixture.journal.removeIf.mockImplementation(async (_item, guard) => guard?.() === true);
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
  it('keeps 未決編號不會自動淘汰 always visible and moves page size and capacity into a HelpTip', async () => {
    render(boundary(dbA, 'operator-a', 1, 'epoch-1', []));
    await screen.findByText(record.commandId);
    const visible = screen.getByText(/未決編號不會自動淘汰/);
    expect(visible).toBeVisible();
    expect(visible).toHaveTextContent('共有 1 筆待核對編號');
    expect(visible).not.toHaveTextContent('每頁最多');
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '待核對容量說明' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent(/每頁最多 \d+ 筆，最多保留 \d+ 筆/);
  });

  it('keeps the duplicate-charge warnings visible, not inside a HelpTip', async () => {
    render(boundary(dbA, 'operator-a', 1, 'epoch-1', []));
    await screen.findByText(record.commandId);
    expect(screen.getByText('伺服器目前未查到的編號仍可能已入帳；不可重新收款或重登。')).toBeVisible();
    expect(screen.getByLabelText(confirmationLabel)).toBeVisible();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
