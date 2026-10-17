import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { CommandReceipt, CommandResult } from '../../domain/cloudCommands';
import type {
  CloudDayCloseOverview,
  CloudDayCloseState,
  CloudSettlementVersion,
} from '../../firebase/cloudDayCloseRepository';
import { CloudDayClosePage } from './CloudDayClosePage';

const repository = vi.hoisted(() => ({
  read: vi.fn(),
  readOverview: vi.fn(),
  closeDay: vi.fn(),
  reopenDay: vi.fn(),
  readCommand: vi.fn(),
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
    unclosedDays: [{ dayId: today, status: 'open', openingCash: 1000, activeTransactionCount: 4, kind: 'needs-close' }],
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

function successful(kind: CommandReceipt['kind']): CommandResult {
  return { ok: true, receipt: receipt(kind) };
}

function renderPage(props: { backupBlock?: ReactNode } = {}, onNavigationStateChange = vi.fn()) {
  render(
    <CloudDayClosePage
      db={{} as Firestore}
      leaseEpoch={4}
      identityKey="uid-a:4"
      onNavigationStateChange={onNavigationStateChange}
      backupBlock={props.backupBlock}
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
    repository.reopenDay.mockResolvedValue(successful('ReopenDay'));
    repository.readCommand.mockResolvedValue(null);
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

  it('lists unclosed days, marks past days without business, and opens a listed day', async () => {
    const past = '2026-10-15';
    repository.readOverview.mockResolvedValue(overview({
      unclosedDays: [
        { dayId: '2026-10-10', status: 'open', openingCash: null, activeTransactionCount: 0, kind: 'no-business' },
        { dayId: '2026-10-12', status: 'open', openingCash: null, activeTransactionCount: 3, kind: 'missing-opening' },
        { dayId: past, status: 'reopened', openingCash: 500, activeTransactionCount: 2, kind: 'needs-close' },
        { dayId: today, status: 'open', openingCash: null, activeTransactionCount: 0, kind: 'missing-opening' },
      ],
    }));
    repository.read.mockResolvedValue(dayState({ openingCash: null, expectedCash: null, totals: { ...dayState().totals, activeTransactionCount: 0 } }));
    renderPage();
    expect(await screen.findByTestId('cloud-no-business-days')).toHaveTextContent('無營業，不需關帳：2026-10-10');
    expect(screen.queryByTestId('cloud-unclosed-2026-10-10')).not.toBeInTheDocument();
    expect(screen.getByTestId('cloud-unclosed-2026-10-12')).toHaveTextContent('缺開帳現金，無法關帳');
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

  it('shows a past day without opening cash or transactions as no business and offers no close', async () => {
    const past = '2026-10-10';
    repository.read.mockResolvedValue(dayState({
      dayId: past, openingCash: null, expectedCash: null, totals: { ...dayState().totals, activeTransactionCount: 0 },
    }));
    renderPage();
    fireEvent.change(await screen.findByLabelText('查看日期'), { target: { value: past } });
    fireEvent.click(screen.getByRole('button', { name: '載入日期' }));
    expect(await screen.findByText('無營業，不需關帳：這天沒有開帳現金，也沒有任何交易。')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: `${past} 關帳` })).not.toBeInTheDocument();
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
