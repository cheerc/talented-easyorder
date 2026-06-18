import type { StudentAccount } from '../domain/student';
import type { Vendor, TodayMenu } from '../domain/menu';
import type { LedgerTransaction } from '../domain/ledger';

export type { StudentAccount, Vendor, TodayMenu, LedgerTransaction };

export const INITIAL_STUDENTS: StudentAccount[] = [
  { studentId: '001', displayName: '王柏翰', status: 'active', currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '002', displayName: '陳奕辰', status: 'active', currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '003', displayName: '林子晴', status: 'active', currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '004', displayName: '張哲瑋', status: 'active', currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '005', displayName: '李宥嘉', status: 'active', currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '006', displayName: '黃詩涵', status: 'active', currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '007', displayName: '吳冠霖', status: 'active', currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '008', displayName: '劉芷瑄', status: 'active', currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '009', displayName: '蔡仲恩', status: 'active', currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '010', displayName: '郭宜婷', status: 'active', currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '011', displayName: '何思辰', status: 'active', currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '012', displayName: '楊子毅', status: 'active', currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '013', displayName: '謝佳穎', status: 'active', currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '014', displayName: '羅文皓', status: 'active', currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '015', displayName: '周映彤', status: 'active', currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '016', displayName: '徐宇泰', status: 'active', currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '017', displayName: '高芷柔', status: 'active', currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '018', displayName: '潘柏宇', status: 'active', currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '019', displayName: '簡宥成', status: 'active', currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: '020', displayName: '鄭婉婷', status: 'active', currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: 'S001', displayName: '王小明', status: 'active', currentBalance: 1000, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
  { studentId: 'S002', displayName: '李小華', status: 'active', currentBalance: 500, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-01-10T08:00:00Z', revision: 1 },
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

export const INITIAL_TODAY_TX: LedgerTransaction[] = [];

export const INITIAL_ORDERED_TODAY: Record<string, number> = {};
