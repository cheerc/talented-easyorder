import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { LedgerAuditEvent } from '../../../domain/ledgerAudit';
import type { LedgerTransaction } from '../../../domain/ledger';

const { store, baseEvents, baseTransactions } = vi.hoisted(() => {
  const events: LedgerAuditEvent[] = [
    {
      auditEventId: 'ae-1', eventType: 'transaction_edited', entityType: 'transaction',
      entityId: 'tx-1', businessDate: '2026-05-30',
      before: { mealPrice: 90, paidAmount: 100, note: '' }, after: { mealPrice: 90, paidAmount: 120, note: '' },
      reason: '收款打錯', operatorId: '__system__', createdAt: '2026-05-30T08:42:58.000Z',
    },
    {
      auditEventId: 'ae-2', eventType: 'transaction_deleted', entityType: 'transaction',
      entityId: 'tx-2', businessDate: '2026-05-29',
      before: { transactionId: 'tx-2', studentId: '002', studentNameSnapshot: '李小華', type: 'order', mealPrice: 90, paidAmount: 0, note: '' },
      after: null,
      reason: '家長來電取消', operatorId: 'uid-abc', createdAt: '2026-05-29T03:00:00.000Z',
    },
    {
      auditEventId: 'ae-3', eventType: 'transaction_edited', entityType: 'transaction',
      entityId: 'tx-3', businessDate: '2026-05-30',
      before: { type: 'order', mealPrice: 90, paidAmount: 50, note: '' },
      after: { type: 'payment', mealPrice: 0, paidAmount: 50, note: '取消訂餐：保留繳費 50' },
      reason: '臨時不訂', operatorId: '__system__', createdAt: '2026-05-30T05:00:00.000Z',
    },
  ];
  const tx = (id: string, studentId: string, name: string) => ({ transactionId: id, studentId, studentNameSnapshot: name }) as unknown as LedgerTransaction;
  const transactions = [tx('tx-1', '001', '王小明'), tx('tx-3', '003', '陳小美')];
  return {
    store: { auditEvents: [...events], transactions: [...transactions] },
    baseEvents: events,
    baseTransactions: transactions,
  };
});

vi.mock('../../../store/selectors', () => ({
  useSession: () => ({
    auditEvents: store.auditEvents,
    dailySettlements: [],
    businessDateStatuses: {},
    cashSessions: {},
  }),
  useTransactions: () => ({ transactions: store.transactions }),
}));

import { AuditTrailTable } from '../AuditTrailTable';

const rowTexts = (container: HTMLElement) => Array.from(container.querySelectorAll('.rpt-tr')).map(r => r.textContent ?? '');

describe('AuditTrailTable（M2 F09／F10）', () => {
  beforeEach(() => {
    store.auditEvents = [...baseEvents];
    store.transactions = [...baseTransactions];
  });

  it('依操作時間由新到舊，時間是台北時間，營業日另成一欄', () => {
    const { container } = render(<AuditTrailTable />);
    const rows = rowTexts(container);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('2026-05-30 16:42:58');
    expect(rows[0]).not.toContain('08:42:58');
    expect(rows[2]).toContain('2026-05-29 11:00:00');
    expect(rows[2]).toMatch(/2026-05-29$/);
  });

  it('更正：顯示帳戶編號與姓名、中文欄名的前後值、理由；本機操作顯示「本機櫃台」', () => {
    const { container } = render(<AuditTrailTable />);
    const row = rowTexts(container)[0];
    expect(row).toContain('更正');
    expect(row).toContain('001 王小明');
    expect(row).toContain('實收金額 $100 → $120');
    expect(row).toContain('理由：收款打錯');
    expect(row).toContain('本機櫃台');
    expect(row).not.toMatch(/paidAmount|__system__|tx-1/);
  });

  it('取消訂餐（保留繳費）與刪除後的原單：帳戶從原單找回', () => {
    const { container } = render(<AuditTrailTable />);
    const [, cancelKeep, deleted] = rowTexts(container);
    expect(cancelKeep).toContain('取消訂餐');
    expect(cancelKeep).toContain('003 陳小美');
    expect(cancelKeep).toContain('類型 訂餐 → 繳費');
    expect(deleted).toContain('取消訂餐');
    expect(deleted).toContain('002 李小華');
    expect(deleted).toContain('刪除原單：訂餐、應收 $90、實收 $0');
    expect(deleted).toContain('uid-abc');
  });

  it('可用帳戶編號、姓名或營業日查詢', () => {
    const { container, getByLabelText } = render(<AuditTrailTable />);
    const input = getByLabelText('查詢稽核紀錄');
    fireEvent.change(input, { target: { value: '李小華' } });
    expect(rowTexts(container)).toHaveLength(1);
    fireEvent.change(input, { target: { value: '2026-05-30' } });
    expect(rowTexts(container)).toHaveLength(2);
    fireEvent.change(input, { target: { value: '999' } });
    expect(rowTexts(container)).toHaveLength(0);
    expect(container.textContent).toContain('沒有符合「999」的紀錄');
  });

  it('沒有稽核紀錄時顯示尚無稽核紀錄', () => {
    store.auditEvents = [];
    const { container } = render(<AuditTrailTable />);
    expect(container.textContent).toContain('尚無稽核紀錄');
  });
});
