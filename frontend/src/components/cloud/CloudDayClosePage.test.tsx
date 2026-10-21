import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const repository = vi.hoisted(() => ({
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
}));

vi.mock('../../firebase/cloudDayCloseRepository', () => ({
  createCloudDayCloseRepository: () => repository,
}));

vi.mock('../screens/BackupScreen', () => ({
  BackupScreen: () => <div data-testid="p14-backup">每日加密備份</div>,
}));

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
  backupBlock?: ReactNode;
  initialDayId?: string;
  initialPostCloseEntry?: OpeningMismatchAnomaly;
  onLedgerChanged?: () => void;
  hasUnresolvedPendingCommands?: boolean;
} = {}, onNavigationStateChange = vi.fn()) {
  render(
    <CloudDayClosePage
      db={{} as Firestore}
      leaseEpoch={4}
      identityKey="uid-a:4"
      initialDayId={props.initialDayId}
      onNavigationStateChange={onNavigationStateChange}
      backupBlock={props.backupBlock}
      initialPostCloseEntry={props.initialPostCloseEntry}
      onLedgerChanged={props.onLedgerChanged}
      hasUnresolvedPendingCommands={props.hasUnresolvedPendingCommands}
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
    expect(screen.getByText(/沒有需要關帳的營業日/)).toBeInTheDocument();
  });

  it('keeps the §7.4 close restriction after manual pending-command continuation', async () => {
    renderPage({ hasUnresolvedPendingCommands: true });
    const form = await closeForm();
    expect(within(form).getByTestId('close-submit')).toBeDisabled();
    expect(within(form).getByTestId('pending-close-block')).toHaveTextContent('先完成結果確認後才能關帳');
    fireEvent.submit(form);
    expect(repository.closeDay).not.toHaveBeenCalled();
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
    expect(await screen.findByText('已關帳')).toBeInTheDocument();
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
    expect(history).toHaveTextContent('uid-a');
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

  it('recovers an unknown post-close result by replaying the same command ID and frozen payload', async () => {
    const closed = dayState({ status: 'closed', revision: 7, lastSettlementRevision: 1, settlements: [version(1)] });
    repository.read.mockResolvedValue(closed);
    repository.readLedger.mockResolvedValueOnce({ today, goLiveDate: '2026-10-01', anomalies: [], closedDays: [], seq: 20 });
    repository.recordPostCloseEntry
      .mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } })
      .mockResolvedValueOnce(successful('RecordPostCloseEntry'));
    repository.readCommand.mockResolvedValue(receipt('RecordPostCloseEntry'));
    renderPage();

    const form = await screen.findByRole('form', { name: `${today} 關帳後補記` });
    fireEvent.change(within(form).getByLabelText('金額（元）'), { target: { value: '30' } });
    fireEvent.change(within(form).getByLabelText(/原因（必填/), { target: { value: '補記原因' } });
    fireEvent.click(within(form).getByRole('button', { name: '確認補記' }));
    expect(await screen.findByRole('button', { name: '查詢原命令結果' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));

    await screen.findByText(/已確認 2026-10-17 關帳後補記 完成/);
    expect(repository.readCommand).toHaveBeenCalledWith(commandId);
    expect(repository.recordPostCloseEntry).toHaveBeenNthCalledWith(1, expect.objectContaining({ commandId, amount: 30, reason: '補記原因' }));
    expect(repository.recordPostCloseEntry).toHaveBeenNthCalledWith(2, expect.objectContaining({ commandId, amount: 30, reason: '補記原因' }));
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
    expect(await screen.findByTestId('cloud-no-business-days')).toHaveTextContent(/沒有開帳也沒有交易的過去日期/);
    expect(screen.getByTestId('cloud-no-business-2026-10-10')).toHaveTextContent('2026-10-10');
    expect(screen.queryByTestId('cloud-unclosed-2026-10-10')).not.toBeInTheDocument();
    expect(screen.getByTestId('cloud-unclosed-2026-10-12')).toHaveTextContent('缺開帳現金，需補開帳後關帳');
    expect(screen.getByTestId(`cloud-unclosed-${past}`)).toHaveTextContent('尚未關帳（已重開）');
    expect(screen.getByTestId(`cloud-unclosed-${today}`)).toHaveTextContent('尚未確認開帳現金');
    expect(screen.getByText(/尚未確認開帳現金，不能關帳/)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: `${today} 關帳` })).not.toBeInTheDocument();

    repository.read.mockResolvedValue(dayState({ dayId: past, status: 'reopened', openingCash: 500, expectedCash: 670 }));
    fireEvent.click(within(screen.getByTestId(`cloud-unclosed-${past}`)).getByRole('button', { name: '查看' }));
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
    fireEvent.click(screen.getByRole('button', { name: '載入日期' }));
    expect(await screen.findByText(/這天沒有開帳現金，也沒有任何交易。那天沒有營業就不需關帳/)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: `${past} 關帳` })).not.toBeInTheDocument();
    expect(screen.getByRole('form', { name: `${past} 補開帳` })).toBeInTheDocument();
  });

  it('backfills a past day that has transactions but no opening cash, then offers the close form', async () => {
    const past = '2026-10-12';
    const missing = dayState({ dayId: past, revision: 5, openingCash: null, expectedCash: null });
    repository.read.mockResolvedValue(missing);
    renderPage();
    fireEvent.change(await screen.findByLabelText('查看日期'), { target: { value: past } });
    fireEvent.click(screen.getByRole('button', { name: '載入日期' }));
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
      fireEvent.click(screen.getByRole('button', { name: '載入日期' }));
      expect(await screen.findByRole('heading', { name: `${past} 日結` })).toBeInTheDocument();
      expect(screen.queryByRole('form', { name: `${past} 補開帳` })).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('查看日期'), { target: { value: today } });
      repository.read.mockResolvedValue(dayState({ openingCash: null, expectedCash: null }));
      fireEvent.click(screen.getByRole('button', { name: '載入日期' }));
      expect(await screen.findByRole('heading', { name: `${today} 日結` })).toBeInTheDocument();
    }
    expect(repository.backfillOpening).not.toHaveBeenCalled();
  });

  it('keeps the command ID after an unknown result and confirms it by replaying the same input', async () => {
    repository.closeDay
      .mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } })
      .mockResolvedValueOnce(successful('CloseDay'));
    repository.readCommand.mockResolvedValue(receipt('CloseDay'));
    const report = renderPage();
    const form = await closeForm();
    fireEvent.change(within(form).getByRole('textbox', { name: '實點現金（元）' }), { target: { value: '1170' } });
    fireEvent.click(within(form).getByRole('button', { name: '確認關帳' }));
    expect(await screen.findByText('結果確認中，請勿重複操作。')).toBeInTheDocument();
    await waitFor(() => expect(report).toHaveBeenLastCalledWith('uid-a:4', 'recovering'));
    expect(screen.queryByRole('form', { name: `${today} 關帳` })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
    expect(await screen.findByText(/已確認 2026-10-17 關帳 完成/)).toBeInTheDocument();
    expect(repository.readCommand).toHaveBeenCalledWith(commandId);
    expect(repository.closeDay).toHaveBeenCalledTimes(2);
    expect(repository.closeDay.mock.calls[0][0]).toEqual(repository.closeDay.mock.calls[1][0]);
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
    expect(screen.queryByTestId('p14-backup')).not.toBeInTheDocument();
    expect(report).toHaveBeenLastCalledWith('uid-a:4', 'revoked');
  });

  it('mounts the P14 backup block below the close section', async () => {
    renderPage();
    await screen.findByRole('heading', { name: `${today} 日結` });
    const backup = screen.getByRole('region', { name: '關帳後備份' });
    expect(within(backup).getByTestId('p14-backup')).toBeInTheDocument();
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
  const cleanLedger: CloudLedgerView = {
    status: 'ready', snapshot: { today, goLiveDate: '2026-10-01', closedDays: [], seq: 20, anomalies: [] },
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
        backupBlock={<div />}
        ledger={ledger}
        {...extra}
      />,
    );
  }

  it('shows a banner listing every unclosed past day with a button to the anomalies page', async () => {
    const onOpenAnomalies = vi.fn();
    renderWithLedger(unclosedLedger, { onOpenAnomalies });
    const banner = await screen.findByLabelText('過去未關帳警示');
    expect(banner).toHaveTextContent('過去有 2 天尚未關帳（2026-10-14、2026-10-15），請儘速處理');
    fireEvent.click(within(banner).getByRole('button', { name: '查看帳務異常' }));
    expect(onOpenAnomalies).toHaveBeenCalledTimes(1);
    expect(await closeForm()).toBeInTheDocument();
  });

  it.each<[string, CloudLedgerView | undefined]>([
    ['no unclosed past day', cleanLedger],
    ['a loading ledger', { status: 'loading' }],
    ['a failed ledger', { status: 'error', message: 'x' }],
    ['no ledger', undefined],
  ])('shows no banner for %s', async (_label, ledger) => {
    renderWithLedger(ledger);
    await closeForm();
    expect(screen.queryByLabelText('過去未關帳警示')).not.toBeInTheDocument();
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

    expect(await screen.findByText(/已標為回填，可以到訂餐頁補登交易/)).toBeInTheDocument();
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
  });

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
    await screen.findByText(/已標為回填/);
    expect(repository.backfillOpening).toHaveBeenCalledWith(expect.objectContaining({ openingCash: 800, reason: '抽屜少了 70 元' }));
    expect(repository.startBackfill).toHaveBeenCalledWith(expect.objectContaining({ reason: '那天斷線' }));
  });

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

    expect(await screen.findByText(/2026-10-14 補開帳未完成.*回填 2026-10-14 停在這一步/)).toBeInTheDocument();
    expect(repository.ensureDay).toHaveBeenCalledTimes(1);
    expect(repository.startBackfill).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: '重新載入伺服器資料' })[0]);
    expect(await screen.findByTestId('backfill-plan-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('backfill-continue'));

    expect(await screen.findByText(/已標為回填/)).toBeInTheDocument();
    expect(repository.ensureDay).toHaveBeenCalledTimes(1);
    expect(repository.backfillOpening).toHaveBeenCalledTimes(2);
    // A definite rejection created nothing, so the retry is a new command with the current revision.
    expect(repository.backfillOpening.mock.calls[1][0]).toMatchObject({ commandId: ids[2], expectedDayRevision: 1, openingCash: 870 });
    expect(repository.startBackfill).toHaveBeenCalledTimes(1);
  });

  it('keeps the command ID of an unknown result, confirms it, and carries on with the next step', async () => {
    repository.ensureDay.mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
    repository.readCommand.mockResolvedValue({ ...receipt('EnsureDay'), commandId: ids[0], targets: { dayId: gap } });
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
    expect(await screen.findByText(/已標為回填/)).toBeInTheDocument();
    expect(repository.readCommand).toHaveBeenCalledWith(ids[0]);
    expect(repository.ensureDay).toHaveBeenCalledTimes(2);
    expect(repository.ensureDay.mock.calls[0][0]).toEqual(repository.ensureDay.mock.calls[1][0]);
    expect(repository.backfillOpening).toHaveBeenCalledTimes(1);
    expect(repository.startBackfill).toHaveBeenCalledTimes(1);
  });

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
    expect(await screen.findByText(/已標為回填/)).toBeInTheDocument();
    expect(repository.ensureDay).not.toHaveBeenCalled();
    expect(repository.backfillOpening).not.toHaveBeenCalled();
    expect(repository.startBackfill).toHaveBeenCalledWith({
      commandId: ids[0], leaseEpoch: 4, dayId: gap, expectedDayRevision: 4, reason: '那天斷線',
    });
  });

  it('shows a backfilling day with its reason and a way to the orders page, and offers no second start', async () => {
    repository.readOverview.mockResolvedValue(gapOverview(marker, true));
    repository.read.mockResolvedValue(gapDay(3, 870));
    const onOpenOrders = vi.fn();
    renderAt(gap, { onOpenOrders });
    const info = await screen.findByTestId('backfill-info');
    expect(info).toHaveTextContent('2026-10-14 正在回填（原因：那天斷線）');
    expect(screen.queryByTestId('backfill-start')).not.toBeInTheDocument();
    expect(screen.getByTestId(`cloud-unclosed-backfill-${gap}`)).toHaveTextContent('回填中');
    fireEvent.click(within(info).getByRole('button', { name: `到訂餐頁補登 ${gap}` }));
    expect(onOpenOrders).toHaveBeenCalledWith(gap);
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
