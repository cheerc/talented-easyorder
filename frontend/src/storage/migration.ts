import type { PosState } from '../store/posTypes';
import { appendErrorLog } from '../errors/errorLogger';
import type { Vendor } from '../domain/menu';

export function migratePersistedState(persistedState: unknown, version: number): PosState {
  try {
    const state = persistedState as Record<string, unknown>;
    void version;
    if (!state) return state as unknown as PosState;

    // v2: add audit state fields
    if (!('auditEvents' in state)) state.auditEvents = [];
    if (!('dailySettlements' in state)) state.dailySettlements = [];
    if (!('businessDateStatuses' in state)) state.businessDateStatuses = {};

    // Normalize old-shape students {id, name, balance} → StudentAccount
    const rawStudents = state.students as Array<Record<string, unknown>> | undefined;
    if (rawStudents && rawStudents.length > 0 && 'id' in rawStudents[0] && !('studentId' in rawStudents[0])) {
      state.students = rawStudents.map((s: Record<string, unknown>) => ({
        studentId: s.id as string,
        displayName: (s.name as string) || '',
        status: 'active',
        currentBalance: (s.balance as number) ?? 0,
        aliases: [],
        faceEnrollmentStatus: 'none',
        createdAt: '2026-01-10T08:00:00Z',
        updatedAt: '2026-01-10T08:00:00Z',
        revision: 1,
      }));
    }

    // Normalize old-shape transactions → LedgerTransaction
    const rawTx = state.transactions as Array<Record<string, unknown>> | undefined;
    if (rawTx && rawTx.length > 0) {
      state.transactions = rawTx.map((t: Record<string, unknown>) => {
        const hasId = 'id' in t && !('transactionId' in t);
        const hasSyncStatus = 'syncStatus' in t;
        return {
          ...t,
          transactionId: hasId ? t.id as string : (t.transactionId as string),
          syncStatus: hasSyncStatus ? t.syncStatus : 'local',
        };
      });
    }

    // Normalize old-shape vendors {id, name, phone, note} → Vendor
    const rawVendors = state.vendors as Array<Record<string, unknown>> | undefined;
    if (rawVendors && rawVendors.length > 0 && 'id' in rawVendors[0] && !('vendorId' in rawVendors[0])) {
      state.vendors = rawVendors.map((v: Record<string, unknown>) => ({
        vendorId: v.id as string,
        name: (v.name as string) || '',
        phone: (v.phone as string) || '',
        note: (v.note as string) || '',
        status: 'active' as const,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        revision: 1,
      }));
    }

    // Normalize old-shape todayMenu {date, name, price, vendor} → TodayMenu
    const rawMenu = state.todayMenu as Record<string, unknown> | undefined;
    if (rawMenu && 'date' in rawMenu && !('businessDate' in rawMenu)) {
      const vendorName = (rawMenu.vendor as string) || '';
      const oldVendors = (state.vendors as Vendor[]) || [];
      const matchedVendor = oldVendors.find(v => v.name === vendorName);
      state.todayMenu = {
        businessDate: rawMenu.date as string,
        itemName: (rawMenu.name as string) || '',
        price: (rawMenu.price as number) ?? 0,
        vendorId: matchedVendor?.vendorId || 'v1',
        vendorNameSnapshot: vendorName,
        updatedAt: '2026-05-07T07:00:00Z',
        revision: 1,
      };
    }

    return state as unknown as PosState;
  } catch (e) {
    appendErrorLog({ source: 'storage', message: '[migration] migratePersistedState crashed: ' + String(e) });
    throw e; // let onRehydrateStorage fallback handle the reset
  }
}
