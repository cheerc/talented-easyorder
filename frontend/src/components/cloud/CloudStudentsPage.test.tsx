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
  readOpeningDay: vi.fn(),
  ensureOpeningDay: vi.fn(),
  correctOpening: vi.fn(),
  readCommand: vi.fn(),
  commitStudentCommand: vi.fn(),
  confirmPendingIntent: vi.fn(),
  cleanupConfirmedIntent: vi.fn(),
}));

const currentAuth = vi.hoisted(() => ({ uid: 'uid-a' }));

vi.mock('../../firebase/cloudStudentRepository', () => ({
  createCloudStudentRepository: () => repository,
}));

vi.mock('../../firebase/cloudRecoveryReader', () => ({
  getCloudRecoveryReader: () => ({ assertCurrent: vi.fn() }),
}));

vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: { uid: currentAuth.uid } }),
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
    currentAuth.uid = 'uid-a';
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue('cmd-ui-001') });
    repository.list.mockResolvedValue(snapshot());
    repository.createStudent.mockResolvedValue(successful('cmd-ui-001', 'CreateStudent', '001'));
    repository.changeStudentCode.mockResolvedValue(successful('cmd-ui-001', 'ChangeStudentCode', '001'));
    repository.editStudent.mockResolvedValue(successful('cmd-ui-001', 'EditStudent', '001'));
    repository.setStudentStatus.mockResolvedValue(successful('cmd-ui-001', 'SetStudentStatus', '001'));
    repository.readCommand.mockResolvedValue(null);
    repository.confirmPendingIntent.mockResolvedValue({ status: 'not-found' });
    repository.readOpeningDay.mockResolvedValue({ dayId: '2026-01-01', revision: 3, status: 'open' });
    repository.ensureOpeningDay.mockResolvedValue({ ok: true, receipt: { ...receipt('cmd-ui-001', 'EnsureDay', '001'), targets: { dayId: '2026-01-01' } } });
    repository.correctOpening.mockResolvedValue(successful('cmd-ui-001', 'CorrectOpening', '001'));
    repository.commitStudentCommand.mockImplementation(intent => {
      if (intent.kind === 'create') return repository.createStudent(intent.input);
      if (intent.kind === 'edit') return repository.editStudent(intent.input);
      if (intent.kind === 'change-code') return repository.changeStudentCode(intent.input);
      if (intent.kind === 'status') return repository.setStudentStatus(intent.input);
      if (intent.kind === 'ensure-day') return repository.ensureOpeningDay(intent.input);
      return repository.correctOpening(intent.input);
    });
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
    expect(repository.confirmPendingIntent).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/已確認 新增 001 完成/)).toBeInTheDocument();
    expect(reportNavigationState).toHaveBeenLastCalledWith('uid-a:4', 'resolved');
  });

  it('drops every sensitive field on lease loss while retaining only the command ID', async () => {
    repository.createStudent.mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
    repository.confirmPendingIntent.mockRejectedValueOnce({ code: 'LEASE_LOST', message: 'lease changed' });
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
    expect(screen.getByText(/命令編號 cmd-ui-001/)).toBeInTheDocument();
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
    expect(repository.confirmPendingIntent).not.toHaveBeenCalled();
    expect(reportNavigationState).toHaveBeenLastCalledWith('uid-a:4', 'resolved');
  });

  it('keeps receipt recovery locked when the completed list belongs to a different dataset', async () => {
    const reportNavigationState = vi.fn();
    let resolveReplacementList!: (value: CloudStudentList) => void;
    repository.createStudent.mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
    repository.confirmPendingIntent.mockResolvedValueOnce({
      status: 'matched', receipt: receipt('cmd-ui-001', 'CreateStudent', '001'),
    });
    repository.cleanupConfirmedIntent.mockResolvedValueOnce(true);
    repository.list
      .mockResolvedValueOnce({ ...snapshot(), datasetId: 'dataset-A' })
      .mockReturnValueOnce(new Promise(resolve => { resolveReplacementList = resolve; }))
      .mockResolvedValueOnce({
        ...snapshot([student('replacement-student', { studentCode: '999', displayName: 'B 資料集學生' })]),
        datasetId: 'dataset-B',
      });
    renderPage({}, reportNavigationState);
    await screen.findByText(/目前伺服器名單是空的/);
    openCreateForm();
    fillCreateForm({ id: '001', name: 'A 資料集學生', amount: '0', mode: '沿用既有核對結餘' });
    fireEvent.click(screen.getByRole('button', { name: '建立學生' }));
    await screen.findByText('結果確認中，請勿重複建立／修改。');

    fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
    await waitFor(() => expect(repository.list).toHaveBeenCalledTimes(2));
    await act(async () => resolveReplacementList({
      ...snapshot([student('replacement-student', { studentCode: '999', displayName: 'B 資料集學生' })]),
      datasetId: 'dataset-B',
    }));

    expect(screen.queryByTestId('cloud-student-row-999')).not.toBeInTheDocument();
    const recoveryHeading = screen.getByText('已找到伺服器回執，名單尚待再次讀取。');
    const recovery = recoveryHeading.closest('section');
    if (!recovery) throw new Error('Receipt confirmation panel was not rendered');
    expect(recovery).toHaveTextContent('命令編號 cmd-ui-001');
    expect(recovery).toHaveTextContent('伺服器命令序號 1');
    expect(screen.getByText(/資料集已變更/)).toBeInTheDocument();
    expect(screen.queryByText('B 資料集學生')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新增學生' })).not.toBeInTheDocument();
    expect(screen.queryByText(/已確認 新增 001 完成/)).not.toBeInTheDocument();
    expect(reportNavigationState).toHaveBeenLastCalledWith('uid-a:4', 'recovering');

    fireEvent.click(screen.getByRole('button', { name: '重新讀取伺服器名單' }));
    await waitFor(() => expect(repository.list).toHaveBeenCalledTimes(3));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const repeatedRecovery = screen.getByText('已找到伺服器回執，名單尚待再次讀取。').closest('section');
    if (!repeatedRecovery) throw new Error('Receipt confirmation panel was not retained after reload');
    expect(repeatedRecovery).toHaveTextContent('命令編號 cmd-ui-001');
    expect(screen.getByText(/資料集已變更/)).toBeInTheDocument();
    expect(screen.queryByTestId('cloud-student-row-999')).not.toBeInTheDocument();
    expect(reportNavigationState).toHaveBeenLastCalledWith('uid-a:4', 'recovering');
  });

  it('checks a same-ID receipt with a read-only semantic query and never replays the commit', async () => {
    repository.createStudent.mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
    repository.confirmPendingIntent.mockRejectedValueOnce({ code: 'INVALID_INPUT', message: 'commandId 已用於不同的命令內容' });
    renderPage();
    await screen.findByText(/目前伺服器名單是空的/);
    openCreateForm();
    fillCreateForm({ id: '001', name: '原學生', amount: '0', mode: '沿用既有核對結餘' });
    fireEvent.click(screen.getByRole('button', { name: '建立學生' }));
    await screen.findByText('結果確認中，請勿重複建立／修改。');

    fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));

    expect(await screen.findByText(/命令編號已存在，但伺服器內容與原操作不符/)).toBeInTheDocument();
    expect(repository.confirmPendingIntent).toHaveBeenCalledTimes(1);
    expect(repository.createStudent).toHaveBeenCalledTimes(1);
    expect(repository.list).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/已確認 新增/)).not.toBeInTheDocument();
  });

  it('allows a read-only query at ten seconds but requires a fresh absence after the original settles before retry', async () => {
    vi.useFakeTimers();
    try {
      let settleOriginal!: (result: CommandResult) => void;
      repository.createStudent.mockReturnValueOnce(new Promise<CommandResult>(resolve => { settleOriginal = resolve; }));
      renderPage();
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      openCreateForm();
      fillCreateForm({ amount: '0', mode: '沿用既有核對結餘' });
      fireEvent.click(screen.getByRole('button', { name: '建立學生' }));

      expect(screen.queryByRole('button', { name: '查詢原命令結果' })).not.toBeInTheDocument();
      await act(async () => { vi.advanceTimersByTime(9_999); });
      expect(screen.queryByRole('button', { name: '查詢原命令結果' })).not.toBeInTheDocument();
      await act(async () => { vi.advanceTimersByTime(1); });
      expect(screen.getByText(/結果確認中，勿重新收款/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(repository.confirmPendingIntent).toHaveBeenCalledTimes(1);
      expect(repository.createStudent).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('button', { name: '以相同命令編號重試' })).not.toBeInTheDocument();

      await act(async () => { settleOriginal({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } }); });
      expect(screen.queryByRole('button', { name: '以相同命令編號重試' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(repository.confirmPendingIntent).toHaveBeenCalledTimes(2);
      fireEvent.click(screen.getByRole('button', { name: '以相同命令編號重試' }));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(repository.createStudent).toHaveBeenCalledTimes(2);
      expect(repository.createStudent.mock.calls[0][0]).toEqual(repository.createStudent.mock.calls[1][0]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let a late null query authorize retry when it started before the original settled', async () => {
    vi.useFakeTimers();
    try {
      let settleOriginal!: (result: CommandResult) => void;
      let resolveEarlyQuery!: (result: { status: 'not-found' }) => void;
      repository.createStudent.mockReturnValueOnce(new Promise<CommandResult>(resolve => { settleOriginal = resolve; }));
      repository.confirmPendingIntent.mockReturnValueOnce(new Promise<{ status: 'not-found' }>(resolve => { resolveEarlyQuery = resolve; }));
      renderPage();
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      openCreateForm();
      fillCreateForm({ amount: '0', mode: '沿用既有核對結餘' });
      fireEvent.click(screen.getByRole('button', { name: '建立學生' }));
      await act(async () => { vi.advanceTimersByTime(10_000); });
      fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
      expect(repository.confirmPendingIntent).toHaveBeenCalledOnce();

      await act(async () => settleOriginal({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } }));
      await act(async () => resolveEarlyQuery({ status: 'not-found' }));

      expect(repository.createStudent).toHaveBeenCalledOnce();
      expect(screen.queryByRole('button', { name: '以相同命令編號重試' })).not.toBeInTheDocument();
      expect(screen.getByText(/這次查詢開始時原命令仍在送出中；未找到結果不能授權重試/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(repository.confirmPendingIntent).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('button', { name: '以相同命令編號重試' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '以相同命令編號重試' }));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(repository.createStudent).toHaveBeenCalledTimes(2);
      expect(repository.createStudent.mock.calls[0][0]).toEqual(repository.createStudent.mock.calls[1][0]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not authorize a retry when the fenced receipt service read fails', async () => {
    repository.createStudent.mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
    repository.confirmPendingIntent.mockRejectedValueOnce({ code: 'UNKNOWN_RESULT', message: 'reader unavailable' });
    renderPage();
    await screen.findByText(/目前伺服器名單是空的/);
    openCreateForm();
    fillCreateForm({ amount: '0', mode: '沿用既有核對結餘' });
    fireEvent.click(screen.getByRole('button', { name: '建立學生' }));
    await screen.findByText('結果確認中，請勿重複建立／修改。');

    fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
    expect(await screen.findByText(/查詢錯誤不代表命令不存在/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '以相同命令編號重試' })).not.toBeInTheDocument();
    expect(repository.createStudent).toHaveBeenCalledTimes(1);
  });

  it('locks manual list reload while the frozen command is unresolved', async () => {
    let resolveCommand!: (result: CommandResult) => void;
    repository.createStudent.mockReturnValueOnce(new Promise<CommandResult>(resolve => {
      resolveCommand = resolve;
    }));
    repository.list.mockResolvedValueOnce(snapshot());
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
    expect(screen.getByRole('button', { name: '重新載入名單' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重新載入名單' }));
    await act(async () => resolveCommand({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } }));
    expect(screen.getByText(/命令編號 cmd-ui-001/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新載入名單' })).toBeDisabled();
    expect(repository.list).toHaveBeenCalledTimes(1);
  });

  it('blocks same-identity retries after an initial list authorization denial', async () => {
    const reportNavigationState = vi.fn();
    const db = {} as Firestore;
    repository.list.mockRejectedValueOnce({ code: 'LEASE_LOST', message: 'lease changed' });
    const view = render(
      <CloudStudentsPage db={db} leaseEpoch={4} identityKey="uid-a:4" onNavigationStateChange={reportNavigationState} />,
    );

    expect(await screen.findByText(/授權狀態已失效/)).toBeInTheDocument();
    expect(reportNavigationState).toHaveBeenLastCalledWith('uid-a:4', 'revoked');
    view.rerender(
      <CloudStudentsPage
        db={db}
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

  it('clears the frozen command after a read-only receipt query loses authorization and locks list reload', async () => {
    let rejectReceiptRead!: (error: unknown) => void;
    repository.createStudent.mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
    repository.list.mockResolvedValueOnce(snapshot());
    repository.confirmPendingIntent.mockReturnValueOnce(new Promise((_, reject) => {
      rejectReceiptRead = reject;
    }));
    renderPage();
    await screen.findByText(/目前伺服器名單是空的/);
    openCreateForm();
    fillCreateForm({ id: '088', name: '另一敏感姓名', amount: '0', mode: '沿用既有核對結餘' });
    fireEvent.click(screen.getByRole('button', { name: '建立學生' }));
    await screen.findByText('結果確認中，請勿重複建立／修改。');
    fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
    await waitFor(() => expect(repository.confirmPendingIntent).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: '重新載入名單' })).toBeDisabled();

    await act(async () => rejectReceiptRead({ code: 'UNAUTHORIZED', message: 'token revoked' }));
    expect(await screen.findByText('使用權已變更；敏感操作內容已清除。')).toBeInTheDocument();

    expect(screen.getByText('命令編號 cmd-ui-001')).toBeInTheDocument();
    const pageText = screen.getByRole('main', { name: '雲端學生名單' }).textContent ?? '';
    for (const sensitiveValue of ['088', '另一敏感姓名']) {
      expect(pageText).not.toContain(sensitiveValue);
    }
    expect(repository.list).toHaveBeenCalledTimes(1);
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

  it.each([
    ['Auth UID', (db: Firestore) => {
      currentAuth.uid = 'uid-b';
      return { db, leaseEpoch: 4, identityKey: 'uid-a:4' };
    }],
    ['lease epoch', (db: Firestore) => ({ db, leaseEpoch: 5, identityKey: 'uid-a:4' })],
    ['Firestore instance', () => ({ db: {} as Firestore, leaseEpoch: 4, identityKey: 'uid-a:4' })],
  ])('invalidates a pending command immediately when the %s scope changes', async (_label, nextScope) => {
    let resolveCommand!: (result: CommandResult) => void;
    repository.commitStudentCommand.mockReturnValueOnce(new Promise(resolve => { resolveCommand = resolve; }));
    const db = {} as Firestore;
    const view = render(
      <CloudStudentsPage db={db} leaseEpoch={4} identityKey="uid-a:4" />,
    );
    await screen.findByText(/目前伺服器名單是空的/);
    openCreateForm();
    fillCreateForm({ id: '097', name: '待清除敏感姓名', amount: '8', mode: '建立新學生' });
    fireEvent.change(screen.getByLabelText(/別名（逗號、頓號/), { target: { value: '待清除敏感別名' } });
    fireEvent.click(screen.getByRole('button', { name: '建立學生' }));
    await screen.findByText('結果確認中，請勿重複建立／修改。');

    view.rerender(<CloudStudentsPage {...nextScope(db)} />);

    const main = screen.getByRole('main', { name: '雲端學生名單' });
    expect(main.textContent).not.toContain('待清除敏感姓名');
    expect(main.textContent).not.toContain('待清除敏感別名');
    expect(main.textContent).not.toContain('097');
    expect(screen.queryByText(/命令編號 cmd-ui-001/)).not.toBeInTheDocument();

    await act(async () => resolveCommand({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'late response' } }));
    expect(screen.queryByText(/命令編號 cmd-ui-001/)).not.toBeInTheDocument();
    expect(screen.getByRole('main', { name: '雲端學生名單' }).textContent).not.toContain('待清除敏感姓名');
    expect(repository.confirmPendingIntent).not.toHaveBeenCalled();
  });

  it('does not confirm, clean the journal, or reload after a pending receipt read settles after unmount', async () => {
    let resolveReceipt!: (result: { status: 'matched'; receipt: CommandReceipt }) => void;
    repository.createStudent.mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
    repository.confirmPendingIntent.mockReturnValueOnce(new Promise(resolve => { resolveReceipt = resolve; }));
    const view = renderPage();
    await screen.findByText(/目前伺服器名單是空的/);
    openCreateForm();
    fillCreateForm({ id: '096', name: '卸載後不得回填', amount: '0', mode: '沿用既有核對結餘' });
    fireEvent.click(screen.getByRole('button', { name: '建立學生' }));
    await screen.findByText(/命令編號 cmd-ui-001/);
    fireEvent.click(screen.getByRole('button', { name: '查詢原命令結果' }));
    await waitFor(() => expect(repository.confirmPendingIntent).toHaveBeenCalledOnce());

    view.unmount();

    await act(async () => resolveReceipt({
      status: 'matched', receipt: receipt('cmd-ui-001', 'CreateStudent', '096'),
    }));
    expect(repository.cleanupConfirmedIntent).not.toHaveBeenCalled();
    expect(repository.list).toHaveBeenCalledTimes(1);
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

  it('corrects an opening amount and note with a reason, both revisions, and a balance preview', async () => {
    const original = student('uuid-001', {
      studentCode: '001',
      revision: 4,
      currentBalance: 250,
      openingBalance: { amount: 100, asOfDate: '2026-01-01', note: '舊帳', createdAt: '2026-01-01T00:00:00.000Z' },
    });
    repository.list
      .mockResolvedValueOnce(snapshot([original]))
      .mockResolvedValueOnce(snapshot([{ ...original, revision: 5, currentBalance: 230, openingBalance: { ...original.openingBalance, amount: 80, note: '核對後' } }]));
    renderPage();
    const row = await screen.findByTestId('cloud-student-row-001');
    fireEvent.click(within(row).getByRole('button', { name: '更正期初' }));
    const form = await within(row).findByRole('form', { name: '更正期初 001' });
    expect(repository.readOpeningDay).toHaveBeenCalledWith('2026-01-01');
    expect(within(form).getByText(/期初日 2026-01-01 不變/)).toBeInTheDocument();
    expect(within(form).getByLabelText(/期初結餘/)).toHaveValue('100');

    fireEvent.click(within(form).getByRole('button', { name: '確認更正期初' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('期初金額與備註都沒有變更');

    fireEvent.change(within(form).getByLabelText(/期初結餘/), { target: { value: '80' } });
    fireEvent.change(within(form).getByLabelText(/期初備註/), { target: { value: '核對後' } });
    const preview = within(form).getByLabelText('期初更正預覽');
    expect(preview).toHaveTextContent(/期初\s*NT\$ 100 → NT\$ 80/);
    expect(preview).toHaveTextContent(/目前結餘\s*NT\$ 250 → NT\$ 230/);
    fireEvent.click(within(form).getByRole('button', { name: '確認更正期初' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('請輸入具體的期初更正原因');
    expect(repository.correctOpening).not.toHaveBeenCalled();

    fireEvent.change(within(form).getByLabelText('更正原因（必填）'), { target: { value: '對帳發現少記 20 元' } });
    fireEvent.click(within(form).getByRole('button', { name: '確認更正期初' }));
    await waitFor(() => expect(repository.correctOpening).toHaveBeenCalledWith({
      commandId: 'cmd-ui-001',
      leaseEpoch: 4,
      studentId: 'uuid-001',
      dayId: '2026-01-01',
      expectedStudentRevision: 4,
      expectedDayRevision: 3,
      amount: 80,
      note: '核對後',
      reason: '對帳發現少記 20 元',
    }));
    expect(await screen.findByText(/已確認 更正 001 期初為/)).toBeInTheDocument();
  });

  it('creates the missing opening day first and never sends a correction against a closed day', async () => {
    repository.list.mockResolvedValue(snapshot([student('uuid-001', { studentCode: '001' })]));
    repository.readOpeningDay.mockResolvedValueOnce(null);
    renderPage();
    let row = await screen.findByTestId('cloud-student-row-001');
    fireEvent.click(within(row).getByRole('button', { name: '更正期初' }));
    fireEvent.click(await within(row).findByRole('button', { name: '先建立營業日 2026-01-01' }));
    await waitFor(() => expect(repository.ensureOpeningDay).toHaveBeenCalledWith({
      commandId: 'cmd-ui-001',
      leaseEpoch: 4,
      dayId: '2026-01-01',
    }));
    expect(await screen.findByText(/請再按該學生的「更正期初」繼續/)).toBeInTheDocument();
    expect(repository.correctOpening).not.toHaveBeenCalled();

    repository.readOpeningDay.mockResolvedValueOnce({ dayId: '2026-01-01', revision: 7, status: 'closed' });
    row = await screen.findByTestId('cloud-student-row-001');
    fireEvent.click(within(row).getByRole('button', { name: '更正期初' }));
    expect(await within(row).findByText(/已關帳。請先到「日結」頁填寫原因重開該日/)).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: '確認更正期初' })).not.toBeInTheDocument();
    expect(repository.correctOpening).not.toHaveBeenCalled();
  });
});
