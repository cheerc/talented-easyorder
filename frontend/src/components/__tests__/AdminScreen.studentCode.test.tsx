import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../hooks/useFirebase', () => ({
  useFirebase: () => ({ fb: null, fbError: null, access: { ok: false, reason: 'signed_out' } }),
}));

import { AdminScreen } from '../screens/AdminScreen';
import { usePosStore } from '../../store/posStore';
import { createLocalAccount } from '../../domain/student';

const D1 = '2026-10-15';

function resetAndSeedStudents() {
  usePosStore.getState().startBlankData();
  // 建立 002 (二號) 與 005 (五號)，中間缺 001 與 003–004
  usePosStore.getState().addLocalStudent(
    createLocalAccount({ studentId: '002', displayName: '王二', openingBalance: 100, openingNote: '', asOfDate: D1 }, '2026-10-15T00:00:00Z')
  );
  usePosStore.getState().addLocalStudent(
    createLocalAccount({ studentId: '005', displayName: '李五', openingBalance: 200, openingNote: '', asOfDate: D1 }, '2026-10-15T00:00:00Z')
  );
  usePosStore.getState().setMenuForDate(D1, { itemName: '排骨便當', price: 90, vendorId: '', vendorNameSnapshot: '' }, 'now');
}

describe('AdminScreen - 學員編號排序、缺號列與改編號 (U3 #7, #9)', () => {
  beforeEach(() => {
    resetAndSeedStudents();
  });

  it('列表依編號數值由小到大排序，並顯示缺號列（單一空號與連續空號合併）', () => {
    render(<AdminScreen viewDate={D1} />);
    // 應有缺號列 001 與 003–004
    expect(screen.getByText('001 尚無人使用')).toBeInTheDocument();
    expect(screen.getByText('003–004 尚無人使用（2 個號碼）')).toBeInTheDocument();

    // 學員列正確顯示
    expect(screen.getByText('王二')).toBeInTheDocument();
    expect(screen.getByText('李五')).toBeInTheDocument();
  });

  it('點擊缺號列將號碼帶入新增帳戶表單的帳戶編號', async () => {
    render(<AdminScreen viewDate={D1} />);
    const user = userEvent.setup();

    // 點擊 001 缺號列
    const gap001 = screen.getByTestId('gap-row-001');
    await user.click(gap001);

    const idInput = screen.getByLabelText('帳戶編號') as HTMLInputElement;
    expect(idInput.value).toBe('001');

    // 點擊連續缺號列 003–004（帶著第一個號碼 003）
    const gap003 = screen.getByTestId('gap-row-003');
    await user.click(gap003);
    expect(idInput.value).toBe('003');
  });

  it('搜尋框有文字時不顯示缺號列，只顯示符合搜尋的帳戶', async () => {
    render(<AdminScreen viewDate={D1} />);
    const user = userEvent.setup();

    const searchInput = screen.getByLabelText('搜尋學員');
    await user.type(searchInput, '王');

    expect(screen.getByText('王二')).toBeInTheDocument();
    expect(screen.queryByText(/尚無人使用/)).toBeNull();
  });

  it('點擊學員列「交易紀錄」按鈕跳至 F5 交易查詢（呼叫 onViewStudentHistory）', async () => {
    const onViewStudentHistory = vi.fn();
    render(<AdminScreen viewDate={D1} onViewStudentHistory={onViewStudentHistory} />);
    const user = userEvent.setup();

    const historyBtn = screen.getByRole('button', { name: '交易紀錄 002' });
    expect(historyBtn).toBeInTheDocument();
    await user.click(historyBtn);

    expect(onViewStudentHistory).toHaveBeenCalledTimes(1);
    expect(onViewStudentHistory).toHaveBeenCalledWith(expect.objectContaining({ studentId: '002', displayName: '王二' }));
  });

  it('編輯學員時編號欄可編輯，若修改編號顯示改號理由輸入框', async () => {
    render(<AdminScreen viewDate={D1} />);
    const user = userEvent.setup();

    // 點擊 002 的編輯按鈕
    await user.click(screen.getByRole('button', { name: '編輯 002' }));

    const form = screen.getByRole('form', { name: '編輯帳戶 002' });
    const idInput = within(form).getByLabelText('帳戶編號') as HTMLInputElement;
    expect(idInput).toBeInTheDocument();
    expect(idInput.value).toBe('002');

    // 尚未修改編號時不顯示改號理由
    expect(within(form).queryByLabelText('改號理由')).toBeNull();

    // 修改編號為 008
    await user.clear(idInput);
    await user.type(idInput, '008');

    // 顯示改號理由輸入框
    expect(within(form).getByLabelText('改號理由')).toBeInTheDocument();
  });

  it('修改編號時理由為必填（1–500 字）', async () => {
    render(<AdminScreen viewDate={D1} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '編輯 002' }));
    const form = screen.getByRole('form', { name: '編輯帳戶 002' });
    const idInput = within(form).getByLabelText('帳戶編號');
    await user.clear(idInput);
    await user.type(idInput, '008');

    // 未填理由直接儲存
    await user.click(within(form).getByRole('button', { name: '儲存' }));
    expect(within(form).getByText('修改編號時改號理由為必填（1–500 字）')).toBeInTheDocument();
  });

  it('修改編號為已存在之編號時阻擋並提示已有人使用與互換提示', async () => {
    render(<AdminScreen viewDate={D1} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '編輯 002' }));
    const form = screen.getByRole('form', { name: '編輯帳戶 002' });
    const idInput = within(form).getByLabelText('帳戶編號');
    await user.clear(idInput);
    await user.type(idInput, '005'); // 005 已被李五使用

    const reasonInput = within(form).getByLabelText('改號理由');
    await user.type(reasonInput, '測試重複改號');

    await user.click(within(form).getByRole('button', { name: '儲存' }));
    expect(within(form).getByText(/編號 005 已經有人使用（李五）。若兩位學生要互換號碼/)).toBeInTheDocument();
  });

  it('儲存改號跳出確認框，確認後成功更新編號與交易稽核', async () => {
    render(<AdminScreen viewDate={D1} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '編輯 002' }));
    const form = screen.getByRole('form', { name: '編輯帳戶 002' });
    const idInput = within(form).getByLabelText('帳戶編號');
    await user.clear(idInput);
    await user.type(idInput, '009');

    const reasonInput = within(form).getByLabelText('改號理由');
    await user.type(reasonInput, '學員指定號碼');

    await user.click(within(form).getByRole('button', { name: '儲存' }));

    // 彈出確認框
    expect(screen.getByText('確認修改學員編號')).toBeInTheDocument();
    expect(screen.getByText(/確定將 王二 的編號由 002 改為 009 嗎？/)).toBeInTheDocument();

    // 點擊確認改號
    await user.click(screen.getByRole('button', { name: '確認改號' }));

    // 編號已更新為 009
    expect(screen.queryByText('002')).toBeNull();
    expect(screen.getByText('009')).toBeInTheDocument();

    const state = usePosStore.getState();
    expect(state.students.find(s => s.studentId === '009')).toBeDefined();
    expect(state.students.find(s => s.studentId === '002')).toBeUndefined();
  });
});
