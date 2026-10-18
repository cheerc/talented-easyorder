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

const repository = vi.hoisted(() => ({
  loadSnapshot: vi.fn(),
  ensureDay: vi.fn(),
  saveVendor: vi.fn(),
  removeVendor: vi.fn(),
  setDayMenu: vi.fn(),
  setOpeningCash: vi.fn(),
  findPreviousClosed: vi.fn(),
  readCommand: vi.fn(),
}));

vi.mock('../../firebase/cloudDayVendorRepository', () => ({
  createCloudDayVendorRepository: () => repository,
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
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue('00000000-0000-4000-8000-000000000007') });
    repository.loadSnapshot.mockResolvedValue(snapshot());
    repository.ensureDay.mockResolvedValue(successful('00000000-0000-4000-8000-000000000007', 'EnsureDay', { dayId: future }));
    repository.saveVendor.mockResolvedValue(successful('00000000-0000-4000-8000-000000000007', 'SaveVendor', { vendorId: 'vendor-new' }));
    repository.removeVendor.mockResolvedValue(successful('00000000-0000-4000-8000-000000000007', 'RemoveVendor', { vendorId: 'vendor-old' }));
    repository.setDayMenu.mockResolvedValue(successful('00000000-0000-4000-8000-000000000007', 'SetDayMenu', { dayId: future }));
    repository.setOpeningCash.mockResolvedValue(successful('00000000-0000-4000-8000-000000000007', 'SetOpeningCash', { dayId: today }));
    repository.readCommand.mockResolvedValue(null);
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

  it('recovers an unknown opening command with the same UUID and frozen semantic input', async () => {
    const reportNavigationState = vi.fn();
    const commandId = '00000000-0000-4000-8000-000000000007';
    repository.setOpeningCash
      .mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } })
      .mockResolvedValueOnce(successful(commandId, 'SetOpeningCash', { dayId: today }));
    repository.readCommand.mockResolvedValue(receipt(commandId, 'SetOpeningCash', { dayId: today }));
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
    expect(repository.readCommand).toHaveBeenCalledWith(commandId);
    expect(repository.setOpeningCash).toHaveBeenCalledTimes(2);
    expect(repository.setOpeningCash.mock.calls[0][0]).toEqual(repository.setOpeningCash.mock.calls[1][0]);
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
    expect(await screen.findByText('命令送出中，請勿重複操作。')).toBeInTheDocument();

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
    await screen.findByText('命令送出中，請勿重複操作。');

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
    let rejectReceiptRead!: (error: unknown) => void;
    let resolveList!: (value: CloudDayVendorSnapshot) => void;
    repository.setOpeningCash.mockResolvedValueOnce({
      ok: false,
      error: { code: 'UNKNOWN_RESULT', message: 'unknown' },
    });
    repository.readCommand.mockReturnValueOnce(new Promise<CommandReceipt | null>((_resolve, reject) => { rejectReceiptRead = reject; }));
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
    await act(async () => { rejectReceiptRead({ code: 'UNAUTHORIZED', message: 'not authorized' }); });
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
      .mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } })
      .mockResolvedValueOnce({ ok: false, error: { code: 'INVALID_INPUT', message: 'existing command input differs' } });
    repository.readCommand.mockResolvedValueOnce({
      ...receipt(commandId, 'SetDayMenu', { dayId: future }),
      committedAt: '2026-10-15T16:01:00.000Z',
    });
    renderPage();
    await screen.findByRole('heading', { name: `${future} 菜單` });
    fireEvent.change(screen.getByLabelText('菜單名稱'), { target: { value: '午夜前已凍結菜單' } });
    fireEvent.change(screen.getByLabelText('價格（新臺幣整數）'), { target: { value: '120' } });
    fireEvent.change(screen.getByRole('combobox', { name: '供應商' }), { target: { value: activeVendor.vendorId } });
    fireEvent.click(screen.getByRole('button', { name: '儲存菜單' }));
    await screen.findByText('結果確認中，請勿重複操作。');
    fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));

    expect(await screen.findByText(/命令編號已存在，但伺服器內容與原操作不符/)).toBeInTheDocument();
    expect(repository.setDayMenu).toHaveBeenCalledTimes(2);
    expect(repository.setDayMenu.mock.calls[0][0]).toEqual(repository.setDayMenu.mock.calls[1][0]);
    expect(repository.setDayMenu.mock.calls[1][0]).toMatchObject({
      commandId,
      dayId: future,
      selectionDate: today,
      expectedHeadSeq: 24,
    });
    expect(screen.queryByText(new RegExp(`已確認 設定 ${future} 菜單 完成`))).not.toBeInTheDocument();
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

  function renderWithLedger(ledger: CloudLedgerView, extra: { onOpenAnomalies?: () => void; onLedgerChanged?: () => void } = {}) {
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
        { kind: 'opening-mismatch', dayId: '2026-10-14', openingCash: 1, previousClosedDayId: '2026-10-13', previousCountedCash: 2, difference: -1, daysApart: 1 },
      ],
    }), { onOpenAnomalies });
    const banner = await screen.findByLabelText('過去未關帳警示');
    expect(banner).toHaveTextContent('過去有 2 天尚未關帳（2026-10-12、2026-10-14）');
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
});
