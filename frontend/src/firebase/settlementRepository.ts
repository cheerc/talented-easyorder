import type { Firestore } from 'firebase/firestore';

export function createCloseAttemptId(deviceId: string, businessDate: string, sequence: number): string {
  return `${deviceId}:close:${businessDate}:${sequence}`;
}

export function summarizeCloseAttemptConflict(attempts: Array<{ id: string; actualDrawer: number; difference: number }>) {
  const signatures = new Set(attempts.map(a => `${a.actualDrawer}:${a.difference}`));
  return { conflict: signatures.size > 1, attemptIds: attempts.map(a => a.id) };
}

export async function writeOfflineCloseAttempt(db: Firestore, input: {
  id: string;
  businessDate: string;
  openingCash: number;
  netCash: number;
  expectedDrawer: number;
  actualDrawer: number;
  difference: number;
  transactionIds: string[];
  cashAdjustmentIds: string[];
  operatorId: string;
  operatorEmail: string;
  deviceId: string;
  note: string;
}) {
  void db;
  void input;
  throw new Error('業務功能暫未開放');
}

export async function promoteCloseAttemptOnline(db: Firestore, input: {
  businessDate: string;
  closeAttemptId: string;
  summary: Record<string, unknown>;
}) {
  void db;
  void input;
  throw new Error('業務功能暫未開放');
}

export async function addCashAdjustment(db: Firestore, input: {
  id: string;
  businessDate: string;
  type: 'deposit' | 'withdraw';
  amount: number;
  reason: string;
  operatorId: string;
  operatorEmail: string;
  deviceId: string;
}) {
  void db;
  void input;
  throw new Error('業務功能暫未開放');
}
