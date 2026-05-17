import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
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

    const { container } = render(
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

    expect(container).toBeTruthy();
  });
});
