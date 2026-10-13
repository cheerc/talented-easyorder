import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('../../hooks/useFirebase', () => ({
  useFirebase: () => ({ fb: null, fbError: null, access: { ok: false, reason: 'signed_out' } }),
}));

import { VendorsScreen } from '../screens/VendorsScreen';
import { AdminScreen } from '../screens/AdminScreen';
import { usePosStore } from '../../store/posStore';
import type { Vendor } from '../../domain/menu';

const vendor = (id: string, name: string, phone = '02-1111'): Vendor => ({
  vendorId: id, name, phone, note: '', status: 'active', createdAt: 'x', updatedAt: 'x', revision: 1,
});
const DATE = '2026-10-13';

beforeEach(() => {
  usePosStore.getState().startBlankData();
  usePosStore.getState().setVendors([vendor('v1', '阿榮'), vendor('v2', '老王')]);
  usePosStore.getState().setMenuForDate(DATE, { itemName: '排骨', price: 90, vendorId: 'v1', vendorNameSnapshot: '阿榮' }, 'now');
});

const vendorById = (id: string) => usePosStore.getState().vendors.find(v => v.vendorId === id);

describe('F4 供應商停用、恢復、永久刪除（D02）', () => {
  it('新增時名稱空白顯示在畫面上，不跳 alert；Enter 可儲存', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<VendorsScreen viewDate={DATE} />);
    fireEvent.click(screen.getByRole('button', { name: /新增供應商/ }));
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(screen.getByRole('alert').textContent).toBe('請填寫供應商名稱。');
    expect(alertSpy).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('供應商名稱'), { target: { value: '小林' } });
    fireEvent.keyDown(screen.getByLabelText('供應商名稱'), { key: 'Enter' });
    expect(usePosStore.getState().vendors.map(v => v.name)).toEqual(['阿榮', '老王', '小林']);
    alertSpy.mockRestore();
  });

  it('編輯可以清空電話和備註', () => {
    render(<VendorsScreen viewDate={DATE} />);
    fireEvent.click(screen.getAllByRole('button', { name: '編輯' })[1]);
    fireEvent.change(screen.getByLabelText('電話'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(vendorById('v2')!.phone).toBe('');
  });

  it('停用後收進「已停用」，可以恢復；今天菜單在用時提醒到 F3 改選', () => {
    render(<VendorsScreen viewDate={DATE} />);
    fireEvent.click(screen.getAllByRole('button', { name: '停用' })[0]);
    expect(vendorById('v1')!.status).toBe('inactive');
    expect(screen.getByRole('status').textContent).toMatch(/2026-10-13 的晚餐設定還在用這家/);
    // 菜單快照不變。
    expect(usePosStore.getState().menusByDate[DATE].vendorNameSnapshot).toBe('阿榮');

    fireEvent.click(screen.getByRole('button', { name: /已停用（1 家）/ }));
    fireEvent.click(screen.getByRole('button', { name: '恢復' }));
    expect(vendorById('v1')!.status).toBe('active');
  });

  it('使用中的沒有刪除鍵；已停用的永久刪除要確認，取消不刪', () => {
    render(<VendorsScreen viewDate={DATE} />);
    expect(screen.queryByRole('button', { name: /刪除/ })).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: '停用' })[0]);
    fireEvent.click(screen.getByRole('button', { name: /已停用/ }));
    fireEvent.click(screen.getByRole('button', { name: '永久刪除' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toMatch(/有 1 天的晚餐設定用過這家（2026-10-13）/);
    expect(dialog.textContent).toMatch(/歷史訂單與菜單上的店名會保留/);

    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(vendorById('v1')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '永久刪除' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '永久刪除' }));
    expect(vendorById('v1')).toBeUndefined();
    expect(usePosStore.getState().menusByDate[DATE]).toMatchObject({ vendorId: 'v1', vendorNameSnapshot: '阿榮' });
  });
});

describe('F3 供應商下拉只列使用中的，以編號存（D01／D02）', () => {
  it('停用的不出現在下拉；這天的供應商已停用時提醒改選，改選後存成新的編號與名稱', () => {
    usePosStore.getState().setVendors(usePosStore.getState().vendors.map(v => v.vendorId === 'v1' ? { ...v, status: 'inactive' } : v));
    render(<AdminScreen viewDate={DATE} />);
    const select = screen.getByLabelText('供應商') as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.textContent);
    expect(options.some(o => o?.includes('阿榮'))).toBe(false);
    expect(select.value).toBe('');
    expect(screen.getByRole('note').textContent).toMatch(/「阿榮」已停用或刪除/);

    fireEvent.change(select, { target: { value: 'v2' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存今日設定' }));
    expect(usePosStore.getState().menusByDate[DATE]).toMatchObject({ vendorId: 'v2', vendorNameSnapshot: '老王' });
  });

  it('同名的兩家以編號區分，不會存錯', () => {
    usePosStore.getState().setVendors([vendor('v1', '阿榮'), { ...vendor('v3', '阿榮'), phone: '03-3333' }]);
    render(<AdminScreen viewDate={DATE} />);
    fireEvent.change(screen.getByLabelText('供應商'), { target: { value: 'v3' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存今日設定' }));
    expect(usePosStore.getState().menusByDate[DATE].vendorId).toBe('v3');
  });
});
