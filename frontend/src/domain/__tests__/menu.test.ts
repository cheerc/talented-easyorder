import { describe, it, expect } from 'vitest';
import {
  validateTodayMenu,
  filterActiveVendors,
  createMenuSnapshot,
  promoteCatalogItemToTodayMenu,
} from '../menu';
import type { Vendor, TodayMenu } from '../menu';
import { VENDOR_ARONG, TODAY_MENU_KARAAGE, CATALOG_ITEM_KARAAGE, FIXTURE_BUSINESS_DATE } from './fixtures';

const INACTIVE_VENDOR: Vendor = {
  ...VENDOR_ARONG,
  vendorId: 'v99',
  name: '已停用廠商',
  status: 'inactive',
};

describe('validateTodayMenu', () => {
  const vendors = [VENDOR_ARONG, INACTIVE_VENDOR];

  it('passes with valid menu and active vendor', () => {
    const result = validateTodayMenu(TODAY_MENU_KARAAGE, vendors);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails with empty item name', () => {
    const menu: TodayMenu = { ...TODAY_MENU_KARAAGE, itemName: '' };
    const result = validateTodayMenu(menu, vendors);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('itemName');
  });

  it('fails with zero price', () => {
    const menu: TodayMenu = { ...TODAY_MENU_KARAAGE, price: 0 };
    const result = validateTodayMenu(menu, vendors);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('price');
  });

  it('fails with negative price', () => {
    const menu: TodayMenu = { ...TODAY_MENU_KARAAGE, price: -50 };
    const result = validateTodayMenu(menu, vendors);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('price');
  });

  it('fails with decimal price', () => {
    const menu: TodayMenu = { ...TODAY_MENU_KARAAGE, price: 89.5 };
    const result = validateTodayMenu(menu, vendors);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('price');
  });

  it('fails with inactive vendor', () => {
    const menu: TodayMenu = { ...TODAY_MENU_KARAAGE, vendorId: 'v99' };
    const result = validateTodayMenu(menu, vendors);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('vendorId');
  });
});

describe('filterActiveVendors', () => {
  it('excludes inactive vendors', () => {
    const result = filterActiveVendors([VENDOR_ARONG, INACTIVE_VENDOR]);
    expect(result).toHaveLength(1);
    expect(result[0].vendorId).toBe('v1');
  });
});

describe('createMenuSnapshot', () => {
  it('preserves menu and vendor values', () => {
    const snapshot = createMenuSnapshot(TODAY_MENU_KARAAGE);
    expect(snapshot).toEqual({
      menuNameSnapshot: '日式唐揚雞便當',
      menuPriceSnapshot: 90,
      vendorIdSnapshot: 'v1',
      vendorNameSnapshot: '阿榮便當',
    });
  });

  it('snapshot is independent of later edits to source', () => {
    const menu = { ...TODAY_MENU_KARAAGE };
    const snapshot = createMenuSnapshot(menu);
    menu.itemName = '排骨飯';
    menu.price = 100;
    expect(snapshot.menuNameSnapshot).toBe('日式唐揚雞便當');
    expect(snapshot.menuPriceSnapshot).toBe(90);
  });
});

describe('promoteCatalogItemToTodayMenu', () => {
  it('creates a valid TodayMenu from catalog item', () => {
    const result = promoteCatalogItemToTodayMenu(CATALOG_ITEM_KARAAGE, VENDOR_ARONG, FIXTURE_BUSINESS_DATE, '2026-05-07T07:30:00Z');
    expect(result.businessDate).toBe(FIXTURE_BUSINESS_DATE);
    expect(result.itemName).toBe('日式唐揚雞便當');
    expect(result.price).toBe(90);
    expect(result.vendorId).toBe('v1');
    expect(result.vendorNameSnapshot).toBe('阿榮便當');
    expect(result.catalogItemId).toBe('cat-001');
  });

  it('uses explicit updatedAt instead of wall clock', () => {
    const explicitTime = '2026-05-07T08:00:00Z';
    const result = promoteCatalogItemToTodayMenu(CATALOG_ITEM_KARAAGE, VENDOR_ARONG, FIXTURE_BUSINESS_DATE, explicitTime);
    expect(result.updatedAt).toBe(explicitTime);
  });
});
