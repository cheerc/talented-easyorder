import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { DailySettlement } from '../../domain/cashClose';

const { store, baseSettlements } = vi.hoisted(() => {
  const base: DailySettlement[] = [
    {
      settlementId: 's-1', businessDate: '2026-05-30', status: 'closed', settlementRevision: 1,
      orderCount: 10, transactionCount: 12, totalIncome: 900, totalExpense: 200,
      openingCash: 500, netCash: 700, expectedCash: 1200, countedCash: 1205, difference: 5,
      note: 'end of day', closedBy: 'op-1', closedAt: '2026-05-30T18:00:00.000Z',
      syncStatus: 'synced' as const, revision: 1,
    },
    {
      settlementId: 's-2', businessDate: '2026-05-29', status: 'reopened', settlementRevision: 2,
      orderCount: 8, transactionCount: 10, totalIncome: 720, totalExpense: 150,
      openingCash: 500, netCash: 570, expectedCash: 1070, countedCash: 1070, difference: 0,
      note: 'corrected', closedBy: 'op-2', closedAt: '2026-05-29T17:00:00.000Z',
      reopenedBy: 'op-1', reopenedAt: '2026-05-29T18:30:00.000Z', reopenReason: 'missed tx',
      syncStatus: 'synced' as const, revision: 2,
    },
  ];
  return {
    store: { dailySettlements: [...base] as DailySettlement[] },
    baseSettlements: base,
  };
});

vi.mock('../../../store/posStore', () => ({
  usePosStore: (selector: (s: { dailySettlements: DailySettlement[] }) => unknown) => selector(store),
}));

import { SettlementHistoryTable } from '../SettlementHistoryTable';

describe('SettlementHistoryTable', () => {
  beforeEach(() => {
    store.dailySettlements = [...baseSettlements];
  });

  it('shows 尚無關帳紀錄 when dailySettlements is empty', () => {
    store.dailySettlements = [];
    const { container } = render(<SettlementHistoryTable />);
    expect(container.textContent).toContain('尚無關帳紀錄');
  });

  it('renders settlements sorted by businessDate desc', () => {
    const { container } = render(<SettlementHistoryTable />);
    const rows = container.querySelectorAll('.rpt-tr');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('2026-05-30');
  });

  it('shows status labels', () => {
    const { container } = render(<SettlementHistoryTable />);
    expect(container.textContent).toContain('已關帳');
    expect(container.textContent).toContain('已重開');
  });

  it('shows orderCount', () => {
    const { container } = render(<SettlementHistoryTable />);
    expect(container.textContent).toContain('10');
    expect(container.textContent).toContain('8');
  });

  it('shows expectedCash and countedCash', () => {
    const { container } = render(<SettlementHistoryTable />);
    expect(container.textContent).toContain('$1,200');
  });

  it('shows difference with + prefix when positive', () => {
    const { container } = render(<SettlementHistoryTable />);
    expect(container.textContent).toContain('+5');
  });

  it('shows difference in warn style when non-zero', () => {
    const { container } = render(<SettlementHistoryTable />);
    const warnEls = container.querySelectorAll('.rpt-tr .warn');
    expect(warnEls.length).toBeGreaterThanOrEqual(1);
  });

  it('shows closedBy and closedAt', () => {
    const { container } = render(<SettlementHistoryTable />);
    expect(container.textContent).toContain('op-1');
    expect(container.textContent).toContain('18:00:00');
  });

  it('expands row on click to show details', () => {
    const { container } = render(<SettlementHistoryTable />);
    const firstRow = container.querySelector('.rpt-tr') as HTMLElement;
    fireEvent.click(firstRow);
    expect(container.textContent).toContain('end of day');
    expect(container.textContent).toContain('synced');
  });

  it('collapses expanded row on second click', () => {
    const { container } = render(<SettlementHistoryTable />);
    const firstRow = container.querySelector('.rpt-tr') as HTMLElement;
    fireEvent.click(firstRow);
    fireEvent.click(firstRow);
    expect(container.querySelector('.rpt-expand')).toBeNull();
  });

  it('shows reopen info when present', () => {
    const { container } = render(<SettlementHistoryTable />);
    const secondRow = container.querySelectorAll('.rpt-tr')[1] as HTMLElement;
    fireEvent.click(secondRow);
    expect(container.textContent).toContain('missed tx');
    expect(container.textContent).toContain('18:30:00');
  });
});
