import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { LedgerAuditEvent } from '../../domain/ledgerAudit';

const { store, baseEvents } = vi.hoisted(() => {
  const base: LedgerAuditEvent[] = [
    {
      auditEventId: 'ae-1', eventType: 'transaction_edited', entityType: 'transaction',
      entityId: 'tx-1', businessDate: '2026-05-30',
      before: { mealPrice: 90 }, after: { mealPrice: 80, note: 'changed' },
      reason: 'correction', operatorId: 'op-1', createdAt: '2026-05-30T14:00:00.000Z',
    },
    {
      auditEventId: 'ae-2', eventType: 'transaction_corrected', entityType: 'transaction',
      entityId: 'tx-2', businessDate: '2026-05-30',
      before: { paidAmount: 100 }, after: { paidAmount: 80 },
      reason: 'correction', operatorId: 'op-2', createdAt: '2026-05-30T13:00:00.000Z',
    },
    {
      auditEventId: 'ae-3', eventType: 'business_date_closed', entityType: 'business_date',
      entityId: 'bd-2026-05-30', businessDate: '2026-05-30',
      before: null, after: { status: 'closed' },
      reason: 'end of day', operatorId: 'op-1', createdAt: '2026-05-30T18:00:00.000Z',
    },
  ];
  return {
    store: { auditEvents: [...base] as LedgerAuditEvent[] },
    baseEvents: base,
  };
});

vi.mock('../../../store/selectors', () => ({
  useSession: () => ({
    auditEvents: store.auditEvents,
    dailySettlements: [],
    businessDateStatuses: {},
    cashSessions: {},
  }),
}));

import { AuditTrailTable } from '../AuditTrailTable';

describe('AuditTrailTable', () => {
  beforeEach(() => {
    store.auditEvents = [...baseEvents];
  });

  it('renders events sorted by createdAt desc', () => {
    const { container } = render(<AuditTrailTable />);
    const rows = container.querySelectorAll('.rpt-tr');
    expect(rows.length).toBe(3);
    expect(rows[0].textContent).toContain('18:00:00');
  });

  it('shows event type labels', () => {
    const { container } = render(<AuditTrailTable />);
    expect(container.textContent).toContain('編輯');
    expect(container.textContent).toContain('更正');
    expect(container.textContent).toContain('關帳');
  });

  it('shows correct pill class per event type', () => {
    const { container } = render(<AuditTrailTable />);
    expect(container.querySelector('.pill-warn')).toBeTruthy();
    expect(container.querySelector('.pill-ok')).toBeTruthy();
    expect(container.querySelector('.pill')).toBeTruthy();
  });

  it('shows operatorId', () => {
    const { container } = render(<AuditTrailTable />);
    expect(container.textContent).toContain('op-1');
    expect(container.textContent).toContain('op-2');
  });

  it('shows entity type and truncated entityId', () => {
    const { container } = render(<AuditTrailTable />);
    expect(container.textContent).toContain('transaction');
    expect(container.textContent).toContain('tx-1');
  });

  it('shows (新建) when before is null', () => {
    const { container } = render(<AuditTrailTable />);
    expect(container.textContent).toContain('(新建)');
  });

  it('shows field changes joined by ; when changes exist', () => {
    const { container } = render(<AuditTrailTable />);
    expect(container.textContent).toContain('mealPrice');
  });

  it('shows businessDate', () => {
    const { container } = render(<AuditTrailTable />);
    expect(container.textContent).toContain('2026-05-30');
  });

  it('shows 尚無稽核紀錄 when auditEvents is empty', () => {
    store.auditEvents = [];
    const { container } = render(<AuditTrailTable />);
    expect(container.textContent).toContain('尚無稽核紀錄');
  });

  it('shows - when no changes in before/after', () => {
    store.auditEvents = [{
      auditEventId: 'ae-x', eventType: 'transaction_edited', entityType: 'transaction',
      entityId: 'tx-x', businessDate: '2026-05-30',
      before: {}, after: {},
      reason: 'correction', operatorId: 'op-3', createdAt: '2026-05-30T10:00:00.000Z',
    }];
    const { container } = render(<AuditTrailTable />);
    expect(container.textContent).toContain('-');
  });
});
