import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

// M0：未連 Firebase 時 F3 顯示練習資料與手動建帳戶（使用真實 store）。
vi.mock('../../hooks/useFirebase', () => ({
  useFirebase: () => ({ fb: null, fbError: null, access: { ok: false, reason: 'signed_out' } }),
}));

import { AdminScreen } from '../screens/AdminScreen';
import { usePosStore } from '../../store/posStore';

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
});
