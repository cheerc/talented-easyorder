import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';

// M0：未連 Firebase 時 F3 顯示練習資料與手動建帳戶（使用真實 store）。
vi.mock('../../hooks/useFirebase', () => ({
  useFirebase: () => ({ fb: null, fbError: null, access: { ok: false, reason: 'signed_out' } }),
}));

import { AdminScreen } from '../screens/AdminScreen';
import { usePosStore } from '../../store/posStore';
import { buildSnapshot, pickDataset } from '../../domain/practiceSnapshot';
import { filterSearchSuggestions } from '../../domain/posSearch';

beforeEach(() => {
  usePosStore.getState().loadSampleData();
});

function fillAccount(id: string, name: string, opening: string) {
  fireEvent.change(screen.getByLabelText('帳戶編號'), { target: { value: id } });
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('期初餘額 (元)'), { target: { value: opening } });
  fireEvent.click(screen.getByRole('button', { name: '新增帳戶' }));
}

describe('AdminScreen practice data (local mode)', () => {
  it('cancel on "從空白開始" changes nothing; confirm clears everything (S02)', () => {
    render(<AdminScreen viewDate="2026-10-12" />);
    fireEvent.click(screen.getByRole('button', { name: '從空白開始…' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(usePosStore.getState().students).toHaveLength(22);

    fireEvent.click(screen.getByRole('button', { name: '從空白開始…' }));
    fireEvent.click(screen.getByRole('button', { name: '確認清空' }));
    const s = usePosStore.getState();
    expect(s.students).toHaveLength(0);
    expect(s.vendors).toHaveLength(0);
    expect(screen.getByLabelText('練習資料').textContent).toContain('0 位帳戶、0 家供應商、0 筆交易');
  });

  it('creates accounts with 0 / negative openings, blocks duplicate id, warns on same name (S03/S04)', () => {
    usePosStore.getState().startBlankData();
    render(<AdminScreen viewDate="2026-10-12" />);

    fillAccount('001', '甲生', '0');
    fillAccount('002', '乙生', '-120');
    expect(usePosStore.getState().students.map(s => [s.studentId, s.currentBalance])).toEqual([['001', 0], ['002', -120]]);

    fillAccount('001', '丙生', '10');
    expect(screen.getByRole('alert').textContent).toContain('這個帳戶編號已經存在');
    expect(usePosStore.getState().students).toHaveLength(2);

    fillAccount('003', '甲生', '50');
    expect(screen.getByRole('status').textContent).toContain('與編號 001 同名');
    expect(usePosStore.getState().students).toHaveLength(3);
  });

  it('blank opening balance is an error, not 0', () => {
    usePosStore.getState().startBlankData();
    render(<AdminScreen viewDate="2026-10-12" />);
    fillAccount('001', '甲生', '');
    expect(screen.getByRole('alert').textContent).toContain('沒有就填 0');
    expect(usePosStore.getState().students).toHaveLength(0);
  });

  it('shows the setup steps for a blank dataset', () => {
    usePosStore.getState().startBlankData();
    render(<AdminScreen viewDate="2026-10-12" />);
    const steps = within(screen.getByRole('list', { name: '開始訂餐前的準備' })).getAllByRole('listitem');
    expect(steps).toHaveLength(4);
    expect(steps.every(li => !li.textContent?.startsWith('✓'))).toBe(true);
  });

  it('export → blank → restore brings back accounts, opening balance and menu (S05)', async () => {
    usePosStore.getState().startBlankData();
    render(<AdminScreen viewDate="2026-10-12" />);
    fillAccount('001', '甲生', '200');

    const createObjectURL = vi.fn(() => 'blob:x');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    fireEvent.click(screen.getByRole('button', { name: '匯出快照' }));
    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
    const exported = await blob.text();
    expect(screen.getByText(/已匯出/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '載入驗收範例…' }));
    fireEvent.click(screen.getByRole('button', { name: '確認載入範例' }));
    expect(usePosStore.getState().students).toHaveLength(22);

    const file = new File([exported], 'start.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('選擇快照檔'), { target: { files: [file] } });
    await screen.findByRole('button', { name: '確認還原' });
    fireEvent.click(screen.getByRole('button', { name: '確認還原' }));
    const s = usePosStore.getState();
    expect(s.students.map(x => [x.studentId, x.currentBalance, x.openingBalance?.amount])).toEqual([['001', 200, 200]]);
    expect(s.vendors).toHaveLength(0);
  });

  it('a bad snapshot file shows the reason and leaves data unchanged (S06)', async () => {
    render(<AdminScreen viewDate="2026-10-12" />);
    const file = new File(['{"format":"other"}'], 'bad.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('選擇快照檔'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('不是訂餐櫃台的練習快照檔'));
    expect(screen.getByRole('alert').textContent).toContain('目前資料沒有變更');
    expect(usePosStore.getState().students).toHaveLength(22);
    expect(screen.queryByRole('button', { name: '確認還原' })).toBeNull();
  });

  it('restore cancel changes nothing', async () => {
    const snapshot = JSON.stringify(buildSnapshot({ ...pickDataset(usePosStore.getState()), students: [] }, '2026-10-12T09:00:00Z'));
    render(<AdminScreen viewDate="2026-10-12" />);
    fireEvent.change(screen.getByLabelText('選擇快照檔'), { target: { files: [new File([snapshot], 's.json')] } });
    await screen.findByRole('button', { name: '確認還原' });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(usePosStore.getState().students).toHaveLength(22);
  });

  it('clear practice transactions keeps the roster and returns balances to opening (S06)', () => {
    usePosStore.getState().startBlankData();
    render(<AdminScreen viewDate="2026-10-12" />);
    fillAccount('001', '甲生', '200');
    usePosStore.getState().processTransaction('001', 'order', 90, 0);
    expect(usePosStore.getState().students[0].currentBalance).toBe(110);

    fireEvent.click(screen.getByRole('button', { name: '只清除練習交易…' }));
    expect(screen.getByText(/將清除 1 筆交易/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '確認清除交易' }));
    const s = usePosStore.getState();
    expect(s.transactions).toHaveLength(0);
    expect(s.students.map(x => [x.studentId, x.currentBalance])).toEqual([['001', 200]]);
  });

  it('只清除練習交易的確認視窗寫明刷臉訂餐動態一起清掉，平板狀態與人臉註冊欄保留', () => {
    usePosStore.getState().startBlankData();
    render(<AdminScreen viewDate="2026-10-12" />);
    fillAccount('001', '甲生', '200');
    usePosStore.getState().setMenuForDate('2026-10-12', { itemName: '排骨餐點', price: 90, vendorId: '', vendorNameSnapshot: '' }, 'now');
    usePosStore.getState().handleFaceEvent({ eventId: 'e1', deviceId: 'faceorder-01', action: 'order', studentId: '001', businessDate: '2026-10-12', recognizedAt: '2026-10-12T02:00:00.000Z' }, '2026-10-12T02:00:00.000Z');
    usePosStore.getState().applyFaceEnrollment({ deviceId: 'faceorder-01', studentId: '001', status: 'enrolled', faceCount: 2, reportedAt: '2026-10-12T02:00:00.000Z' });

    fireEvent.click(screen.getByRole('button', { name: '只清除練習交易…' }));
    expect(screen.getByText(/、1 筆刷臉訂餐動態；/)).toBeTruthy();
    expect(screen.getByText(/保留.*刷臉平板狀態與人臉註冊欄/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '確認清除交易' }));
    const s = usePosStore.getState();
    expect(s.faceEvents).toEqual([]);
    expect(s.faceDevices['faceorder-01']).toBeDefined();
    expect(s.students[0]).toMatchObject({ faceEnrollmentStatus: 'enrolled', faceCount: 2 });
  });

  it('edits aliases and name; deactivated accounts leave F1 search but keep history (S04)', () => {
    usePosStore.getState().startBlankData();
    render(<AdminScreen viewDate="2026-10-12" />);
    fillAccount('001', '甲生', '200');
    usePosStore.getState().processTransaction('001', 'order', 90, 0);

    fireEvent.click(screen.getByRole('button', { name: '編輯 001' }));
    fireEvent.change(screen.getByLabelText('別名'), { target: { value: '小甲、Jia' } });
    fireEvent.change(screen.getByLabelText('001 姓名'), { target: { value: '甲同學' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    let s = usePosStore.getState().students[0];
    expect(s.displayName).toBe('甲同學');
    expect(s.aliases).toEqual(['小甲', 'Jia']);
    expect(usePosStore.getState().transactions[0].studentNameSnapshot).toBe('甲生');
    expect(screen.getByTestId('student-row-001').textContent).toContain('小甲、Jia');

    fireEvent.click(screen.getByRole('button', { name: '停用 001' }));
    s = usePosStore.getState().students[0];
    expect(s.status).toBe('inactive');
    expect(screen.getByTestId('student-row-001').textContent).toContain('已停用');
    // F1 搜尋框候選（PosColumn 實際使用的過濾）：停用後以別名、姓名、編號都搜不到。
    for (const q of ['小甲', '甲同學', '001']) expect(filterSearchSuggestions(usePosStore.getState().students, q)).toEqual([]);
    expect(usePosStore.getState().transactions).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '恢復 001' }));
    expect(usePosStore.getState().students[0].status).toBe('active');
    expect(filterSearchSuggestions(usePosStore.getState().students, 'jia').map(x => x.studentId)).toEqual(['001']);
  });
});

describe('AdminScreen per-date dinner menu (M0)', () => {
  it('saves the menu for the viewed date only; a later date inherits it until it gets its own', () => {
    usePosStore.getState().startBlankData();
    usePosStore.getState().setVendors([{ vendorId: 'v1', name: '練習店', phone: '0', note: '', status: 'active', createdAt: 'x', updatedAt: 'x', revision: 1 }]);
    const { rerender } = render(<AdminScreen viewDate="2026-06-01" />);
    fireEvent.change(screen.getByLabelText('餐點單價'), { target: { value: '90' } });
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '排骨' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存今日設定' }));
    expect(screen.getByText('已儲存 2026-06-01 的晚餐')).toBeTruthy();

    rerender(<AdminScreen viewDate="2026-06-02" />);
    expect(screen.getByText(/目前沿用 2026-06-01 的晚餐/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('餐點單價'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存今日設定' }));

    expect(screen.getByText('已儲存 2026-06-02 的晚餐')).toBeTruthy();

    // 切到更早、沒有設定的日子：不沿用較晚的菜單，提示未設定；上一天的「已儲存」提示清掉。
    rerender(<AdminScreen viewDate="2026-05-31" />);
    expect(screen.queryByText(/已儲存/)).toBeNull();
    expect(screen.getByText(/這天之前還沒有設定晚餐/)).toBeTruthy();
    expect((screen.getByLabelText('餐點單價') as HTMLInputElement).value).toBe('0');

    const s = usePosStore.getState();
    expect(s.menusByDate['2026-06-01']).toMatchObject({ itemName: '排骨', price: 90, vendorId: 'v1' });
    expect(s.menusByDate['2026-06-02']).toMatchObject({ itemName: '排骨', price: 120 });
  });

  it('M3：餐點名稱空白或單價不合法時不儲存，並說明原因', () => {
    usePosStore.getState().startBlankData();
    render(<AdminScreen viewDate="2026-10-12" />);
    fireEvent.change(screen.getByLabelText('餐點名稱'), { target: { value: '  ' } });
    fireEvent.change(screen.getByLabelText('餐點單價'), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存今日設定' }));
    expect(screen.getByRole('alert').textContent).toBe('請填寫餐點名稱。');
    expect(usePosStore.getState().menusByDate['2026-10-12']).toBeUndefined();

    fireEvent.change(screen.getByLabelText('餐點名稱'), { target: { value: ' 雞腿飯 ' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存今日設定' }));
    expect(screen.queryByText('請填寫餐點名稱。')).toBeNull();
    expect(usePosStore.getState().menusByDate['2026-10-12']).toMatchObject({ itemName: '雞腿飯', price: 90 });
  });

  it('M3：開帳金額預填跟著建議值更新；重開的日子預填那次關帳的開帳金額', async () => {
    const { act } = await import('@testing-library/react');
    const { createDailySettlement, reopenBusinessDate } = await import('../../domain/cashClose');
    const { calculateLedgerTotals } = await import('../../domain/ledgerReport');
    usePosStore.getState().startBlankData();
    render(<AdminScreen viewDate="2026-10-12" />);
    expect(screen.getByLabelText('開帳金額')).toHaveProperty('value', '');

    // 同一天內建議值改變（例如還原快照帶進前一天的關帳），欄位跟著重新預填。
    const totals = calculateLedgerTotals([]);
    const yesterday = createDailySettlement('2026-10-11', totals, 1000, 1050, '', 'op', '2026-10-11T10:00:00.000Z', false);
    act(() => { usePosStore.setState({ dailySettlements: [yesterday] }); });
    expect(screen.getByLabelText('開帳金額')).toHaveProperty('value', '1050');
    expect(screen.getByText(/已預填前一天關帳點算的 \$1,050/)).toBeTruthy();

    // 這一天以前用 4000 關帳過、後來重開：優先預填那次的開帳金額。
    const closed = createDailySettlement('2026-10-12', totals, 4000, 4000, '', 'op', '2026-10-12T10:00:00.000Z', false);
    const reopened = reopenBusinessDate(closed, '補登', 'op', '2026-10-12T11:00:00.000Z');
    act(() => { usePosStore.setState({ dailySettlements: [yesterday, closed, reopened] }); });
    expect(screen.getByLabelText('開帳金額')).toHaveProperty('value', '4000');
    expect(screen.getByText(/已預填這一天上次關帳用的開帳金額 \$4,000/)).toBeTruthy();
  });
});
