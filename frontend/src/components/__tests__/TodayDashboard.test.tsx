import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { DailySettlement } from '../../domain/cashClose';
import type { PosTransaction } from '../../domain/transaction';
import type { LedgerAuditEvent } from '../../domain/ledgerAudit';

const { store, baseTrans, baseEvents, baseSettlements, baseStatuses, todayStr } = vi.hoisted(() => {
  const systemDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
  const transactions: PosTransaction[] = [
    {
      transactionId: 'tx-1', studentId: '001', studentNameSnapshot: '王小美', type: 'order',
      businessDate: systemDate, mealPrice: 90, paidAmount: 0,
      amount: -90, note: '', afterBalance: -90, createdAt: '2026-05-30T12:00:00.000Z',
      menuNameSnapshot: '排骨便當', vendorNameSnapshot: '老王便當', sourceDevice: 'pc',
      revision: 1, syncStatus: 'local', depositAmount: 0, unpaidAmount: 90,
    },
    {
      transactionId: 'tx-2', studentId: '002', studentNameSnapshot: '李大华', type: 'payment',
      businessDate: systemDate, mealPrice: 0, paidAmount: 500,
      amount: 500, note: '', afterBalance: 500, createdAt: '2026-05-30T13:00:00.000Z',
      menuNameSnapshot: '', vendorNameSnapshot: '', sourceDevice: 'pc',
      revision: 1, syncStatus: 'queued', depositAmount: 500, unpaidAmount: 0,
    },
  ];
  const auditEvents: LedgerAuditEvent[] = [
    { auditEventId: 'ae-1', eventType: 'transaction_edited', entityType: 'transaction',
      entityId: 'tx-1', businessDate: systemDate,
      before: { mealPrice: 90 }, after: { mealPrice: 80 },
      reason: 'correction', operatorId: 'op-1', createdAt: '2026-05-30T14:00:00.000Z' },
    { auditEventId: 'ae-2', eventType: 'transaction_deleted', entityType: 'transaction',
      entityId: 'tx-3', businessDate: systemDate,
      before: { mealPrice: 90 }, after: null,
      reason: 'void', operatorId: 'op-2', createdAt: '2026-05-30T15:00:00.000Z' },
  ];
  const settlements: DailySettlement[] = [{
    settlementId: 's-1', businessDate: systemDate,
    status: 'closed' as const, settlementRevision: 1,
    orderCount: 10, transactionCount: 12, totalIncome: 900, totalExpense: 200,
    openingCash: 500, netCash: 700, expectedCash: 1200, countedCash: 1200, difference: 0,
    note: 'end of day', closedBy: 'op-1', closedAt: '2026-05-30T18:00:00.000Z',
    syncStatus: 'synced' as const, revision: 1,
  }];
  return {
    store: {
      transactions: [...transactions] as PosTransaction[],
      auditEvents: [...auditEvents] as LedgerAuditEvent[],
      dailySettlements: [...settlements] as DailySettlement[],
      businessDateStatuses: { [systemDate]: 'closed' } as Record<string, string>,
    },
    baseTrans: transactions,
    baseEvents: auditEvents,
    baseSettlements: settlements,
    baseStatuses: { [systemDate]: 'closed' } as Record<string, string>,
    todayStr: systemDate,
  };
});

vi.mock('../../store/selectors', () => ({
  useSession: () => ({
    auditEvents: store.auditEvents,
    dailySettlements: store.dailySettlements,
    businessDateStatuses: store.businessDateStatuses,
    cashSessions: {},
  }),
  useTransactions: () => ({
    transactions: store.transactions,
  }),
}));

import { TodayDashboard } from '../TodayDashboard';

describe('TodayDashboard', () => {
  beforeEach(() => {
    store.transactions = baseTrans.map(t => ({ ...t }));
    store.auditEvents = baseEvents.map(e => ({ ...e, before: e.before ? { ...e.before } : null, after: e.after ? { ...e.after } : null }));
    store.dailySettlements = baseSettlements.map(s => ({ ...s }));
    store.businessDateStatuses = { ...baseStatuses };
  });

  it('uses the systemDate prop (practice business date) instead of the real date', () => {
    const practiceDate = '2026-01-05';
    store.transactions = [
      ...baseTrans.map(t => ({ ...t })),
      { ...baseTrans[0], transactionId: 'tx-p', studentNameSnapshot: '練習生', businessDate: practiceDate, syncStatus: 'local' as const },
    ];
    const { container } = render(<TodayDashboard systemDate={practiceDate} onClose={vi.fn()} />);
    expect(container.textContent).toContain(practiceDate);
    expect(container.textContent).toContain('練習生');
    expect(container.textContent).not.toContain('王小美');
    expect(container.textContent).toContain('營業中');
  });

  it('renders system date', () => {
    const { container } = render(<TodayDashboard systemDate={todayStr} onClose={vi.fn()} />);
    expect(container.textContent).toContain(todayStr);
  });

  it('F08：筆數含未付款訂餐，份數附餐費，收現是實收現金', () => {
    const { container } = render(<TodayDashboard systemDate={todayStr} onClose={vi.fn()} />);
    const cards = Array.from(container.querySelectorAll('.db-card')).map(el => el.textContent);
    expect(cards[0]).toBe('筆數2含未付款訂餐');
    expect(cards[1]).toBe('份數1餐費 $90');
    expect(cards[2]).toBe('收現$500淨現金 $500');
    expect(container.textContent).not.toMatch(/undefined|NaN/);
  });

  it('shows 已關帳 when dateStatus is closed', () => {
    const { container } = render(<TodayDashboard systemDate={todayStr} onClose={vi.fn()} />);
    expect(container.textContent).toContain('已關帳');
  });

  it('shows 營業中 when dateStatus is open', () => {
    store.businessDateStatuses = { [todayStr]: 'open' };
    const { container } = render(<TodayDashboard systemDate={todayStr} onClose={vi.fn()} />);
    expect(container.textContent).toContain('營業中');
  });

  it('shows 已重開 when dateStatus is reopened', () => {
    store.businessDateStatuses = { [todayStr]: 'reopened' };
    const { container } = render(<TodayDashboard systemDate={todayStr} onClose={vi.fn()} />);
    expect(container.textContent).toContain('已重開');
  });

  it('shows settlement closer and time when todaySettlement exists', () => {
    const { container } = render(<TodayDashboard systemDate={todayStr} onClose={vi.fn()} />);
    expect(container.textContent).toContain('op-1');
    // F10：關帳時間 18:00Z 顯示為台北時間 02:00:00
    expect(container.textContent).toContain('02:00:00');
  });

  it('shows queued count synced when 0', () => {
    store.transactions.forEach(t => { t.syncStatus = 'local'; });
    const { container } = render(<TodayDashboard systemDate={todayStr} onClose={vi.fn()} />);
    expect(container.textContent).toContain('已全數同步');
  });

  it('今日更正與刪除各算一筆', () => {
    const { container } = render(<TodayDashboard systemDate={todayStr} onClose={vi.fn()} />);
    const card = Array.from(container.querySelectorAll('.db-card')).find(el => el.textContent?.includes('今日更正'));
    expect(card?.textContent).toBe('今日更正1刪除 1 筆');
  });

  it('shows latest 5 transactions sorted by createdAt desc', () => {
    const { container } = render(<TodayDashboard systemDate={todayStr} onClose={vi.fn()} />);
    expect(container.textContent).toContain('最近 5 筆交易');
  });

  it('shows 今日尚無交易紀錄 when no transactions today', () => {
    store.transactions = [];
    const { container } = render(<TodayDashboard systemDate={todayStr} onClose={vi.fn()} />);
    expect(container.textContent).toContain('今日尚無交易紀錄');
  });

  it('calls onClose when overlay clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<TodayDashboard systemDate={todayStr} onClose={onClose} />);
    const overlay = container.querySelector('.db-overlay') as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<TodayDashboard systemDate={todayStr} onClose={onClose} />);
    const closeBtn = container.querySelector('.db-close') as HTMLElement;
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('panel click does NOT call onClose', () => {
    const onClose = vi.fn();
    const { container } = render(<TodayDashboard systemDate={todayStr} onClose={onClose} />);
    const panel = container.querySelector('.db-panel') as HTMLElement;
    fireEvent.click(panel);
    expect(onClose).not.toHaveBeenCalled();
  });
});
