export interface Student {
  id: string;
  name: string;
  balance: number;
}

export interface Transaction {
  id?: string;
  date: string;
  time: string;
  sid: string;
  name: string;
  type: 'order' | 'topup' | 'cancel';
  mealPrice: number;
  paidAmount: number;
  amount: number; // Balance change
  after: number;
  note: string;
}

export interface Vendor {
  id: string;
  name: string;
  phone: string;
  note: string;
}

export interface TodayMenu {
  date: string;
  name: string;
  price: number;
  vendor: string;
}

export const INITIAL_STUDENTS: Student[] = [
  { id: '001', name: '王柏翰', balance: 1250 },
  { id: '002', name: '陳奕辰', balance: 80 },
  { id: '003', name: '林子晴', balance: 540 },
  { id: '004', name: '張哲瑋', balance: -90 },
  { id: '005', name: '李宥嘉', balance: 2340 },
  { id: '006', name: '黃詩涵', balance: 180 },
  { id: '007', name: '吳冠霖', balance: 420 },
  { id: '008', name: '劉芷瑄', balance: -90 },
  { id: '009', name: '蔡仲恩', balance: 800 },
  { id: '010', name: '郭宜婷', balance: 1500 },
  { id: '011', name: '何思辰', balance: 30 },
  { id: '012', name: '楊子毅', balance: 670 },
  { id: '013', name: '謝佳穎', balance: -180 },
  { id: '014', name: '羅文皓', balance: 990 },
  { id: '015', name: '周映彤', balance: 2100 },
  { id: '016', name: '徐宇泰', balance: 45 },
  { id: '017', name: '高芷柔', balance: 320 },
  { id: '018', name: '潘柏宇', balance: 750 },
  { id: '019', name: '簡宥成', balance: 1080 },
  { id: '020', name: '鄭婉婷', balance: 200 },
];

export const VENDORS: Vendor[] = [
  { id: 'v1', name: '阿榮便當', phone: '0912-345-678', note: '週一/三/五供應' },
  { id: 'v2', name: '池上飯包',  phone: '0922-118-203', note: '需前一天 17:00 前訂' },
  { id: 'v3', name: '小李義大利麵', phone: '02-2345-6789', note: '教職員個別餐用' },
  { id: 'v4', name: '永和豆漿',   phone: '02-8765-4321', note: '早餐備用' },
];

export const INITIAL_TODAY_MENU: TodayMenu = {
  date: '2026/05/07',
  name: '日式唐揚雞便當',
  price: 90,
  vendor: '阿榮便當',
};

// orderedToday: { sid: count } — for duplicate-order warnings
export const INITIAL_ORDERED_TODAY: Record<string, number> = {
  '001': 1, '003': 1, '010': 1, '014': 1, '015': 1, '019': 1, '020': 1,
  '004': 1, '008': 0,
};

// Mock today's transactions for the report screen
export const INITIAL_TODAY_TX: Transaction[] = [
  { date: '2026-05-10', time: '11:42:08', sid: '015', name: '周映彤', type: 'order', mealPrice: 90, paidAmount: 0, amount: -90, after: 2010, note: '日式唐揚雞便當' },
  { date: '2026-05-10', time: '11:41:55', sid: '019', name: '簡宥成', type: 'order', mealPrice: 90, paidAmount: 0, amount: -90, after: 990,  note: '日式唐揚雞便當' },
  { date: '2026-05-10', time: '11:41:32', sid: '004', name: '張哲瑋', type: 'order', mealPrice: 90, paidAmount: 0, amount: -90, after: 0,    note: '記帳 ‧ 待繳' },
  { date: '2026-05-10', time: '11:41:10', sid: '002', name: '陳奕辰', type: 'topup', mealPrice: 0,  paidAmount: 500, amount: +500, after: 580, note: '現金儲值' },
  { date: '2026-05-10', time: '11:40:48', sid: '010', name: '郭宜婷', type: 'order', mealPrice: 90, paidAmount: 0, amount: -90, after: 1410, note: '日式唐揚雞便當' },
  { date: '2026-05-10', time: '11:39:58', sid: '008', name: '劉芷瑄', type: 'topup', mealPrice: 0,  paidAmount: 90, amount: +90, after: 60,   note: '繳交欠款' },
  { date: '2026-05-10', time: '11:39:30', sid: '003', name: '林子晴', type: 'order', mealPrice: 90, paidAmount: 0, amount: -90, after: 450,  note: '日式唐揚雞便當' },
  { date: '2026-05-10', time: '11:38:51', sid: '014', name: '羅文皓', type: 'order', mealPrice: 90, paidAmount: 0, amount: -90, after: 900,  note: '日式唐揚雞便當' },
  { date: '2026-05-10', time: '11:38:14', sid: '001', name: '王柏翰', type: 'order', mealPrice: 90, paidAmount: 0, amount: -90, after: 1160, note: '日式唐揚雞便當' },
  { date: '2026-05-10', time: '11:37:42', sid: '006', name: '黃詩涵', type: 'topup', mealPrice: 0,  paidAmount: 200, amount: +200, after: 380, note: '現金儲值' },
  { date: '2026-05-10', time: '11:37:08', sid: '020', name: '鄭婉婷', type: 'order', mealPrice: 90, paidAmount: 0, amount: -90, after: 110,  note: '日式唐揚雞便當' },
];
