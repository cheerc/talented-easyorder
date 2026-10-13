import { describe, it, expect } from 'vitest';
import {
  validateVendorDraft, applyVendorEdit, setVendorStatus, deleteInactiveVendor, vendorMenuDates, isVendorInLegacyMenu, resolveMenuVendor,
  type Vendor, type TodayMenu, type MenusByDate,
} from '../menu';

const v = (id: string, name: string, status: Vendor['status'] = 'active'): Vendor => ({
  vendorId: id, name, phone: '02-1234', note: '備註', status, createdAt: 'c', updatedAt: 'u', revision: 1,
});
const menu = (vendorId: string, vendorNameSnapshot: string, businessDate = '2026-10-13'): TodayMenu => ({
  businessDate, itemName: '排骨', price: 90, vendorId, vendorNameSnapshot, updatedAt: '', revision: 1,
});

describe('M3 F4 供應商維護', () => {
  it('名稱必填、不可和其他供應商同名（含已停用），編輯自己不算重複', () => {
    const list = [v('a', '阿榮'), v('b', '老王', 'inactive')];
    expect(validateVendorDraft({ name: '  ', phone: '', note: '' }, list, null)).toBe('請填寫供應商名稱。');
    expect(validateVendorDraft({ name: '阿榮 ', phone: '', note: '' }, list, null)).toMatch(/已經有一家/);
    expect(validateVendorDraft({ name: '老王', phone: '', note: '' }, list, null)).toMatch(/已停用的供應商裡有/);
    expect(validateVendorDraft({ name: '阿榮', phone: '', note: '' }, list, 'a')).toBeNull();
  });

  it('編輯可以把電話和備註清空，版次加一', () => {
    const edited = applyVendorEdit(v('a', '阿榮'), { name: '阿榮', phone: '', note: '' }, 'now');
    expect(edited).toMatchObject({ phone: '', note: '', updatedAt: 'now', revision: 2 });
  });

  it('停用與恢復只改那一家', () => {
    const list = [v('a', '阿榮'), v('b', '老王')];
    const off = setVendorStatus(list, 'a', 'inactive', 'now');
    expect(off[0]).toMatchObject({ status: 'inactive', revision: 2 });
    expect(off[1]).toBe(list[1]);
    expect(setVendorStatus(off, 'a', 'active', 'later')[0]).toMatchObject({ status: 'active', revision: 3 });
  });

  it('只有已停用的才能永久刪除', () => {
    const list = [v('a', '阿榮'), v('b', '老王', 'inactive')];
    expect(deleteInactiveVendor(list, 'a')).toEqual({ ok: false, message: '請先停用這家供應商，才能永久刪除。' });
    expect(deleteInactiveVendor(list, 'zz').ok).toBe(false);
    const r = deleteInactiveVendor(list, 'b');
    expect(r.ok && r.vendors.map(x => x.vendorId)).toEqual(['a']);
  });

  it('列出用過這家的晚餐設定日期', () => {
    const menus: MenusByDate = {
      '2026-10-12': menu('a', '阿榮', '2026-10-12'),
      '2026-10-10': menu('a', '阿榮', '2026-10-10'),
      '2026-10-11': menu('b', '老王', '2026-10-11'),
    };
    expect(vendorMenuDates('a', menus)).toEqual(['2026-10-10', '2026-10-12']);
  });

  it('還沒有日期菜單時，舊版單一菜單用這家也算', () => {
    expect(isVendorInLegacyMenu('a', {}, menu('a', '阿榮'))).toBe(true);
    expect(isVendorInLegacyMenu('b', {}, menu('a', '阿榮'))).toBe(false);
    expect(isVendorInLegacyMenu('', {}, menu('', ''))).toBe(false);
    // 已有日期菜單時，舊版菜單不再生效。
    expect(isVendorInLegacyMenu('a', { '2026-10-11': menu('b', '老王', '2026-10-11') }, menu('a', '阿榮'))).toBe(false);
  });

  it('F3 預設供應商：使用中就選它；沒指定選第一家使用中；已停用或刪除不預選並給名稱', () => {
    const list = [v('b', '老王', 'inactive'), v('a', '阿榮')];
    expect(resolveMenuVendor(menu('a', '阿榮'), list)).toEqual({ vendorId: 'a', unavailableName: null });
    expect(resolveMenuVendor(menu('', ''), list)).toEqual({ vendorId: 'a', unavailableName: null });
    expect(resolveMenuVendor(menu('b', '老王'), list)).toEqual({ vendorId: '', unavailableName: '老王' });
    expect(resolveMenuVendor(menu('gone', '已收店'), list)).toEqual({ vendorId: '', unavailableName: '已收店' });
    // 舊資料編號對不到，用名稱找到使用中的那家。
    expect(resolveMenuVendor(menu('legacy-id', '阿榮'), list)).toEqual({ vendorId: 'a', unavailableName: null });
  });
});
