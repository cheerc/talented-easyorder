import type { StudentAccount } from '../domain/student';
import type { Vendor, TodayMenu } from '../domain/menu';
import type { LedgerTransaction } from '../domain/ledger';

export type { StudentAccount, Vendor, TodayMenu, LedgerTransaction };

export const INITIAL_STUDENTS: StudentAccount[] = [
  { studentId: '001', displayName: '王柏翰', status: 'active', currentBalance: 1250, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '002', displayName: '陳奕辰', status: 'active', currentBalance: 80, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '003', displayName: '林子晴', status: 'active', currentBalance: 540, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '004', displayName: '張哲瑋', status: 'active', currentBalance: -90, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '005', displayName: '李宥嘉', status: 'active', currentBalance: 2340, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '006', displayName: '黃詩涵', status: 'active', currentBalance: 180, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '007', displayName: '吳冠霖', status: 'active', currentBalance: 420, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '008', displayName: '劉芷瑄', status: 'active', currentBalance: -90, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '009', displayName: '蔡仲恩', status: 'active', currentBalance: 800, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '010', displayName: '郭宜婷', status: 'active', currentBalance: 1500, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '011', displayName: '何思辰', status: 'active', currentBalance: 30, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '012', displayName: '楊子毅', status: 'active', currentBalance: 670, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '013', displayName: '謝佳穎', status: 'active', currentBalance: -180, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '014', displayName: '羅文皓', status: 'active', currentBalance: 990, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '015', displayName: '周映彤', status: 'active', currentBalance: 2100, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '016', displayName: '徐宇泰', status: 'active', currentBalance: 45, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '017', displayName: '高芷柔', status: 'active', currentBalance: 320, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '018', displayName: '潘柏宇', status: 'active', currentBalance: 750, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '019', displayName: '簡宥成', status: 'active', currentBalance: 1080, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '020', displayName: '鄭婉婷', status: 'active', currentBalance: 200, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
];

export const VENDORS: Vendor[] = [
  { vendorId: 'v1', name: '阿榮便當', phone: '0912-345-678', note: '週一/三/五供應', status: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', revision: 1 },
  { vendorId: 'v2', name: '池上飯包',  phone: '0922-118-203', note: '需前一天 17:00 前訂', status: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', revision: 1 },
  { vendorId: 'v3', name: '小李義大利麵', phone: '02-2345-6789', note: '教職員個別餐用', status: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', revision: 1 },
  { vendorId: 'v4', name: '永和豆漿',   phone: '02-8765-4321', note: '早餐備用', status: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', revision: 1 },
];

export const INITIAL_TODAY_MENU: TodayMenu = {
  businessDate: '2026-05-07',
  itemName: '日式唐揚雞便當',
  price: 90,
  vendorId: 'v1',
  vendorNameSnapshot: '阿榮便當',
  updatedAt: '2026-05-07T07:00:00Z',
  revision: 1,
};

export const INITIAL_TODAY_TX: LedgerTransaction[] = [
  { transactionId: 'tx-init-001', businessDate: '2026-05-10', createdAt: '2026-05-10T03:42:08.000Z', studentId: '015', studentNameSnapshot: '周映彤', type: 'order', mealPrice: 90, paidAmount: 0, amount: -90, afterBalance: 2010, menuNameSnapshot: '日式唐揚雞便當', vendorNameSnapshot: '阿榮便當', sourceDevice: 'pc', syncStatus: 'local', revision: 1, note: '日式唐揚雞便當' },
  { transactionId: 'tx-init-002', businessDate: '2026-05-10', createdAt: '2026-05-10T03:41:55.000Z', studentId: '019', studentNameSnapshot: '簡宥成', type: 'order', mealPrice: 90, paidAmount: 0, amount: -90, afterBalance: 990,  menuNameSnapshot: '日式唐揚雞便當', vendorNameSnapshot: '阿榮便當', sourceDevice: 'pc', syncStatus: 'local', revision: 1, note: '日式唐揚雞便當' },
  { transactionId: 'tx-init-003', businessDate: '2026-05-10', createdAt: '2026-05-10T03:41:32.000Z', studentId: '004', studentNameSnapshot: '張哲瑋', type: 'order', mealPrice: 90, paidAmount: 0, amount: -90, afterBalance: 0,    menuNameSnapshot: '日式唐揚雞便當', vendorNameSnapshot: '阿榮便當', sourceDevice: 'pc', syncStatus: 'local', revision: 1, note: '記帳 ‧ 待繳' },
  { transactionId: 'tx-init-004', businessDate: '2026-05-10', createdAt: '2026-05-10T03:41:10.000Z', studentId: '002', studentNameSnapshot: '陳奕辰', type: 'topup', mealPrice: 0,  paidAmount: 500, amount: 500, afterBalance: 580, menuNameSnapshot: '', vendorNameSnapshot: '', sourceDevice: 'pc', syncStatus: 'local', revision: 1, note: '現金儲值' },
  { transactionId: 'tx-init-005', businessDate: '2026-05-10', createdAt: '2026-05-10T03:40:48.000Z', studentId: '010', studentNameSnapshot: '郭宜婷', type: 'order', mealPrice: 90, paidAmount: 0, amount: -90, afterBalance: 1410, menuNameSnapshot: '日式唐揚雞便當', vendorNameSnapshot: '阿榮便當', sourceDevice: 'pc', syncStatus: 'local', revision: 1, note: '日式唐揚雞便當' },
  { transactionId: 'tx-init-006', businessDate: '2026-05-10', createdAt: '2026-05-10T03:39:58.000Z', studentId: '008', studentNameSnapshot: '劉芷瑄', type: 'topup', mealPrice: 0,  paidAmount: 90, amount: 90, afterBalance: 60,   menuNameSnapshot: '', vendorNameSnapshot: '', sourceDevice: 'pc', syncStatus: 'local', revision: 1, note: '繳交欠款' },
  { transactionId: 'tx-init-007', businessDate: '2026-05-10', createdAt: '2026-05-10T03:39:30.000Z', studentId: '003', studentNameSnapshot: '林子晴', type: 'order', mealPrice: 90, paidAmount: 0, amount: -90, afterBalance: 450,  menuNameSnapshot: '日式唐揚雞便當', vendorNameSnapshot: '阿榮便當', sourceDevice: 'pc', syncStatus: 'local', revision: 1, note: '日式唐揚雞便當' },
  { transactionId: 'tx-init-008', businessDate: '2026-05-10', createdAt: '2026-05-10T03:38:51.000Z', studentId: '014', studentNameSnapshot: '羅文皓', type: 'order', mealPrice: 90, paidAmount: 0, amount: -90, afterBalance: 900,  menuNameSnapshot: '日式唐揚雞便當', vendorNameSnapshot: '阿榮便當', sourceDevice: 'pc', syncStatus: 'local', revision: 1, note: '日式唐揚雞便當' },
  { transactionId: 'tx-init-009', businessDate: '2026-05-10', createdAt: '2026-05-10T03:38:14.000Z', studentId: '001', studentNameSnapshot: '王柏翰', type: 'order', mealPrice: 90, paidAmount: 0, amount: -90, afterBalance: 1160, menuNameSnapshot: '日式唐揚雞便當', vendorNameSnapshot: '阿榮便當', sourceDevice: 'pc', syncStatus: 'local', revision: 1, note: '日式唐揚雞便當' },
  { transactionId: 'tx-init-010', businessDate: '2026-05-10', createdAt: '2026-05-10T03:37:42.000Z', studentId: '006', studentNameSnapshot: '黃詩涵', type: 'topup', mealPrice: 0,  paidAmount: 200, amount: 200, afterBalance: 380, menuNameSnapshot: '', vendorNameSnapshot: '', sourceDevice: 'pc', syncStatus: 'local', revision: 1, note: '現金儲值' },
  { transactionId: 'tx-init-011', businessDate: '2026-05-10', createdAt: '2026-05-10T03:37:08.000Z', studentId: '020', studentNameSnapshot: '鄭婉婷', type: 'order', mealPrice: 90, paidAmount: 0, amount: -90, afterBalance: 110,  menuNameSnapshot: '日式唐揚雞便當', vendorNameSnapshot: '阿榮便當', sourceDevice: 'pc', syncStatus: 'local', revision: 1, note: '日式唐揚雞便當' },
];

// orderedToday: { studentId: count } — for duplicate-order warnings
export const INITIAL_ORDERED_TODAY: Record<string, number> = {
  '001': 1, '003': 1, '010': 1, '014': 1, '015': 1, '019': 1, '020': 1,
  '004': 1, '008': 0,
};
