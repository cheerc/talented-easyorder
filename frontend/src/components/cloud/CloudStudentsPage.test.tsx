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

function renderPage(props: Partial<{ leaseEpoch: number; identityKey: string }> = {}) {
  return render(
    <CloudStudentsPage
      db={{} as Firestore}
      leaseEpoch={props.leaseEpoch ?? 4}
      identityKey={props.identityKey ?? 'uid-a:4'}
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
      studentId: '001',
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
    repository.createStudent
      .mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } })
      .mockResolvedValueOnce(successful('cmd-ui-001', 'CreateStudent', '001'));
    repository.list
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot([student('001', { displayName: '新學生' })]));
    renderPage();
    await screen.findByText(/目前伺服器名單是空的/);
    openCreateForm();
    fillCreateForm({ amount: '0', mode: '沿用既有核對結餘' });
    fireEvent.click(screen.getByRole('button', { name: '建立學生' }));
    expect(await screen.findByText('結果確認中，請勿重複建立／修改。')).toBeInTheDocument();
    expect(repository.createStudent).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
    expect(await screen.findByText(/伺服器目前尚未找到這筆命令/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '以相同命令編號重試' }));
    await waitFor(() => expect(repository.createStudent).toHaveBeenCalledTimes(2));
    expect(repository.createStudent.mock.calls[0][0]).toEqual(repository.createStudent.mock.calls[1][0]);
    expect(repository.readCommand).toHaveBeenCalledWith('cmd-ui-001');
    expect(await screen.findByText(/已確認 新增 001 完成/)).toBeInTheDocument();
  });

  it('drops every sensitive field on lease loss while retaining only the command ID', async () => {
    repository.createStudent.mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
    repository.readCommand.mockRejectedValueOnce({ code: 'LEASE_LOST', message: 'lease changed' });
    renderPage();
    await screen.findByText(/目前伺服器名單是空的/);
    openCreateForm();
    const form = within(screen.getByRole('form', { name: '新增學生' }));
    fireEvent.change(form.getByLabelText('學員編號'), { target: { value: 'STUDENT-PII-77' } });
    fireEvent.change(form.getByRole('textbox', { name: '姓名', exact: true }), { target: { value: '敏感姓名' } });
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
    for (const sensitiveValue of ['STUDENT-PII-77', '敏感姓名', '敏感別名', '敏感備註']) {
      expect(pageText).not.toContain(sensitiveValue);
    }
  });

  it('keeps a confirmed receipt when list reload fails and retries only the server list', async () => {
    repository.list
      .mockResolvedValueOnce(snapshot())
      .mockRejectedValueOnce({ code: 'OFFLINE', message: 'offline' })
      .mockResolvedValueOnce(snapshot([student('001', { displayName: '新學生' })]));
    renderPage();
    await screen.findByText(/目前伺服器名單是空的/);
    openCreateForm();
    fillCreateForm({ amount: '0', mode: '沿用既有核對結餘' });
    fireEvent.click(screen.getByRole('button', { name: '建立學生' }));

    expect(await screen.findByText('已找到伺服器回執，名單尚待再次讀取。')).toBeInTheDocument();
    expect(screen.getByText('伺服器命令序號 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查詢原命令結果' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新讀取伺服器名單' }));

    expect(await screen.findByText(/已確認 新增 001 完成/)).toBeInTheDocument();
    expect(repository.list).toHaveBeenCalledTimes(3);
    expect(repository.readCommand).not.toHaveBeenCalled();
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
    fireEvent.change(screen.getByLabelText('學員編號'), { target: { value: 'STUDENT-PII-77' } });
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '敏感姓名' } });
    fireEvent.change(screen.getByLabelText(/別名（逗號、頓號/), { target: { value: '敏感別名' } });
    fireEvent.change(screen.getByLabelText(/期初結餘/), { target: { value: '-7' } });
    fireEvent.click(screen.getByRole('radio', { name: /沿用既有核對結餘/ }));
    fireEvent.change(screen.getByLabelText('期初備註（選填，最多 500 字）'), { target: { value: '敏感備註' } });
    fireEvent.click(screen.getByRole('button', { name: '建立學生' }));

    await screen.findByText('結果確認中，請勿重複建立／修改。');
    fireEvent.click(screen.getByRole('button', { name: '重新載入名單' }));
    expect(await screen.findByText('使用權已變更；敏感操作內容已清除。')).toBeInTheDocument();

    await act(async () => resolveCommand(successful('cmd-ui-001', 'CreateStudent', 'STUDENT-PII-77')));

    expect(screen.getByText('命令編號 cmd-ui-001')).toBeInTheDocument();
    expect(screen.queryByText(/已找到伺服器回執/)).not.toBeInTheDocument();
    const pageText = screen.getByRole('main', { name: '雲端學生名單' }).textContent ?? '';
    for (const sensitiveValue of ['STUDENT-PII-77', '敏感姓名', '敏感別名', '敏感備註']) {
      expect(pageText).not.toContain(sensitiveValue);
    }
    expect(repository.list).toHaveBeenCalledTimes(2);
  });

  it('blocks same-identity retries after an initial list authorization denial', async () => {
    repository.list.mockRejectedValueOnce({ code: 'LEASE_LOST', message: 'lease changed' });
    renderPage();

    expect(await screen.findByText(/授權狀態已失效/)).toBeInTheDocument();
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
    fillCreateForm({ id: 'STUDENT-PII-88', name: '另一敏感姓名', amount: '0', mode: '沿用既有核對結餘' });
    fireEvent.click(screen.getByRole('button', { name: '建立學生' }));
    await screen.findByText('結果確認中，請勿重複建立／修改。');
    fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
    await waitFor(() => expect(repository.readCommand).toHaveBeenCalledWith('cmd-ui-001'));
    fireEvent.click(screen.getByRole('button', { name: '重新載入名單' }));

    await act(async () => rejectReceiptRead({ code: 'UNAUTHORIZED', message: 'token revoked' }));
    expect(await screen.findByText('使用權已變更；敏感操作內容已清除。')).toBeInTheDocument();
    await act(async () => resolveList(snapshot([student('STALE-PII-99', { displayName: '過期敏感名單' })])));

    expect(screen.getByText('命令編號 cmd-ui-001')).toBeInTheDocument();
    const pageText = screen.getByRole('main', { name: '雲端學生名單' }).textContent ?? '';
    for (const sensitiveValue of ['STUDENT-PII-88', '另一敏感姓名', 'STALE-PII-99', '過期敏感名單']) {
      expect(pageText).not.toContain(sensitiveValue);
    }
    expect(screen.queryByTestId('cloud-student-row-STALE-PII-99')).not.toBeInTheDocument();
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
});
