import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';

// M0：未連 Firebase 時 F3 顯示練習資料與手動建帳戶（使用真實 store）。
vi.mock('../../hooks/useFirebase', () => ({
  useFirebase: () => ({ fb: null, fbError: null, access: { ok: false, reason: 'signed_out' } }),
}));

import { AdminScreen } from '../screens/AdminScreen';
import { usePosStore } from '../../store/posStore';
import { buildSnapshot, pickDataset } from '../../domain/practiceSnapshot';

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
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('不是便當櫃台的練習快照檔'));
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
});
