import { describe, it, expect, beforeEach } from 'vitest';
import { SYSTEM_OPERATOR_ID } from '../domain/operatorId';
import { usePosStore } from '../store/posStore';

beforeEach(() => {
  window.localStorage.clear();
  usePosStore.getState().resetData();
  usePosStore.setState({ students: [], transactions: [], vendors: [], auditEvents: [] });
});

function seedStudent(id: string, balance: number) {
  usePosStore.setState((s) => ({
    students: [
      ...s.students,
      {
        studentId: id,
        displayName: '學生',
        status: 'active' as const,
        currentBalance: balance,
        aliases: [],
        faceEnrollmentStatus: 'none' as const,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        revision: 1,
      },
    ],
  }));
}

function seedMenu() {
  usePosStore.setState({
    todayMenu: {
      businessDate: '2026-06-15',
      itemName: '便當',
      price: 60,
      vendorId: 'v1',
      vendorNameSnapshot: '廠商A',
      updatedAt: '2026-06-15T08:00:00Z',
      revision: 1,
    },
  });
}

describe('#310 — operatorId in audit events', () => {
  it('deleteOrderWithRefundCheck records real operatorId in audit event', () => {
    seedStudent('s1', 1000);
    seedMenu();
    usePosStore.getState().processTransaction('s1', 'order', 60, 0, '便當');

    const txId = usePosStore.getState().transactions[0].transactionId;
    usePosStore.getState().deleteOrderWithRefundCheck(txId, 'uid-operator-1');

    const auditEvents = usePosStore.getState().auditEvents;
    expect(auditEvents.length).toBe(1);
    expect(auditEvents[0].operatorId).toBe('uid-operator-1');
  });

  it('deleteOrderWithRefundCheck falls back to SYSTEM_OPERATOR_ID when no operatorId', () => {
    seedStudent('s1', 1000);
    seedMenu();
    usePosStore.getState().processTransaction('s1', 'order', 60, 0, '便當');

    const txId = usePosStore.getState().transactions[0].transactionId;
    usePosStore.getState().deleteOrderWithRefundCheck(txId);

    const auditEvents = usePosStore.getState().auditEvents;
    expect(auditEvents.length).toBe(1);
    expect(auditEvents[0].operatorId).toBe(SYSTEM_OPERATOR_ID);
  });

  it('editTransaction records real operatorId in audit event', () => {
    seedStudent('s1', 1000);
    seedMenu();
    usePosStore.getState().processTransaction('s1', 'order', 60, 0, '便當');

    const txId = usePosStore.getState().transactions[0].transactionId;
    usePosStore.getState().editTransaction(txId, { mealPrice: 80 }, 'uid-admin-2');

    const auditEvents = usePosStore.getState().auditEvents;
    expect(auditEvents.length).toBe(1);
    expect(auditEvents[0].operatorId).toBe('uid-admin-2');
  });

  it('editTransaction falls back to SYSTEM_OPERATOR_ID when no operatorId', () => {
    seedStudent('s1', 1000);
    seedMenu();
    usePosStore.getState().processTransaction('s1', 'order', 60, 0, '便當');

    const txId = usePosStore.getState().transactions[0].transactionId;
    usePosStore.getState().editTransaction(txId, { mealPrice: 80 });

    const auditEvents = usePosStore.getState().auditEvents;
    expect(auditEvents.length).toBe(1);
    expect(auditEvents[0].operatorId).toBe(SYSTEM_OPERATOR_ID);
  });

  it('SYSTEM_OPERATOR_ID is the expected constant', () => {
    expect(SYSTEM_OPERATOR_ID).toBe('__system__');
  });
});
