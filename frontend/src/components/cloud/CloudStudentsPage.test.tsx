// UI contract tests use a controlled repository mock. They do not claim Firestore or Rules proof.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { CloudStudentList, CloudStudentRecord } from '../../firebase/cloudStudentRepository';
import type { CommandReceipt, CommandResult } from '../../domain/cloudCommands';
import { CloudStudentsPage } from './CloudStudentsPage';

const repository = vi.hoisted(() => ({
  list: vi.fn(),
  createStudent: vi.fn(),
  changeStudentCode: vi.fn(),
  editStudent: vi.fn(),
  setStudentStatus: vi.fn(),
  readCommand: vi.fn(),
}));

vi.mock('../../firebase/cloudStudentRepository', () => ({
  createCloudStudentRepository: () => repository,
}));

function student(studentId: string, overrides: Partial<CloudStudentRecord> = {}): CloudStudentRecord {
  return {
    studentId,
    studentCode: overrides.studentCode ?? studentId,
    displayName: '測試學生',
    aliases: [],
    status: 'active',
    openingBalance: { amount: 0, asOfDate: '2026-01-01', note: '', createdAt: '2026-01-01T00:00:00.000Z' },
    currentBalance: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    revision: 1,
    lastCommandId: 'prior-command',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function snapshot(students: CloudStudentRecord[] = []): CloudStudentList {
  return { students, seq: 0, datasetId: 'demo-dataset', goLiveDate: '2026-01-01' };
}

function receipt(commandId: string, kind: CommandReceipt['kind'], studentId: string): CommandReceipt {
  return {
    commandId,
    seq: 1,
    committedAt: '2026-01-02T00:00:00.000Z',
    kind,
    targets: { studentId },
    result: {},
  };
}

function successful(commandId: string, kind: CommandReceipt['kind'], studentId: string): CommandResult {
  return { ok: true, receipt: receipt(commandId, kind, studentId) };
}

function renderPage(
  props: Partial<{ leaseEpoch: number; identityKey: string }> = {},
  onNavigationStateChange?: (identityKey: string, state: 'recovering' | 'revoked' | 'resolved') => void,
) {
  return render(
    <CloudStudentsPage
      db={{} as Firestore}
      leaseEpoch={props.leaseEpoch ?? 4}
      identityKey={props.identityKey ?? 'uid-a:4'}
      onNavigationStateChange={onNavigationStateChange}
    />,
  );
}

function openCreateForm() {
  fireEvent.click(screen.getByRole('button', { name: '新增學生' }));
}

function fillCreateForm(input: { id?: string; name?: string; amount?: string; mode?: string }) {
  fireEvent.change(screen.getByLabelText('學員編號'), { target: { value: input.id ?? '001' } });
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: input.name ?? '新學生' } });
  if (input.amount !== undefined) {
    fireEvent.change(screen.getByLabelText(/期初結餘/), { target: { value: input.amount } });
  }
  if (input.mode) {
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(input.mode) }));
  }
}

describe('CloudStudentsPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue('cmd-ui-001') });
    repository.list.mockResolvedValue(snapshot());
    repository.createStudent.mockResolvedValue(successful('cmd-ui-001', 'CreateStudent', '001'));
    repository.changeStudentCode.mockResolvedValue(successful('cmd-ui-001', 'ChangeStudentCode', '001'));
    repository.editStudent.mockResolvedValue(successful('cmd-ui-001', 'EditStudent', '001'));
    repository.setStudentStatus.mockResolvedValue(successful('cmd-ui-001', 'SetStudentStatus', '001'));
    repository.readCommand.mockResolvedValue(null);
  });

  it('shows the exact student ID string, including leading zeroes, from the complete repository result', async () => {
    repository.list.mockResolvedValue(snapshot([student('001')]));
    renderPage();

    expect(await screen.findByTestId('cloud-student-row-001')).toBeInTheDocument();
    expect(screen.getByTestId('cloud-student-row-001')).toHaveTextContent('001');
    expect(repository.list).toHaveBeenCalledTimes(1);
  });

  it('requires an explicit opening amount and opening mode before creating', async () => {
    renderPage();
    await screen.findByText(/目前伺服器名單是空的/);
    openCreateForm();
    fillCreateForm({ amount: undefined });
    fireEvent.click(screen.getByRole('button', { name: '建立學生' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('期初結餘必須明確輸入整數');
    expect(repository.createStudent).not.toHaveBeenCalled();
  });

  it('sends a negative opening balance with the explicitly selected new-student date and waits for a server list reload', async () => {
    repository.list
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot([student('001', {
        displayName: '新學生',
        openingBalance: { amount: -25, asOfDate: '2026-01-02', note: '', createdAt: '2026-01-02T00:00:00.000Z' },
        currentBalance: -25,
        lastCommandId: 'cmd-ui-001',
      })]));
    renderPage();
    await screen.findByText(/目前伺服器名單是空的/);
    openCreateForm();
    fillCreateForm({ amount: '-25', mode: '建立新學生' });
    fireEvent.click(screen.getByRole('button', { name: '建立學生' }));

    await waitFor(() => expect(repository.createStudent).toHaveBeenCalledWith(expect.objectContaining({
      commandId: 'cmd-ui-001',
      leaseEpoch: 4,
      studentCode: '001',
      displayName: '新學生',
      openingBalance: expect.objectContaining({ amount: -25, note: '' }),
    })));
    expect(repository.createStudent.mock.calls[0][0].openingBalance.asOfDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(repository.list).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/已確認 新增 001 完成/)).toBeInTheDocument();
  });

  it('allows duplicate names and edits only name and aliases at the expected revision', async () => {
    repository.createStudent.mockResolvedValue(successful('cmd-ui-001', 'CreateStudent', '002'));
    repository.list
      .mockResolvedValueOnce(snapshot([student('001', { displayName: '相同姓名', revision: 3 })]))
      .mockResolvedValueOnce(snapshot([
        student('001', { displayName: '相同姓名', revision: 3 }),
        student('002', { displayName: '相同姓名', revision: 1, currentBalance: 0 }),
      ]))
      .mockResolvedValueOnce(snapshot([
        student('001', { displayName: '相同姓名', revision: 3 }),
        student('002', { displayName: '改過姓名', aliases: ['小乙'], revision: 2 }),
      ]));
    renderPage();
    await screen.findByTestId('cloud-student-row-001');
    openCreateForm();
    fillCreateForm({ id: '002', name: '相同姓名', amount: '0', mode: '沿用既有核對結餘' });
    fireEvent.click(screen.getByRole('button', { name: '建立學生' }));
    await screen.findByTestId('cloud-student-row-002');

    const row = screen.getByTestId('cloud-student-row-002');
    fireEvent.click(within(row).getByRole('button', { name: '編輯姓名與別名' }));
    const editForm = within(row).getByRole('form', { name: '編輯學生 002' });
    fireEvent.change(within(editForm).getByLabelText('姓名'), { target: { value: '改過姓名' } });
    fireEvent.change(within(editForm).getByLabelText('別名'), { target: { value: '小乙' } });
    fireEvent.click(within(editForm).getByRole('button', { name: '儲存姓名與別名' }));

    await waitFor(() => expect(repository.editStudent).toHaveBeenCalledWith({
      commandId: 'cmd-ui-001',
      leaseEpoch: 4,
      studentId: '002',
      expectedRevision: 1,
      displayName: '改過姓名',
      aliases: ['小乙'],
    }));
    expect(await screen.findByTestId('cloud-student-row-002')).toHaveTextContent('改過姓名');
  });

  it('requires a human status reason and sends it with the captured revision', async () => {
    repository.list
      .mockResolvedValueOnce(snapshot([student('001', { revision: 5 })]))
      .mockResolvedValueOnce(snapshot([student('001', { status: 'inactive', revision: 6 })]));
    renderPage();
    const row = await screen.findByTestId('cloud-student-row-001');
    fireEvent.click(within(row).getByRole('button', { name: '停用' }));
    fireEvent.click(within(row).getByRole('button', { name: '確認停用' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('請輸入具體的停用或恢復原因');
    expect(repository.setStudentStatus).not.toHaveBeenCalled();

    fireEvent.change(within(row).getByLabelText('原因（必填）'), { target: { value: '操作員確認此帳戶重複，暫時停用' } });
    fireEvent.click(within(row).getByRole('button', { name: '確認停用' }));
    await waitFor(() => expect(repository.setStudentStatus).toHaveBeenCalledWith({
      commandId: 'cmd-ui-001',
      leaseEpoch: 4,
      studentId: '001',
      expectedRevision: 5,
      status: 'inactive',
      reason: '操作員確認此帳戶重複，暫時停用',
    }));
    expect(await screen.findByText('已停用')).toBeInTheDocument();
  });

  it('keeps an unknown command ID and frozen payload for receipt lookup and same-ID retry', async () => {
    const reportNavigationState = vi.fn();
    repository.createStudent
      .mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } })
      .mockResolvedValueOnce(successful('cmd-ui-001', 'CreateStudent', '001'));
    repository.list
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot([student('001', { displayName: '新學生' })]));
    renderPage({}, reportNavigationState);
    await screen.findByText(/目前伺服器名單是空的/);
    openCreateForm();
    fillCreateForm({ amount: '0', mode: '沿用既有核對結餘' });
    fireEvent.click(screen.getByRole('button', { name: '建立學生' }));
    expect(await screen.findByText('結果確認中，請勿重複建立／修改。')).toBeInTheDocument();
    expect(repository.createStudent).toHaveBeenCalledTimes(1);
    expect(reportNavigationState).toHaveBeenLastCalledWith('uid-a:4', 'recovering');

    fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
    expect(await screen.findByText(/伺服器目前尚未找到這筆命令/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '以相同命令編號重試' }));
    await waitFor(() => expect(repository.createStudent).toHaveBeenCalledTimes(2));
    expect(repository.createStudent.mock.calls[0][0]).toEqual(repository.createStudent.mock.calls[1][0]);
    expect(repository.readCommand).toHaveBeenCalledWith('cmd-ui-001');
    expect(await screen.findByText(/已確認 新增 001 完成/)).toBeInTheDocument();
    expect(reportNavigationState).toHaveBeenLastCalledWith('uid-a:4', 'resolved');
  });

  it('drops every sensitive field on lease loss while retaining only the command ID', async () => {
    repository.createStudent.mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
    repository.readCommand.mockRejectedValueOnce({ code: 'LEASE_LOST', message: 'lease changed' });
    renderPage();
    await screen.findByText(/目前伺服器名單是空的/);
    openCreateForm();
    const form = within(screen.getByRole('form', { name: '新增學生' }));
    fireEvent.change(form.getByLabelText('學員編號'), { target: { value: '077' } });
    fireEvent.change(form.getByRole('textbox', { name: /^姓名$/ }), { target: { value: '敏感姓名' } });
    fireEvent.change(form.getByRole('textbox', { name: /別名（逗號、頓號/ }), { target: { value: '敏感別名' } });
    fireEvent.change(form.getByLabelText(/期初結餘/), { target: { value: '-7' } });
    fireEvent.click(form.getByRole('radio', { name: /沿用既有核對結餘/ }));
    fireEvent.change(form.getByLabelText('期初備註（選填，最多 500 字）'), { target: { value: '敏感備註' } });
    fireEvent.click(form.getByRole('button', { name: '建立學生' }));
    await screen.findByText('結果確認中，請勿重複建立／修改。');

    fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
    expect(await screen.findByText('使用權已變更；敏感操作內容已清除。')).toBeInTheDocument();
    expect(screen.getByText('命令編號 cmd-ui-001')).toBeInTheDocument();
    expect(screen.queryByText('查詢原命令結果')).not.toBeInTheDocument();
    const pageText = screen.getByRole('main', { name: '雲端學生名單' }).textContent ?? '';
    for (const sensitiveValue of ['077', '敏感姓名', '敏感別名', '敏感備註']) {
      expect(pageText).not.toContain(sensitiveValue);
    }
  });

  it('keeps a confirmed receipt when list reload fails and retries only the server list', async () => {
    const reportNavigationState = vi.fn();
    repository.list
      .mockResolvedValueOnce(snapshot())
      .mockRejectedValueOnce({ code: 'OFFLINE', message: 'offline' })
      .mockResolvedValueOnce(snapshot([student('001', { displayName: '新學生' })]));
    renderPage({}, reportNavigationState);
    await screen.findByText(/目前伺服器名單是空的/);
    openCreateForm();
    fillCreateForm({ amount: '0', mode: '沿用既有核對結餘' });
    fireEvent.click(screen.getByRole('button', { name: '建立學生' }));

    expect(await screen.findByText('已找到伺服器回執，名單尚待再次讀取。')).toBeInTheDocument();
    expect(reportNavigationState).toHaveBeenLastCalledWith('uid-a:4', 'recovering');
    expect(screen.getByText('伺服器命令序號 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查詢原命令結果' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新讀取伺服器名單' }));

    expect(await screen.findByText(/已確認 新增 001 完成/)).toBeInTheDocument();
    expect(repository.list).toHaveBeenCalledTimes(3);
    expect(repository.readCommand).not.toHaveBeenCalled();
    expect(reportNavigationState).toHaveBeenLastCalledWith('uid-a:4', 'resolved');
  });

  it('does not accept a receipt with the same ID until replay verifies the frozen command semantics', async () => {
    repository.createStudent
      .mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } })
      .mockResolvedValueOnce({ ok: false, error: { code: 'INVALID_INPUT', message: 'commandId 已用於不同的命令內容' } });
    repository.readCommand.mockResolvedValueOnce(receipt('cmd-ui-001', 'CreateStudent', 'OTHER-STUDENT'));
    renderPage();
    await screen.findByText(/目前伺服器名單是空的/);
    openCreateForm();
    fillCreateForm({ id: '001', name: '原學生', amount: '0', mode: '沿用既有核對結餘' });
    fireEvent.click(screen.getByRole('button', { name: '建立學生' }));
    await screen.findByText('結果確認中，請勿重複建立／修改。');

    fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));

    expect(await screen.findByText(/命令編號已存在，但伺服器內容與原操作不符/)).toBeInTheDocument();
    expect(repository.createStudent).toHaveBeenCalledTimes(2);
    expect(repository.createStudent.mock.calls[0][0]).toEqual(repository.createStudent.mock.calls[1][0]);
    expect(repository.list).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/已確認 新增/)).not.toBeInTheDocument();
  });

  it('does not restore a pending command after a concurrent list read loses authorization', async () => {
    let resolveCommand!: (result: CommandResult) => void;
    repository.createStudent.mockReturnValueOnce(new Promise<CommandResult>(resolve => {
      resolveCommand = resolve;
    }));
    repository.list
      .mockResolvedValueOnce(snapshot())
      .mockRejectedValueOnce({ code: 'LEASE_LOST', message: 'lease changed' });
    renderPage();
    await screen.findByText(/目前伺服器名單是空的/);
    openCreateForm();
    fireEvent.change(screen.getByLabelText('學員編號'), { target: { value: '077' } });
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '敏感姓名' } });
    fireEvent.change(screen.getByLabelText(/別名（逗號、頓號/), { target: { value: '敏感別名' } });
    fireEvent.change(screen.getByLabelText(/期初結餘/), { target: { value: '-7' } });
    fireEvent.click(screen.getByRole('radio', { name: /沿用既有核對結餘/ }));
    fireEvent.change(screen.getByLabelText('期初備註（選填，最多 500 字）'), { target: { value: '敏感備註' } });
    fireEvent.click(screen.getByRole('button', { name: '建立學生' }));

    await screen.findByText('結果確認中，請勿重複建立／修改。');
    fireEvent.click(screen.getByRole('button', { name: '重新載入名單' }));
    expect(await screen.findByText('使用權已變更；敏感操作內容已清除。')).toBeInTheDocument();

    await act(async () => resolveCommand(successful('cmd-ui-001', 'CreateStudent', '077')));

    expect(screen.getByText('命令編號 cmd-ui-001')).toBeInTheDocument();
    expect(screen.queryByText(/已找到伺服器回執/)).not.toBeInTheDocument();
    const pageText = screen.getByRole('main', { name: '雲端學生名單' }).textContent ?? '';
    for (const sensitiveValue of ['077', '敏感姓名', '敏感別名', '敏感備註']) {
      expect(pageText).not.toContain(sensitiveValue);
    }
    expect(repository.list).toHaveBeenCalledTimes(2);
  });

  it('blocks same-identity retries after an initial list authorization denial', async () => {
    const reportNavigationState = vi.fn();
    repository.list.mockRejectedValueOnce({ code: 'LEASE_LOST', message: 'lease changed' });
    const view = renderPage({}, reportNavigationState);

    expect(await screen.findByText(/授權狀態已失效/)).toBeInTheDocument();
    expect(reportNavigationState).toHaveBeenLastCalledWith('uid-a:4', 'revoked');
    view.rerender(
      <CloudStudentsPage
        db={{} as Firestore}
        leaseEpoch={4}
        identityKey="uid-a:4"
        onNavigationStateChange={reportNavigationState}
      />,
    );
    const reload = screen.getByRole('button', { name: '重新載入名單' });
    expect(reload).toBeDisabled();
    fireEvent.click(reload);

    expect(repository.list).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/重新載入整頁會再次向伺服器驗證/)).toBeInTheDocument();
  });

  it('does not restore a delayed list after receipt lookup loses authorization', async () => {
    let resolveList!: (value: CloudStudentList) => void;
    let rejectReceiptRead!: (error: unknown) => void;
    repository.createStudent.mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
    repository.list
      .mockResolvedValueOnce(snapshot())
      .mockReturnValueOnce(new Promise<CloudStudentList>(resolve => {
        resolveList = resolve;
      }));
    repository.readCommand.mockReturnValueOnce(new Promise<CommandReceipt | null>((_resolve, reject) => {
      rejectReceiptRead = reject;
    }));
    renderPage();
    await screen.findByText(/目前伺服器名單是空的/);
    openCreateForm();
    fillCreateForm({ id: '088', name: '另一敏感姓名', amount: '0', mode: '沿用既有核對結餘' });
    fireEvent.click(screen.getByRole('button', { name: '建立學生' }));
    await screen.findByText('結果確認中，請勿重複建立／修改。');
    fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
    await waitFor(() => expect(repository.readCommand).toHaveBeenCalledWith('cmd-ui-001'));
    fireEvent.click(screen.getByRole('button', { name: '重新載入名單' }));

    await act(async () => rejectReceiptRead({ code: 'UNAUTHORIZED', message: 'token revoked' }));
    expect(await screen.findByText('使用權已變更；敏感操作內容已清除。')).toBeInTheDocument();
    await act(async () => resolveList(snapshot([student('099', { displayName: '過期敏感名單' })])));

    expect(screen.getByText('命令編號 cmd-ui-001')).toBeInTheDocument();
    const pageText = screen.getByRole('main', { name: '雲端學生名單' }).textContent ?? '';
    for (const sensitiveValue of ['088', '另一敏感姓名', '099', '過期敏感名單']) {
      expect(pageText).not.toContain(sensitiveValue);
    }
    expect(screen.queryByTestId('cloud-student-row-099')).not.toBeInTheDocument();
    expect(repository.list).toHaveBeenCalledTimes(2);
  });

  it('clears old identity data immediately and ignores an old list promise after identity changes', async () => {
    let resolveOld!: (value: CloudStudentList) => void;
    repository.list
      .mockResolvedValueOnce(snapshot([student('OLD-PII', { displayName: '前一位操作員資料' })]))
      .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce(snapshot([student('NEW-PII', { displayName: '目前操作員資料' })]));
    const view = renderPage({ identityKey: 'uid-a:4' });
    expect(await screen.findByText('前一位操作員資料')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新載入名單' }));
    await waitFor(() => expect(repository.list).toHaveBeenCalledTimes(2));

    view.rerender(<CloudStudentsPage db={{} as Firestore} leaseEpoch={5} identityKey="uid-b:5" />);
    expect(screen.queryByText('前一位操作員資料')).not.toBeInTheDocument();
    expect(await screen.findByText('目前操作員資料')).toBeInTheDocument();

    await act(async () => resolveOld(snapshot([student('OLD-PII', { displayName: '前一位操作員資料' })])));
    expect(screen.queryByText('前一位操作員資料')).not.toBeInTheDocument();
    expect(screen.getByText('目前操作員資料')).toBeInTheDocument();
  });

  it('sorts students numerically by studentCode', async () => {
    repository.list.mockResolvedValue(snapshot([
      student('uuid-100', { studentCode: '100', displayName: '學生一百' }),
      student('uuid-002', { studentCode: '002', displayName: '學生二號' }),
      student('uuid-010', { studentCode: '010', displayName: '學生十號' }),
    ]));
    renderPage();

    await screen.findByTestId('cloud-student-row-002');
    const rows = screen.getAllByTestId(/^cloud-student-row-/);
    expect(rows[0]).toHaveTextContent('002');
    expect(rows[1]).toHaveTextContent('010');
    expect(rows[2]).toHaveTextContent('100');
  });

  it('renders gap rows for missing student codes and prefills code on click', async () => {
    repository.list.mockResolvedValue(snapshot([
      student('uuid-002', { studentCode: '002', displayName: '學生二號' }),
      student('uuid-005', { studentCode: '005', displayName: '學生五號' }),
    ]));
    renderPage();

    await screen.findByTestId('cloud-student-row-002');
    // 001 is missing (single gap)
    expect(screen.getByTestId('cloud-student-gap-001')).toHaveTextContent('001 尚無人使用');
    // 003..004 are missing (consecutive gap)
    expect(screen.getByTestId('cloud-student-gap-003')).toHaveTextContent('003–004 尚無人使用（2 個號碼）');

    // Click gap row 003–004 to prefill 003 into create form
    fireEvent.click(screen.getByTestId('cloud-student-gap-003'));
    const form = screen.getByRole('form', { name: '新增學生' });
    expect(within(form).getByLabelText('學員編號')).toHaveValue('003');
  });

  it('hides gap rows when searching', async () => {
    repository.list.mockResolvedValue(snapshot([
      student('uuid-002', { studentCode: '002', displayName: '學生二號' }),
      student('uuid-005', { studentCode: '005', displayName: '學生五號' }),
    ]));
    renderPage();

    await screen.findByTestId('cloud-student-row-002');
    expect(screen.getByTestId('cloud-student-gap-001')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('搜尋編號、姓名或別名'), { target: { value: '二號' } });
    expect(screen.queryByTestId('cloud-student-gap-001')).not.toBeInTheDocument();
    expect(screen.getByTestId('cloud-student-row-002')).toBeInTheDocument();
    expect(screen.queryByTestId('cloud-student-row-005')).not.toBeInTheDocument();
  });

  it('supports changing student code with ChangeStudentCode command and reason', async () => {
    repository.list
      .mockResolvedValueOnce(snapshot([
        student('uuid-002', { studentCode: '002', displayName: '王小明', revision: 2 }),
      ]))
      .mockResolvedValueOnce(snapshot([
        student('uuid-002', { studentCode: '015', displayName: '王小明', revision: 3 }),
      ]));
    renderPage();

    await screen.findByTestId('cloud-student-row-002');
    const row = screen.getByTestId('cloud-student-row-002');
    fireEvent.click(within(row).getByRole('button', { name: '改編號' }));

    const codeForm = within(row).getByRole('form', { name: '改編號 002' });
    fireEvent.change(within(codeForm).getByLabelText('新編號'), { target: { value: '015' } });
    fireEvent.change(within(codeForm).getByLabelText('改號原因（必填）'), { target: { value: '調班改號' } });
    fireEvent.click(within(codeForm).getByRole('button', { name: '確認改號' }));

    await waitFor(() => expect(repository.changeStudentCode).toHaveBeenCalledWith({
      commandId: 'cmd-ui-001',
      leaseEpoch: 4,
      studentId: 'uuid-002',
      expectedRevision: 2,
      studentCode: '015',
      reason: '調班改號',
    }));
  });
});
