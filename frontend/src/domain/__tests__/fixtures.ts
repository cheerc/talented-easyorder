import type { StudentAccount } from '../student';
import type { Vendor, TodayMenu, MenuCatalogItem } from '../menu';

export const FIXTURE_BUSINESS_DATE = '2026-05-07';

export const STUDENT_001: StudentAccount = {
  studentId: '001',
  displayName: '王柏翰',
  status: 'active',
  currentBalance: 1250,
  aliases: [],
  faceEnrollmentStatus: 'none',
  createdAt: '2026-01-10T08:00:00Z',
  updatedAt: '2026-01-10T08:00:00Z',
  revision: 1,
};

export const STUDENT_004: StudentAccount = {
  studentId: '004',
  displayName: '張哲瑋',
  status: 'active',
  currentBalance: -90,
  aliases: [],
  faceEnrollmentStatus: 'none',
  createdAt: '2026-01-10T08:00:00Z',
  updatedAt: '2026-01-10T08:00:00Z',
  revision: 1,
};

export const VENDOR_ARONG: Vendor = {
  vendorId: 'v1',
  name: '阿榮便當',
  phone: '0912-345-678',
  note: '週一/三/五供應',
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  revision: 1,
};

export const TODAY_MENU_KARAAGE: TodayMenu = {
  businessDate: FIXTURE_BUSINESS_DATE,
  itemName: '日式唐揚雞餐點',
  price: 90,
  vendorId: 'v1',
  vendorNameSnapshot: '阿榮便當',
  updatedAt: '2026-05-07T07:00:00Z',
  revision: 1,
};

export const CATALOG_ITEM_KARAAGE: MenuCatalogItem = {
  itemId: 'cat-001',
  name: '日式唐揚雞餐點',
  defaultPrice: 90,
  defaultVendorId: 'v1',
  category: '便當',
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  revision: 1,
};
