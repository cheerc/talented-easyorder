import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { CommandReceipt, CommandResult } from '../../domain/cloudCommands';
import type {
  CloudDayVendorSnapshot,
  CloudVendorRecord,
} from '../../firebase/cloudDayVendorRepository';
import type { CloudLedgerView } from '../../hooks/useCloudLedger';
import { CloudDayVendorsPage } from './CloudDayVendorsPage';

const repository = vi.hoisted(() => {
  const value = {
    loadSnapshot: vi.fn(),
    ensureDay: vi.fn(),
    saveVendor: vi.fn(),
    removeVendor: vi.fn(),
    setDayMenu: vi.fn(),
    setOpeningCash: vi.fn(),
    findPreviousClosed: vi.fn(),
    readCommand: vi.fn(),
    commitDayVendorIntent: vi.fn((intent: { kind: string; input: unknown }) => {
      switch (intent.kind) {
        case 'ensure-day': return value.ensureDay(intent.input);
        case 'save-vendor': return value.saveVendor(intent.input);
        case 'remove-vendor': return value.removeVendor(intent.input);
        case 'set-day-menu': return value.setDayMenu(intent.input);
        case 'set-opening-cash': return value.setOpeningCash(intent.input);
        default: throw new Error(`Unexpected DayVendor intent: ${intent.kind}`);
      }
    }),
    confirmPendingIntent: vi.fn(),
    cleanupConfirmedIntent: vi.fn(),
  };
  return value;
});

const currentAuth = vi.hoisted(() => ({ uid: 'uid-a' }));
const headMock = vi.hoisted(() => ({ current: null as { seq: number; lastCommandId: string; datasetId: string; targets: Record<string, unknown> } | null }));

vi.mock('../../providers/FirebaseProvider', () => ({ useDataHead: () => headMock.current }));

vi.mock('../../firebase/cloudDayVendorRepository', () => ({
  createCloudDayVendorRepository: () => repository,
}));

vi.mock('../../firebase/cloudRecoveryReader', () => ({
  getCloudRecoveryReader: () => ({ assertCurrent: vi.fn() }),
}));

vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: { uid: currentAuth.uid } }),
}));

const today = '2026-10-15';
const future = '2026-10-20';

function vendor(vendorId: string, overrides: Partial<CloudVendorRecord> = {}): CloudVendorRecord {
  return {
    vendorId,
    name: `名稱 ${vendorId}`,
    phone: '02-1234',
    note: '備註',
    status: 'active',
    deleted: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    revision: 1,
    lastCommandId: 'prior-command',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function snapshot(overrides: Partial<CloudDayVendorSnapshot> = {}): CloudDayVendorSnapshot {
  return {
    dayId: today,
    selectionDate: today,
    day: {
      dayId: today,
      status: 'open',
      revision: 3,
      menu: null,
      openingCash: null,
      openedBy: null,
      openedAt: null,
      totals: {
        activeTransactionCount: 0,
        bentoCount: 0,
        otherMealCount: 0,
        mealTotal: 0,
        retainedReceipts: 0,
        cashierIncome: 0,
        cashierExpense: 0, accountRefunds: 0,
      },
      lastSettlementRevision: 0,
      lastCommandId: 'prior-day-command',
      updatedAt: '2026-10-15T00:00:00.000Z',
    },
    vendors: [],
    latestEarlierMenu: null,
    seq: 10,
    datasetId: 'demo-p07',
    goLiveDate: today,
    ...overrides,
  };
}

function receipt(commandId: string, kind: CommandReceipt['kind'], targets: CommandReceipt['targets'] = {}): CommandReceipt {
  return {
    commandId,
    seq: 11,
    committedAt: '2026-10-15T02:00:00.000Z',
    kind,
    targets,
    result: {},
  };
}

function successful(commandId: string, kind: CommandReceipt['kind'], targets: CommandReceipt['targets'] = {}): CommandResult {
  return { ok: true, receipt: receipt(commandId, kind, targets) };
}

function renderPage(
  props: Partial<{ leaseEpoch: number; identityKey: string }> = {},
  onNavigationStateChange?: (identityKey: string, state: 'recovering' | 'revoked' | 'resolved') => void,
) {
  return render(
    <CloudDayVendorsPage
      db={{} as Firestore}
      leaseEpoch={props.leaseEpoch ?? 4}
      identityKey={props.identityKey ?? 'uid-a:4'}
      onNavigationStateChange={onNavigationStateChange}
    />,
  );
}

describe('CloudDayVendorsPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    currentAuth.uid = 'uid-a';
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue('00000000-0000-4000-8000-000000000007') });
    repository.loadSnapshot.mockResolvedValue(snapshot());
    repository.ensureDay.mockResolvedValue(successful('00000000-0000-4000-8000-000000000007', 'EnsureDay', { dayId: future }));
    repository.saveVendor.mockResolvedValue(successful('00000000-0000-4000-8000-000000000007', 'SaveVendor', { vendorId: 'vendor-new' }));
    repository.removeVendor.mockResolvedValue(successful('00000000-0000-4000-8000-000000000007', 'RemoveVendor', { vendorId: 'vendor-old' }));
    repository.setDayMenu.mockResolvedValue(successful('00000000-0000-4000-8000-000000000007', 'SetDayMenu', { dayId: future }));
    repository.setOpeningCash.mockResolvedValue(successful('00000000-0000-4000-8000-000000000007', 'SetOpeningCash', { dayId: today }));
    repository.readCommand.mockResolvedValue(null);
    repository.confirmPendingIntent.mockResolvedValue({ status: 'not-found' });
    repository.cleanupConfirmedIntent.mockResolvedValue(true);
  });

  it('uses the server-selected date by default and never shows an opening form for a future day', async () => {
    repository.loadSnapshot.mockResolvedValue(snapshot({
      dayId: future,
      selectionDate: today,
      day: { ...snapshot().day!, dayId: future },
      vendors: [vendor('active-vendor'), vendor('inactive-vendor', { status: 'inactive' })],
    }));
    renderPage();

    expect(await screen.findByRole('heading', { name: `${future} 營業日` })).toBeInTheDocument();
    expect(repository.loadSnapshot).toHaveBeenCalledWith(undefined);
    expect(screen.getByLabelText('查看或設定日期')).toHaveValue(future);
    expect(screen.queryByRole('form', { name: `${future} 開帳現金` })).not.toBeInTheDocument();
    expect(screen.getByText(/此日期可預排菜單，但不能預先開帳/)).toBeInTheDocument();
  });

  it('uses StatusBadge for day and vendor states', async () => {
    repository.loadSnapshot.mockResolvedValue(snapshot({
      day: { ...snapshot().day!, status: 'reopened' },
      vendors: [vendor('active-vendor'), vendor('inactive-vendor', { status: 'inactive' })],
    }));
    renderPage();

    const daySection = await screen.findByRole('region', { name: '指定營業日' });
    expect(within(daySection).getByText('已重開')).toHaveClass('badge-ui', 'badge-warn');
    const vendorSection = screen.getByRole('region', { name: '供應商管理' });
    const activeRow = screen.getByTestId('cloud-vendor-row-active-vendor');
    const inactiveRow = screen.getByTestId('cloud-vendor-row-inactive-vendor');
    expect(within(activeRow).getByText('使用中')).toHaveClass('badge-ui', 'badge-ok');
    expect(within(inactiveRow).getByText('已停用')).toHaveClass('badge-ui', 'badge-neutral');
    expect(vendorSection).toContainElement(activeRow);
  });

  it('uses EmptyState when the server returns an empty vendor list', async () => {
    repository.loadSnapshot.mockResolvedValue(snapshot({ vendors: [] }));
    renderPage();
    const empty = await screen.findByText('目前伺服器沒有可管理的供應商，請新增一筆供應商資料。');
    expect(empty.closest('.empty-title')).not.toBeNull();
  });

  it('creates a future day as an empty server record before configuring it', async () => {
    const missingDay = snapshot({ dayId: future, selectionDate: today, day: null });
    const createdDay = snapshot({ dayId: future, selectionDate: today, day: { ...snapshot().day!, dayId: future } });
    repository.loadSnapshot.mockResolvedValueOnce(missingDay).mockResolvedValueOnce(createdDay);
    renderPage();

    expect(await screen.findByRole('button', { name: '建立空白營業日' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '建立空白營業日' }));
    await waitFor(() => expect(repository.ensureDay).toHaveBeenCalledWith({
      commandId: '00000000-0000-4000-8000-000000000007',
      leaseEpoch: 4,
      dayId: future,
    }));
    expect(await screen.findByRole('heading', { name: `${future} 菜單` })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: `${future} 開帳現金` })).not.toBeInTheDocument();
  });

  it('saves a direct future menu with the server selection date, strict read head and active vendor snapshot', async () => {
    const current = snapshot({
      dayId: future,
      selectionDate: today,
      day: { ...snapshot().day!, dayId: future, revision: 7 },
      vendors: [vendor('active-vendor', { name: '直接供應商' }), vendor('inactive-vendor', { status: 'inactive' })],
      seq: 24,
    });
    repository.loadSnapshot.mockResolvedValueOnce(current).mockResolvedValueOnce(current);
    renderPage();

    await screen.findByRole('heading', { name: `${future} 菜單` });
    const vendorSelect = screen.getByRole('combobox', { name: '供應商' });
    expect(within(vendorSelect).getByRole('option', { name: '直接供應商' })).toBeInTheDocument();
    expect(within(vendorSelect).queryByRole('option', { name: '名稱 inactive-vendor' })).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: `${future} 開帳現金` })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('菜單名稱'), { target: { value: '預排餐盒' } });
    fireEvent.change(screen.getByLabelText('價格（新臺幣整數）'), { target: { value: '180' } });
    fireEvent.change(vendorSelect, { target: { value: 'active-vendor' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存菜單' }));

    await waitFor(() => expect(repository.setDayMenu).toHaveBeenCalledWith({
      commandId: '00000000-0000-4000-8000-000000000007',
      leaseEpoch: 4,
      dayId: future,
      selectionDate: today,
      expectedRevision: 7,
      expectedHeadSeq: 24,
      itemName: '預排餐盒',
      price: 180,
      vendorId: 'active-vendor',
      vendorNameSnapshot: '直接供應商',
      inheritedFromDate: null,
    }));
    expect(await screen.findByText(new RegExp(`已確認 設定 ${future} 菜單 完成`))).toBeInTheDocument();
  });

  it('inherits only the immediate validated earlier menu and keeps its source date in the command', async () => {
    const sourceVendor = vendor('vendor-source', { name: '來源供應商' });
    const current = snapshot({
      dayId: future,
      selectionDate: today,
      day: { ...snapshot().day!, dayId: future, revision: 5 },
      vendors: [sourceVendor],
      latestEarlierMenu: {
        sourceDayId: today,
        menu: {
          businessDate: today,
          itemName: '沿用餐點',
          price: 125,
          vendorId: sourceVendor.vendorId,
          vendorNameSnapshot: sourceVendor.name,
          updatedAt: '2026-10-15T00:00:00.000Z',
          revision: 2,
          inheritedFromDate: null,
        },
        sourceVendor,
        blocked: null,
      },
      seq: 31,
    });
    repository.loadSnapshot.mockResolvedValueOnce(current).mockResolvedValueOnce(current);
    renderPage();

    await screen.findByRole('button', { name: '帶入最新較早菜單' });
    fireEvent.click(screen.getByRole('button', { name: '帶入最新較早菜單' }));
    expect(screen.getByRole('textbox', { name: '菜單名稱' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '儲存菜單' }));

    await waitFor(() => expect(repository.setDayMenu).toHaveBeenCalledWith({
      commandId: '00000000-0000-4000-8000-000000000007',
      leaseEpoch: 4,
      dayId: future,
      selectionDate: today,
      expectedRevision: 5,
      expectedHeadSeq: 31,
      itemName: '沿用餐點',
      price: 125,
      vendorId: 'vendor-source',
      vendorNameSnapshot: '來源供應商',
      inheritedFromDate: today,
    }));
  });

  it('does not fall back to an older menu when the repository marks the newest source blocked', async () => {
    const sourceVendor = vendor('inactive-source', { status: 'inactive' });
    repository.loadSnapshot.mockResolvedValue(snapshot({
      dayId: future,
      selectionDate: today,
      day: { ...snapshot().day!, dayId: future },
      vendors: [sourceVendor],
      latestEarlierMenu: {
        sourceDayId: '2026-10-14',
        menu: {
          businessDate: '2026-10-14',
          itemName: '不可沿用餐點',
          price: 100,
          vendorId: sourceVendor.vendorId,
          vendorNameSnapshot: sourceVendor.name,
          updatedAt: '2026-10-14T00:00:00.000Z',
          revision: 1,
          inheritedFromDate: null,
        },
        sourceVendor,
        blocked: 'vendor-inactive',
      },
    }));
    renderPage();

    expect(await screen.findByText(/最近一筆較早菜單的供應商已停用/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '帶入最新較早菜單' })).not.toBeInTheDocument();
    expect(repository.setDayMenu).not.toHaveBeenCalled();
  });

  it('requires explicit opening input and sends zero distinctly from unconfirmed null', async () => {
    repository.loadSnapshot
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot({
        day: { ...snapshot().day!, revision: 4, openingCash: 0, openedBy: 'uid-a', openedAt: '2026-10-15T01:00:00.000Z' },
      }));
    renderPage();

    const form = await screen.findByRole('form', { name: `${today} 開帳現金` });
    await waitFor(() => expect(within(form).getByRole('button', { name: '確認開帳金額' })).toBeEnabled());
    fireEvent.click(within(form).getByRole('button', { name: '確認開帳金額' }));
    expect(repository.setOpeningCash).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByRole('textbox', { name: /^開帳現金/ }), { target: { value: '0' } });
    await waitFor(() => expect(within(form).getByRole('button', { name: '確認開帳金額' })).toBeEnabled());
    fireEvent.click(within(form).getByRole('button', { name: '確認開帳金額' }));

    await waitFor(() => expect(repository.setOpeningCash).toHaveBeenCalledWith({
      commandId: '00000000-0000-4000-8000-000000000007',
      leaseEpoch: 4,
      dayId: today,
      expectedRevision: 3,
      openingCash: 0,
    }));
    expect(await screen.findByText(/已確認 確認 2026-10-15 開帳現金 完成/)).toBeInTheDocument();
    expect(screen.getByText(/首次開帳人：uid-a/)).toBeInTheDocument();
    expect(screen.getByText(/伺服器已確認開帳現金 NT\$ 0/)).toBeInTheDocument();
  });

  it('rejects opening values outside 0..20,000 without dispatching a command', async () => {
    renderPage();
    const form = await screen.findByRole('form', { name: `${today} 開帳現金` });
    const amount = within(form).getByRole('textbox', { name: /^開帳現金/ });
    for (const invalid of ['-0', '-1', '1.5', '20001']) {
      fireEvent.change(amount, { target: { value: invalid } });
      await waitFor(() => expect(within(form).getByRole('button', { name: '確認開帳金額' })).toBeEnabled());
    fireEvent.click(within(form).getByRole('button', { name: '確認開帳金額' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(/開帳現金/);
    }
    expect(repository.setOpeningCash).not.toHaveBeenCalled();
  });

  it('creates vendors as active with a stable caller ID, and edits one record at its current revision', async () => {
    const current = snapshot({ vendors: [vendor('vendor-edit', { revision: 4 })] });
    repository.loadSnapshot.mockResolvedValueOnce(current).mockResolvedValueOnce(current);
    renderPage();
    await screen.findByTestId('cloud-vendor-row-vendor-edit');

    fireEvent.click(screen.getByRole('button', { name: '新增供應商' }));
    const createForm = screen.getByRole('form', { name: '新增供應商' });
    fireEvent.change(within(createForm).getByLabelText('供應商編號'), { target: { value: 'vendor-new' } });
    fireEvent.change(within(createForm).getByLabelText('供應商名稱'), { target: { value: '新店' } });
    fireEvent.click(within(createForm).getByRole('button', { name: '建立供應商' }));
    await waitFor(() => expect(repository.saveVendor).toHaveBeenCalledWith({
      commandId: '00000000-0000-4000-8000-000000000007',
      leaseEpoch: 4,
      vendorId: 'vendor-new',
      expectedRevision: 0,
      name: '新店',
      phone: '',
      note: '',
      status: 'active',
    }));

    fireEvent.click(screen.getByRole('button', { name: '編輯／停用／恢復' }));
    const editForm = screen.getByRole('form', { name: '編輯供應商 vendor-edit' });
    fireEvent.change(within(editForm).getByLabelText('狀態'), { target: { value: 'inactive' } });
    fireEvent.click(within(editForm).getByRole('button', { name: '儲存供應商' }));
    await waitFor(() => expect(repository.saveVendor).toHaveBeenLastCalledWith({
      commandId: '00000000-0000-4000-8000-000000000007',
      leaseEpoch: 4,
      vendorId: 'vendor-edit',
      expectedRevision: 4,
      name: '名稱 vendor-edit',
      phone: '02-1234',
      note: '備註',
      status: 'inactive',
    }));
  });

  it('does not remove active vendors and requires a reason before tombstoning an inactive record', async () => {
    const current = snapshot({ vendors: [vendor('active-vendor'), vendor('inactive-vendor', { status: 'inactive', revision: 3 })] });
    repository.loadSnapshot.mockResolvedValueOnce(current).mockResolvedValueOnce(current);
    renderPage();
    await screen.findByTestId('cloud-vendor-row-inactive-vendor');

    const activeRow = screen.getByTestId('cloud-vendor-row-active-vendor');
    expect(within(activeRow).queryByRole('button', { name: '移除' })).not.toBeInTheDocument();
    const inactiveRow = screen.getByTestId('cloud-vendor-row-inactive-vendor');
    fireEvent.click(within(inactiveRow).getByRole('button', { name: '移除' }));
    const removeForm = within(inactiveRow).getByRole('form', { name: '移除供應商 inactive-vendor' });
    fireEvent.click(within(removeForm).getByRole('button', { name: '確認移除' }));
    expect(repository.removeVendor).not.toHaveBeenCalled();
    fireEvent.change(within(removeForm).getByLabelText(/移除原因/), { target: { value: '已確認停止合作' } });
    fireEvent.click(within(removeForm).getByRole('button', { name: '確認移除' }));

    await waitFor(() => expect(repository.removeVendor).toHaveBeenCalledWith({
      commandId: '00000000-0000-4000-8000-000000000007',
      leaseEpoch: 4,
      vendorId: 'inactive-vendor',
      expectedRevision: 3,
      reason: '已確認停止合作',
    }));
  });

  it('keeps a vendor command single-flight and shows the fixed confirmation prompt exactly at ten seconds', async () => {
    vi.useFakeTimers();
    try {
      let resolveSave!: (result: CommandResult) => void;
      repository.saveVendor.mockReturnValueOnce(new Promise<CommandResult>(resolve => { resolveSave = resolve; }));
      renderPage();
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      const createButton = screen.getByRole('button', { name: '新增供應商' });
      fireEvent.click(createButton);
      const form = screen.getByRole('form', { name: '新增供應商' });
      fireEvent.change(within(form).getByLabelText('供應商編號'), { target: { value: 'vendor-pending' } });
      fireEvent.change(within(form).getByLabelText('供應商名稱'), { target: { value: '待確認供應商' } });
      fireEvent.submit(form);
      fireEvent.submit(form);

      await act(async () => { await Promise.resolve(); });
      expect(repository.saveVendor).toHaveBeenCalledTimes(1);
      // Before ten seconds only the progress bar says "sending" (#585): no recovery panel.
      expect(screen.queryByRole('alert', { name: '命令結果確認' })).not.toBeInTheDocument();
      expect(screen.getByTestId('command-progress')).toHaveAttribute('data-active', 'true');
      await act(async () => { vi.advanceTimersByTime(9_999); });
      expect(screen.queryByText('結果確認中，勿重新收款')).not.toBeInTheDocument();
      await act(async () => { vi.advanceTimersByTime(1); });
      expect(screen.getByText('結果確認中，勿重新收款')).toBeInTheDocument();
      expect(screen.getByText(/命令編號 00000000-0000-4000-8000-000000000007/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '查詢原命令結果' })).toBeInTheDocument();

      await act(async () => resolveSave({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } }));
      expect(repository.saveVendor).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses a read-only receipt check and does not authorize retry from a query started before submit settles', async () => {
    vi.useFakeTimers();
    try {
      let settleSave!: (result: CommandResult) => void;
      let resolveEarlyQuery!: (result: { status: 'not-found' }) => void;
      repository.saveVendor.mockReturnValueOnce(new Promise<CommandResult>(resolve => { settleSave = resolve; }));
      repository.confirmPendingIntent.mockReturnValueOnce(new Promise(resolve => { resolveEarlyQuery = resolve; }));
      renderPage();
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      fireEvent.click(screen.getByRole('button', { name: '新增供應商' }));
      const form = screen.getByRole('form', { name: '新增供應商' });
      fireEvent.change(within(form).getByLabelText('供應商編號'), { target: { value: 'vendor-race' } });
      fireEvent.change(within(form).getByLabelText('供應商名稱'), { target: { value: '競態供應商' } });
      fireEvent.submit(form);
      await act(async () => { vi.advanceTimersByTime(10_000); });
      fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
      expect(repository.confirmPendingIntent).toHaveBeenCalledOnce();

      await act(async () => settleSave({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } }));
      await act(async () => resolveEarlyQuery({ status: 'not-found' }));
      expect(repository.saveVendor).toHaveBeenCalledOnce();
      expect(screen.queryByRole('button', { name: '以相同命令編號重試' })).not.toBeInTheDocument();
      expect(screen.getByText(/這次查詢開始時原命令仍在送出中；未找到結果不能授權重試/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(repository.confirmPendingIntent).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('button', { name: '以相同命令編號重試' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '以相同命令編號重試' }));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(repository.saveVendor).toHaveBeenCalledTimes(2);
      expect(repository.saveVendor.mock.calls[0][0]).toEqual(repository.saveVendor.mock.calls[1][0]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not authorize a retry when the read-only receipt service fails', async () => {
    repository.saveVendor.mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
    repository.confirmPendingIntent.mockRejectedValueOnce({ code: 'OFFLINE', message: 'reader unavailable' });
    renderPage();
    await screen.findByRole('heading', { name: `${today} 營業日` });
    fireEvent.click(screen.getByRole('button', { name: '新增供應商' }));
    const form = screen.getByRole('form', { name: '新增供應商' });
    fireEvent.change(within(form).getByLabelText('供應商編號'), { target: { value: 'vendor-reader-error' } });
    fireEvent.change(within(form).getByLabelText('供應商名稱'), { target: { value: '查詢服務失敗供應商' } });
    fireEvent.submit(form);
    await screen.findByText(/操作回應不確定；請唯讀查詢原命令結果/);

    fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
    expect(await screen.findByText(/查詢錯誤不代表命令不存在，暫不可重試/)).toBeInTheDocument();
    expect(repository.confirmPendingIntent).toHaveBeenCalledOnce();
    expect(repository.saveVendor).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: '以相同命令編號重試' })).not.toBeInTheDocument();
  });

  it('keeps a confirmed vendor command locked when the full refresh returns another dataset or day', async () => {
    vi.useFakeTimers();
    try {
    const commandId = '00000000-0000-4000-8000-000000000007';
    let resolveSave!: (result: CommandResult) => void;
    repository.saveVendor.mockReturnValueOnce(new Promise<CommandResult>(resolve => { resolveSave = resolve; }));
    const matched = receipt(commandId, 'SaveVendor', { vendorId: 'vendor-confirmed' });
    repository.confirmPendingIntent.mockResolvedValueOnce({ status: 'matched', receipt: matched });
    repository.loadSnapshot
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot({ dayId: future, datasetId: 'replacement-dataset', vendors: [vendor('private-vendor')] }))
      .mockResolvedValueOnce(snapshot({ dayId: future, datasetId: 'replacement-dataset', vendors: [vendor('private-vendor')] }));
    const reportNavigationState = vi.fn();
    renderPage({}, reportNavigationState);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole('heading', { name: `${today} 營業日` })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '新增供應商' }));
    const form = screen.getByRole('form', { name: '新增供應商' });
    fireEvent.change(within(form).getByLabelText('供應商編號'), { target: { value: 'vendor-confirmed' } });
    fireEvent.change(within(form).getByLabelText('供應商名稱'), { target: { value: '已確認供應商' } });
    fireEvent.click(within(form).getByRole('button', { name: '建立供應商' }));
    expect(screen.getByTestId('command-progress')).toHaveAttribute('data-active', 'true');
    await act(async () => { vi.advanceTimersByTime(10_000); });
    fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));

    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText(/命令回執已確認，但伺服器資料集或營業日已變更/)).toBeInTheDocument();
    expect(repository.confirmPendingIntent).toHaveBeenCalledTimes(1);
    expect(repository.saveVendor).toHaveBeenCalledTimes(1);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(repository.cleanupConfirmedIntent).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert', { name: '命令結果確認' })).toContainElement(screen.getByText(new RegExp(commandId)));
    expect(screen.queryByText('名稱 private-vendor')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新增供應商' })).not.toBeInTheDocument();
    expect(screen.queryByText(/已確認 新增供應商 vendor-confirmed 完成/)).not.toBeInTheDocument();
    expect(reportNavigationState).toHaveBeenLastCalledWith('uid-a:4', 'recovering');

    fireEvent.click(screen.getByRole('button', { name: '重新讀取伺服器資料' }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText(/命令回執已確認，但伺服器資料集或營業日已變更/)).toBeInTheDocument();
    expect(repository.saveVendor).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('名稱 private-vendor')).not.toBeInTheDocument();
    await act(async () => resolveSave({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'late result' } }));
    expect(screen.getByRole('alert', { name: '命令結果確認' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps confirmed receipts and retries only the server read if refresh fails', async () => {
    const reportNavigationState = vi.fn();
    repository.setOpeningCash.mockResolvedValueOnce(successful('00000000-0000-4000-8000-000000000007', 'SetOpeningCash', { dayId: today }));
    repository.loadSnapshot
      .mockResolvedValueOnce(snapshot())
      .mockRejectedValueOnce({ code: 'OFFLINE', message: 'offline' })
      .mockResolvedValueOnce(snapshot({ day: { ...snapshot().day!, revision: 4, openingCash: 80, openedBy: 'uid-a', openedAt: '2026-10-15T01:00:00.000Z' } }));
    renderPage({}, reportNavigationState);
    const form = await screen.findByRole('form', { name: `${today} 開帳現金` });
    fireEvent.change(within(form).getByRole('textbox', { name: /^開帳現金/ }), { target: { value: '80' } });
    await waitFor(() => expect(within(form).getByRole('button', { name: '確認開帳金額' })).toBeEnabled());
    fireEvent.click(within(form).getByRole('button', { name: '確認開帳金額' }));

    expect(await screen.findByText('已找到伺服器回執，資料尚待再次讀取。')).toBeInTheDocument();
    await waitFor(() => expect(reportNavigationState).toHaveBeenLastCalledWith('uid-a:4', 'recovering'));
    fireEvent.click(screen.getByRole('button', { name: '重新讀取伺服器資料' }));
    expect(await screen.findByText(/已確認 確認 2026-10-15 開帳現金 完成/)).toBeInTheDocument();
    expect(repository.setOpeningCash).toHaveBeenCalledTimes(1);
    expect(repository.loadSnapshot).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(reportNavigationState).toHaveBeenLastCalledWith('uid-a:4', 'resolved'));
  });

  it('keeps a matched opening receipt and navigation locked until the same-scope full snapshot, then calls ledger refresh once', async () => {
    vi.useFakeTimers();
    try {
      const commandId = '00000000-0000-4000-8000-000000000007';
      let resolveWrite!: (result: CommandResult) => void;
      let resolveFreshSnapshot!: (value: CloudDayVendorSnapshot) => void;
      const onLedgerChanged = vi.fn();
      repository.findPreviousClosed.mockResolvedValue({ previous: null, seq: 10 });
      repository.setOpeningCash.mockReturnValueOnce(new Promise<CommandResult>(resolve => { resolveWrite = resolve; }));
      repository.confirmPendingIntent.mockResolvedValueOnce({
        status: 'matched', receipt: receipt(commandId, 'SetOpeningCash', { dayId: today }),
      });
      repository.loadSnapshot
        .mockResolvedValueOnce(snapshot())
        .mockReturnValueOnce(new Promise<CloudDayVendorSnapshot>(resolve => { resolveFreshSnapshot = resolve; }));
      render(
        <CloudDayVendorsPage
          db={{} as Firestore}
          leaseEpoch={4}
          identityKey="uid-a:4"
          ledger={{ status: 'ready', snapshot: { today, goLiveDate: '2026-10-01', anomalies: [], seq: 10, closedDays: [] } }}
          onLedgerChanged={onLedgerChanged}
        />,
      );
      await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
      const form = screen.getByRole('form', { name: `${today} 開帳現金` });
      fireEvent.change(within(form).getByRole('textbox', { name: /^開帳現金/ }), { target: { value: '250' } });
      fireEvent.click(within(form).getByRole('button', { name: '確認開帳金額' }));
      await act(async () => { vi.advanceTimersByTime(10_000); });
      fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

      expect(repository.confirmPendingIntent).toHaveBeenCalledOnce();
      expect(repository.cleanupConfirmedIntent).toHaveBeenCalledOnce();
      expect(repository.loadSnapshot).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('alert', { name: '命令結果確認' })).toHaveTextContent(commandId);
      expect(screen.getByRole('alert', { name: '命令結果確認' })).toHaveTextContent('已找到伺服器回執，資料尚待再次讀取。');
      expect(screen.getByRole('button', { name: '重新讀取伺服器資料' })).toBeDisabled();
      expect(screen.queryByRole('form', { name: `${today} 開帳現金` })).not.toBeInTheDocument();
      expect(onLedgerChanged).not.toHaveBeenCalled();

      await act(async () => resolveFreshSnapshot(snapshot({
        day: { ...snapshot().day!, revision: 4, openingCash: 250, openedBy: 'uid-a', openedAt: '2026-10-15T01:00:00.000Z' },
      })));
      expect(screen.getByText(/已確認 確認 2026-10-15 開帳現金 完成/)).toBeInTheDocument();
      expect(onLedgerChanged).toHaveBeenCalledTimes(1);

      await act(async () => resolveWrite({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'late result' } }));
      expect(onLedgerChanged).toHaveBeenCalledTimes(1);
      expect(repository.setOpeningCash).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('recovers an unknown opening command with the same UUID and frozen semantic input', async () => {
    const reportNavigationState = vi.fn();
    const commandId = '00000000-0000-4000-8000-000000000007';
    repository.setOpeningCash
      .mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } })
      .mockResolvedValueOnce(successful(commandId, 'SetOpeningCash', { dayId: today }));
    repository.confirmPendingIntent.mockResolvedValue({
      status: 'matched', receipt: receipt(commandId, 'SetOpeningCash', { dayId: today }),
    });
    repository.loadSnapshot.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot({
      day: { ...snapshot().day!, revision: 4, openingCash: 90, openedBy: 'uid-a', openedAt: '2026-10-15T01:00:00.000Z' },
    }));
    renderPage({}, reportNavigationState);
    const form = await screen.findByRole('form', { name: `${today} 開帳現金` });
    fireEvent.change(within(form).getByRole('textbox', { name: /^開帳現金/ }), { target: { value: '90' } });
    await waitFor(() => expect(within(form).getByRole('button', { name: '確認開帳金額' })).toBeEnabled());
    fireEvent.click(within(form).getByRole('button', { name: '確認開帳金額' }));

    expect(await screen.findByText('結果確認中，請勿重複操作。')).toBeInTheDocument();
    await waitFor(() => expect(reportNavigationState).toHaveBeenLastCalledWith('uid-a:4', 'recovering'));
    fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
    expect(await screen.findByText(/已確認 確認 2026-10-15 開帳現金 完成/)).toBeInTheDocument();
    expect(repository.confirmPendingIntent).toHaveBeenCalledTimes(1);
    expect(repository.setOpeningCash).toHaveBeenCalledTimes(1);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(reportNavigationState).toHaveBeenLastCalledWith('uid-a:4', 'resolved'));
  });

  it('keeps navigation locked after same-identity authorization loss without a command ID', async () => {
    const reportNavigationState = vi.fn();
    repository.loadSnapshot.mockRejectedValueOnce({ code: 'UNAUTHORIZED', message: 'not allowed' });
    renderPage({}, reportNavigationState);

    expect(await screen.findByText(/授權狀態已失效/)).toBeInTheDocument();
    await waitFor(() => expect(reportNavigationState).toHaveBeenLastCalledWith('uid-a:4', 'revoked'));
    expect(repository.loadSnapshot).toHaveBeenCalledTimes(1);
  });

  it('clears vendor drafts synchronously on authorization loss and ignores an old command result', async () => {
    let resolveSave!: (result: CommandResult) => void;
    repository.saveVendor.mockReturnValueOnce(new Promise<CommandResult>(resolve => { resolveSave = resolve; }));
    renderPage();
    await screen.findByRole('heading', { name: `${today} 營業日` });
    fireEvent.click(screen.getByRole('button', { name: '新增供應商' }));
    const createForm = screen.getByRole('form', { name: '新增供應商' });
    fireEvent.change(within(createForm).getByLabelText('供應商編號'), { target: { value: 'vendor-pii-id' } });
    fireEvent.change(within(createForm).getByLabelText('供應商名稱'), { target: { value: '敏感供應商名稱' } });
    fireEvent.click(within(createForm).getByRole('button', { name: '建立供應商' }));
    await waitFor(() => expect(screen.getByTestId('command-progress')).toHaveAttribute('data-active', 'true'));

    await act(async () => {
      resolveSave({ ok: false, error: { code: 'LEASE_LOST', message: 'lease changed' } });
    });
    expect(await screen.findByText('使用權已變更；敏感操作內容已清除。')).toBeInTheDocument();
    expect(screen.getByText(/命令編號 00000000-0000-4000-8000-000000000007/)).toBeInTheDocument();
    const text = screen.getByRole('main', { name: '雲端日期設定與供應商管理' }).textContent ?? '';
    expect(text).not.toContain('vendor-pii-id');
    expect(text).not.toContain('敏感供應商名稱');
    expect(repository.loadSnapshot).toHaveBeenCalledTimes(1);
  });

  it('does not restore an old command response after the UID and lease epoch change', async () => {
    let resolveSave!: (result: CommandResult) => void;
    repository.saveVendor.mockReturnValueOnce(new Promise<CommandResult>(resolve => { resolveSave = resolve; }));
    repository.loadSnapshot
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot({ vendors: [vendor('vendor-new-identity', { name: '新身分供應商' })] }));
    const view = renderPage();
    await screen.findByRole('heading', { name: `${today} 營業日` });
    fireEvent.click(screen.getByRole('button', { name: '新增供應商' }));
    const createForm = screen.getByRole('form', { name: '新增供應商' });
    fireEvent.change(within(createForm).getByLabelText('供應商編號'), { target: { value: 'old-private-id' } });
    fireEvent.change(within(createForm).getByLabelText('供應商名稱'), { target: { value: '舊身分草稿' } });
    fireEvent.click(within(createForm).getByRole('button', { name: '建立供應商' }));

    view.rerender(
      <CloudDayVendorsPage db={{} as Firestore} leaseEpoch={5} identityKey="uid-b:5" />,
    );
    expect(await screen.findAllByText('新身分供應商')).toHaveLength(2);
    await act(async () => {
      resolveSave(successful('00000000-0000-4000-8000-000000000007', 'SaveVendor', { vendorId: 'old-private-id' }));
    });

    const text = screen.getByRole('main', { name: '雲端日期設定與供應商管理' }).textContent ?? '';
    expect(text).toContain('新身分供應商');
    expect(text).not.toContain('old-private-id');
    expect(text).not.toContain('舊身分草稿');
  });

  it('does not restore a pending command result after a concurrent header reload loses authorization', async () => {
    let resolveSave!: (result: CommandResult) => void;
    let rejectReload!: (error: unknown) => void;
    repository.saveVendor.mockReturnValueOnce(new Promise<CommandResult>(resolve => { resolveSave = resolve; }));
    repository.loadSnapshot
      .mockResolvedValueOnce(snapshot())
      .mockReturnValueOnce(new Promise<CloudDayVendorSnapshot>((_resolve, reject) => { rejectReload = reject; }));
    renderPage();
    await screen.findByRole('heading', { name: `${today} 營業日` });
    fireEvent.click(screen.getByRole('button', { name: '新增供應商' }));
    const createForm = screen.getByRole('form', { name: '新增供應商' });
    fireEvent.change(within(createForm).getByLabelText('供應商編號'), { target: { value: 'pending-private-id' } });
    fireEvent.change(within(createForm).getByLabelText('供應商名稱'), { target: { value: '待回填供應商' } });
    fireEvent.click(within(createForm).getByRole('button', { name: '建立供應商' }));
    await waitFor(() => expect(screen.getByTestId('command-progress')).toHaveAttribute('data-active', 'true'));

    fireEvent.click(screen.getByRole('button', { name: '重新載入伺服器資料' }));
    await screen.findByText(/正在從伺服器載入完整營業日/);
    await act(async () => { rejectReload({ code: 'LEASE_LOST', message: 'lease changed' }); });
    expect(await screen.findByText('使用權已變更；敏感操作內容已清除。')).toBeInTheDocument();
    await act(async () => {
      resolveSave(successful('00000000-0000-4000-8000-000000000007', 'SaveVendor', { vendorId: 'pending-private-id' }));
    });

    const text = screen.getByRole('main', { name: '雲端日期設定與供應商管理' }).textContent ?? '';
    expect(text).not.toContain('pending-private-id');
    expect(text).not.toContain('待回填供應商');
    expect(repository.loadSnapshot).toHaveBeenCalledTimes(2);
  });

  it('invalidates a concurrent pending list when receipt lookup loses authorization', async () => {
    let rejectConfirmation!: (error: unknown) => void;
    let resolveList!: (value: CloudDayVendorSnapshot) => void;
    repository.setOpeningCash.mockResolvedValueOnce({
      ok: false,
      error: { code: 'UNKNOWN_RESULT', message: 'unknown' },
    });
    repository.confirmPendingIntent.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectConfirmation = reject; }));
    repository.loadSnapshot
      .mockResolvedValueOnce(snapshot())
      .mockReturnValueOnce(new Promise<CloudDayVendorSnapshot>(resolve => { resolveList = resolve; }));
    renderPage();
    const form = await screen.findByRole('form', { name: `${today} 開帳現金` });
    fireEvent.change(within(form).getByRole('textbox', { name: /^開帳現金/ }), { target: { value: '15' } });
    await waitFor(() => expect(within(form).getByRole('button', { name: '確認開帳金額' })).toBeEnabled());
    fireEvent.click(within(form).getByRole('button', { name: '確認開帳金額' }));
    await screen.findByText('結果確認中，請勿重複操作。');
    fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
    await screen.findByText('正在查詢原命令結果…');

    fireEvent.click(screen.getByRole('button', { name: '重新載入伺服器資料' }));
    await screen.findByText(/正在從伺服器載入完整營業日/);
    await act(async () => { rejectConfirmation({ code: 'UNAUTHORIZED', message: 'not authorized' }); });
    expect(await screen.findByText('使用權已變更；敏感操作內容已清除。')).toBeInTheDocument();
    await act(async () => {
      resolveList(snapshot({ vendors: [vendor('private-after-revoke', { name: '不得回填的供應商' })] }));
    });

    const text = screen.getByRole('main', { name: '雲端日期設定與供應商管理' }).textContent ?? '';
    expect(text).not.toContain('不得回填的供應商');
    expect(text).not.toContain('private-after-revoke');
    expect(repository.loadSnapshot).toHaveBeenCalledTimes(2);
  });

  it('keeps the same-identity authorization revoke latch closed against manual reload', async () => {
    repository.saveVendor.mockResolvedValueOnce({
      ok: false,
      error: { code: 'LEASE_LOST', message: 'lease changed' },
    });
    const view = renderPage();
    await screen.findByRole('heading', { name: `${today} 營業日` });
    fireEvent.click(screen.getByRole('button', { name: '新增供應商' }));
    const createForm = screen.getByRole('form', { name: '新增供應商' });
    fireEvent.change(within(createForm).getByLabelText('供應商編號'), { target: { value: 'latch-private-id' } });
    fireEvent.change(within(createForm).getByLabelText('供應商名稱'), { target: { value: '權限失效供應商' } });
    fireEvent.click(within(createForm).getByRole('button', { name: '建立供應商' }));
    expect(await screen.findByText('使用權已變更；敏感操作內容已清除。')).toBeInTheDocument();

    view.rerender(<CloudDayVendorsPage db={{} as Firestore} leaseEpoch={4} identityKey="uid-a:4" />);
    const reload = screen.getByRole('button', { name: '重新載入伺服器資料' });
    expect(reload).toBeDisabled();
    fireEvent.click(reload);
    expect(repository.loadSnapshot).toHaveBeenCalledTimes(1);
    const text = screen.getByRole('main', { name: '雲端日期設定與供應商管理' }).textContent ?? '';
    expect(text).not.toContain('latch-private-id');
    expect(text).not.toContain('權限失效供應商');
  });

  it('replays an unknown menu with its frozen lease date and head sequence after midnight', async () => {
    const commandId = '00000000-0000-4000-8000-000000000007';
    const activeVendor = vendor('menu-vendor', { name: '菜單供應商' });
    const initial = snapshot({
      dayId: future,
      selectionDate: today,
      day: { ...snapshot().day!, dayId: future, revision: 8 },
      vendors: [activeVendor],
      seq: 24,
    });
    repository.loadSnapshot.mockResolvedValueOnce(initial);
    repository.setDayMenu
      .mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
    repository.confirmPendingIntent.mockRejectedValueOnce({ code: 'INVALID_INPUT', message: 'existing command input differs' });
    renderPage();
    await screen.findByRole('heading', { name: `${future} 菜單` });
    fireEvent.change(screen.getByLabelText('菜單名稱'), { target: { value: '午夜前已凍結菜單' } });
    fireEvent.change(screen.getByLabelText('價格（新臺幣整數）'), { target: { value: '120' } });
    fireEvent.change(screen.getByRole('combobox', { name: '供應商' }), { target: { value: activeVendor.vendorId } });
    fireEvent.click(screen.getByRole('button', { name: '儲存菜單' }));
    await screen.findByText('結果確認中，請勿重複操作。');
    fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));

    expect(await screen.findByText(/命令編號已存在，但伺服器內容與原操作不符/)).toBeInTheDocument();
    expect(repository.confirmPendingIntent).toHaveBeenCalledTimes(1);
    expect(repository.setDayMenu).toHaveBeenCalledTimes(1);
    expect(repository.setDayMenu.mock.calls[0][0]).toMatchObject({
      commandId,
      dayId: future,
      selectionDate: today,
      expectedHeadSeq: 24,
    });
    expect(screen.queryByText(new RegExp(`已確認 設定 ${future} 菜單 完成`))).not.toBeInTheDocument();
  });

  describe('改日期即載入（#651）', () => {
    const dateField = () => screen.getByLabelText('查看或設定日期');
    const nextDay = '2026-10-16';

    it('loads the server snapshot as soon as a complete valid date is chosen, without a load button', async () => {
      renderPage();
      await screen.findByRole('heading', { name: `${today} 營業日` });
      expect(screen.queryByRole('button', { name: '載入日期' })).not.toBeInTheDocument();
      repository.loadSnapshot.mockResolvedValueOnce(snapshot({ dayId: nextDay, day: { ...snapshot().day!, dayId: nextDay } }));

      fireEvent.change(dateField(), { target: { value: nextDay } });

      await screen.findByRole('heading', { name: `${nextDay} 營業日` });
      expect(repository.loadSnapshot).toHaveBeenLastCalledWith(nextDay);
    });

    it('does not read for an empty date or one before the go-live date, and keeps the original error', async () => {
      renderPage();
      await screen.findByRole('heading', { name: `${today} 營業日` });
      repository.loadSnapshot.mockClear();

      fireEvent.change(dateField(), { target: { value: '' } });
      fireEvent.blur(dateField());
      fireEvent.change(dateField(), { target: { value: '2026-10-10' } });

      expect(repository.loadSnapshot).not.toHaveBeenCalled();
      expect(await screen.findByRole('alert')).toHaveTextContent(`營業日必須是 ${today} 或之後的有效日期。`);
    });

    it('waits for Enter or blur while the date is being typed by keyboard', async () => {
      renderPage();
      await screen.findByRole('heading', { name: `${today} 營業日` });
      repository.loadSnapshot.mockClear();
      repository.loadSnapshot.mockResolvedValue(snapshot({ dayId: nextDay, day: { ...snapshot().day!, dayId: nextDay } }));

      fireEvent.keyDown(dateField(), { key: '6' });
      fireEvent.change(dateField(), { target: { value: nextDay } });
      expect(repository.loadSnapshot).not.toHaveBeenCalled();

      fireEvent.keyDown(dateField(), { key: 'Enter' });
      await screen.findByRole('heading', { name: `${nextDay} 營業日` });
      expect(repository.loadSnapshot).toHaveBeenCalledTimes(1);
      expect(repository.loadSnapshot).toHaveBeenCalledWith(nextDay);
    });

    it('loads typed dates on blur', async () => {
      renderPage();
      await screen.findByRole('heading', { name: `${today} 營業日` });
      repository.loadSnapshot.mockClear();
      repository.loadSnapshot.mockResolvedValue(snapshot({ dayId: nextDay, day: { ...snapshot().day!, dayId: nextDay } }));

      fireEvent.keyDown(dateField(), { key: '6' });
      fireEvent.change(dateField(), { target: { value: nextDay } });
      expect(repository.loadSnapshot).not.toHaveBeenCalled();
      fireEvent.blur(dateField());

      await screen.findByRole('heading', { name: `${nextDay} 營業日` });
      expect(repository.loadSnapshot).toHaveBeenCalledWith(nextDay);
    });

    it('asks before discarding an unsent draft: cancel keeps the draft and date, confirm loads', async () => {
      renderPage();
      await screen.findByRole('heading', { name: `${today} 營業日` });
      repository.loadSnapshot.mockClear();
      fireEvent.change(screen.getByLabelText('菜單名稱'), { target: { value: '未送出的菜單' } });

      fireEvent.change(dateField(), { target: { value: nextDay } });
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent('捨棄草稿');
      expect(repository.loadSnapshot).not.toHaveBeenCalled();

      fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(repository.loadSnapshot).not.toHaveBeenCalled();
      expect(screen.getByLabelText('菜單名稱')).toHaveValue('未送出的菜單');
      expect(dateField()).toHaveValue(today);

      repository.loadSnapshot.mockResolvedValueOnce(snapshot({ dayId: nextDay, day: { ...snapshot().day!, dayId: nextDay } }));
      fireEvent.change(dateField(), { target: { value: nextDay } });
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '捨棄並載入' }));
      await screen.findByRole('heading', { name: `${nextDay} 營業日` });
      expect(repository.loadSnapshot).toHaveBeenCalledWith(nextDay);
    });

    it('applies only the last response when an older read resolves late', async () => {
      let resolveOld: (value: CloudDayVendorSnapshot) => void = () => {};
      repository.loadSnapshot
        .mockImplementationOnce(() => new Promise<CloudDayVendorSnapshot>(resolve => { resolveOld = resolve; }))
        .mockResolvedValueOnce(snapshot({ dayId: today }));
      const view = renderPage();
      view.rerender(<CloudDayVendorsPage db={{} as Firestore} leaseEpoch={5} identityKey="uid-a:5" />);
      await screen.findByRole('heading', { name: `${today} 營業日` });

      await act(async () => { resolveOld(snapshot({ dayId: future, day: { ...snapshot().day!, dayId: future } })); });

      expect(screen.getByRole('heading', { name: `${today} 營業日` })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: `${future} 營業日` })).not.toBeInTheDocument();
    });
  });

  describe('說明收進「?」、警示常駐（#650）', () => {
    it('moves explanations into HelpTip and drops the details block and engineering terms', async () => {
      repository.loadSnapshot.mockResolvedValue(snapshot({
        vendors: [vendor('inactive-vendor', { status: 'inactive' })],
      }));
      const { container } = renderPage();
      await screen.findByRole('heading', { name: `${today} 營業日` });

      expect(container.querySelector('details')).toBeNull();
      expect(screen.queryByText(/使用權日期來自伺服器租約時間/)).not.toBeInTheDocument();
      expect(screen.queryByText(/tombstone/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/資料序號/)).not.toBeInTheDocument();
      expect(screen.queryByText(/逐筆伺服器命令/)).not.toBeInTheDocument();
      for (const name of ['資料與歷史說明', '營業日說明', '供應商說明']) {
        expect(screen.getByRole('button', { name })).toBeInTheDocument();
      }

      fireEvent.click(screen.getByRole('button', { name: '供應商說明' }));
      const tip = screen.getByRole('tooltip');
      expect(tip).toHaveTextContent('停用的供應商可以恢復');
      expect(tip).toHaveTextContent('移除後不能恢復，編號也不會再使用');
      expect(tip).toHaveTextContent('不會改到已存的菜單與交易');
      expect(tip.textContent).not.toMatch(/tombstone/i);
    });

    it('keeps the midnight sentence visible and out of the HelpTip', async () => {
      renderPage();
      await screen.findByRole('heading', { name: `${today} 營業日` });
      const note = screen.getByText(/若跨過臺北午夜，請先取得伺服器更新的使用權，再重新載入。/);
      expect(note.closest('.callout-ui')).not.toBeNull();
      expect(note.textContent).not.toMatch(/瀏覽器時鐘/);
    });

    it('shows blocked-action reasons as Callout', async () => {
      repository.loadSnapshot.mockResolvedValue(snapshot({ day: { ...snapshot().day!, status: 'closed' } }));
      renderPage();
      await screen.findByRole('heading', { name: `${today} 營業日` });
      const closed = screen.getAllByText(/此日期已關帳，不能修改/);
      expect(closed.length).toBeGreaterThanOrEqual(2);
      for (const node of closed) expect(node.closest('.callout-ui.callout-warn')).not.toBeNull();
    });

    it('shows the future-day opening block reason as Callout', async () => {
      repository.loadSnapshot.mockResolvedValue(snapshot({
        dayId: future, selectionDate: today, day: { ...snapshot().day!, dayId: future },
      }));
      renderPage();
      const note = await screen.findByText(/此日期可預排菜單，但不能預先開帳/);
      expect(note.closest('.callout-ui.callout-warn')).not.toBeNull();
    });

    it('keeps an always-visible irreversibility warning in the remove form', async () => {
      repository.loadSnapshot.mockResolvedValue(snapshot({
        vendors: [vendor('inactive-vendor', { status: 'inactive' })],
      }));
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: '移除' }));
      const form = screen.getByRole('form', { name: '移除供應商 inactive-vendor' });
      const warning = within(form).getByText(/移除後不能恢復，編號也不會再使用/);
      expect(warning.closest('.callout-ui.callout-warn')).not.toBeNull();
      expect(form.textContent).not.toMatch(/tombstone/i);
    });

    it('places the menu and opening-cash panels side by side in one row', async () => {
      renderPage();
      const menu = await screen.findByRole('region', { name: '日期菜單設定' });
      const opening = screen.getByRole('region', { name: '開帳現金設定' });
      expect(menu.parentElement).toBe(opening.parentElement);
      expect(menu.parentElement).toHaveClass('cloud-day-vendors__panels');
    });
  });
});

describe('CloudDayVendorsPage: ledger warnings and the opening difference reason (contract §11)', () => {
  const readyLedger = (change: Partial<Extract<CloudLedgerView, { status: 'ready' }>['snapshot']> = {}): CloudLedgerView => ({
    status: 'ready',
    snapshot: {
      today, goLiveDate: '2026-10-01', anomalies: [], seq: 10,
      closedDays: [{ dayId: '2026-10-13', countedCash: 870 }],
      ...change,
    },
  });
  const commandId = '00000000-0000-4000-8000-000000000007';

  function renderWithLedger(ledger: CloudLedgerView, extra: {
    onOpenAnomalies?: () => void;
    onLedgerChanged?: () => void;
    onNavigationStateChange?: (identityKey: string, state: 'recovering' | 'revoked' | 'resolved') => void;
  } = {}) {
    return render(
      <CloudDayVendorsPage db={{} as Firestore} leaseEpoch={4} identityKey="uid-a:4" ledger={ledger} {...extra} />,
    );
  }

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue(commandId) });
    repository.loadSnapshot.mockResolvedValue(snapshot());
    repository.setOpeningCash.mockResolvedValue(successful(commandId, 'SetOpeningCash', { dayId: today }));
    repository.findPreviousClosed.mockResolvedValue({ previous: { dayId: '2026-10-13', countedCash: 870 }, seq: 10 });
    repository.readCommand.mockResolvedValue(null);
  });

  it('shows a banner with the unclosed past days and a button to the anomalies page', async () => {
    const onOpenAnomalies = vi.fn();
    renderWithLedger(readyLedger({
      anomalies: [
        { kind: 'unclosed-past-day', dayId: '2026-10-12', status: 'open', openingCash: 500, activeTransactionCount: 2 },
        { kind: 'unclosed-past-day', dayId: '2026-10-14', status: 'reopened', openingCash: null, activeTransactionCount: 1 },
        { kind: 'opening-mismatch', dayId: '2026-10-14', openingCash: 1, previousClosedDayId: '2026-10-13', previousCountedCash: 2, previousPostCloseNet: 0, previousEffectiveCash: 2, difference: -1, daysApart: 1, gapDays: [], gapDayCount: 0 },
      ],
    }), { onOpenAnomalies });
    const banner = await screen.findByLabelText('過去未關帳警示');
    expect(banner).toHaveTextContent('過去有 2 天尚未關帳（2026-10-12、2026-10-14）');
    fireEvent.click(within(banner).getByRole('button', { name: '查看帳務異常' }));
    expect(onOpenAnomalies).toHaveBeenCalledTimes(1);
  });

  it('presents the unclosed-past-day banner through Callout with the same name and button', async () => {
    const onOpenAnomalies = vi.fn();
    renderWithLedger(readyLedger({
      anomalies: [{ kind: 'unclosed-past-day', dayId: '2026-10-12', status: 'open', openingCash: 500, activeTransactionCount: 2 }],
    }), { onOpenAnomalies });
    const banner = await screen.findByLabelText('過去未關帳警示');
    expect(banner.closest('.callout-ui.callout-warn')).not.toBeNull();
    fireEvent.click(within(banner).getByRole('button', { name: '查看帳務異常' }));
    expect(onOpenAnomalies).toHaveBeenCalledTimes(1);
  });

  it('shows no banner without unclosed past days, while loading, on failure, or without a ledger', async () => {
    for (const ledger of [readyLedger(), { status: 'loading' } as CloudLedgerView, { status: 'error', message: 'x' } as CloudLedgerView]) {
      const view = renderWithLedger(ledger);
      await screen.findByRole('form', { name: `${today} 開帳現金` });
      expect(screen.queryByLabelText('過去未關帳警示')).not.toBeInTheDocument();
      view.unmount();
    }
    renderPage();
    await screen.findByRole('form', { name: `${today} 開帳現金` });
    expect(screen.queryByLabelText('過去未關帳警示')).not.toBeInTheDocument();
  });

  it.each(['LEASE_LOST', 'UNAUTHORIZED'] as const)(
    'revokes the confirmed opening operation when cleanup observes %s',
    async code => {
      const onLedgerChanged = vi.fn();
      const onNavigationStateChange = vi.fn();
      repository.loadSnapshot.mockResolvedValueOnce(snapshot({ vendors: [vendor('private-vendor')] }));
      repository.cleanupConfirmedIntent.mockRejectedValueOnce({ code, message: 'authority changed' });
      repository.findPreviousClosed.mockResolvedValueOnce({
        previous: { dayId: '2026-10-13', countedCash: 870 }, seq: 10,
      });

      renderWithLedger(readyLedger(), { onLedgerChanged, onNavigationStateChange });
      const form = await screen.findByRole('form', { name: `${today} 開帳現金` });
      fireEvent.change(within(form).getByRole('textbox', { name: /^開帳現金/ }), { target: { value: '870' } });
      await waitFor(() => expect(within(form).getByRole('button', { name: '確認開帳金額' })).toBeEnabled());
      fireEvent.click(within(form).getByRole('button', { name: '確認開帳金額' }));

      expect(await screen.findByText('授權狀態已失效。敏感資料與操作草稿已清除；請重新登入並取得有效使用權。')).toBeInTheDocument();
      const recovery = screen.getByRole('alert', { name: '命令結果確認' });
      expect(recovery).toHaveTextContent('使用權已變更；敏感操作內容已清除。');
      expect(recovery).toHaveTextContent(commandId);
      expect(recovery).not.toHaveTextContent('開帳現金');
      expect(screen.queryByTestId('cloud-vendor-row-private-vendor')).not.toBeInTheDocument();
      expect(screen.queryByRole('form', { name: `${today} 開帳現金` })).not.toBeInTheDocument();
      expect(screen.queryByText(new RegExp(`已確認 確認 ${today} 開帳現金 完成`))).not.toBeInTheDocument();
      expect(repository.setOpeningCash).toHaveBeenCalledOnce();
      expect(repository.cleanupConfirmedIntent).toHaveBeenCalledOnce();
      expect(repository.loadSnapshot).toHaveBeenCalledOnce();
      expect(onLedgerChanged).not.toHaveBeenCalled();
      await waitFor(() => expect(onNavigationStateChange).toHaveBeenLastCalledWith('uid-a:4', 'revoked'));
    },
  );

  it('keeps a confirmed opening result and refreshes once when local journal cleanup fails', async () => {
    const onLedgerChanged = vi.fn();
    const onNavigationStateChange = vi.fn();
    repository.cleanupConfirmedIntent.mockRejectedValueOnce({
      code: 'LOCAL_STORAGE_UNAVAILABLE', message: 'local journal unavailable',
    });
    repository.findPreviousClosed.mockResolvedValueOnce({
      previous: { dayId: '2026-10-13', countedCash: 870 }, seq: 10,
    });

    renderWithLedger(readyLedger(), { onLedgerChanged, onNavigationStateChange });
    const form = await screen.findByRole('form', { name: `${today} 開帳現金` });
    fireEvent.change(within(form).getByRole('textbox', { name: /^開帳現金/ }), { target: { value: '870' } });
    await waitFor(() => expect(within(form).getByRole('button', { name: '確認開帳金額' })).toBeEnabled());
    fireEvent.click(within(form).getByRole('button', { name: '確認開帳金額' }));

    expect(await screen.findByText(new RegExp(`已確認 確認 ${today} 開帳現金 完成`))).toBeInTheDocument();
    expect(screen.getByText(/本機命令追蹤清理未完成；伺服器回執仍已確認/)).toBeInTheDocument();
    expect(repository.setOpeningCash).toHaveBeenCalledOnce();
    expect(repository.cleanupConfirmedIntent).toHaveBeenCalledOnce();
    expect(repository.loadSnapshot).toHaveBeenCalledTimes(2);
    expect(onLedgerChanged).toHaveBeenCalledOnce();
    await waitFor(() => expect(onNavigationStateChange).toHaveBeenLastCalledWith('uid-a:4', 'resolved'));
  });

  it('requires a trimmed reason when the opening differs from the last close and sends it with the command', async () => {
    const onLedgerChanged = vi.fn();
    repository.loadSnapshot
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot({ day: { ...snapshot().day!, revision: 4, openingCash: 800, openedBy: 'uid-a', openedAt: '2026-10-15T01:00:00.000Z' } }));
    renderWithLedger(readyLedger(), { onLedgerChanged });
    const form = await screen.findByRole('form', { name: `${today} 開帳現金` });
    await waitFor(() => expect(within(form).getByText(/上一個已關帳日 2026-10-13 的實點現金為 NT\$ 870/)).toBeInTheDocument());
    fireEvent.change(within(form).getByRole('textbox', { name: /^開帳現金/ }), { target: { value: '800' } });
    expect(within(form).getByRole('alert')).toHaveTextContent('少了 NT$ 70');

    await waitFor(() => expect(within(form).getByRole('button', { name: '確認開帳金額' })).toBeEnabled());
    fireEvent.click(within(form).getByRole('button', { name: '確認開帳金額' }));
    expect(await screen.findByText(/必須填寫 1 至 500 字的差額原因/)).toBeInTheDocument();
    fireEvent.change(within(form).getByRole('textbox', { name: /差額原因/ }), { target: { value: '   ' } });
    await waitFor(() => expect(within(form).getByRole('button', { name: '確認開帳金額' })).toBeEnabled());
    fireEvent.click(within(form).getByRole('button', { name: '確認開帳金額' }));
    expect(repository.setOpeningCash).not.toHaveBeenCalled();

    fireEvent.change(within(form).getByRole('textbox', { name: /差額原因/ }), { target: { value: '  前一天少記一筆收入  ' } });
    await waitFor(() => expect(within(form).getByRole('button', { name: '確認開帳金額' })).toBeEnabled());
    fireEvent.click(within(form).getByRole('button', { name: '確認開帳金額' }));
    await waitFor(() => expect(repository.setOpeningCash).toHaveBeenCalledWith({
      commandId, leaseEpoch: 4, dayId: today, expectedRevision: 3, openingCash: 800, reason: '前一天少記一筆收入',
    }));
    expect(await screen.findByText(/已確認 確認 2026-10-15 開帳現金 完成/)).toBeInTheDocument();
    await waitFor(() => expect(onLedgerChanged).toHaveBeenCalledTimes(1));
  });

  it('does not ask for or send a reason when the opening equals the last close or no day was closed', async () => {
    renderWithLedger(readyLedger());
    const form = await screen.findByRole('form', { name: `${today} 開帳現金` });
    fireEvent.change(within(form).getByRole('textbox', { name: /^開帳現金/ }), { target: { value: '870' } });
    expect(within(form).queryByRole('textbox', { name: /差額原因/ })).not.toBeInTheDocument();
    await waitFor(() => expect(within(form).getByRole('button', { name: '確認開帳金額' })).toBeEnabled());
    fireEvent.click(within(form).getByRole('button', { name: '確認開帳金額' }));
    await waitFor(() => expect(repository.setOpeningCash).toHaveBeenCalledWith({
      commandId, leaseEpoch: 4, dayId: today, expectedRevision: 3, openingCash: 870,
    }));
  });

  it('sends a plain opening when there is no closed day', async () => {
    repository.findPreviousClosed.mockResolvedValue({ previous: null, seq: 10 });
    renderWithLedger(readyLedger({ closedDays: [] }));
    const form = await screen.findByRole('form', { name: `${today} 開帳現金` });
    fireEvent.change(within(form).getByRole('textbox', { name: /^開帳現金/ }), { target: { value: '5000' } });
    expect(within(form).queryByRole('textbox', { name: /差額原因/ })).not.toBeInTheDocument();
    await waitFor(() => expect(within(form).getByRole('button', { name: '確認開帳金額' })).toBeEnabled());
    fireEvent.click(within(form).getByRole('button', { name: '確認開帳金額' }));
    await waitFor(() => expect(repository.setOpeningCash).toHaveBeenCalledWith(
      expect.not.objectContaining({ reason: expect.anything() }),
    ));
  });

  it('asks for the previous closed day of the shown day only, not through the whole anomaly scan', async () => {
    renderWithLedger({ status: 'error', message: '整段掃描失敗' });
    const form = await screen.findByRole('form', { name: `${today} 開帳現金` });
    await waitFor(() => expect(within(form).getByText(/上一個已關帳日 2026-10-13 的實點現金為 NT\$ 870/)).toBeInTheDocument());
    expect(repository.findPreviousClosed).toHaveBeenCalledWith(today);
    expect(within(form).getByRole('button', { name: '確認開帳金額' })).toBeEnabled();
  });

  it('looks the previous closed day up again after the ledger snapshot changes', async () => {
    const view = renderWithLedger(readyLedger());
    await screen.findByRole('form', { name: `${today} 開帳現金` });
    await waitFor(() => expect(repository.findPreviousClosed).toHaveBeenCalledTimes(1));
    view.rerender(
      <CloudDayVendorsPage db={{} as Firestore} leaseEpoch={4} identityKey="uid-a:4" ledger={readyLedger({ seq: 11 })} />,
    );
    await waitFor(() => expect(repository.findPreviousClosed).toHaveBeenCalledTimes(2));
  });

  it('blocks opening while the last close is unknown (the lookup is pending)', async () => {
    repository.findPreviousClosed.mockReturnValue(new Promise(() => undefined));
    renderWithLedger(readyLedger());
    const form = await screen.findByRole('form', { name: `${today} 開帳現金` });
    expect(within(form).getByText('正在確認上一個已關帳日的實點現金…')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: '確認開帳金額' })).toBeDisabled();
  });

  it('blocks opening with the reason when the lookup failed', async () => {
    repository.findPreviousClosed.mockRejectedValue(new Error('離線'));
    renderWithLedger(readyLedger());
    const form = await screen.findByRole('form', { name: `${today} 開帳現金` });
    expect(await within(form).findByText(/無法確認上一個已關帳日的實點現金（離線），暫時不能開帳/)).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: '確認開帳金額' })).toBeDisabled();
  });

  it('retries a failed lookup from a button, without reloading the page', async () => {
    repository.findPreviousClosed
      .mockRejectedValueOnce(new Error('離線'))
      .mockResolvedValue({ previous: { dayId: '2026-10-13', countedCash: 870 }, seq: 10 });
    renderWithLedger(readyLedger());
    const form = await screen.findByRole('form', { name: `${today} 開帳現金` });
    await within(form).findByText(/無法確認上一個已關帳日的實點現金（離線）/);
    expect(within(form).getByRole('button', { name: '確認開帳金額' })).toBeDisabled();

    fireEvent.click(screen.getByTestId('opening-lookup-retry'));
    await waitFor(() => expect(within(form).getByText(/上一個已關帳日 2026-10-13 的實點現金為 NT\$ 870/)).toBeInTheDocument());
    expect(repository.findPreviousClosed).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('opening-lookup-retry')).not.toBeInTheDocument();
    expect(within(form).getByRole('button', { name: '確認開帳金額' })).toBeEnabled();
  });
});

// #585 P2: a command is answered quietly: no text panel while sending, the page keeps its content while it re-reads after the
// receipt, and the success sentence is a short toast (no sequence number); a local cleanup warning stays visible.
describe('CloudDayVendorsPage: #585 quiet command feedback', () => {
  const commandId = '00000000-0000-4000-8000-000000000007';
  const toastText = () => screen.getByTestId('toast').querySelector('.toast__text')?.textContent ?? null;
  const openedSnapshot = () => snapshot({
    day: { ...snapshot().day!, revision: 4, openingCash: 80, openedBy: 'uid-a', openedAt: '2026-10-15T01:00:00.000Z' },
  });

  beforeEach(() => {
    vi.resetAllMocks();
    currentAuth.uid = 'uid-a';
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue(commandId) });
    repository.loadSnapshot.mockResolvedValue(snapshot());
    repository.setOpeningCash.mockResolvedValue(successful(commandId, 'SetOpeningCash', { dayId: today }));
    repository.readCommand.mockResolvedValue(null);
    repository.confirmPendingIntent.mockResolvedValue({ status: 'not-found' });
    repository.cleanupConfirmedIntent.mockResolvedValue(true);
  });

  async function submitOpening() {
    const form = await screen.findByRole('form', { name: `${today} 開帳現金` });
    fireEvent.change(within(form).getByRole('textbox', { name: /^開帳現金/ }), { target: { value: '80' } });
    await waitFor(() => expect(within(form).getByRole('button', { name: '確認開帳金額' })).toBeEnabled());
    fireEvent.click(within(form).getByRole('button', { name: '確認開帳金額' }));
  }

  it('shows no text panel while a command is being sent: only the progress bar', async () => {
    let resolveSave!: (result: CommandResult) => void;
    repository.setOpeningCash.mockReturnValueOnce(new Promise<CommandResult>(resolve => { resolveSave = resolve; }));
    renderPage();
    await submitOpening();
    await waitFor(() => expect(repository.setOpeningCash).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert', { name: '命令結果確認' })).not.toBeInTheDocument();
    expect(screen.queryByText(/命令送出中/)).not.toBeInTheDocument();
    expect(screen.getByTestId('command-progress')).toHaveAttribute('data-active', 'true');
    // The confirmed content stays on screen, locked, while the command is in flight.
    expect(screen.getByRole('heading', { name: `${today} 營業日` })).toBeInTheDocument();
    expect(screen.getByTestId('cloud-day-vendors-content')).toHaveAttribute('inert');
    repository.loadSnapshot.mockResolvedValueOnce(openedSnapshot());
    await act(async () => resolveSave(successful(commandId, 'SetOpeningCash', { dayId: today })));
    await waitFor(() => expect(toastText()).toBe('已確認 確認 2026-10-15 開帳現金 完成'));
    expect(screen.getByTestId('cloud-day-vendors-content')).not.toHaveAttribute('inert');
  });

  it('keeps the previous content in place, locked, while it re-reads after the receipt', async () => {
    let finishRead!: () => void;
    repository.loadSnapshot
      .mockResolvedValueOnce(snapshot())
      .mockImplementationOnce(() => new Promise(resolve => { finishRead = () => resolve(openedSnapshot()); }));
    renderPage();
    await submitOpening();
    await waitFor(() => expect(repository.loadSnapshot).toHaveBeenCalledTimes(2));

    expect(screen.queryByText(/正在從伺服器載入完整營業日/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert', { name: '命令結果確認' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: `${today} 營業日` })).toBeInTheDocument();
    expect(screen.getByTestId('cloud-day-vendors-content')).toHaveAttribute('inert');
    expect(screen.queryByTestId('toast')).not.toBeInTheDocument();
    expect(screen.getByTestId('command-progress')).toHaveAttribute('data-active', 'true');

    await act(async () => finishRead());
    await waitFor(() => expect(toastText()).toBe('已確認 確認 2026-10-15 開帳現金 完成'));
    expect(screen.getByTestId('cloud-day-vendors-content')).not.toHaveAttribute('inert');
    expect(screen.queryByText(/命令序號|伺服器資料已重新讀取/)).not.toBeInTheDocument();
  });

  it('does not keep the previous content when the lease is lost during the re-read (fail closed)', async () => {
    let failRead!: () => void;
    repository.loadSnapshot
      .mockResolvedValueOnce(snapshot())
      .mockImplementationOnce(() => new Promise((_, reject) => {
        failRead = () => reject({ code: 'LEASE_LOST', message: 'lease changed' });
      }));
    renderPage();
    await submitOpening();
    await waitFor(() => expect(repository.loadSnapshot).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('heading', { name: `${today} 營業日` })).toBeInTheDocument();

    await act(async () => failRead());
    expect(await screen.findByText(/授權狀態已失效/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: `${today} 營業日` })).not.toBeInTheDocument();
    expect(screen.queryByTestId('cloud-day-vendors-content')).not.toBeInTheDocument();
  });

  it('shows a local cleanup warning as a lasting alert, not inside the toast', async () => {
    repository.cleanupConfirmedIntent.mockRejectedValueOnce({ code: 'LOCAL_STORAGE_UNAVAILABLE', message: 'local journal unavailable' });
    repository.loadSnapshot.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(openedSnapshot());
    renderPage();
    await submitOpening();
    await waitFor(() => expect(toastText()).toBe('已確認 確認 2026-10-15 開帳現金 完成'));
    expect(screen.getAllByRole('alert').some(node => /本機命令追蹤清理未完成；伺服器回執仍已確認/.test(node.textContent ?? ''))).toBe(true);
    expect(screen.getByTestId('toast')).not.toHaveTextContent('本機命令追蹤');
  });
});

describe('CloudDayVendorsPage: #587 P2 data updated elsewhere', () => {
  const head = (seq: number) => ({ seq, lastCommandId: `cmd-${seq}`, datasetId: 'demo-p07', targets: {} });

  beforeEach(() => {
    vi.resetAllMocks();
    currentAuth.uid = 'uid-a';
    headMock.current = null;
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue('00000000-0000-4000-8000-000000000007') });
    repository.loadSnapshot.mockResolvedValue(snapshot());
    repository.readCommand.mockResolvedValue(null);
    repository.confirmPendingIntent.mockResolvedValue({ status: 'not-found' });
    repository.cleanupConfirmedIntent.mockResolvedValue(true);
  });

  it('shows the notice when the data head is ahead of the snapshot, and its button reloads', async () => {
    repository.loadSnapshot
      .mockResolvedValueOnce(snapshot({ seq: 10 }))
      .mockResolvedValueOnce(snapshot({ seq: 12 }));
    headMock.current = head(12);
    renderPage();
    const notice = await screen.findByTestId('data-updated-notice');
    expect(notice).toHaveTextContent('其他裝置已更新資料。');
    fireEvent.click(within(notice).getByRole('button', { name: '重新載入' }));
    await waitFor(() => expect(repository.loadSnapshot).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('data-updated-notice')).toBeNull());
  });

  it('shows nothing when the snapshot is at the head, or there is no head', async () => {
    headMock.current = head(10);
    const view = renderPage();
    await screen.findByRole('heading', { name: `${today} 營業日` });
    expect(screen.queryByTestId('data-updated-notice')).toBeNull();
    view.unmount();
    headMock.current = null;
    renderPage();
    await screen.findByRole('heading', { name: `${today} 營業日` });
    expect(screen.queryByTestId('data-updated-notice')).toBeNull();
  });
});
