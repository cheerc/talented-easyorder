import type { ValidationResult } from '../types/validation';

export type DailyCashSessionStatus = 'open' | 'closed';

export interface DailyCashSession {
  cashSessionId: string;
  businessDate: string;
  openingCash: number;
  openedBy: string;
  openedAt: string;
  closedAt?: string;
  closedBy?: string;
  status: DailyCashSessionStatus;
  revision: number;
}

export interface CreateDailyCashSessionInput {
  businessDate: string;
  openingCash: number;
  openedBy: string;
  openedAt: string;
}

export interface DrawerCashInput {
  openingCash: number;
  netCash: number;
}

export interface DrawerCloseout {
  businessDate: string;
  openingCash: number;
  netCash: number;
  expectedDrawerCash: number;
  countedCash: number;
  difference: number;
  note: string;
}

export function createDailyCashSession(input: CreateDailyCashSessionInput): DailyCashSession {
  return {
    cashSessionId: `cash-${input.businessDate}`,
    businessDate: input.businessDate,
    openingCash: input.openingCash,
    openedBy: input.openedBy,
    openedAt: input.openedAt,
    status: 'open',
    revision: 1,
  };
}

export function calculateExpectedDrawerCash(input: DrawerCashInput): number {
  return input.openingCash + input.netCash;
}

export function createDrawerCloseout(input: {
  businessDate: string;
  openingCash: number;
  netCash: number;
  countedCash: number;
  note: string;
}): DrawerCloseout {
  const expectedDrawerCash = calculateExpectedDrawerCash({
    openingCash: input.openingCash,
    netCash: input.netCash,
  });

  return {
    businessDate: input.businessDate,
    openingCash: input.openingCash,
    netCash: input.netCash,
    expectedDrawerCash,
    countedCash: input.countedCash,
    difference: input.countedCash - expectedDrawerCash,
    note: input.note,
  };
}


export function validateOpeningCash(value: number): ValidationResult {
  if (!Number.isInteger(value) || value < 0) {
    return { ok: false, reason: '開帳金額必須是 0 或正整數' };
  }
  if (value > 20000) {
    return { ok: false, reason: '開帳金額異常，請確認是否輸入錯誤' };
  }
  return { ok: true };
}
