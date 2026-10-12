import { describe, it, expect, beforeEach } from 'vitest';
import { resolveMenuForDate, type TodayMenu } from '../menu';
import { usePosStore } from '../../store/posStore';
import { validatePersistedState } from '../../storage/posStateValidator';
import { buildSnapshot, parseSnapshot, pickDataset } from '../practiceSnapshot';

// M0：日期 key 菜單。每個營業日有自己的晚餐設定；沒設定的日子沿用較早日期。

const menu = (date: string, itemName: string, price: number): TodayMenu => ({
  businessDate: date, itemName, price, vendorId: 'v1', vendorNameSnapshot: '練習店', updatedAt: `${date}T08:00:00Z`, revision: 1,
});
const legacy = menu('2026-01-01', '舊菜單', 80);

describe('resolveMenuForDate', () => {
  const byDate = { '2026-06-01': menu('2026-06-01', '排骨', 90), '2026-06-03': menu('2026-06-03', '雞腿', 100) };

  it('uses the date\'s own menu', () => {
    const r = resolveMenuForDate(byDate, legacy, '2026-06-03');
    expect(r.source).toBe('own');
    expect(r.menu.itemName).toBe('雞腿');
  });

  it('inherits the latest earlier date and reports it, with businessDate set to the queried date', () => {
    const r = resolveMenuForDate(byDate, legacy, '2026-06-02');
    expect(r).toMatchObject({ source: 'inherited', fromDate: '2026-06-01' });
    expect(r.menu).toMatchObject({ itemName: '排骨', businessDate: '2026-06-02' });
    expect(resolveMenuForDate(byDate, legacy, '2026-06-10').menu.itemName).toBe('雞腿');
  });

  it('falls back to the legacy single menu only while no date has its own menu', () => {
    const r = resolveMenuForDate({}, legacy, '2026-05-31');
    expect(r.source).toBe('legacy');
    expect(r.menu).toMatchObject({ itemName: '舊菜單', businessDate: '2026-05-31' });
    expect(resolveMenuForDate({}, legacy, '2026-01-01').menu).toBe(legacy);
  });

  it('a date earlier than every saved menu is unset, not the later menu', () => {
    const r = resolveMenuForDate(byDate, legacy, '2026-05-31');
    expect(r.source).toBe('none');
    expect(r.menu).toMatchObject({ itemName: '', price: 0, businessDate: '2026-05-31' });
  });
});

describe('setMenuForDate', () => {
  beforeEach(() => { usePosStore.getState().startBlankData(); });

  it('saves per date without changing other days, bumping the revision on re-save', () => {
    const { setMenuForDate } = usePosStore.getState();
    setMenuForDate('2026-06-01', { itemName: '排骨', price: 90, vendorId: 'v1', vendorNameSnapshot: '練習店' }, '2026-06-01T08:00:00Z');
    setMenuForDate('2026-06-02', { itemName: '雞腿', price: 100, vendorId: 'v1', vendorNameSnapshot: '練習店' }, '2026-06-02T08:00:00Z');
    setMenuForDate('2026-06-02', { itemName: '雞腿', price: 110, vendorId: 'v1', vendorNameSnapshot: '練習店' }, '2026-06-02T09:00:00Z');
    const s = usePosStore.getState();
    expect(s.menusByDate['2026-06-01']).toMatchObject({ itemName: '排骨', price: 90, revision: 1, businessDate: '2026-06-01' });
    expect(s.menusByDate['2026-06-02']).toMatchObject({ price: 110, revision: 2, updatedAt: '2026-06-02T09:00:00Z' });
    expect(s.todayMenu).toMatchObject({ itemName: '雞腿', price: 110 });
  });

  it('editing an earlier day keeps todayMenu on the latest day', () => {
    const { setMenuForDate } = usePosStore.getState();
    setMenuForDate('2026-06-02', { itemName: '雞腿', price: 100, vendorId: 'v1', vendorNameSnapshot: '練習店' }, 'x');
    setMenuForDate('2026-06-01', { itemName: '排骨', price: 90, vendorId: 'v1', vendorNameSnapshot: '練習店' }, 'x');
    expect(usePosStore.getState().todayMenu.itemName).toBe('雞腿');
  });

  it('the first dated save keeps the old single menu on its own date for earlier days', () => {
    usePosStore.getState().loadSampleData();
    const old = usePosStore.getState().todayMenu;
    const later = '2099-01-02';
    usePosStore.getState().setMenuForDate(later, { itemName: '雞腿', price: 100, vendorId: 'v1', vendorNameSnapshot: '練習店' }, 'x');
    const s = usePosStore.getState();
    expect(s.menusByDate[old.businessDate]).toEqual(old);
    expect(resolveMenuForDate(s.menusByDate, s.todayMenu, '2099-01-01').menu.itemName).toBe(old.itemName);
  });

  it('blank / sample reset the per-date menus; clearing transactions keeps them', () => {
    const st = () => usePosStore.getState();
    st().setMenuForDate('2026-06-01', { itemName: '排骨', price: 90, vendorId: 'v1', vendorNameSnapshot: '練習店' }, 'x');
    st().clearPracticeTransactions();
    expect(Object.keys(st().menusByDate)).toEqual(['2026-06-01']);
    st().loadSampleData();
    expect(st().menusByDate).toEqual({});
    st().setMenuForDate('2026-06-01', { itemName: '排骨', price: 90, vendorId: 'v1', vendorNameSnapshot: '練習店' }, 'x');
    st().startBlankData();
    expect(st().menusByDate).toEqual({});
  });
});

describe('menusByDate validation and snapshots', () => {
  beforeEach(() => { usePosStore.getState().loadSampleData(); });

  it('round-trips per-date menus through a snapshot', () => {
    usePosStore.getState().setMenuForDate('2026-06-01', { itemName: '排骨', price: 90, vendorId: 'V001', vendorNameSnapshot: '店' }, 'x');
    const r = parseSnapshot(JSON.stringify(buildSnapshot(pickDataset(usePosStore.getState()), '2026-06-01T09:00:00Z')));
    expect(r.ok && r.snapshot.data.menusByDate['2026-06-01'].itemName).toBe('排骨');
  });

  it('accepts an older snapshot without menusByDate', () => {
    const snap = buildSnapshot(pickDataset(usePosStore.getState()), '2026-06-01T09:00:00Z') as unknown as { data: Record<string, unknown> };
    delete snap.data.menusByDate;
    const r = parseSnapshot(JSON.stringify(snap));
    expect(r.ok && r.snapshot.data.menusByDate).toEqual({});
  });

  it('rejects a per-date menu whose businessDate does not match its key, or an invalid price', () => {
    const base = pickDataset(usePosStore.getState());
    expect(validatePersistedState({ ...base, menusByDate: { '2026-06-01': menu('2026-06-02', '排骨', 90) } }).ok).toBe(false);
    expect(validatePersistedState({ ...base, menusByDate: { '2026-06-01': menu('2026-06-01', '排骨', -5) } }).ok).toBe(false);
    expect(validatePersistedState({ ...base, menusByDate: [] }).ok).toBe(false);
    expect(validatePersistedState({ ...base, menusByDate: { '2026-06-01': menu('2026-06-01', '排骨', 90) } }).ok).toBe(true);
  });
});
