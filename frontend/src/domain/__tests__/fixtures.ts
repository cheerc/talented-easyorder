import type { StudentAccount } from '../student';
import type { Vendor, TodayMenu, MenuCatalogItem } from '../menu';
import type { LedgerTransaction } from '../ledger';

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
  itemName: '日式唐揚雞便當',
  price: 90,
  vendorId: 'v1',
  vendorNameSnapshot: '阿榮便當',
  updatedAt: '2026-05-07T07:00:00Z',
  revision: 1,
};

export const CATALOG_ITEM_KARAAGE: MenuCatalogItem = {
  itemId: 'cat-001',
  name: '日式唐揚雞便當',
  defaultPrice: 90,
  defaultVendorId: 'v1',
  category: '便當',
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  revision: 1,
};

export const TX_ORDER_001: LedgerTransaction = {
  transactionId: 'tx-order-001',
  businessDate: FIXTURE_BUSINESS_DATE,
  createdAt: '2026-05-07T03:38:14.000Z',
  studentId: '001',
  studentNameSnapshot: '王柏翰',
  type: 'order',
  mealPrice: 90,
  paidAmount: 0,
  amount: -90,
  afterBalance: 1160,
  menuNameSnapshot: '日式唐揚雞便當',
  vendorNameSnapshot: '阿榮便當',
  sourceDevice: 'pc',
  syncStatus: 'local',
  revision: 1,
  note: '日式唐揚雞便當',
};

export const TX_TOPUP_002: LedgerTransaction = {
  transactionId: 'tx-topup-002',
  businessDate: FIXTURE_BUSINESS_DATE,
  createdAt: '2026-05-07T03:41:10.000Z',
  studentId: '002',
  studentNameSnapshot: '陳奕辰',
  type: 'topup',
  mealPrice: 0,
  paidAmount: 500,
  amount: 500,
  afterBalance: 580,
  menuNameSnapshot: '',
  vendorNameSnapshot: '',
  sourceDevice: 'pc',
  syncStatus: 'local',
  revision: 1,
  note: '現金儲值',
};
