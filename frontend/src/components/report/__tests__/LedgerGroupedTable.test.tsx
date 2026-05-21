import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LedgerGroupedTable } from '../LedgerGroupedTable';

describe('LedgerGroupedTable', () => {
  it('renders without crashing with grouped transactions', () => {
    const groups = [
      {
        studentId: '001',
        studentNameSnapshot: '王小美',
        latestCreatedAt: '2026-05-17T12:00:00.000Z',
        mealTotal: 90,
        paidTotal: 90,
        afterBalance: 100,
        recordCount: 1,
        transactions: [
          {
            transactionId: 'tx-1',
            studentId: '001',
            studentNameSnapshot: '王小美',
            type: 'order' as const,
            businessDate: '2026-05-17',
            mealPrice: 90,
            paidAmount: 90,
            amount: 0,
            note: '便當',
            afterBalance: 100,
            createdAt: '2026-05-17T12:00:00.000Z',
            createdBy: 'test',
            syncStatus: 'local' as const,
          },
        ],
      },
    ];
    const expenseRows: typeof groups[0]['transactions'] = [];

    render(
      <LedgerGroupedTable
        groups={groups}
        expenseRows={expenseRows}
        onToggleExpand={() => {}}
        expandedSids={new Set(['001'])}
        onEditClick={() => {}}
        onDeleteClick={() => {}}
        dateStatus="open"
      />,
    );

    expect(screen.getByText('王小美')).toBeTruthy();
  });

  it('shows pagination when groups exceed page size', () => {
    const groups = Array.from({ length: 25 }, (_, i) => ({
      studentId: String(i + 1).padStart(3, '0'),
      studentNameSnapshot: `學員${i + 1}`,
      latestCreatedAt: '2026-05-17T12:00:00.000Z',
      mealTotal: 90,
      paidTotal: 90,
      afterBalance: 100,
      recordCount: 1,
      transactions: [
        {
          transactionId: `tx-${i}`,
          studentId: String(i + 1).padStart(3, '0'),
          studentNameSnapshot: `學員${i + 1}`,
          type: 'order' as const,
          businessDate: '2026-05-17',
          mealPrice: 90,
          paidAmount: 90,
          amount: 0,
          note: '',
          afterBalance: 100,
          createdAt: '2026-05-17T12:00:00.000Z',
          createdBy: 'test',
          syncStatus: 'local' as const,
        },
      ],
    }));

    render(
      <LedgerGroupedTable
        groups={groups}
        expenseRows={[]}
        onToggleExpand={() => {}}
        expandedSids={new Set()}
        onEditClick={() => {}}
        onDeleteClick={() => {}}
        dateStatus="open"
      />,
    );

    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(screen.getByText('＜ 上一頁')).toBeTruthy();
    expect(screen.getByText('下一頁 ＞')).toBeTruthy();
  });

  it('renders cashier income and expense rows correctly', () => {
    const expenseRows = [
      {
        transactionId: 'tx-exp-1',
        studentId: '__cashier__',
        studentNameSnapshot: '櫃台',
        type: 'expense' as const,
        businessDate: '2026-05-17',
        mealPrice: 0,
        paidAmount: 500,
        amount: 500,
        note: '櫃台收入測試',
        afterBalance: 0,
        createdAt: '2026-05-17T12:00:00.000Z',
        syncStatus: 'local' as const,
        revision: 1,
        sourceDevice: 'pc' as const,
      },
      {
        transactionId: 'tx-exp-2',
        studentId: '__cashier__',
        studentNameSnapshot: '櫃台',
        type: 'expense' as const,
        businessDate: '2026-05-17',
        mealPrice: 300,
        paidAmount: 0,
        amount: -300,
        note: '櫃台支出測試',
        afterBalance: 0,
        createdAt: '2026-05-17T12:05:00.000Z',
        syncStatus: 'local' as const,
        revision: 1,
        sourceDevice: 'pc' as const,
      },
    ];

    render(
      <LedgerGroupedTable
        groups={[]}
        expenseRows={expenseRows}
        onToggleExpand={() => {}}
        expandedSids={new Set()}
        onEditClick={() => {}}
        onDeleteClick={() => {}}
        dateStatus="open"
      />,
    );

    expect(screen.getByText('櫃台 收支明細（2 筆）')).toBeTruthy();
    expect(screen.getByText('櫃台收入測試')).toBeTruthy();
    expect(screen.getByText('櫃台支出測試')).toBeTruthy();
    expect(screen.getByText('+$500')).toBeTruthy();
    expect(screen.getByText('−$300')).toBeTruthy();
  });
});

