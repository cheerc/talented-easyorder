import { StrictMode, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { CommandReceipt, CommandResult } from '../../domain/cloudCommands';
import type { OpeningMismatchAnomaly } from '../../domain/ledgerAnomalies';
import type { PostCloseEntry } from '../../domain/postCloseEntries';
import type {
  CloudDayCloseOverview,
  CloudDayCloseState,
  CloudSettlementVersion,
} from '../../firebase/cloudDayCloseRepository';
import type { CloudLedgerView } from '../../hooks/useCloudLedger';
import { CloudDayClosePage } from './CloudDayClosePage';

const repository = vi.hoisted(() => {
  const isAuthorizationLoss = (error: unknown) => ['LEASE_LOST', 'UNAUTHORIZED', 'ACCESS_BUSY']
    .includes(String((error as { code?: unknown } | null)?.code));
  const lookupMessage = (error: unknown) => (error instanceof Error || (error && typeof error === 'object' && 'message' in error))
    ? String((error as { message: unknown }).message)
    : '查詢失敗';
  const dataset = { id: 'dataset-a' };
  const value = {
    dataset,
    read: vi.fn(),
    readOverview: vi.fn(),
    closeDay: vi.fn(),
    recordPostCloseEntry: vi.fn(),
    reopenDay: vi.fn(),
    backfillOpening: vi.fn(),
    ensureDay: vi.fn(),
    startBackfill: vi.fn(),
    findPreviousClosed: vi.fn(),
    findNextOpened: vi.fn(),
    readCommand: vi.fn(),
    readLedger: vi.fn(),
    // The composed, dataset-bearing page read; the fake reuses the per-method mocks the tests already prepare.
    loadSnapshot: vi.fn(async (targetDayId?: string) => {
      const overview = await value.readOverview();
      const dayId = targetDayId ?? overview.selectionDate;
      const day = await value.read(dayId);
      const backfill = overview.unclosedDays.find((item: { dayId: string }) => item.dayId === dayId)?.backfill ?? null;
      let previous: unknown = null;
      if (dayId < overview.selectionDate && dayId >= overview.goLiveDate && !backfill
        && (!day || (day.status === 'open' && day.lastSettlementRevision === 0 && day.openingCash === null))) {
        try {
          previous = { status: 'ready', previous: (await value.findPreviousClosed(dayId)).previous };
        } catch (error) {
          if (isAuthorizationLoss(error)) throw error;
          previous = { status: 'error', message: lookupMessage(error) };
        }
      }
      let align: unknown = null;
      if (backfill && day && day.status !== 'closed' && day.openingCash !== null) {
        try {
          align = { status: 'ready', next: (await value.findNextOpened(dayId)).next };
        } catch (error) {
          if (isAuthorizationLoss(error)) throw error;
          align = { status: 'error', message: lookupMessage(error) };
        }
      }
      return { datasetId: dataset.id, overview, dayId, day, backfill, previous, align };
    }),
    commitDayCloseIntent: vi.fn((intent: { kind: string; input: unknown }) => {
      switch (intent.kind) {
        case 'close-day': return value.closeDay(intent.input);
        case 'record-post-close-entry': return value.recordPostCloseEntry(intent.input);
        case 'reopen-day': return value.reopenDay(intent.input);
        case 'backfill-opening': return value.backfillOpening(intent.input);
        case 'ensure-day': return value.ensureDay(intent.input);
        case 'start-backfill': return value.startBackfill(intent.input);
        default: throw new Error(`Unexpected DayClose intent: ${intent.kind}`);
      }
    }),
    confirmPendingIntent: vi.fn<() => Promise<Record<string, unknown>>>(async () => ({ status: 'not-found' })),
    cleanupConfirmedIntent: vi.fn(async () => true),
    hasOtherUnresolvedCommands: vi.fn(async () => false),
  };
  return value;
});

const currentAuth = vi.hoisted(() => ({ uid: 'uid-a' }));
const headMock = vi.hoisted(() => ({ current: null as { seq: number; lastCommandId: string; datasetId: string; targets: Record<string, unknown> } | null }));

vi.mock('../../providers/FirebaseProvider', () => ({ useDataHead: () => headMock.current }));

vi.mock('../../firebase/cloudDayCloseRepository', () => ({
  createCloudDayCloseRepository: () => repository,
}));

vi.mock('../../firebase/cloudRecoveryReader', () => ({
  getCloudRecoveryReader: () => ({ assertCurrent: vi.fn() }),
}));

vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: { uid: currentAuth.uid } }),
}));

beforeEach(() => {
  currentAuth.uid = 'uid-a';
  repository.dataset.id = 'dataset-a';
});

const today = '2026-10-17';
const commandId = '00000000-0000-4000-8000-000000000011';

function overview(overrides: Partial<CloudDayCloseOverview> = {}): CloudDayCloseOverview {
  return {
    selectionDate: today,
    goLiveDate: '2026-10-01',
    unclosedDays: [{ dayId: today, status: 'open', openingCash: 1000, activeTransactionCount: 4, kind: 'needs-close', backfill: null }],
    seq: 20,
    ...overrides,
  };
}

// Spec L05: opening 1,000, receipts 200, counter income 50, expense 80 → expected 1,170.
function dayState(overrides: Partial<CloudDayCloseState> = {}): CloudDayCloseState {
  return {
    dayId: today,
    status: 'open',
    revision: 6,
    openingCash: 1000,
    totals: {
      activeTransactionCount: 4, bentoCount: 2, otherMealCount: 0, mealTotal: 180,
      retainedReceipts: 200, cashierIncome: 50, cashierExpense: 80, accountRefunds: 0,
    },
    lastSettlementRevision: 0,
    expectedCash: 1170,
    settlements: [],
    postCloseEntries: [],
    effectiveCash: null,
    seq: 20,
    ...overrides,
  };
}

function version(revision: number, overrides: Partial<CloudSettlementVersion> = {}): CloudSettlementVersion {
  return {
    revision,
    status: 'closed',
    totals: dayState().totals,
    openingCash: 1000,
    expectedCash: 1170,
    countedCash: 1160,
    difference: -10,
    note: '找零少收 10 元',
    actorUid: 'uid-a',
    actorEmail: 'operator@example.test',
    sourceSeq: 21,
    committedAt: '2026-10-17T12:00:00.000Z',
    lastCommandId: commandId,
    ...overrides,
  };
}

function receipt(kind: CommandReceipt['kind']): CommandReceipt {
  return { commandId, seq: 21, committedAt: '2026-10-17T12:00:00.000Z', kind, targets: { dayId: today }, result: {} };
}

function postCloseEntry(overrides: Partial<PostCloseEntry> = {}): PostCloseEntry {
  return {
    entryId: '00000000-0000-4000-8000-000000000012',
    dayId: today,
    settlementRevision: 1,
    direction: 'expense',
    amount: 50,
    reason: '找零短少，補記支出',
    createdBy: 'uid-a',
    createdAt: new Date('2026-10-17T12:30:00.000Z'),
    commandId: '00000000-0000-4000-8000-000000000012',
    ...overrides,
  };
}

const q2Mismatch: OpeningMismatchAnomaly = {
  kind: 'opening-mismatch', dayId: '2026-10-15', openingCash: 950, previousClosedDayId: '2026-10-14',
  previousCountedCash: 1000, previousPostCloseNet: 0, previousEffectiveCash: 1000, difference: -50, daysApart: 1,
  gapDays: [], gapDayCount: 0,
};

function successful(kind: CommandReceipt['kind']): CommandResult {
  return { ok: true, receipt: receipt(kind) };
}

function renderPage(props: {
  initialDayId?: string;
  initialPostCloseEntry?: OpeningMismatchAnomaly;
  onLedgerChanged?: () => void;
  hasUnresolvedPendingCommands?: boolean;
  operatorSelf?: { uid: string; name: string } | null;
} = {}, onNavigationStateChange = vi.fn()) {
  render(
    <CloudDayClosePage
      db={{} as Firestore}
      leaseEpoch={4}
      identityKey="uid-a:4"
      initialDayId={props.initialDayId}
      onNavigationStateChange={onNavigationStateChange}
      initialPostCloseEntry={props.initialPostCloseEntry}
      onLedgerChanged={props.onLedgerChanged}
      hasUnresolvedPendingCommands={props.hasUnresolvedPendingCommands}
      operatorSelf={props.operatorSelf === undefined ? { uid: 'uid-a', name: '測試操作員甲' } : props.operatorSelf}
    />,
  );
  return onNavigationStateChange;
}

async function closeForm() {
  return screen.findByRole('form', { name: `${today} 關帳` });
}

describe('CloudDayClosePage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue(commandId) });
    repository.readOverview.mockResolvedValue(overview());
    repository.read.mockResolvedValue(dayState());
    repository.closeDay.mockResolvedValue(successful('CloseDay'));
    repository.recordPostCloseEntry.mockResolvedValue(successful('RecordPostCloseEntry'));
    repository.reopenDay.mockResolvedValue(successful('ReopenDay'));
    repository.backfillOpening.mockResolvedValue(successful('BackfillOpeningCash'));
    repository.ensureDay.mockResolvedValue(successful('EnsureDay'));
    repository.startBackfill.mockResolvedValue(successful('StartBackfill'));
    repository.findPreviousClosed.mockResolvedValue({ previous: null, seq: 20 });
    repository.readCommand.mockResolvedValue(null);
    repository.readLedger.mockResolvedValue({ today, goLiveDate: '2026-10-01', anomalies: [], closedDays: [], seq: 20 });
  });

  it('L05: expected 1,170 and counted 1,160 needs a non-blank reason, then closes with the server numbers', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: `${today} 日結` })).toBeInTheDocument();
    expect(screen.getByText('開啟中')).toHaveClass('badge-ui', 'badge-warn');
    expect(repository.read).toHaveBeenCalledWith(today);
    const figures = screen.getByLabelText('營業日現金統計');
    expect(within(figures).getByText('NT$ 1,170')).toBeInTheDocument();

    const form = await closeForm();
    fireEvent.change(within(form).getByRole('textbox', { name: '實點現金（元）' }), { target: { value: '1160' } });
    expect(within(form).getByText('應有 NT$ 1,170，實點 NT$ 1,160，少 NT$ 10')).toBeInTheDocument();
    fireEvent.click(within(form).getByRole('button', { name: '確認關帳' }));
    expect(await screen.findByText('實點與應有現金不同，請填寫差額原因後再關帳。')).toBeInTheDocument();
    fireEvent.change(within(form).getByRole('textbox', { name: /差額原因/ }), { target: { value: '   ' } });
    fireEvent.click(within(form).getByRole('button', { name: '確認關帳' }));
    expect(await screen.findByText('實點與應有現金不同，請填寫差額原因後再關帳。')).toBeInTheDocument();
    expect(repository.closeDay).not.toHaveBeenCalled();

    repository.readOverview.mockResolvedValue(overview({ unclosedDays: [], seq: 21 }));
    repository.read.mockResolvedValue(dayState({ status: 'closed', revision: 7, lastSettlementRevision: 1, settlements: [version(1)], seq: 21 }));
    fireEvent.change(within(form).getByRole('textbox', { name: /差額原因/ }), { target: { value: ' 找零少收 10 元 ' } });
    fireEvent.click(within(form).getByRole('button', { name: '確認關帳' }));

    expect(await screen.findByText(/已確認 2026-10-17 關帳 完成/)).toBeInTheDocument();
    expect(repository.closeDay).toHaveBeenCalledWith({
      commandId, leaseEpoch: 4, dayId: today, expectedDayRevision: 6, expectedSettlementRevision: 0,
      expectedCash: 1170, countedCash: 1160, note: '找零少收 10 元',
    });
    expect(screen.queryByRole('form', { name: `${today} 關帳` })).not.toBeInTheDocument();
    const row = screen.getByTestId('cloud-settlement-1');
    expect(within(row).getByText('少 NT$ 10')).toBeInTheDocument();
    expect(within(row).getByText('找零少收 10 元')).toBeInTheDocument();
    expect(screen.getByText('過去沒有未關帳的日子')).toBeInTheDocument();
  });

  it('uses EmptyState for a day with no settlement versions, and one status line when no past day is unclosed', async () => {
    repository.readOverview.mockResolvedValue(overview({ unclosedDays: [] }));
    repository.read.mockResolvedValue(dayState({ status: 'closed', revision: 7, lastSettlementRevision: 1, settlements: [] }));
    renderPage();

    expect(await screen.findByText('過去沒有未關帳的日子')).toBeInTheDocument();
    expect(screen.queryByLabelText('未關帳營業日')).not.toBeInTheDocument();
    const noSettlements = screen.getByText('這天還沒有日結版本。');
    expect(noSettlements.closest('.empty-title')).not.toBeNull();
    const noPostCloseEntries = screen.getByText('這個關帳版本還沒有補記。');
    expect(noPostCloseEntries.closest('.empty-title')).not.toBeNull();
  });

  it('keeps the §7.4 close restriction after manual pending-command continuation', async () => {
    renderPage({ hasUnresolvedPendingCommands: true });
    const form = await closeForm();
    expect(within(form).getByTestId('close-submit')).toBeDisabled();
    expect(within(form).getByTestId('pending-close-block')).toHaveTextContent('先完成結果確認後才能關帳');
    fireEvent.submit(form);
    expect(repository.closeDay).not.toHaveBeenCalled();
  });

  it('closes when clicked right after the §7.4 block clears, before passive effects run (#611)', async () => {
    // The flag changes outside act() (as a pending-command query resolving would), and the click comes from a
    // MutationObserver: right after React commits the enabled button, before that commit's passive effects flush.
    let setUnresolved: (value: boolean) => void = () => undefined;
    const db = {} as Firestore;
    function Harness() {
      const [unresolved, set] = useState(true);
      setUnresolved = set;
      return <CloudDayClosePage db={db} leaseEpoch={4} identityKey="uid-a:4" hasUnresolvedPendingCommands={unresolved} />;
    }
    render(<Harness />);
    const form = await closeForm();
    const counted = within(form).getByRole('textbox', { name: '實點現金（元）' });
    await waitFor(() => expect(counted).toBeEnabled());
    fireEvent.change(counted, { target: { value: '1170' } });
    expect(counted).toHaveValue('1170');
    expect(within(form).getByTestId('close-submit')).toBeDisabled();
    let clicked = false;
    const observer = new MutationObserver(() => {
      if (clicked) return;
      const submit = document.querySelector<HTMLButtonElement>('[data-testid="close-submit"]');
      if (!submit || submit.disabled) return;
      clicked = true;
      fireEvent.click(submit);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    try {
      await new Promise<void>(resolve => setTimeout(() => { setUnresolved(false); resolve(); }, 0));
      await waitFor(() => expect(clicked).toBe(true));
      await waitFor(() => expect(repository.closeDay).toHaveBeenCalledTimes(1), { timeout: 3_000 });
      expect(screen.queryByText('尚有待核對命令；依系統關帳規則，先完成結果確認後才能關帳。保留原編號，不要重新收款。')).not.toBeInTheDocument();
    } finally {
      observer.disconnect();
    }
  });

  it('closes without a note when the counted cash equals the expected cash', async () => {
    renderPage();
    const form = await closeForm();
    fireEvent.change(within(form).getByRole('textbox', { name: '實點現金（元）' }), { target: { value: '1170' } });
    expect(within(form).getByText(/無差額/)).toBeInTheDocument();
    fireEvent.click(within(form).getByRole('button', { name: '確認關帳' }));
    await screen.findByText(/已確認 2026-10-17 關帳 完成/);
    expect(repository.closeDay).toHaveBeenCalledWith(expect.objectContaining({ countedCash: 1170, note: '' }));
  });

  it('refuses blank, negative or fractional counted cash without sending', async () => {
    renderPage();
    const form = await closeForm();
    for (const value of ['', '-5', '10.5', 'abc']) {
      fireEvent.change(within(form).getByRole('textbox', { name: '實點現金（元）' }), { target: { value } });
      fireEvent.submit(form);
      expect(await screen.findByText(/實點現金必須明確輸入/)).toBeInTheDocument();
    }
    expect(repository.closeDay).not.toHaveBeenCalled();
  });

  it('reopens a closed day only with a non-blank reason and keeps the old versions visible', async () => {
    repository.read.mockResolvedValue(dayState({ status: 'closed', revision: 7, lastSettlementRevision: 1, settlements: [version(1)] }));
    renderPage();
    expect(await screen.findByText('已關帳')).toHaveClass('badge-ui', 'badge-ok');
    expect(within(screen.getByTestId('cloud-settlement-1')).getByText('關帳')).toHaveClass('badge-ui', 'badge-ok');
    expect(screen.queryByRole('form', { name: `${today} 關帳` })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重開這一天' }));
    const form = screen.getByRole('form', { name: `${today} 重開` });
    fireEvent.change(within(form).getByRole('textbox', { name: /重開原因/ }), { target: { value: '  ' } });
    fireEvent.submit(form);
    expect(await screen.findByText('重開原因必須為 1 至 500 個字元。')).toBeInTheDocument();
    expect(repository.reopenDay).not.toHaveBeenCalled();

    repository.read.mockResolvedValue(dayState({
      status: 'reopened', revision: 8, lastSettlementRevision: 2,
      settlements: [version(1), version(2, { status: 'reopened', countedCash: null, difference: null, note: '補登漏記的繳費' })],
    }));
    fireEvent.change(within(form).getByRole('textbox', { name: /重開原因/ }), { target: { value: '補登漏記的繳費' } });
    fireEvent.click(within(form).getByRole('button', { name: '確認重開' }));
    expect(await screen.findByText(/已確認 2026-10-17 重開 完成/)).toBeInTheDocument();
    expect(await screen.findByText('已重開')).toHaveClass('badge-ui', 'badge-warn');
    expect(within(screen.getByTestId('cloud-settlement-2')).getByText('重開')).toHaveClass('badge-ui', 'badge-warn');
    expect(repository.reopenDay).toHaveBeenCalledWith({
      commandId, leaseEpoch: 4, dayId: today, expectedDayRevision: 7, expectedSettlementRevision: 1, reason: '補登漏記的繳費',
    });
    expect(screen.getByTestId('cloud-settlement-1')).toHaveTextContent('找零少收 10 元');
    expect(screen.getByTestId('cloud-settlement-2')).toHaveTextContent('補登漏記的繳費');
    expect(await closeForm()).toBeInTheDocument();
  });

  it('prefills a closed-day difference entry, requires its reason, then records and reloads the effective cash', async () => {
    const targetDay = q2Mismatch.previousClosedDayId;
    const closed = dayState({
      dayId: targetDay, status: 'closed', revision: 7, lastSettlementRevision: 1,
      settlements: [version(1, { countedCash: 1000 })], effectiveCash: 1000,
    });
    const recorded = postCloseEntry({ dayId: targetDay, settlementRevision: 1, reason: '中間沒有營業，開店點現金少 50 元' });
    const after = { ...closed, postCloseEntries: [recorded], effectiveCash: 950, seq: 21 };
    repository.read.mockResolvedValueOnce(closed).mockResolvedValueOnce(closed).mockResolvedValue(after);
    repository.readOverview.mockResolvedValue(overview({ seq: 21 }));
    repository.readLedger.mockResolvedValueOnce({ today, goLiveDate: '2026-10-01', anomalies: [q2Mismatch], closedDays: [], seq: 20 });
    const onLedgerChanged = vi.fn();

    renderPage({ initialDayId: targetDay, initialPostCloseEntry: q2Mismatch, onLedgerChanged });

    expect(await screen.findByRole('heading', { name: `${targetDay} 日結` })).toBeInTheDocument();
    expect(screen.getByLabelText('有效關帳現金')).toHaveTextContent('NT$ 1,000');
    const form = await screen.findByRole('form', { name: `${targetDay} 關帳後補記` });
    expect(within(form).getByLabelText('收支方向')).toHaveValue('expense');
    expect(within(form).getByLabelText('金額（元）')).toHaveValue('50');
    expect(within(form).getByLabelText(/原因（必填/)).toHaveValue('');
    fireEvent.submit(form);
    expect(await screen.findByText('關帳後補記原因必須為 1 至 500 個字元。')).toBeInTheDocument();
    expect(repository.recordPostCloseEntry).not.toHaveBeenCalled();

    fireEvent.change(within(form).getByLabelText(/原因（必填/), { target: { value: '中間沒有營業，開店點現金少 50 元' } });
    fireEvent.click(within(form).getByRole('button', { name: '確認補記' }));

    await screen.findByText(/已確認 2026-10-14 關帳後補記 完成/);
    expect(repository.read).toHaveBeenLastCalledWith(targetDay);
    expect(repository.readLedger).toHaveBeenCalledTimes(1);
    expect(repository.recordPostCloseEntry).toHaveBeenCalledWith({
      commandId, leaseEpoch: 4, dayId: targetDay, expectedDayRevision: 7, expectedSettlementRevision: 1,
      direction: 'expense', amount: 50, reason: '中間沒有營業，開店點現金少 50 元',
    });
    expect(onLedgerChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('有效關帳現金')).toHaveTextContent('NT$ 950');
    const history = screen.getByTestId(`post-close-entry-${recorded.entryId}`);
    expect(history).toHaveTextContent('支出');
    expect(history).toHaveTextContent('NT$ 50');
    expect(history).toHaveTextContent('中間沒有營業，開店點現金少 50 元');
    expect(history).toHaveTextContent('測試操作員甲');
    expect(history).not.toHaveTextContent('uid-a');
    expect(history).toHaveTextContent('已計入有效關帳現金');
  });

  it('prefills a positive opening difference as income', async () => {
    const targetDay = q2Mismatch.previousClosedDayId;
    const positiveMismatch: OpeningMismatchAnomaly = {
      ...q2Mismatch, openingCash: 1025, previousEffectiveCash: 1000, difference: 25,
    };
    repository.read.mockResolvedValue(dayState({
      dayId: targetDay, status: 'closed', revision: 7, lastSettlementRevision: 1,
      settlements: [version(1, { countedCash: 1000 })], effectiveCash: 1000,
    }));
    renderPage({ initialDayId: targetDay, initialPostCloseEntry: positiveMismatch });

    const form = await screen.findByRole('form', { name: `${targetDay} 關帳後補記` });
    expect(within(form).getByLabelText('收支方向')).toHaveValue('income');
    expect(within(form).getByLabelText('金額（元）')).toHaveValue('25');
    expect(within(form).getByLabelText(/原因（必填/)).toHaveValue('');
  });

  it('keeps the closed-day summary counted cash and difference on the settlement count after a post-close entry', async () => {
    const targetDay = q2Mismatch.previousClosedDayId;
    const recorded = postCloseEntry({ dayId: targetDay, settlementRevision: 1, reason: '中間沒有營業，開店點現金少 50 元' });
    repository.read.mockResolvedValue(dayState({
      dayId: targetDay, status: 'closed', revision: 8, lastSettlementRevision: 1,
      settlements: [version(1, { countedCash: 1160, difference: -10 })],
      postCloseEntries: [recorded], effectiveCash: 1110,
    }));
    renderPage({ initialDayId: targetDay });

    expect(await screen.findByRole('heading', { name: `${targetDay} 日結` })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /^實點現金/ })).toHaveTextContent('NT$ 1,160');
    expect(screen.getByRole('group', { name: /^差額/ })).toHaveTextContent('−NT$ 10');
    expect(screen.getByLabelText('有效關帳現金')).toHaveTextContent('NT$ 1,110');
  });

  it('補記歷史的操作者欄：自己顯示操作員名稱，其他人顯示「其他操作員」，不出現 UID（#668）', async () => {
    const targetDay = q2Mismatch.previousClosedDayId;
    const mine = postCloseEntry({ entryId: 'entry-mine', dayId: targetDay, createdBy: 'uid-a' });
    const others = postCloseEntry({ entryId: 'entry-others', dayId: targetDay, createdBy: 'uid-someone-else' });
    repository.read.mockResolvedValue(dayState({
      dayId: targetDay, status: 'closed', revision: 8, lastSettlementRevision: 1,
      settlements: [version(1)], postCloseEntries: [mine, others], effectiveCash: 1110,
    }));
    renderPage({ initialDayId: targetDay });

    const mineRow = await screen.findByTestId('post-close-entry-entry-mine');
    const othersRow = screen.getByTestId('post-close-entry-entry-others');
    expect(within(mineRow).getAllByRole('cell')[3]).toHaveTextContent('測試操作員甲');
    expect(within(othersRow).getAllByRole('cell')[3]).toHaveTextContent('其他操作員');
    expect(screen.queryByText(/uid-someone-else/)).not.toBeInTheDocument();
    expect(within(mineRow).queryByText(/uid-a/)).not.toBeInTheDocument();
  });

  it('does not split or submit an anomaly amount above the single-entry limit', async () => {
    const targetDay = q2Mismatch.previousClosedDayId;
    const oversizedMismatch: OpeningMismatchAnomaly = {
      ...q2Mismatch, openingCash: 21_001, previousEffectiveCash: 1000, difference: 20_001,
    };
    repository.read.mockResolvedValue(dayState({
      dayId: targetDay, status: 'closed', revision: 7, lastSettlementRevision: 1,
      settlements: [version(1, { countedCash: 1000 })], effectiveCash: 1000,
    }));
    renderPage({ initialDayId: targetDay, initialPostCloseEntry: oversizedMismatch });

    const form = await screen.findByRole('form', { name: `${targetDay} 關帳後補記` });
    expect(await screen.findByText(/超過單筆補記上限 NT\$ 20,000/)).toBeInTheDocument();
    expect(within(form).getByLabelText('金額（元）')).toHaveValue('20001');
    expect(within(form).getByRole('button', { name: '確認補記' })).toBeDisabled();
    expect(repository.recordPostCloseEntry).not.toHaveBeenCalled();
  });

  it('does not write a stale anomaly draft and requires confirmation of refreshed numbers and revisions', async () => {
    const targetDay = q2Mismatch.previousClosedDayId;
    const originallyShown = dayState({
      dayId: targetDay, status: 'closed', revision: 7, lastSettlementRevision: 1,
      settlements: [version(1, { countedCash: 1000 })], effectiveCash: 1000,
    });
    const updatedMismatch: OpeningMismatchAnomaly = {
      ...q2Mismatch, openingCash: 1075, previousClosedDayId: targetDay, previousCountedCash: 1000,
      previousEffectiveCash: 1000, difference: 75,
    };
    const updatedDay = { ...originallyShown, revision: 8, lastSettlementRevision: 2, settlements: [version(1), version(2)] };
    repository.read.mockResolvedValueOnce(originallyShown).mockResolvedValueOnce(updatedDay).mockResolvedValueOnce(updatedDay);
    repository.readLedger.mockResolvedValueOnce({ today, goLiveDate: '2026-10-01', anomalies: [updatedMismatch], closedDays: [], seq: 21 })
      .mockResolvedValueOnce({ today, goLiveDate: '2026-10-01', anomalies: [updatedMismatch], closedDays: [], seq: 21 });
    renderPage({ initialDayId: targetDay, initialPostCloseEntry: q2Mismatch });

    const form = await screen.findByRole('form', { name: `${targetDay} 關帳後補記` });
    fireEvent.change(within(form).getByLabelText(/原因（必填/), { target: { value: '核對時使用的原因' } });
    fireEvent.click(within(form).getByRole('button', { name: '確認補記' }));

    expect(await screen.findByText(/資料已更新，補記沒有送出/)).toBeInTheDocument();
    expect(within(form).getByLabelText('收支方向')).toHaveValue('income');
    expect(within(form).getByLabelText('金額（元）')).toHaveValue('75');
    expect(within(form).getByLabelText(/原因（必填/)).toHaveValue('');
    expect(within(form).getByLabelText('我已核對更新後的差額與關帳現金')).not.toBeChecked();
    expect(repository.recordPostCloseEntry).not.toHaveBeenCalled();

    fireEvent.click(within(form).getByLabelText('我已核對更新後的差額與關帳現金'));
    fireEvent.change(within(form).getByLabelText(/原因（必填/), { target: { value: '更新後確認為多 75 元' } });
    fireEvent.click(within(form).getByRole('button', { name: '確認補記' }));

    await waitFor(() => expect(repository.recordPostCloseEntry).toHaveBeenCalledWith({
      commandId, leaseEpoch: 4, dayId: targetDay, expectedDayRevision: 8, expectedSettlementRevision: 2,
      direction: 'income', amount: 75, reason: '更新後確認為多 75 元',
    }));
  });

  it('keeps historical entries on a reopened day without offering a post-close form', async () => {
    const oldEntry = postCloseEntry({ settlementRevision: 1 });
    repository.read.mockResolvedValue(dayState({
      status: 'reopened', revision: 8, lastSettlementRevision: 2,
      settlements: [version(1), version(2, { status: 'reopened', countedCash: null, difference: null })],
      postCloseEntries: [oldEntry], effectiveCash: null,
    }));
    renderPage();
    await screen.findByRole('heading', { name: `${today} 日結` });
    expect(screen.getByTestId(`post-close-entry-${oldEntry.entryId}`)).toHaveTextContent('舊關帳版本，僅供歷史查閱');
    expect(screen.queryByRole('form', { name: `${today} 關帳後補記` })).not.toBeInTheDocument();
  });

  it('recovers an unknown post-close result by a read-only receipt check, without replaying the write', async () => {
    const closed = dayState({ status: 'closed', revision: 7, lastSettlementRevision: 1, settlements: [version(1)] });
    repository.read.mockResolvedValue(closed);
    repository.readLedger.mockResolvedValueOnce({ today, goLiveDate: '2026-10-01', anomalies: [], closedDays: [], seq: 20 });
    repository.recordPostCloseEntry.mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
    repository.confirmPendingIntent.mockResolvedValue({ status: 'matched', receipt: receipt('RecordPostCloseEntry') });
    renderPage();

    const form = await screen.findByRole('form', { name: `${today} 關帳後補記` });
    fireEvent.change(within(form).getByLabelText('金額（元）'), { target: { value: '30' } });
    fireEvent.change(within(form).getByLabelText(/原因（必填/), { target: { value: '補記原因' } });
    fireEvent.click(within(form).getByRole('button', { name: '確認補記' }));
    expect(await screen.findByRole('button', { name: '查詢原命令結果' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));

    await screen.findByText(/已確認 2026-10-17 關帳後補記 完成/);
    expect(repository.confirmPendingIntent).toHaveBeenCalledWith(
      { kind: 'record-post-close-entry', input: expect.objectContaining({ commandId, amount: 30, reason: '補記原因', leaseEpoch: 4 }) },
      'dataset-a', 'uid-a',
    );
    expect(repository.recordPostCloseEntry).toHaveBeenCalledTimes(1);
    expect(repository.readCommand).not.toHaveBeenCalled();
  });

  it('clears post-close form data when authorization is lost', async () => {
    repository.read.mockResolvedValue(dayState({ status: 'closed', revision: 7, lastSettlementRevision: 1, settlements: [version(1)] }));
    repository.readLedger.mockResolvedValueOnce({ today, goLiveDate: '2026-10-01', anomalies: [], closedDays: [], seq: 20 });
    repository.recordPostCloseEntry.mockResolvedValueOnce({ ok: false, error: { code: 'LEASE_LOST', message: 'lease lost' } });
    const report = renderPage();
    const form = await screen.findByRole('form', { name: `${today} 關帳後補記` });
    fireEvent.change(within(form).getByLabelText('金額（元）'), { target: { value: '30' } });
    fireEvent.change(within(form).getByLabelText(/原因（必填/), { target: { value: '機密草稿' } });
    fireEvent.click(within(form).getByRole('button', { name: '確認補記' }));

    expect(await screen.findByText(/授權狀態已失效/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`命令編號 ${commandId}`))).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: `${today} 日結` })).not.toBeInTheDocument();
    expect(screen.queryByText('機密草稿')).not.toBeInTheDocument();
    expect(report).toHaveBeenLastCalledWith('uid-a:4', 'revoked');
  });

  it('lists unclosed days, marks past days without business, and opens a listed day', async () => {
    const past = '2026-10-15';
    repository.readOverview.mockResolvedValue(overview({
      unclosedDays: [
        { dayId: '2026-10-10', status: 'open', openingCash: null, activeTransactionCount: 0, kind: 'no-business', backfill: null },
        { dayId: '2026-10-12', status: 'open', openingCash: null, activeTransactionCount: 3, kind: 'missing-opening', backfill: null },
        { dayId: past, status: 'reopened', openingCash: 500, activeTransactionCount: 2, kind: 'needs-close', backfill: null },
        { dayId: today, status: 'open', openingCash: null, activeTransactionCount: 0, kind: 'missing-opening', backfill: null },
      ],
    }));
    repository.read.mockResolvedValue(dayState({ openingCash: null, expectedCash: null, totals: { ...dayState().totals, activeTransactionCount: 0 } }));
    renderPage();
    expect(await screen.findByTestId('cloud-no-business-days')).toHaveTextContent('2026-10-10');
    expect(screen.getByTestId('cloud-no-business-2026-10-10')).toHaveTextContent('2026-10-10');
    expect(screen.queryByTestId('cloud-unclosed-2026-10-10')).not.toBeInTheDocument();
    expect(screen.getByTestId('cloud-unclosed-2026-10-12')).toHaveTextContent('2026-10-12');
    expect(within(screen.getByTestId('cloud-unclosed-2026-10-12')).getByText('待確認開帳')).toHaveClass('badge-ui', 'badge-warn');
    const reopened = screen.getByTestId(`cloud-unclosed-${past}`);
    expect(reopened).toHaveTextContent('2 筆交易');
    expect(within(reopened).getByText('已重開')).toHaveClass('badge-ui', 'badge-warn');
    // Today is the page's own day (shown by the date row), not a past unclosed day.
    expect(screen.queryByTestId(`cloud-unclosed-${today}`)).not.toBeInTheDocument();
    expect(screen.getByText(/尚未確認開帳現金，不能關帳/)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: `${today} 關帳` })).not.toBeInTheDocument();

    repository.read.mockResolvedValue(dayState({ dayId: past, status: 'reopened', openingCash: 500, expectedCash: 670 }));
    fireEvent.click(screen.getByTestId(`cloud-unclosed-${past}`));
    expect(await screen.findByRole('heading', { name: `${past} 日結` })).toBeInTheDocument();
    expect(repository.read).toHaveBeenLastCalledWith(past);
    expect(screen.getByRole('form', { name: `${past} 關帳` })).toBeInTheDocument();
  });

  it('shows a past day without opening cash or transactions as no business, offers backfill but no close', async () => {
    const past = '2026-10-10';
    repository.read.mockResolvedValue(dayState({
      dayId: past, openingCash: null, expectedCash: null, totals: { ...dayState().totals, activeTransactionCount: 0 },
    }));
    renderPage();
    fireEvent.change(await screen.findByLabelText('查看日期'), { target: { value: past } });
    expect(await screen.findByText('這天沒有開帳現金，也沒有任何交易。')).toBeInTheDocument();
    fireEvent.focus(screen.getByRole('button', { name: '沒有營業的日子說明' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('那天沒有營業就不需關帳');
    expect(screen.queryByRole('form', { name: `${past} 關帳` })).not.toBeInTheDocument();
    expect(screen.getByRole('form', { name: `${past} 補開帳` })).toBeInTheDocument();
  });

  it('backfills a past day that has transactions but no opening cash, then offers the close form', async () => {
    const past = '2026-10-12';
    const missing = dayState({ dayId: past, revision: 5, openingCash: null, expectedCash: null });
    repository.read.mockResolvedValue(missing);
    renderPage();
    fireEvent.change(await screen.findByLabelText('查看日期'), { target: { value: past } });
    expect(await screen.findByText('這天有交易但沒有開帳現金，要先補開帳才能關帳。')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: `${past} 關帳` })).not.toBeInTheDocument();
    const form = screen.getByRole('form', { name: `${past} 補開帳` });

    for (const value of ['', '-5', '10.5', '20001']) {
      fireEvent.change(within(form).getByRole('textbox', { name: '開帳現金（元）' }), { target: { value } });
      fireEvent.submit(form);
      expect(await screen.findByText(/開帳現金必須明確輸入 0 至 20,000 元的整數/)).toBeInTheDocument();
    }
    fireEvent.change(within(form).getByRole('textbox', { name: '開帳現金（元）' }), { target: { value: '1000' } });
    fireEvent.change(within(form).getByRole('textbox', { name: /補開帳原因/ }), { target: { value: '   ' } });
    fireEvent.submit(form);
    expect(await screen.findByText('補開帳原因必須為 1 至 500 個字元。')).toBeInTheDocument();
    expect(repository.backfillOpening).not.toHaveBeenCalled();

    repository.read.mockResolvedValue(dayState({ dayId: past, revision: 6, openingCash: 1000, expectedCash: 1170 }));
    fireEvent.change(within(form).getByRole('textbox', { name: /補開帳原因/ }), { target: { value: ' 當天網路中斷 ' } });
    fireEvent.click(within(form).getByRole('button', { name: '確認補開帳' }));
    expect(await screen.findByText(/已確認 2026-10-12 補開帳 完成/)).toBeInTheDocument();
    expect(repository.backfillOpening).toHaveBeenCalledWith({
      commandId, leaseEpoch: 4, dayId: past, expectedDayRevision: 5, openingCash: 1000, reason: '當天網路中斷',
    });
    expect(screen.queryByRole('form', { name: `${past} 補開帳` })).not.toBeInTheDocument();
    expect(screen.getByRole('form', { name: `${past} 關帳` })).toBeInTheDocument();
  });

  it('offers no backfill for today, a closed past day or a past day that already has opening cash', async () => {
    repository.read.mockResolvedValue(dayState({ openingCash: null, expectedCash: null }));
    renderPage();
    expect(await screen.findByText(/尚未確認開帳現金，不能關帳/)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: `${today} 補開帳` })).not.toBeInTheDocument();

    const past = '2026-10-12';
    for (const state of [
      dayState({ dayId: past, status: 'closed', openingCash: null, expectedCash: null }),
      dayState({ dayId: past, openingCash: 500, expectedCash: 670 }),
    ]) {
      repository.read.mockResolvedValue(state);
      fireEvent.change(screen.getByLabelText('查看日期'), { target: { value: past } });
      expect(await screen.findByRole('heading', { name: `${past} 日結` })).toBeInTheDocument();
      expect(screen.queryByRole('form', { name: `${past} 補開帳` })).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('查看日期'), { target: { value: today } });
      repository.read.mockResolvedValue(dayState({ openingCash: null, expectedCash: null }));
      expect(await screen.findByRole('heading', { name: `${today} 日結` })).toBeInTheDocument();
    }
    expect(repository.backfillOpening).not.toHaveBeenCalled();
  });

  it('keeps the command ID after an unknown result and confirms it by a read-only receipt check', async () => {
    repository.closeDay.mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
    repository.confirmPendingIntent.mockResolvedValue({ status: 'matched', receipt: receipt('CloseDay') });
    const report = renderPage();
    const form = await closeForm();
    fireEvent.change(within(form).getByRole('textbox', { name: '實點現金（元）' }), { target: { value: '1170' } });
    fireEvent.click(within(form).getByRole('button', { name: '確認關帳' }));
    expect(await screen.findByText('結果確認中，請勿重複操作。')).toBeInTheDocument();
    await waitFor(() => expect(report).toHaveBeenLastCalledWith('uid-a:4', 'recovering'));
    expect(screen.queryByRole('form', { name: `${today} 關帳` })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
    expect(await screen.findByText(/已確認 2026-10-17 關帳 完成/)).toBeInTheDocument();
    expect(repository.confirmPendingIntent).toHaveBeenCalledTimes(1);
    expect(repository.readCommand).not.toHaveBeenCalled();
    expect(repository.closeDay).toHaveBeenCalledTimes(1);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
    // 導覽狀態由 commit 後的 effect 回報，CI 較慢時會晚於成功訊息出現。
    await waitFor(() => expect(report).toHaveBeenLastCalledWith('uid-a:4', 'resolved'));
  });

  it('explains a revision conflict and asks for a reload instead of resending', async () => {
    repository.closeDay.mockResolvedValueOnce({ ok: false, error: { code: 'REVISION_CONFLICT', message: 'conflict' } });
    renderPage();
    const form = await closeForm();
    fireEvent.change(within(form).getByRole('textbox', { name: '實點現金（元）' }), { target: { value: '1170' } });
    fireEvent.click(within(form).getByRole('button', { name: '確認關帳' }));
    expect(await screen.findByText(/關帳未完成：營業日在你操作期間有新的異動/)).toBeInTheDocument();
    expect(repository.closeDay).toHaveBeenCalledTimes(1);
  });

  it('clears the day and keeps only the command ID when the lease is lost', async () => {
    repository.closeDay.mockResolvedValueOnce({ ok: false, error: { code: 'LEASE_LOST', message: 'lease lost' } });
    const report = renderPage();
    const form = await closeForm();
    fireEvent.change(within(form).getByRole('textbox', { name: '實點現金（元）' }), { target: { value: '1170' } });
    fireEvent.click(within(form).getByRole('button', { name: '確認關帳' }));
    expect(await screen.findByText(/授權狀態已失效/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`命令編號 ${commandId}`))).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: `${today} 日結` })).not.toBeInTheDocument();
    expect(report).toHaveBeenLastCalledWith('uid-a:4', 'revoked');
  });

  it('no longer mounts the backup block (it moved to F3 › 資料備份, #649)', async () => {
    renderPage();
    await screen.findByRole('heading', { name: `${today} 日結` });
    expect(screen.queryByRole('region', { name: '關帳後備份' })).not.toBeInTheDocument();
  });

  it('fails closed when the server read is incomplete', async () => {
    repository.read.mockRejectedValueOnce({ code: 'INCOMPLETE_SNAPSHOT', message: 'gap' });
    renderPage();
    expect(await screen.findByText(/伺服器日結資料不完整/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: `${today} 日結` })).not.toBeInTheDocument();
  });
});

describe('CloudDayClosePage: ledger warnings (contract §11)', () => {
  const unclosedLedger: CloudLedgerView = {
    status: 'ready',
    snapshot: {
      today, goLiveDate: '2026-10-01', closedDays: [], seq: 20,
      anomalies: [
        { kind: 'unclosed-past-day', dayId: '2026-10-14', status: 'open', openingCash: 500, activeTransactionCount: 1 },
        { kind: 'unclosed-past-day', dayId: '2026-10-15', status: 'open', openingCash: 600, activeTransactionCount: 2 },
        { kind: 'opening-mismatch', dayId: '2026-10-16', openingCash: 1, previousClosedDayId: '2026-10-13', previousCountedCash: 2, previousPostCloseNet: 0, previousEffectiveCash: 2, difference: -1, daysApart: 3, gapDays: [], gapDayCount: 0 },
      ],
    },
  };
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue(commandId) });
    repository.readOverview.mockResolvedValue(overview());
    repository.read.mockResolvedValue(dayState());
    repository.closeDay.mockResolvedValue(successful('CloseDay'));
    repository.readCommand.mockResolvedValue(null);
  });

  function renderWithLedger(ledger: CloudLedgerView | undefined, extra: {
    onOpenAnomalies?: () => void; onLedgerChanged?: () => void; initialDayId?: string;
  } = {}) {
    render(
      <CloudDayClosePage
        db={{} as Firestore}
        leaseEpoch={4}
        identityKey="uid-a:4"
        ledger={ledger}
        {...extra}
      />,
    );
  }

  it('does not show the ledger banner on this page (the unclosed past days are the page\'s own warning, #648 R8)', async () => {
    renderWithLedger(unclosedLedger);
    await closeForm();
    expect(screen.queryByLabelText('過去未關帳警示')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看帳務異常' })).not.toBeInTheDocument();
  });

  it('opens on the day sent from the anomalies page', async () => {
    const day = '2026-10-15';
    repository.readOverview.mockResolvedValue(overview({
      unclosedDays: [{ dayId: day, status: 'open', openingCash: 600, activeTransactionCount: 2, kind: 'needs-close', backfill: null }],
    }));
    repository.read.mockResolvedValue(dayState({ dayId: day }));
    renderWithLedger(unclosedLedger, { initialDayId: day });
    expect(await screen.findByRole('heading', { name: `${day} 日結` })).toBeInTheDocument();
    expect(repository.read).toHaveBeenCalledWith(day);
    expect(repository.read).not.toHaveBeenCalledWith(today);
  });

  it('asks the parent to re-read the ledger after a confirmed command', async () => {
    const onLedgerChanged = vi.fn();
    repository.readOverview.mockResolvedValueOnce(overview()).mockResolvedValue(overview({ unclosedDays: [], seq: 21 }));
    repository.read
      .mockResolvedValueOnce(dayState())
      .mockResolvedValue(dayState({ status: 'closed', revision: 7, lastSettlementRevision: 1, settlements: [version(1)], seq: 21 }));
    renderWithLedger(unclosedLedger, { onLedgerChanged });
    const form = await closeForm();
    expect(onLedgerChanged).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByRole('textbox', { name: '實點現金（元）' }), { target: { value: '1170' } });
    fireEvent.click(within(form).getByRole('button', { name: '確認關帳' }));
    await screen.findByText(/已確認 2026-10-17 關帳 完成/);
    expect(onLedgerChanged).toHaveBeenCalledTimes(1);
  });
});


describe('CloudDayClosePage: backfill (contract §13)', () => {
  const gap = '2026-10-14';
  const previousClosed = { dayId: '2026-10-12', countedCash: 870 };
  const ids = [
    '00000000-0000-4000-8000-0000000000a1',
    '00000000-0000-4000-8000-0000000000a2',
    '00000000-0000-4000-8000-0000000000a3',
    '00000000-0000-4000-8000-0000000000a4',
  ];
  const marker = {
    dayId: gap, reason: '那天斷線', startedBy: 'uid-a', startedAt: new Date('2026-10-17T01:00:00.000Z'), commandId: ids[2],
  };
  const noTotals = { ...dayState().totals, activeTransactionCount: 0 };
  const gapOverview = (backfill: typeof marker | null = null, withDay = false) => overview({
    unclosedDays: withDay
      ? [{
        dayId: gap, status: 'open', openingCash: backfill ? 870 : null, activeTransactionCount: 0,
        kind: backfill ? 'needs-close' : 'no-business', backfill,
      }]
      : [],
  });
  const gapDay = (revision: number, openingCash: number | null) => dayState({
    dayId: gap, revision, openingCash, expectedCash: openingCash, totals: noTotals,
  });

  // Receipts must carry the command ID that was sent, or the page rightly refuses them.
  const echoing = (kind: CommandReceipt['kind']) => async (input: { commandId: string; dayId: string }): Promise<CommandResult> => ({
    ok: true,
    receipt: { ...receipt(kind), commandId: input.commandId, targets: { dayId: input.dayId } },
  });

  beforeEach(() => {
    vi.resetAllMocks();
    repository.readOverview.mockResolvedValue(overview());
    repository.read.mockResolvedValue(dayState());
    repository.closeDay.mockResolvedValue(successful('CloseDay'));
    repository.reopenDay.mockResolvedValue(successful('ReopenDay'));
    repository.backfillOpening.mockImplementation(echoing('BackfillOpeningCash'));
    repository.ensureDay.mockImplementation(echoing('EnsureDay'));
    repository.startBackfill.mockImplementation(echoing('StartBackfill'));
    repository.readCommand.mockResolvedValue(null);
    const queue = [...ids];
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockImplementation(() => queue.shift() ?? commandId) });
    repository.findPreviousClosed.mockResolvedValue({ previous: previousClosed, seq: 20 });
    repository.findNextOpened.mockResolvedValue({ next: null, seq: 20 });
  });

  function renderAt(dayId: string, extra: { onOpenOrders?: (dayId: string) => void } = {}) {
    render(
      <CloudDayClosePage
        db={{} as Firestore}
        leaseEpoch={4}
        identityKey="uid-a:4"
        initialDayId={dayId}
        {...extra}
      />,
    );
  }

  async function startForm(label = `${gap} 回填`) {
    return screen.findByRole('form', { name: label });
  }

  it('creates the day, confirms the opening cash and marks the backfill, each step with its own command ID', async () => {
    repository.readOverview
      .mockResolvedValueOnce(gapOverview())
      .mockResolvedValueOnce(gapOverview(null, true))
      .mockResolvedValueOnce(gapOverview(null, true))
      .mockResolvedValue(gapOverview(marker, true));
    repository.read
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(gapDay(1, null))
      .mockResolvedValueOnce(gapDay(2, 870))
      .mockResolvedValue(gapDay(3, 870));
    renderAt(gap);
    const form = await startForm();
    // The opening cash defaults to the previous closed day's counted cash.
    const opening = within(form).getByRole('textbox', { name: /開帳現金（元）/ });
    expect(opening).toHaveValue('870');
    expect(within(form).getByText(/預設為 2026-10-12 關帳的實點/)).toBeInTheDocument();
    fireEvent.change(within(form).getByRole('textbox', { name: /回填原因/ }), { target: { value: ' 那天斷線 ' } });
    fireEvent.click(within(form).getByRole('button', { name: '確認回填這一天' }));

    expect(await screen.findByText(/已標為回填，可以到訂餐頁補登交易/, undefined, { timeout: 5_000 })).toBeInTheDocument();
    expect(repository.ensureDay).toHaveBeenCalledTimes(1);
    expect(repository.ensureDay).toHaveBeenCalledWith({ commandId: ids[0], leaseEpoch: 4, dayId: gap });
    expect(repository.backfillOpening).toHaveBeenCalledTimes(1);
    expect(repository.backfillOpening).toHaveBeenCalledWith({
      commandId: ids[1], leaseEpoch: 4, dayId: gap, expectedDayRevision: 1, openingCash: 870, reason: '那天斷線',
    });
    expect(repository.startBackfill).toHaveBeenCalledTimes(1);
    expect(repository.startBackfill).toHaveBeenCalledWith({
      commandId: ids[2], leaseEpoch: 4, dayId: gap, expectedDayRevision: 2, reason: '那天斷線',
    });
    expect(screen.getByTestId('backfill-info')).toHaveTextContent('那天斷線');
    expect(screen.queryByTestId('backfill-plan-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('backfill-start')).not.toBeInTheDocument();
  }, 15_000);

  it('defaults the opening cash to the previous day\'s effective closing cash when it has post-close entries (contract §15)', async () => {
    repository.findPreviousClosed.mockResolvedValue({ previous: { ...previousClosed, postCloseNet: -50 }, seq: 20 });
    repository.readOverview.mockResolvedValue(gapOverview());
    repository.read.mockResolvedValue(null);
    renderAt(gap);
    const form = await startForm();
    expect(within(form).getByRole('textbox', { name: /開帳現金（元）/ })).toHaveValue(String(previousClosed.countedCash - 50));
    expect(within(form).getByText(/預設為 2026-10-12 關帳的有效現金（含關帳後補記）/)).toBeInTheDocument();
  });

  it('requires a reason, a valid opening cash and, when it differs from the last close, a difference reason', async () => {
    repository.readOverview.mockResolvedValue(gapOverview());
    repository.read.mockResolvedValue(null);
    renderAt(gap);
    const form = await startForm();
    fireEvent.submit(form);
    expect(await screen.findByText('回填原因必須為 1 至 500 個字元。')).toBeInTheDocument();

    fireEvent.change(within(form).getByRole('textbox', { name: /回填原因/ }), { target: { value: '那天斷線' } });
    for (const value of ['', '-5', '10.5', '20001']) {
      fireEvent.change(within(form).getByRole('textbox', { name: /開帳現金（元）/ }), { target: { value } });
      fireEvent.submit(form);
      expect(await screen.findByText(/開帳現金必須明確輸入 0 至 20,000 元的整數/)).toBeInTheDocument();
    }
    fireEvent.change(within(form).getByRole('textbox', { name: /開帳現金（元）/ }), { target: { value: '800' } });
    expect(within(form).getByRole('textbox', { name: /差額原因/ })).toBeInTheDocument();
    expect(within(form).getByText(/少 NT\$ 70/)).toBeInTheDocument();
    fireEvent.submit(form);
    expect(await screen.findByText('開帳現金與上次關帳實點不同，必須填寫 1 至 500 字的差額原因。')).toBeInTheDocument();
    expect(repository.ensureDay).not.toHaveBeenCalled();

    // Back to the default amount: no difference reason is asked for any more.
    fireEvent.change(within(form).getByRole('textbox', { name: /開帳現金（元）/ }), { target: { value: '870' } });
    expect(within(form).queryByRole('textbox', { name: /差額原因/ })).not.toBeInTheDocument();
  });

  it('sends the difference reason with the opening cash and the backfill reason with the marker', async () => {
    repository.readOverview
      .mockResolvedValueOnce(gapOverview())
      .mockResolvedValueOnce(gapOverview(null, true))
      .mockResolvedValueOnce(gapOverview(null, true))
      .mockResolvedValue(gapOverview(marker, true));
    repository.read
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(gapDay(1, null))
      .mockResolvedValueOnce(gapDay(2, 800))
      .mockResolvedValue(gapDay(3, 800));
    renderAt(gap);
    const form = await startForm();
    fireEvent.change(within(form).getByRole('textbox', { name: /回填原因/ }), { target: { value: '那天斷線' } });
    fireEvent.change(within(form).getByRole('textbox', { name: /開帳現金（元）/ }), { target: { value: '800' } });
    fireEvent.change(within(form).getByRole('textbox', { name: /差額原因/ }), { target: { value: '抽屜少了 70 元' } });
    fireEvent.click(within(form).getByRole('button', { name: '確認回填這一天' }));
    await screen.findByText(/已標為回填/, undefined, { timeout: 5_000 });
    expect(repository.backfillOpening).toHaveBeenCalledWith(expect.objectContaining({ openingCash: 800, reason: '抽屜少了 70 元' }));
    expect(repository.startBackfill).toHaveBeenCalledWith(expect.objectContaining({ reason: '那天斷線' }));
  }, 15_000);

  it('stops at the failed step, says where, and continues from that step without creating the day again', async () => {
    repository.backfillOpening
      .mockResolvedValueOnce({ ok: false, error: { code: 'REVISION_CONFLICT', message: 'conflict' } })
      .mockImplementation(echoing('BackfillOpeningCash'));
    repository.readOverview
      .mockResolvedValueOnce(gapOverview())
      .mockResolvedValueOnce(gapOverview(null, true))
      .mockResolvedValueOnce(gapOverview(null, true))
      .mockResolvedValueOnce(gapOverview(null, true))
      .mockResolvedValue(gapOverview(marker, true));
    repository.read
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(gapDay(1, null))
      .mockResolvedValueOnce(gapDay(1, null))
      .mockResolvedValueOnce(gapDay(2, 870))
      .mockResolvedValue(gapDay(3, 870));
    renderAt(gap);
    const form = await startForm();
    fireEvent.change(within(form).getByRole('textbox', { name: /回填原因/ }), { target: { value: '那天斷線' } });
    fireEvent.click(within(form).getByRole('button', { name: '確認回填這一天' }));

    expect(await screen.findByText(/2026-10-14 補開帳未完成.*回填 2026-10-14 停在這一步/, undefined, { timeout: 5_000 })).toBeInTheDocument();
    expect(repository.ensureDay).toHaveBeenCalledTimes(1);
    expect(repository.startBackfill).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: '重新載入伺服器資料' })[0]);
    expect(await screen.findByTestId('backfill-plan-panel', undefined, { timeout: 5_000 })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('backfill-continue'));

    expect(await screen.findByText(/已標為回填/, undefined, { timeout: 5_000 })).toBeInTheDocument();
    expect(repository.ensureDay).toHaveBeenCalledTimes(1);
    expect(repository.backfillOpening).toHaveBeenCalledTimes(2);
    // A definite rejection created nothing, so the retry is a new command with the current revision.
    expect(repository.backfillOpening.mock.calls[1][0]).toMatchObject({ commandId: ids[2], expectedDayRevision: 1, openingCash: 870 });
    expect(repository.startBackfill).toHaveBeenCalledTimes(1);
  }, 15_000);

  it('keeps the command ID of an unknown result, confirms it read-only, and carries on only when the operator continues', async () => {
    repository.ensureDay.mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
    repository.confirmPendingIntent.mockResolvedValue({
      status: 'matched', receipt: { ...receipt('EnsureDay'), commandId: ids[0], targets: { dayId: gap } },
    });
    repository.readOverview
      .mockResolvedValueOnce(gapOverview())
      .mockResolvedValueOnce(gapOverview(null, true))
      .mockResolvedValueOnce(gapOverview(null, true))
      .mockResolvedValue(gapOverview(marker, true));
    repository.read
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(gapDay(1, null))
      .mockResolvedValueOnce(gapDay(2, 870))
      .mockResolvedValue(gapDay(3, 870));
    renderAt(gap);
    const form = await startForm();
    fireEvent.change(within(form).getByRole('textbox', { name: /回填原因/ }), { target: { value: '那天斷線' } });
    fireEvent.click(within(form).getByRole('button', { name: '確認回填這一天' }));
    expect(await screen.findByText('結果確認中，請勿重複操作。')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`命令編號 ${ids[0]}`))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
    // A receipt found by an explicit query is not an automatic go-ahead: the operator continues the plan.
    fireEvent.click(await screen.findByTestId('backfill-continue', undefined, { timeout: 5_000 }));
    expect(await screen.findByText(/已標為回填/, undefined, { timeout: 5_000 })).toBeInTheDocument();
    expect(repository.confirmPendingIntent).toHaveBeenCalledWith(
      { kind: 'ensure-day', input: { commandId: ids[0], leaseEpoch: 4, dayId: gap } }, 'dataset-a', 'uid-a',
    );
    expect(repository.ensureDay).toHaveBeenCalledTimes(1);
    expect(repository.backfillOpening).toHaveBeenCalledTimes(1);
    expect(repository.startBackfill).toHaveBeenCalledTimes(1);
  }, 15_000);

  it('cannot start while the previous closed day is unknown, and retries the lookup', async () => {
    repository.readOverview.mockResolvedValue(gapOverview());
    repository.read.mockResolvedValue(null);
    repository.findPreviousClosed
      .mockRejectedValueOnce({ code: 'OFFLINE', message: 'offline' })
      .mockResolvedValue({ previous: previousClosed, seq: 20 });
    renderAt(gap);
    const form = await startForm();
    expect(await screen.findByTestId('backfill-previous-error')).toHaveTextContent('無法查詢上一個已關帳日的實點現金');
    expect(within(form).getByRole('button', { name: '確認回填這一天' })).toBeDisabled();
    expect(repository.ensureDay).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('backfill-previous-retry'));
    await waitFor(() => expect(screen.queryByTestId('backfill-previous-error')).not.toBeInTheDocument());
    expect(repository.findPreviousClosed).toHaveBeenCalledTimes(2);
    const reloaded = await startForm();
    expect(within(reloaded).getByRole('textbox', { name: /開帳現金（元）/ })).toHaveValue('870');
    expect(within(reloaded).getByRole('button', { name: '確認回填這一天' })).toBeEnabled();
  });

  it('marks an existing open past day as backfilled with one command when its opening cash is already confirmed', async () => {
    repository.readOverview
      .mockResolvedValueOnce(overview({
        unclosedDays: [{ dayId: gap, status: 'open', openingCash: 870, activeTransactionCount: 2, kind: 'needs-close', backfill: null }],
      }))
      .mockResolvedValue(overview({
        unclosedDays: [{ dayId: gap, status: 'open', openingCash: 870, activeTransactionCount: 2, kind: 'needs-close', backfill: marker }],
      }));
    repository.read
      .mockResolvedValueOnce(dayState({ dayId: gap, revision: 4, openingCash: 870, expectedCash: 1040 }))
      .mockResolvedValue(dayState({ dayId: gap, revision: 4, openingCash: 870, expectedCash: 1040 }));
    renderAt(gap);
    const form = await startForm(`${gap} 標為回填`);
    // No opening cash is asked for, and no previous-day lookup is made.
    expect(within(form).queryByRole('textbox', { name: /開帳現金（元）/ })).not.toBeInTheDocument();
    expect(repository.findPreviousClosed).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByRole('textbox', { name: /回填原因/ }), { target: { value: '那天斷線' } });
    fireEvent.click(within(form).getByRole('button', { name: '確認標為回填' }));
    expect(await screen.findByText(/已標為回填/, undefined, { timeout: 5_000 })).toBeInTheDocument();
    expect(repository.ensureDay).not.toHaveBeenCalled();
    expect(repository.backfillOpening).not.toHaveBeenCalled();
    expect(repository.startBackfill).toHaveBeenCalledWith({
      commandId: ids[0], leaseEpoch: 4, dayId: gap, expectedDayRevision: 4, reason: '那天斷線',
    });
  }, 15_000);

  it('shows a backfilling day with its reason and a way to the orders page, and offers no second start', async () => {
    repository.readOverview.mockResolvedValue(gapOverview(marker, true));
    repository.read.mockResolvedValue(gapDay(3, 870));
    const onOpenOrders = vi.fn();
    renderAt(gap, { onOpenOrders });
    const info = await screen.findByTestId('backfill-info');
    expect(info).toHaveTextContent('2026-10-14 正在回填（原因：那天斷線）');
    expect(screen.queryByTestId('backfill-start')).not.toBeInTheDocument();
    expect(screen.getByTestId(`cloud-unclosed-backfill-${gap}`)).toHaveTextContent('回填中');
    expect(within(screen.getByTestId(`cloud-unclosed-backfill-${gap}`)).getByText('回填中')).toHaveClass('badge-ui', 'badge-warn');
    fireEvent.click(within(info).getByRole('button', { name: `到訂餐頁補登 ${gap}` }));
    expect(onOpenOrders).toHaveBeenCalledWith(gap);
  });

  it('shows a reopened backfilling day as 回填中（已重開） and still offers the way to the orders page (#601)', async () => {
    repository.readOverview.mockResolvedValue(overview({
      unclosedDays: [{ dayId: gap, status: 'reopened', openingCash: 870, activeTransactionCount: 2, kind: 'needs-close', backfill: marker }],
    }));
    repository.read.mockResolvedValue(dayState({
      dayId: gap, status: 'reopened', revision: 7, openingCash: 870, expectedCash: 870, totals: noTotals,
      lastSettlementRevision: 2, settlements: [version(1), version(2)],
    }));
    const onOpenOrders = vi.fn();
    renderAt(gap, { onOpenOrders });
    const info = await screen.findByTestId('backfill-info');
    expect(info).toHaveTextContent('2026-10-14 正在回填（原因：那天斷線）');
    expect(info).toHaveTextContent('這一天關過帳後重開；補登完要再關帳一次，現金仍要與下一天的開帳對齊。');
    const row = screen.getByTestId(`cloud-unclosed-${gap}`);
    expect(within(row).getByText('回填中（已重開）')).toHaveClass('badge-ui', 'badge-warn');
    expect(row).toHaveTextContent('2 筆交易');
    fireEvent.click(within(info).getByRole('button', { name: `到訂餐頁補登 ${gap}` }));
    expect(onOpenOrders).toHaveBeenCalledWith(gap);
  });

  it('keeps the open backfilling day free of the reopened note (#601)', async () => {
    repository.readOverview.mockResolvedValue(gapOverview(marker, true));
    repository.read.mockResolvedValue(gapDay(3, 870));
    renderAt(gap, { onOpenOrders: vi.fn() });
    const info = await screen.findByTestId('backfill-info');
    expect(info).not.toHaveTextContent('關過帳後重開');
    expect(within(screen.getByTestId(`cloud-unclosed-${gap}`)).getByText('回填中')).toBeInTheDocument();
  });

  it.each([
    ['today', today, dayState({ openingCash: null, expectedCash: null })],
    ['a closed past day', gap, dayState({ dayId: gap, status: 'closed', lastSettlementRevision: 1, settlements: [version(1)] })],
    ['a reopened past day that was closed before', gap, dayState({ dayId: gap, status: 'reopened', lastSettlementRevision: 2, settlements: [version(1), version(2)] })],
    ['a day before go-live', '2026-09-30', null],
  ])('offers no backfill for %s', async (_label, dayId, state) => {
    repository.readOverview.mockResolvedValue(overview());
    repository.read.mockResolvedValue(state);
    renderAt(dayId);
    await screen.findByRole('heading', { name: `${dayId} 日結` });
    expect(screen.queryByTestId('backfill-start')).not.toBeInTheDocument();
  });
});

describe('CloudDayClosePage: aligned close of a backfilled day (contract §14)', () => {
  const gap = '2026-10-14';
  const marker = {
    dayId: gap, reason: '那天斷線', startedBy: 'uid-a', startedAt: new Date('2026-10-17T01:00:00.000Z'), commandId: 'c-start',
  };
  const gapOverview = (backfill: typeof marker | null) => overview({
    unclosedDays: [{ dayId: gap, status: 'open', openingCash: 1000, activeTransactionCount: 2, kind: 'needs-close', backfill }],
  });
  // Opening 1,000 and 50 of receipts leave 1,050 as the expected cash of the back-filled day.
  const gapDay = (retainedReceipts: number) => dayState({
    dayId: gap, openingCash: 1000, expectedCash: 1000 + retainedReceipts,
    totals: { ...dayState().totals, retainedReceipts, cashierIncome: 0, cashierExpense: 0 },
  });

  function renderAt(dayId: string, extra: { onOpenOrders?: (dayId: string) => void } = {}) {
    render(<CloudDayClosePage db={{} as Firestore} leaseEpoch={4} identityKey="uid-a:4" initialDayId={dayId} {...extra} />);
  }

  beforeEach(() => {
    vi.resetAllMocks();
    repository.readOverview.mockResolvedValue(gapOverview(marker));
    repository.read.mockResolvedValue(gapDay(-50));
    repository.closeDay.mockImplementation(async (input: { commandId: string; dayId: string }): Promise<CommandResult> => ({
      ok: true, receipt: { ...receipt('CloseDay'), commandId: input.commandId, targets: { dayId: input.dayId } },
    }));
    repository.findNextOpened.mockResolvedValue({ next: { dayId: '2026-10-16', openingCash: 950 }, seq: 20 });
    repository.readCommand.mockResolvedValue(null);
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue(commandId) });
  });

  it('shows the alignment day and amount, defaults the count to it and closes with alignWithDayId', async () => {
    renderAt(gap);
    expect(await screen.findByTestId('backfill-align-target')).toHaveTextContent('須等於 2026-10-16 的開帳現金 NT$ 950');
    expect(repository.findNextOpened).toHaveBeenCalledWith(gap);
    const form = screen.getByRole('form', { name: `${gap} 關帳` });
    expect(within(form).getByRole('textbox', { name: /實點現金/ })).toHaveValue('950');
    expect(screen.queryByTestId('backfill-align-gap')).not.toBeInTheDocument();
    fireEvent.click(within(form).getByRole('button', { name: '確認關帳' }));
    await waitFor(() => expect(repository.closeDay).toHaveBeenCalledTimes(1));
    expect(repository.closeDay).toHaveBeenCalledWith(expect.objectContaining({
      dayId: gap, countedCash: 950, expectedCash: 950, note: '', alignWithDayId: '2026-10-16',
    }));
  });

  it('does not drop a close clicked right after the alignment renders, before passive effects run (CI flake, run 41642144001)', async () => {
    // Click from a MutationObserver: it runs right after React commits the alignment, before the passive effects of that
    // commit are flushed, which is the window a loaded CI runner hit.
    let clicked = false;
    const observer = new MutationObserver(() => {
      if (clicked) return;
      const target = document.querySelector('[data-testid="backfill-align-target"]');
      const submit = document.querySelector<HTMLButtonElement>('[data-testid="close-submit"]');
      if (!target?.textContent?.includes('須等於') || !submit || submit.disabled) return;
      clicked = true;
      fireEvent.click(submit);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    try {
      renderAt(gap);
      await waitFor(() => expect(clicked).toBe(true));
      await waitFor(() => expect(repository.closeDay).toHaveBeenCalledTimes(1), { timeout: 3_000 });
      expect(repository.closeDay).toHaveBeenCalledWith(expect.objectContaining({ dayId: gap, alignWithDayId: '2026-10-16' }));
    } finally {
      observer.disconnect();
    }
  });

  it('blocks the close, says how much is missing and points to the back-fill mode when the cash does not match', async () => {
    repository.read.mockResolvedValue(gapDay(0));
    const onOpenOrders = vi.fn();
    renderAt(gap, { onOpenOrders });
    const gapNote = await screen.findByTestId('backfill-align-gap');
    expect(gapNote).toHaveTextContent('差 NT$ 50，不能關帳');
    expect(gapNote).toHaveTextContent('回到訂餐頁的回填模式');
    expect(screen.getByRole('button', { name: '確認關帳' })).toBeDisabled();
    fireEvent.click(within(gapNote).getByRole('button', { name: `到訂餐頁補登 ${gap}` }));
    expect(onOpenOrders).toHaveBeenCalledWith(gap);
    expect(repository.closeDay).not.toHaveBeenCalled();
  });

  it('refuses a count that differs from the aligned cash even when a note is given', async () => {
    renderAt(gap);
    const form = await screen.findByRole('form', { name: `${gap} 關帳` });
    fireEvent.change(within(form).getByRole('textbox', { name: /實點現金/ }), { target: { value: '940' } });
    fireEvent.change(within(form).getByRole('textbox', { name: /備註/ }), { target: { value: '少了十元' } });
    fireEvent.click(within(form).getByRole('button', { name: '確認關帳' }));
    expect(await screen.findByText(/回填日的實點必須等於 NT\$ 950/)).toBeInTheDocument();
    expect(repository.closeDay).not.toHaveBeenCalled();
  });

  it('closes with a null alignment when no later day is opened', async () => {
    repository.findNextOpened.mockResolvedValue({ next: null, seq: 20 });
    renderAt(gap);
    expect(await screen.findByTestId('backfill-align-target')).toHaveTextContent('之後沒有已開帳的日子');
    const form = screen.getByRole('form', { name: `${gap} 關帳` });
    expect(within(form).getByRole('textbox', { name: /實點現金/ })).toHaveValue('950');
    fireEvent.click(within(form).getByRole('button', { name: '確認關帳' }));
    await waitFor(() => expect(repository.closeDay).toHaveBeenCalledTimes(1));
    expect(repository.closeDay).toHaveBeenCalledWith(expect.objectContaining({ countedCash: 950, alignWithDayId: null }));
  });

  it('disables the close with a retry when the alignment day cannot be looked up', async () => {
    repository.findNextOpened.mockRejectedValueOnce(new Error('連線中斷')).mockResolvedValue({ next: null, seq: 20 });
    renderAt(gap);
    expect(await screen.findByTestId('backfill-align-error')).toHaveTextContent('連線中斷');
    expect(screen.getByRole('button', { name: '確認關帳' })).toBeDisabled();
    fireEvent.click(screen.getByTestId('backfill-align-retry'));
    await waitFor(() => expect(screen.getByRole('button', { name: '確認關帳' })).toBeEnabled());
  });

  it('leaves an ordinary day alone: no lookup, no alignment, a difference with a note still closes', async () => {
    repository.readOverview.mockResolvedValue(overview());
    repository.read.mockResolvedValue(dayState());
    renderAt(today);
    const form = await screen.findByRole('form', { name: `${today} 關帳` });
    expect(repository.findNextOpened).not.toHaveBeenCalled();
    expect(screen.queryByTestId('backfill-align')).not.toBeInTheDocument();
    fireEvent.change(within(form).getByRole('textbox', { name: /實點現金/ }), { target: { value: '1160' } });
    fireEvent.change(within(form).getByRole('textbox', { name: /差額原因/ }), { target: { value: '找錯錢' } });
    fireEvent.click(within(form).getByRole('button', { name: '確認關帳' }));
    await waitFor(() => expect(repository.closeDay).toHaveBeenCalledTimes(1));
    const sent = repository.closeDay.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent).toMatchObject({ countedCash: 1160, expectedCash: 1170, note: '找錯錢' });
    expect(Object.hasOwn(sent, 'alignWithDayId')).toBe(false);
  });
});


describe('CloudDayClosePage: same-page command recovery (P13b2b2c)', () => {
  const gap = '2026-10-14';
  const ids = [
    '00000000-0000-4000-8000-0000000000b1',
    '00000000-0000-4000-8000-0000000000b2',
    '00000000-0000-4000-8000-0000000000b3',
  ];
  const marker = {
    dayId: gap, reason: '那天斷線', startedBy: 'uid-a', startedAt: new Date('2026-10-17T01:00:00.000Z'), commandId: ids[2],
  };
  const noTotals = { ...dayState().totals, activeTransactionCount: 0 };
  const gapOverview = (backfill: typeof marker | null = null, withDay = false) => overview({
    unclosedDays: withDay
      ? [{
        dayId: gap, status: 'open', openingCash: backfill ? 870 : null, activeTransactionCount: 0,
        kind: backfill ? 'needs-close' : 'no-business', backfill,
      }]
      : [],
  });
  const gapDay = (revision: number, openingCash: number | null) => dayState({
    dayId: gap, revision, openingCash, expectedCash: openingCash, totals: noTotals,
  });
  const echoing = (kind: CommandReceipt['kind']) => async (input: { commandId: string; dayId: string }): Promise<CommandResult> => ({
    ok: true,
    receipt: { ...receipt(kind), commandId: input.commandId, targets: { dayId: input.dayId } },
  });
  const unknown: CommandResult = { ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } };

  type Element = Parameters<typeof render>[0];
  // One Firestore instance per test file run: a rerender with a new instance would be a different owner.
  const stableDb = {} as Firestore;
  const flush = async (turns = 12) => act(async () => { for (let index = 0; index < turns; index += 1) await Promise.resolve(); });

  function pageElement(props: {
    identityKey?: string; leaseEpoch?: number; hasUnresolved?: boolean; initialDayId?: string;
    onLedgerChanged?: () => void; onNavigationStateChange?: (key: string, state: 'recovering' | 'revoked' | 'resolved') => void;
    initialPostCloseEntry?: OpeningMismatchAnomaly; db?: Firestore;
  } = {}): Element {
    return (
      <CloudDayClosePage
        db={props.db ?? stableDb}
        leaseEpoch={props.leaseEpoch ?? 4}
        identityKey={props.identityKey ?? 'uid-a:4'}
        initialDayId={props.initialDayId}
        initialPostCloseEntry={props.initialPostCloseEntry}
        onLedgerChanged={props.onLedgerChanged}
        onNavigationStateChange={props.onNavigationStateChange}
        hasUnresolvedPendingCommands={props.hasUnresolved ?? false}
      />
    );
  }

  const closedSnapshotRefresh = () => {
    repository.readOverview.mockResolvedValue(overview({ unclosedDays: [], seq: 21 }));
    repository.read.mockResolvedValue(dayState({ status: 'closed', revision: 7, lastSettlementRevision: 1, settlements: [version(1)], seq: 21 }));
  };

  async function submitClose(form: HTMLElement, counted = '1170') {
    fireEvent.change(within(form).getByRole('textbox', { name: '實點現金（元）' }), { target: { value: counted } });
    fireEvent.submit(form);
  }

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue(commandId) });
    repository.readOverview.mockResolvedValue(overview());
    repository.read.mockResolvedValue(dayState());
    repository.closeDay.mockResolvedValue(successful('CloseDay'));
    repository.reopenDay.mockResolvedValue(successful('ReopenDay'));
    repository.recordPostCloseEntry.mockResolvedValue(successful('RecordPostCloseEntry'));
    repository.findPreviousClosed.mockResolvedValue({ previous: null, seq: 20 });
    repository.findNextOpened.mockResolvedValue({ next: null, seq: 20 });
    repository.readLedger.mockResolvedValue({ today, goLiveDate: '2026-10-01', anomalies: [], closedDays: [], seq: 20 });
  });

  describe('typed intents', () => {
    it('sends close, reopen, post-close and opening backfill as typed intents with the same canonical input', async () => {
      render(pageElement());
      const form = await closeForm();
      await submitClose(form);
      await screen.findByText(/已確認 2026-10-17 關帳 完成/);
      expect(repository.commitDayCloseIntent).toHaveBeenLastCalledWith({
        kind: 'close-day',
        input: {
          commandId, leaseEpoch: 4, dayId: today, expectedDayRevision: 6, expectedSettlementRevision: 0,
          expectedCash: 1170, countedCash: 1170, note: '',
        },
      }, expect.any(Function));
    });

    it('sends reopen-day and record-post-close-entry intents', async () => {
      repository.read.mockResolvedValue(dayState({ status: 'closed', revision: 7, lastSettlementRevision: 1, settlements: [version(1)] }));
      render(pageElement());
      fireEvent.click(await screen.findByRole('button', { name: '重開這一天' }));
      const reopen = screen.getByRole('form', { name: `${today} 重開` });
      fireEvent.change(within(reopen).getByRole('textbox', { name: /重開原因/ }), { target: { value: '補登漏記' } });
      fireEvent.submit(reopen);
      await screen.findByText(/已確認 2026-10-17 重開 完成/);
      expect(repository.commitDayCloseIntent).toHaveBeenLastCalledWith({
        kind: 'reopen-day',
        input: { commandId, leaseEpoch: 4, dayId: today, expectedDayRevision: 7, expectedSettlementRevision: 1, reason: '補登漏記' },
      }, expect.any(Function));

      const entry = await screen.findByRole('form', { name: `${today} 關帳後補記` });
      fireEvent.change(within(entry).getByLabelText('金額（元）'), { target: { value: '30' } });
      fireEvent.change(within(entry).getByLabelText(/原因（必填/), { target: { value: '補記原因' } });
      fireEvent.submit(entry);
      await screen.findByText(/已確認 2026-10-17 關帳後補記 完成/);
      expect(repository.commitDayCloseIntent).toHaveBeenLastCalledWith({
        kind: 'record-post-close-entry',
        input: {
          commandId, leaseEpoch: 4, dayId: today, expectedDayRevision: 7, expectedSettlementRevision: 1,
          direction: 'income', amount: 30, reason: '補記原因',
        },
      }, expect.any(Function));
    });

    it('sends the opening backfill intent for a past day without opening cash', async () => {
      repository.readOverview.mockResolvedValue(overview({
        unclosedDays: [{ dayId: gap, status: 'open', openingCash: null, activeTransactionCount: 2, kind: 'missing-opening', backfill: null }],
      }));
      repository.read.mockResolvedValue(dayState({ dayId: gap, openingCash: null, expectedCash: null }));
      render(pageElement({ initialDayId: gap }));
      const form = await screen.findByRole('form', { name: `${gap} 補開帳` });
      fireEvent.change(within(form).getByRole('textbox', { name: /開帳現金/ }), { target: { value: '870' } });
      fireEvent.change(within(form).getByRole('textbox', { name: /補開帳原因/ }), { target: { value: '那天斷線' } });
      fireEvent.submit(form);
      await waitFor(() => expect(repository.commitDayCloseIntent).toHaveBeenCalled());
      expect(repository.commitDayCloseIntent).toHaveBeenLastCalledWith({
        kind: 'backfill-opening',
        input: { commandId, leaseEpoch: 4, dayId: gap, expectedDayRevision: 6, openingCash: 870, reason: '那天斷線' },
      }, expect.any(Function));
    });
  });

  describe('single flight, ten seconds and read-only query', () => {
    it('keeps a close single-flight and shows the fixed prompt exactly at ten seconds without a second commit', async () => {
      vi.useFakeTimers();
      try {
        let resolveClose!: (result: CommandResult) => void;
        repository.closeDay.mockReturnValueOnce(new Promise<CommandResult>(resolve => { resolveClose = resolve; }));
        render(pageElement());
        await flush();
        const form = screen.getByRole('form', { name: `${today} 關帳` });
        await submitClose(form);
        fireEvent.submit(form);
        await flush(2);
        expect(repository.closeDay).toHaveBeenCalledTimes(1);
        // Before ten seconds only the progress bar says "sending" (#585): no recovery panel.
        expect(screen.queryByRole('alert', { name: '命令結果確認' })).not.toBeInTheDocument();
        expect(screen.getByTestId('command-progress')).toHaveAttribute('data-active', 'true');
        await act(async () => { vi.advanceTimersByTime(9_999); });
        expect(screen.queryByText('結果確認中，勿重新收款')).not.toBeInTheDocument();
        await act(async () => { vi.advanceTimersByTime(1); });
        expect(screen.getByText('結果確認中，勿重新收款')).toBeInTheDocument();
        expect(screen.getByText(new RegExp(`命令編號 ${commandId}`))).toBeInTheDocument();
        expect(repository.confirmPendingIntent).not.toHaveBeenCalled();
        await act(async () => resolveClose(unknown));
        expect(repository.closeDay).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not authorize a retry from a query that started before the original settled, then retries the frozen input after a fresh null', async () => {
      vi.useFakeTimers();
      try {
        let settleClose!: (result: CommandResult) => void;
        let resolveEarly!: (result: { status: 'not-found' }) => void;
        repository.closeDay.mockReturnValueOnce(new Promise<CommandResult>(resolve => { settleClose = resolve; }));
        repository.confirmPendingIntent.mockReturnValueOnce(new Promise(resolve => { resolveEarly = resolve; }));
        render(pageElement());
        await flush();
        await submitClose(screen.getByRole('form', { name: `${today} 關帳` }));
        await flush(2);
        await act(async () => { vi.advanceTimersByTime(10_000); });
        fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
        expect(repository.confirmPendingIntent).toHaveBeenCalledOnce();

        await act(async () => settleClose(unknown));
        await act(async () => resolveEarly({ status: 'not-found' }));
        expect(repository.closeDay).toHaveBeenCalledOnce();
        expect(screen.queryByRole('button', { name: '以相同命令編號重試' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
        await flush();
        expect(repository.confirmPendingIntent).toHaveBeenCalledTimes(2);
        fireEvent.click(screen.getByRole('button', { name: '以相同命令編號重試' }));
        await flush();
        expect(repository.hasOtherUnresolvedCommands).toHaveBeenCalledWith(commandId);
        expect(repository.closeDay).toHaveBeenCalledTimes(2);
        expect(repository.closeDay.mock.calls[0][0]).toEqual(repository.closeDay.mock.calls[1][0]);
        expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it.each([
      ['a reader failure', () => repository.confirmPendingIntent.mockRejectedValueOnce({ code: 'OFFLINE', message: 'reader unavailable' }), /查詢錯誤不代表命令不存在，暫不可重試/],
      ['a same-ID semantic mismatch', () => repository.confirmPendingIntent.mockRejectedValueOnce({ code: 'INVALID_INPUT', message: 'differs' }), /命令編號已存在，但伺服器內容與原操作不符/],
    ])('does not commit again after %s', async (_label, arrange, message) => {
      repository.closeDay.mockResolvedValueOnce(unknown);
      arrange();
      render(pageElement());
      await submitClose(await closeForm());
      fireEvent.click(await screen.findByRole('button', { name: '查詢原命令結果' }));
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(repository.closeDay).toHaveBeenCalledOnce();
      expect(screen.queryByRole('button', { name: '以相同命令編號重試' })).not.toBeInTheDocument();
    });
  });

  describe('confirmed receipt versus fresh data', () => {
    async function heldClose(options: { onLedgerChanged?: () => void; onNavigationStateChange?: (key: string, state: 'recovering' | 'revoked' | 'resolved') => void } = {}) {
      let resolveClose!: (result: CommandResult) => void;
      repository.closeDay.mockReturnValueOnce(new Promise<CommandResult>(resolve => { resolveClose = resolve; }));
      repository.confirmPendingIntent.mockResolvedValueOnce({ status: 'matched', receipt: receipt('CloseDay') });
      render(pageElement(options));
      await flush();
      await submitClose(screen.getByRole('form', { name: `${today} 關帳` }));
      await flush(2);
      await act(async () => { vi.advanceTimersByTime(10_000); });
      return { resolveClose };
    }

    it('keeps the receipt, navigation and controls locked until the same-scope snapshot, then refreshes the ledger once', async () => {
      vi.useFakeTimers();
      try {
        const onLedgerChanged = vi.fn();
        const onNavigationStateChange = vi.fn();
        const { resolveClose } = await heldClose({ onLedgerChanged, onNavigationStateChange });
        let resolveFresh!: (value: unknown) => void;
        repository.loadSnapshot.mockReturnValueOnce(new Promise(resolve => { resolveFresh = resolve; }) as never);
        fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
        await flush();

        expect(repository.cleanupConfirmedIntent).toHaveBeenCalledOnce();
        expect(repository.loadSnapshot).toHaveBeenCalledTimes(2);
        const recovery = screen.getByRole('alert', { name: '命令結果確認' });
        expect(recovery).toHaveTextContent('已找到伺服器回執，資料尚待再次讀取。');
        expect(recovery).toHaveTextContent(commandId);
        expect(screen.queryByRole('form', { name: `${today} 關帳` })).not.toBeInTheDocument();
        expect(onLedgerChanged).not.toHaveBeenCalled();
        expect(onNavigationStateChange).toHaveBeenLastCalledWith('uid-a:4', 'recovering');

        closedSnapshotRefresh();
        await act(async () => resolveFresh({
          datasetId: 'dataset-a',
          overview: overview({ unclosedDays: [], seq: 21 }),
          dayId: today,
          day: dayState({ status: 'closed', revision: 7, lastSettlementRevision: 1, settlements: [version(1)], seq: 21 }),
          backfill: null, previous: null, align: null,
        }));
        expect(screen.getByText(/已確認 2026-10-17 關帳 完成/)).toBeInTheDocument();
        expect(onLedgerChanged).toHaveBeenCalledTimes(1);

        await act(async () => resolveClose(unknown));
        expect(onLedgerChanged).toHaveBeenCalledTimes(1);
        expect(repository.closeDay).toHaveBeenCalledOnce();
        expect(repository.loadSnapshot).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the confirmed result and retries only the read when the full snapshot fails', async () => {
      vi.useFakeTimers();
      try {
        const onLedgerChanged = vi.fn();
        await heldClose({ onLedgerChanged });
        repository.loadSnapshot.mockRejectedValueOnce({ code: 'OFFLINE', message: 'offline' });
        fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
        await flush();
        expect(screen.getByText(/已找到命令回執，但伺服器資料尚未重新讀取/)).toBeInTheDocument();
        expect(screen.getByRole('alert', { name: '命令結果確認' })).toHaveTextContent(commandId);
        expect(onLedgerChanged).not.toHaveBeenCalled();

        closedSnapshotRefresh();
        fireEvent.click(screen.getAllByRole('button', { name: '重新讀取伺服器資料' }).at(-1)!);
        await flush();
        expect(screen.getByText(/已確認 2026-10-17 關帳 完成/)).toBeInTheDocument();
        expect(repository.closeDay).toHaveBeenCalledOnce();
        expect(repository.cleanupConfirmedIntent).toHaveBeenCalledOnce();
        expect(onLedgerChanged).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it.each([
      ['dataset', () => { repository.dataset.id = 'replacement-dataset'; }],
      ['day', () => {
        repository.loadSnapshot.mockResolvedValueOnce({
          datasetId: 'dataset-a', overview: overview(), dayId: '2026-10-16',
          day: dayState({ dayId: '2026-10-16', openingCash: 9999, expectedCash: 9999 }),
          backfill: null, previous: null, align: null,
        } as never);
      }],
    ])('blocks a confirmed result whose refreshed %s differs, including manual reloads', async (_label, arrange) => {
      vi.useFakeTimers();
      try {
        const onLedgerChanged = vi.fn();
        const { resolveClose } = await heldClose({ onLedgerChanged });
        arrange();
        repository.read.mockResolvedValue(dayState({ openingCash: 9999, expectedCash: 9999 }));
        fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
        await flush();
        expect(screen.getByText(/命令回執已確認，但伺服器資料集或營業日已變更/)).toBeInTheDocument();
        expect(screen.getByRole('alert', { name: '命令結果確認' })).toHaveTextContent(commandId);
        expect(screen.queryByText('NT$ 9,999')).not.toBeInTheDocument();
        expect(screen.queryByText(/已確認 2026-10-17 關帳 完成/)).not.toBeInTheDocument();

        arrange();
        fireEvent.click(screen.getAllByRole('button', { name: '重新讀取伺服器資料' }).at(-1)!);
        await flush();
        expect(screen.getByText(/命令回執已確認，但伺服器資料集或營業日已變更/)).toBeInTheDocument();
        expect(screen.queryByText('NT$ 9,999')).not.toBeInTheDocument();
        expect(onLedgerChanged).not.toHaveBeenCalled();
        expect(repository.closeDay).toHaveBeenCalledOnce();
        await act(async () => resolveClose(unknown));
        expect(screen.getByRole('alert', { name: '命令結果確認' })).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('cleanup authority', () => {
    it.each(['LEASE_LOST', 'UNAUTHORIZED'] as const)('revokes the confirmed operation at once when cleanup observes %s', async code => {
      const onLedgerChanged = vi.fn();
      const onNavigationStateChange = vi.fn();
      repository.cleanupConfirmedIntent.mockRejectedValueOnce({ code, message: 'authority changed' });
      render(pageElement({ onLedgerChanged, onNavigationStateChange }));
      await submitClose(await closeForm());
      expect(await screen.findByText(/授權狀態已失效/)).toBeInTheDocument();
      const recovery = screen.getByRole('alert', { name: '命令結果確認' });
      expect(recovery).toHaveTextContent(commandId);
      expect(screen.queryByRole('heading', { name: `${today} 日結` })).not.toBeInTheDocument();
      expect(screen.queryByText(/已確認 2026-10-17 關帳 完成/)).not.toBeInTheDocument();
      expect(repository.closeDay).toHaveBeenCalledOnce();
      expect(repository.loadSnapshot).toHaveBeenCalledOnce();
      expect(onLedgerChanged).not.toHaveBeenCalled();
      await waitFor(() => expect(onNavigationStateChange).toHaveBeenLastCalledWith('uid-a:4', 'revoked'));
    });

    it('keeps a confirmed result with a warning and refreshes once when only the local journal cleanup fails', async () => {
      const onLedgerChanged = vi.fn();
      repository.cleanupConfirmedIntent.mockRejectedValueOnce({ code: 'LOCAL_STORAGE_UNAVAILABLE', message: 'local journal unavailable' });
      render(pageElement({ onLedgerChanged }));
      const form = await closeForm();
      closedSnapshotRefresh();
      await submitClose(form);
      expect(await screen.findByText(/已確認 2026-10-17 關帳 完成/)).toBeInTheDocument();
      expect(screen.getByText(/本機命令追蹤清理未完成；伺服器回執仍已確認/)).toBeInTheDocument();
      expect(repository.closeDay).toHaveBeenCalledOnce();
      expect(repository.loadSnapshot).toHaveBeenCalledTimes(2);
      expect(onLedgerChanged).toHaveBeenCalledOnce();
    });
  });

  // #585 P2: a command is answered quietly: no text panel while sending, the page keeps its content while it re-reads after the
  // receipt, and the success sentence is a short toast (no sequence number); a local cleanup warning stays visible.
  describe('#585 quiet command feedback', () => {
    const toastText = () => screen.getByTestId('toast').querySelector('.toast__text')?.textContent ?? null;

    it('shows no text panel while a close is being sent: only the progress bar', async () => {
      let resolveClose!: (result: CommandResult) => void;
      repository.closeDay.mockReturnValueOnce(new Promise<CommandResult>(resolve => { resolveClose = resolve; }));
      render(pageElement());
      await submitClose(await closeForm());
      await waitFor(() => expect(repository.closeDay).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('alert', { name: '命令結果確認' })).not.toBeInTheDocument();
      expect(screen.queryByText(/命令送出中/)).not.toBeInTheDocument();
      expect(screen.getByTestId('command-progress')).toHaveAttribute('data-active', 'true');
      closedSnapshotRefresh();
      await act(async () => resolveClose(successful('CloseDay')));
      await waitFor(() => expect(toastText()).toBe('已確認 2026-10-17 關帳 完成'));
    });

    it('keeps the previous content in place, locked, while it re-reads after the receipt', async () => {
      render(pageElement());
      const form = await closeForm();
      let finishRead!: () => void;
      repository.read.mockImplementationOnce(() => new Promise(resolve => {
        finishRead = () => resolve(dayState({ status: 'closed', revision: 7, lastSettlementRevision: 1, settlements: [version(1)], seq: 21 }));
      }));
      repository.readOverview.mockResolvedValue(overview({ unclosedDays: [], seq: 21 }));
      await submitClose(form);
      await waitFor(() => expect(repository.loadSnapshot).toHaveBeenCalledTimes(2));

      expect(screen.queryByText('正在從伺服器載入日結資料…')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert', { name: '命令結果確認' })).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: `${today} 日結` })).toBeInTheDocument();
      expect(screen.getByTestId('cloud-day-close-content')).toHaveAttribute('inert');
      expect(screen.queryByTestId('toast')).not.toBeInTheDocument();
      expect(screen.getByTestId('command-progress')).toHaveAttribute('data-active', 'true');

      await act(async () => finishRead());
      await waitFor(() => expect(toastText()).toBe('已確認 2026-10-17 關帳 完成'));
      expect(screen.getByTestId('cloud-day-close-content')).not.toHaveAttribute('inert');
      expect(screen.queryByText(/命令序號|伺服器資料已重新讀取/)).not.toBeInTheDocument();
    });

    it('does not keep the previous content when the lease is lost during the re-read (fail closed)', async () => {
      render(pageElement());
      const form = await closeForm();
      let failRead!: () => void;
      repository.read.mockImplementationOnce(() => new Promise((_, reject) => {
        failRead = () => reject(Object.assign(new Error('lease lost'), { code: 'LEASE_LOST' }));
      }));
      repository.readOverview.mockResolvedValue(overview({ unclosedDays: [], seq: 21 }));
      await submitClose(form);
      await waitFor(() => expect(repository.loadSnapshot).toHaveBeenCalledTimes(2));
      expect(screen.getByRole('heading', { name: `${today} 日結` })).toBeInTheDocument();

      await act(async () => failRead());
      expect(await screen.findByText(/授權狀態已失效/)).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: `${today} 日結` })).not.toBeInTheDocument();
      expect(screen.queryByTestId('cloud-day-close-content')).not.toBeInTheDocument();
    });

    it('shows a local cleanup warning as a lasting alert, not inside the toast', async () => {
      repository.cleanupConfirmedIntent.mockRejectedValueOnce({ code: 'LOCAL_STORAGE_UNAVAILABLE', message: 'local journal unavailable' });
      render(pageElement());
      const form = await closeForm();
      closedSnapshotRefresh();
      await submitClose(form);
      await waitFor(() => expect(toastText()).toBe('已確認 2026-10-17 關帳 完成'));
      expect(screen.getAllByRole('alert').some(node => /本機命令追蹤清理未完成；伺服器回執仍已確認/.test(node.textContent ?? ''))).toBe(true);
      expect(screen.getByTestId('toast')).not.toHaveTextContent('本機命令追蹤');
    });
  });

  describe('§7.4 close restriction', () => {
    it('refuses a new close when the shared unresolved state turns true before submit or while preflight awaits', async () => {
      const view = render(pageElement());
      const form = await closeForm();
      view.rerender(pageElement({ hasUnresolved: true }));
      await submitClose(form);
      await flush();
      expect(repository.closeDay).not.toHaveBeenCalled();
      expect(repository.commitDayCloseIntent).not.toHaveBeenCalled();
    });

    it('rechecks the shared unresolved state immediately before the commit', async () => {
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      repository.commitDayCloseIntent.mockImplementationOnce(async (intent: { input: unknown }, guard?: () => boolean | Promise<boolean>) => {
        await gate;
        if (guard && !(await guard())) throw Object.assign(new Error('guard rejected'), { name: 'CloudDayCloseGuardRejected' });
        return repository.closeDay(intent.input);
      });
      const view = render(pageElement());
      await submitClose(await closeForm());
      await flush();
      view.rerender(pageElement({ hasUnresolved: true }));
      await act(async () => { release(); });
      await flush();
      expect(repository.closeDay).not.toHaveBeenCalled();
      expect(await screen.findByText(/尚有待核對命令/)).toBeInTheDocument();
    });

    it('allows a same-ID close retry only while no other pending identity exists and never rewrites the shared flag', async () => {
      vi.useFakeTimers();
      try {
        repository.closeDay.mockResolvedValueOnce(unknown).mockResolvedValue(successful('CloseDay'));
        repository.confirmPendingIntent.mockResolvedValue({ status: 'not-found' });
        const view = render(pageElement());
        await flush();
        await submitClose(screen.getByRole('form', { name: `${today} 關帳` }));
        await flush();
        // The boundary now sees this operation's own identity, so the shared flag is true while it is unresolved.
        view.rerender(pageElement({ hasUnresolved: true }));
        fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
        await flush();
        repository.hasOtherUnresolvedCommands.mockResolvedValueOnce(true);
        fireEvent.click(screen.getByRole('button', { name: '以相同命令編號重試' }));
        await flush();
        expect(repository.hasOtherUnresolvedCommands).toHaveBeenCalledWith(commandId);
        expect(repository.closeDay).toHaveBeenCalledTimes(1);
        expect(screen.getByText(/尚有其他待核對命令/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
        await flush();
        closedSnapshotRefresh();
        fireEvent.click(screen.getByRole('button', { name: '以相同命令編號重試' }));
        await flush();
        expect(repository.closeDay).toHaveBeenCalledTimes(2);
        expect(repository.closeDay.mock.calls[0][0]).toEqual(repository.closeDay.mock.calls[1][0]);
        expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('scope fences', () => {
    it('masks the first render after the Firestore instance changes and ignores the old operation', async () => {
      vi.useFakeTimers();
      try {
        let resolveClose!: (result: CommandResult) => void;
        repository.closeDay.mockReturnValueOnce(new Promise<CommandResult>(resolve => { resolveClose = resolve; }));
        const onLedgerChanged = vi.fn();
        const view = render(pageElement({ onLedgerChanged }));
        await flush();
        await submitClose(screen.getByRole('form', { name: `${today} 關帳` }));
        await flush(2);
        expect(screen.getByTestId('command-progress')).toHaveAttribute('data-active', 'true');

        // Same user, same lease, but a different database instance is a different owner.
        view.rerender(pageElement({ onLedgerChanged, db: {} as Firestore }));
        expect(screen.queryByRole('alert', { name: '命令結果確認' })).not.toBeInTheDocument();
        expect(screen.queryByText(new RegExp(commandId))).not.toBeInTheDocument();
        await flush();
        await act(async () => resolveClose(successful('CloseDay')));
        await flush();
        expect(screen.queryByText(/已確認 2026-10-17 關帳 完成/)).not.toBeInTheDocument();
        expect(repository.cleanupConfirmedIntent).not.toHaveBeenCalled();
        expect(repository.confirmPendingIntent).not.toHaveBeenCalled();
        expect(onLedgerChanged).not.toHaveBeenCalled();
        expect(repository.closeDay).toHaveBeenCalledOnce();
        expect(screen.getByRole('form', { name: `${today} 關帳` })).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('masks the first render after a UID, epoch or identity change and ignores the old operation', async () => {
      vi.useFakeTimers();
      try {
        let resolveClose!: (result: CommandResult) => void;
        repository.closeDay.mockReturnValueOnce(new Promise<CommandResult>(resolve => { resolveClose = resolve; }));
        const onLedgerChanged = vi.fn();
        const view = render(pageElement({ onLedgerChanged }));
        await flush();
        await submitClose(screen.getByRole('form', { name: `${today} 關帳` }));
        await flush(2);
        expect(screen.getByTestId('command-progress')).toHaveAttribute('data-active', 'true');

        currentAuth.uid = 'uid-b';
        view.rerender(pageElement({ identityKey: 'uid-b:5', leaseEpoch: 5, onLedgerChanged }));
        // Before any effect or promise runs, the committed render shows nothing of the old scope.
        expect(screen.queryByRole('alert', { name: '命令結果確認' })).not.toBeInTheDocument();
        expect(screen.queryByText(new RegExp(commandId))).not.toBeInTheDocument();
        await flush();
        await act(async () => resolveClose(successful('CloseDay')));
        await flush();
        expect(screen.queryByText(/已確認 2026-10-17 關帳 完成/)).not.toBeInTheDocument();
        expect(repository.cleanupConfirmedIntent).not.toHaveBeenCalled();
        expect(onLedgerChanged).not.toHaveBeenCalled();
        expect(repository.closeDay).toHaveBeenCalledOnce();
        expect(screen.getByRole('form', { name: `${today} 關帳` })).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('drops an unmounted page operation without confirming or cleaning anything', async () => {
      vi.useFakeTimers();
      try {
        let resolveClose!: (result: CommandResult) => void;
        repository.closeDay.mockReturnValueOnce(new Promise<CommandResult>(resolve => { resolveClose = resolve; }));
        const view = render(pageElement());
        await flush();
        await submitClose(screen.getByRole('form', { name: `${today} 關帳` }));
        await flush(2);
        view.unmount();
        await act(async () => resolveClose(successful('CloseDay')));
        await act(async () => { vi.advanceTimersByTime(20_000); });
        expect(repository.cleanupConfirmedIntent).not.toHaveBeenCalled();
        expect(repository.confirmPendingIntent).not.toHaveBeenCalled();
        expect(repository.loadSnapshot).toHaveBeenCalledOnce();
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not submit a post-close entry when the owner changes while the stale-reference preflight awaits', async () => {
      const mismatch: OpeningMismatchAnomaly = {
        kind: 'opening-mismatch', dayId: '2026-10-15', openingCash: 950, previousClosedDayId: '2026-10-14',
        previousCountedCash: 1000, previousPostCloseNet: 0, previousEffectiveCash: 1000, difference: -50, daysApart: 1,
        gapDays: [], gapDayCount: 0,
      };
      const closed = dayState({ dayId: '2026-10-14', status: 'closed', revision: 7, lastSettlementRevision: 1, settlements: [version(1, { countedCash: 1000 })], effectiveCash: 1000 });
      repository.read.mockResolvedValue(closed);
      let resolveLedger!: (value: unknown) => void;
      repository.readLedger.mockReturnValueOnce(new Promise(resolve => { resolveLedger = resolve; }));
      const view = render(pageElement({ initialDayId: '2026-10-14', initialPostCloseEntry: mismatch }));
      const form = await screen.findByRole('form', { name: '2026-10-14 關帳後補記' });
      fireEvent.change(within(form).getByLabelText(/原因（必填/), { target: { value: '開店少 50 元' } });
      fireEvent.submit(form);
      await flush(3);
      currentAuth.uid = 'uid-b';
      view.rerender(pageElement({ identityKey: 'uid-b:5', leaseEpoch: 5, initialDayId: '2026-10-14' }));
      await act(async () => resolveLedger({ today, goLiveDate: '2026-10-01', anomalies: [mismatch], closedDays: [], seq: 20 }));
      await flush();
      expect(repository.recordPostCloseEntry).not.toHaveBeenCalled();
      expect(repository.commitDayCloseIntent).not.toHaveBeenCalled();
    });
  });

  describe('backfill steps', () => {
    async function startGapBackfill() {
      // No findBy*: it never advances vitest's fake clock, so wait on promise turns instead.
      await flush();
      const form = screen.getByRole('form', { name: `${gap} 回填` });
      fireEvent.change(within(form).getByRole('textbox', { name: /開帳現金（元）/ }), { target: { value: '870' } });
      fireEvent.change(within(form).getByRole('textbox', { name: /回填原因/ }), { target: { value: '那天斷線' } });
      fireEvent.change(within(form).getByRole('textbox', { name: /開帳現金（元）/ }), { target: { value: '870' } });
      fireEvent.click(within(form).getByRole('button', { name: '確認回填這一天' }));
    }

    beforeEach(() => {
      const queue = [...ids];
      vi.stubGlobal('crypto', { randomUUID: vi.fn().mockImplementation(() => queue.shift() ?? commandId) });
      repository.findPreviousClosed.mockResolvedValue({ previous: { dayId: '2026-10-12', countedCash: 870 }, seq: 20 });
      repository.ensureDay.mockImplementation(echoing('EnsureDay'));
      repository.backfillOpening.mockImplementation(echoing('BackfillOpeningCash'));
      repository.startBackfill.mockImplementation(echoing('StartBackfill'));
    });

    // StrictMode mounts the page's load effect twice, so its initial read is served twice there.
    function arrangeThreeStepServer(initialLoads = 1) {
      for (let load = 0; load < initialLoads; load += 1) {
        repository.readOverview.mockResolvedValueOnce(gapOverview());
        repository.read.mockResolvedValueOnce(null);
      }
      repository.readOverview
        .mockResolvedValueOnce(gapOverview(null, true))
        .mockResolvedValueOnce(gapOverview(null, true))
        .mockResolvedValue(gapOverview(marker, true));
      repository.read
        .mockResolvedValueOnce(gapDay(1, null))
        .mockResolvedValueOnce(gapDay(2, 870))
        .mockResolvedValue(gapDay(3, 870));
    }

    it('sends ensure-day, opening backfill and start-backfill intents with their own IDs, each exactly once under StrictMode', async () => {
      arrangeThreeStepServer(2);
      render(<StrictMode>{pageElement({ initialDayId: gap })}</StrictMode>);
      await startGapBackfill();
      expect(await screen.findByText(/已標為回填，可以到訂餐頁補登交易/, undefined, { timeout: 5_000 })).toBeInTheDocument();
      expect(repository.commitDayCloseIntent.mock.calls.map(call => (call[0] as { kind: string }).kind))
        .toEqual(['ensure-day', 'backfill-opening', 'start-backfill']);
      expect(repository.commitDayCloseIntent.mock.calls.map(call => (call[0] as { input: { commandId: string } }).input.commandId)).toEqual(ids);
      expect(repository.ensureDay).toHaveBeenCalledTimes(1);
      expect(repository.backfillOpening).toHaveBeenCalledTimes(1);
      expect(repository.startBackfill).toHaveBeenCalledTimes(1);
    }, 15_000);

    it('does not advance on a receipt found while the original response is still held, only on an explicit continue', async () => {
      vi.useFakeTimers();
      try {
        arrangeThreeStepServer();
        let releaseEnsure!: (result: CommandResult) => void;
        repository.ensureDay.mockReturnValueOnce(new Promise<CommandResult>(resolve => { releaseEnsure = resolve; }));
        repository.confirmPendingIntent.mockResolvedValueOnce({
          status: 'matched', receipt: { ...receipt('EnsureDay'), commandId: ids[0], targets: { dayId: gap } },
        });
        render(pageElement({ initialDayId: gap }));
        await flush();
        await startGapBackfill();
        await flush(2);
        await act(async () => { vi.advanceTimersByTime(10_000); });
        expect(repository.backfillOpening).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
        await flush();
        expect(screen.getByTestId('backfill-continue')).toBeInTheDocument();
        await act(async () => { vi.advanceTimersByTime(5_000); });
        expect(repository.backfillOpening).not.toHaveBeenCalled();
        await act(async () => releaseEnsure(unknown));
        await flush();
        expect(repository.backfillOpening).not.toHaveBeenCalled();
        expect(repository.ensureDay).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByTestId('backfill-continue'));
        await flush(20);
        expect(repository.ensureDay).toHaveBeenCalledTimes(1);
        expect(repository.backfillOpening).toHaveBeenCalledTimes(1);
        expect(repository.backfillOpening.mock.calls[0][0]).toMatchObject({ commandId: ids[1], expectedDayRevision: 1 });
        expect(repository.startBackfill).toHaveBeenCalledTimes(1);
        expect(repository.startBackfill.mock.calls[0][0]).toMatchObject({ commandId: ids[2], expectedDayRevision: 2 });
      } finally {
        vi.useRealTimers();
      }
    });

    it('stops all automatic progress on an unknown step until it is checked', async () => {
      vi.useFakeTimers();
      try {
        arrangeThreeStepServer();
        repository.ensureDay.mockResolvedValueOnce(unknown);
        render(pageElement({ initialDayId: gap }));
        await flush();
        await startGapBackfill();
        await flush();
        await act(async () => { vi.advanceTimersByTime(60_000); });
        expect(repository.ensureDay).toHaveBeenCalledTimes(1);
        expect(repository.backfillOpening).not.toHaveBeenCalled();
        expect(repository.confirmPendingIntent).not.toHaveBeenCalled();
        expect(screen.getByRole('alert', { name: '命令結果確認' })).toHaveTextContent(ids[0]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('cancels a stopped plan when the owner changes and never replays completed steps', async () => {
      arrangeThreeStepServer();
      repository.backfillOpening.mockResolvedValueOnce({ ok: false, error: { code: 'REVISION_CONFLICT', message: 'conflict' } });
      const view = render(pageElement({ initialDayId: gap }));
      await startGapBackfill();
      expect(await screen.findByText(/回填 2026-10-14 停在這一步/)).toBeInTheDocument();
      expect(repository.ensureDay).toHaveBeenCalledTimes(1);

      currentAuth.uid = 'uid-b';
      repository.readOverview.mockResolvedValue(gapOverview(null, true));
      repository.read.mockResolvedValue(gapDay(1, null));
      view.rerender(pageElement({ identityKey: 'uid-b:5', leaseEpoch: 5, initialDayId: gap }));
      await waitFor(() => expect(screen.queryByText(/回填 2026-10-14 停在這一步/)).not.toBeInTheDocument());
      expect(screen.queryByTestId('backfill-plan-panel')).not.toBeInTheDocument();
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(repository.ensureDay).toHaveBeenCalledTimes(1);
      expect(repository.backfillOpening).toHaveBeenCalledTimes(1);
      expect(repository.startBackfill).not.toHaveBeenCalled();
    });

    it('stops automatic progress after the confirmed refresh fails, so a manual reload only reads and the next step needs the explicit continue', async () => {
      arrangeThreeStepServer();
      render(pageElement({ initialDayId: gap }));
      await flush();
      // The page read that follows the confirmed EnsureDay fails (offline); everything after it succeeds.
      repository.loadSnapshot.mockRejectedValueOnce({ code: 'OFFLINE', message: 'offline' });
      await startGapBackfill();
      expect(await screen.findByText(/已找到命令回執，但伺服器資料尚未重新讀取/)).toBeInTheDocument();
      expect(repository.ensureDay).toHaveBeenCalledTimes(1);
      expect(repository.backfillOpening).not.toHaveBeenCalled();

      fireEvent.click(screen.getAllByRole('button', { name: '重新讀取伺服器資料' }).at(-1)!);
      expect(await screen.findByTestId('backfill-continue', undefined, { timeout: 5_000 })).toBeInTheDocument();
      await new Promise(resolve => setTimeout(resolve, 50));
      // An explicit reload only reads.
      expect(repository.backfillOpening).not.toHaveBeenCalled();
      expect(repository.startBackfill).not.toHaveBeenCalled();

      // After a failed refresh this plan never advances by itself: each further step needs its own explicit continue.
      fireEvent.click(screen.getByTestId('backfill-continue'));
      await waitFor(() => expect(repository.backfillOpening).toHaveBeenCalledTimes(1));
      expect(await screen.findByTestId('backfill-continue', undefined, { timeout: 5_000 })).toBeInTheDocument();
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(repository.startBackfill).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId('backfill-continue'));
      expect(await screen.findByText(/已標為回填，可以到訂餐頁補登交易/, undefined, { timeout: 5_000 })).toBeInTheDocument();
      expect(repository.ensureDay).toHaveBeenCalledTimes(1);
      expect(repository.backfillOpening).toHaveBeenCalledTimes(1);
      expect(repository.startBackfill).toHaveBeenCalledTimes(1);
    }, 15_000);
  });
});

describe('CloudDayClosePage: #587 P2 data updated elsewhere', () => {
  const head = (seq: number) => ({ seq, lastCommandId: `cmd-${seq}`, datasetId: 'dataset-a', targets: {} });

  beforeEach(() => {
    vi.resetAllMocks();
    headMock.current = null;
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue(commandId) });
    repository.readOverview.mockResolvedValue(overview());
    repository.read.mockResolvedValue(dayState());
    repository.findPreviousClosed.mockResolvedValue({ previous: null, seq: 20 });
    repository.readCommand.mockResolvedValue(null);
    repository.readLedger.mockResolvedValue({ today, goLiveDate: '2026-10-01', anomalies: [], closedDays: [], seq: 20 });
  });

  it('shows the notice when the data head is ahead of the overview, and its button reloads the page data', async () => {
    headMock.current = head(23);
    renderPage();
    const notice = await screen.findByTestId('data-updated-notice');
    expect(notice).toHaveTextContent('其他裝置已更新資料。');
    const reads = repository.readOverview.mock.calls.length;
    repository.readOverview.mockResolvedValue(overview({ seq: 23 }));
    repository.read.mockResolvedValue(dayState({ seq: 23 }));
    fireEvent.click(within(notice).getByRole('button', { name: '重新載入' }));
    await waitFor(() => expect(repository.readOverview.mock.calls.length).toBeGreaterThan(reads));
    await waitFor(() => expect(screen.queryByTestId('data-updated-notice')).toBeNull());
  });

  it('shows nothing when the page is at the head, or there is no head', async () => {
    headMock.current = head(20);
    renderPage();
    await screen.findByRole('heading', { name: `${today} 日結` });
    expect(screen.queryByTestId('data-updated-notice')).toBeNull();
  });
});

describe('CloudDayClosePage: F2 今日 layout and date auto-load (#648 P4)', () => {
  const past = '2026-10-15';

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue(commandId) });
    repository.readOverview.mockResolvedValue(overview());
    repository.read.mockImplementation(async (dayId: string) => dayState({ dayId }));
    repository.closeDay.mockResolvedValue(successful('CloseDay'));
    repository.findPreviousClosed.mockResolvedValue({ previous: null, seq: 20 });
    repository.readCommand.mockResolvedValue(null);
    repository.readLedger.mockResolvedValue({ today, goLiveDate: '2026-10-01', anomalies: [], closedDays: [], seq: 20 });
  });

  function renderWith(extra: { onOpenAnomalies?: () => void } = {}) {
    render(<CloudDayClosePage db={{} as Firestore} leaseEpoch={4} identityKey="uid-a:4" {...extra} />);
  }

  const dateInput = () => screen.getByLabelText('查看日期');

  describe('date input', () => {
    it('loads a complete valid date as soon as it changes, with no load button', async () => {
      renderWith();
      await screen.findByRole('heading', { name: `${today} 日結` });
      expect(screen.queryByRole('button', { name: '載入日期' })).not.toBeInTheDocument();
      fireEvent.change(dateInput(), { target: { value: past } });
      expect(await screen.findByRole('heading', { name: `${past} 日結` })).toBeInTheDocument();
      expect(repository.read).toHaveBeenLastCalledWith(past);
    });

    it('while typing, waits for Enter before reading, and only reads once', async () => {
      renderWith();
      await screen.findByRole('heading', { name: `${today} 日結` });
      const reads = repository.read.mock.calls.length;
      fireEvent.keyDown(dateInput(), { key: '5' });
      fireEvent.change(dateInput(), { target: { value: past } });
      expect(repository.read).toHaveBeenCalledTimes(reads);
      fireEvent.keyDown(dateInput(), { key: 'Enter' });
      expect(await screen.findByRole('heading', { name: `${past} 日結` })).toBeInTheDocument();
      expect(repository.read).toHaveBeenCalledTimes(reads + 1);
    });

    it('while typing, also reads when the field loses focus', async () => {
      renderWith();
      await screen.findByRole('heading', { name: `${today} 日結` });
      fireEvent.keyDown(dateInput(), { key: '5' });
      fireEvent.change(dateInput(), { target: { value: past } });
      fireEvent.blur(dateInput());
      expect(await screen.findByRole('heading', { name: `${past} 日結` })).toBeInTheDocument();
      expect(repository.read).toHaveBeenLastCalledWith(past);
    });

    it('does not read an incomplete or too-early date and shows the original error', async () => {
      renderWith();
      await screen.findByRole('heading', { name: `${today} 日結` });
      const reads = repository.read.mock.calls.length;
      fireEvent.change(dateInput(), { target: { value: '' } });
      expect(await screen.findByText('日期必須是 2026-10-01 或之後的有效日期。')).toBeInTheDocument();
      fireEvent.change(dateInput(), { target: { value: '2026-09-30' } });
      expect(await screen.findByText('日期必須是 2026-10-01 或之後的有效日期。')).toBeInTheDocument();
      fireEvent.blur(dateInput());
      expect(repository.read).toHaveBeenCalledTimes(reads);
      expect(screen.getByRole('heading', { name: `${today} 日結` })).toBeInTheDocument();
    });

    it('does not show the error while an incomplete date is still being typed', async () => {
      renderWith();
      await screen.findByRole('heading', { name: `${today} 日結` });
      fireEvent.keyDown(dateInput(), { key: '1' });
      fireEvent.change(dateInput(), { target: { value: '' } });
      expect(screen.queryByText('日期必須是 2026-10-01 或之後的有效日期。')).not.toBeInTheDocument();
      fireEvent.blur(dateInput());
      expect(await screen.findByText('日期必須是 2026-10-01 或之後的有效日期。')).toBeInTheDocument();
    });

    it('asks to discard the draft first, and keeps the draft and the day when cancelled', async () => {
      renderWith();
      const form = await closeForm();
      fireEvent.change(within(form).getByRole('textbox', { name: '實點現金（元）' }), { target: { value: '1170' } });
      const reads = repository.read.mock.calls.length;
      fireEvent.change(dateInput(), { target: { value: past } });
      const dialog = await screen.findByRole('dialog', { name: '捨棄草稿？' });
      expect(repository.read).toHaveBeenCalledTimes(reads);
      fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: '捨棄草稿？' })).not.toBeInTheDocument());
      expect(repository.read).toHaveBeenCalledTimes(reads);
      expect(within(await closeForm()).getByRole('textbox', { name: '實點現金（元）' })).toHaveValue('1170');
      expect(dateInput()).toHaveValue(today);
    });

    it('loads the new day and drops the draft once the discard is confirmed', async () => {
      renderWith();
      const form = await closeForm();
      fireEvent.change(within(form).getByRole('textbox', { name: '實點現金（元）' }), { target: { value: '1170' } });
      fireEvent.change(dateInput(), { target: { value: past } });
      const dialog = await screen.findByRole('dialog', { name: '捨棄草稿？' });
      fireEvent.click(within(dialog).getByRole('button', { name: '捨棄並載入' }));
      expect(await screen.findByRole('heading', { name: `${past} 日結` })).toBeInTheDocument();
      expect(within(screen.getByRole('form', { name: `${past} 關帳` })).getByRole('textbox', { name: '實點現金（元）' })).toHaveValue('');
    });

    it('asks before discarding an open reopen form too', async () => {
      repository.read.mockImplementation(async (dayId: string) => dayState({
        dayId, status: 'closed', revision: 7, lastSettlementRevision: 1, settlements: [version(1)],
      }));
      renderWith();
      fireEvent.click(await screen.findByRole('button', { name: '重開這一天' }));
      fireEvent.change(dateInput(), { target: { value: past } });
      expect(await screen.findByRole('dialog', { name: '捨棄草稿？' })).toBeInTheDocument();
    });

    it('loads without asking when there is no draft', async () => {
      renderWith();
      await closeForm();
      fireEvent.change(dateInput(), { target: { value: past } });
      expect(screen.queryByRole('dialog', { name: '捨棄草稿？' })).not.toBeInTheDocument();
      expect(await screen.findByRole('heading', { name: `${past} 日結` })).toBeInTheDocument();
    });

    it('keeps the date field while a day loads, and shows only the last requested day when an earlier read answers late', async () => {
      renderWith();
      await screen.findByRole('heading', { name: `${today} 日結` });
      let resolveSlow: (value: CloudDayCloseState) => void = () => undefined;
      repository.read.mockImplementation((dayId: string) => dayId === past
        ? new Promise<CloudDayCloseState>(resolve => { resolveSlow = resolve; })
        : Promise.resolve(dayState({ dayId })));
      fireEvent.change(dateInput(), { target: { value: past } });
      await waitFor(() => expect(repository.read).toHaveBeenLastCalledWith(past));
      // The field stays mounted while the first request is pending, so a second pick is possible.
      fireEvent.change(dateInput(), { target: { value: '2026-10-16' } });
      expect(await screen.findByRole('heading', { name: '2026-10-16 日結' })).toBeInTheDocument();
      await act(async () => { resolveSlow(dayState({ dayId: past })); });
      expect(screen.getByRole('heading', { name: '2026-10-16 日結' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: `${past} 日結` })).not.toBeInTheDocument();
      expect(dateInput()).toHaveValue('2026-10-16');
    });
  });

  describe('unclosed past days', () => {
    it('shows no list section and one OK status line when no past day is unclosed', async () => {
      repository.readOverview.mockResolvedValue(overview({ unclosedDays: [] }));
      renderWith();
      await screen.findByRole('heading', { name: `${today} 日結` });
      expect(screen.queryByLabelText('未關帳營業日')).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: '未關帳營業日' })).not.toBeInTheDocument();
      expect(screen.getByText('過去沒有未關帳的日子')).toBeInTheDocument();
    });

    it('treats only today as no past unclosed day', async () => {
      renderWith();
      await screen.findByRole('heading', { name: `${today} 日結` });
      expect(screen.getByText('過去沒有未關帳的日子')).toBeInTheDocument();
    });

    it('shows a warning with a date chip per unclosed past day, and a chip loads that day', async () => {
      repository.readOverview.mockResolvedValue(overview({
        unclosedDays: [
          { dayId: past, status: 'open', openingCash: 500, activeTransactionCount: 2, kind: 'needs-close', backfill: null },
          { dayId: today, status: 'open', openingCash: 1000, activeTransactionCount: 4, kind: 'needs-close', backfill: null },
        ],
      }));
      renderWith();
      const section = await screen.findByLabelText('未關帳營業日');
      expect(section).toHaveTextContent('過去有 1 天還沒關帳');
      expect(screen.queryByText('過去沒有未關帳的日子')).not.toBeInTheDocument();
      const chip = within(section).getByRole('button', { name: new RegExp(`${past}.*2 筆交易`) });
      fireEvent.click(chip);
      expect(await screen.findByRole('heading', { name: `${past} 日結` })).toBeInTheDocument();
      expect(repository.read).toHaveBeenLastCalledWith(past);
    });

    it('lists the first days and sends the rest to the anomalies page when there are many', async () => {
      const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
      repository.readOverview.mockResolvedValue(overview({
        unclosedDays: days.map(dayId => ({
          dayId, status: 'open' as const, openingCash: 500, activeTransactionCount: 1, kind: 'needs-close' as const, backfill: null,
        })),
      }));
      const onOpenAnomalies = vi.fn();
      renderWith({ onOpenAnomalies });
      const section = await screen.findByLabelText('未關帳營業日');
      expect(section).toHaveTextContent('過去有 7 天還沒關帳');
      expect(within(section).getAllByRole('button', { name: /筆交易/ })).toHaveLength(5);
      fireEvent.click(within(section).getByRole('button', { name: '到帳務檢查看全部' }));
      expect(onOpenAnomalies).toHaveBeenCalledTimes(1);
    });

    it('does not hide days when there is no anomalies page to send the rest to', async () => {
      const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
      repository.readOverview.mockResolvedValue(overview({
        unclosedDays: days.map(dayId => ({
          dayId, status: 'open' as const, openingCash: 500, activeTransactionCount: 1, kind: 'needs-close' as const, backfill: null,
        })),
      }));
      renderWith();
      const section = await screen.findByLabelText('未關帳營業日');
      expect(within(section).getAllByRole('button', { name: /筆交易/ })).toHaveLength(7);
      expect(within(section).queryByRole('button', { name: '到帳務檢查看全部' })).not.toBeInTheDocument();
    });

    it('moves the no-business explanation into a help tip and keeps its days clickable', async () => {
      repository.readOverview.mockResolvedValue(overview({
        unclosedDays: [{ dayId: '2026-10-10', status: 'open', openingCash: null, activeTransactionCount: 0, kind: 'no-business', backfill: null }],
      }));
      renderWith();
      const region = await screen.findByTestId('cloud-no-business-days');
      expect(region).not.toHaveTextContent('那天沒有營業就不需處理');
      fireEvent.focus(within(region).getByRole('button', { name: '沒有營業日期說明' }));
      expect(await screen.findByRole('tooltip')).toHaveTextContent('那天沒有營業就不需處理');
      fireEvent.click(within(region).getByTestId('cloud-no-business-2026-10-10'));
      expect(await screen.findByRole('heading', { name: '2026-10-10 日結' })).toBeInTheDocument();
    });
  });

  describe('layout and wording', () => {
    it('shows three stat tiles with the difference marked as a warning only when it is not zero', async () => {
      repository.read.mockResolvedValue(dayState({
        status: 'closed', revision: 7, lastSettlementRevision: 1, settlements: [version(1)],
      }));
      renderWith();
      await screen.findByRole('heading', { name: `${today} 日結` });
      const expected = screen.getByRole('group', { name: '應有現金 NT$ 1,170' });
      const counted = screen.getByRole('group', { name: '實點現金 NT$ 1,160' });
      const diff = screen.getByRole('group', { name: /^差額/ });
      expect(expected).toHaveClass('stat-tile-ui');
      expect(counted).toHaveClass('stat-tile-ui');
      expect(diff).toHaveClass('stat-tile-ui--warn');
      expect(screen.queryByText('未結營業日數')).not.toBeInTheDocument();
    });

    it('does not mark the difference when it is zero', async () => {
      repository.read.mockResolvedValue(dayState({
        status: 'closed', revision: 7, lastSettlementRevision: 1,
        settlements: [version(1, { countedCash: 1170, difference: 0, note: '' })],
      }));
      renderWith();
      await screen.findByRole('heading', { name: `${today} 日結` });
      expect(screen.getByRole('group', { name: /^差額/ })).not.toHaveClass('stat-tile-ui--warn');
    });

    it('has no engineering info or load-date row text beside the date, and shows the day state there', async () => {
      renderWith();
      await screen.findByRole('heading', { name: `${today} 日結` });
      const state = screen.getByTestId('cloud-day-state');
      expect(state).toHaveTextContent('今天');
      expect(within(state).getByText('開啟中')).toHaveClass('badge-ui', 'badge-warn');
      expect(screen.queryByText(/資料序號/)).not.toBeInTheDocument();
      expect(screen.queryByText(/伺服器使用權日期/)).not.toBeInTheDocument();
    });

    it('puts the intro explanation in a help tip instead of a details block', async () => {
      const { container } = render(<CloudDayClosePage db={{} as Firestore} leaseEpoch={4} identityKey="uid-a:4" />);
      await screen.findByRole('heading', { name: `${today} 日結` });
      expect(container.querySelector('details.cloud-day-close__intro')).toBeNull();
      expect(screen.queryByText(/應有現金由伺服器依營業日統計計算/)).not.toBeInTheDocument();
      fireEvent.focus(screen.getByRole('button', { name: '應有現金與關帳版本說明' }));
      expect(await screen.findByRole('tooltip')).toHaveTextContent('應有現金由伺服器依營業日統計計算');
    });

    it('keeps money, irreversibility and blocking warnings visible in callouts', async () => {
      repository.read.mockImplementation(async (dayId: string) => dayState({ dayId }));
      renderWith();
      const form = await closeForm();
      const warning = within(form).getByText(/關帳後不能再新增或更正交易、菜單與開帳現金/);
      expect(warning.closest('.callout-ui')).toHaveClass('callout-warn');
      // How-to prose about the close is behind the help tip, not on the page.
      expect(within(form).queryByText(/一般現金差額可在下方留下有原因的關帳後補記/)).not.toBeInTheDocument();
      fireEvent.focus(screen.getByRole('button', { name: '關帳說明' }));
      expect(await screen.findByRole('tooltip')).toHaveTextContent('一般現金差額可在下方留下有原因的關帳後補記');
    });

    it('keeps the closed-day warnings visible and the reopen irreversibility notice in callouts', async () => {
      repository.read.mockResolvedValue(dayState({
        status: 'closed', revision: 7, lastSettlementRevision: 1, settlements: [version(1)],
      }));
      renderWith();
      await screen.findByRole('heading', { name: `${today} 日結` });
      expect(screen.getByText(/差額超過 20,000 元時需依現場流程處理，不可拆成多筆補記/).closest('.callout-ui')).toHaveClass('callout-warn');
      expect(screen.getByText(/另一個視窗仍可能同時補記/).closest('.callout-ui')).toHaveClass('callout-warn');
      expect(screen.getByText(/每次關帳或重開都新增一個不能修改的日結版本/).closest('.callout-ui')).not.toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '重開這一天' }));
      expect(screen.getByText(/舊的關帳版本保留不變；修正後要重新關帳/).closest('.callout-ui')).toHaveClass('callout-warn');
    });

    it('keeps the backfill irreversibility warning visible and moves the how-to behind a help tip', async () => {
      repository.readOverview.mockResolvedValue(overview({
        unclosedDays: [{ dayId: past, status: 'open', openingCash: null, activeTransactionCount: 3, kind: 'missing-opening', backfill: null }],
      }));
      repository.read.mockImplementation(async (dayId: string) => dayState({ dayId, openingCash: null, expectedCash: null }));
      renderWith();
      fireEvent.change(await screen.findByLabelText('查看日期'), { target: { value: past } });
      const form = await screen.findByRole('form', { name: `${past} 補開帳` });
      expect(within(form).getByText(/補開帳會留下操作者、時間與原因，之後不能用補開帳修改/).closest('.callout-ui')).toHaveClass('callout-warn');
      expect(within(form).queryByText(/填那天開店時抽屜裡的現金/)).not.toBeInTheDocument();
      fireEvent.focus(screen.getByRole('button', { name: '補開帳說明' }));
      expect(await screen.findByRole('tooltip')).toHaveTextContent('填那天開店時抽屜裡的現金');
    });

    it('shows the future-date and missing-opening warnings as callouts', async () => {
      repository.read.mockImplementation(async (dayId: string) => dayState({ dayId, openingCash: null, expectedCash: null }));
      renderWith();
      expect((await screen.findByText(/尚未確認開帳現金，不能關帳/)).closest('.callout-ui')).toHaveClass('callout-warn');
    });
  });
});
