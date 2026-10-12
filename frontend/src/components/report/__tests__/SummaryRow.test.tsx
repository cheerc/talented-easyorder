import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SummaryRow } from '../SummaryRow';
import type { LedgerGroup } from '../../../domain/ledgerReport';
import type { LedgerTransaction } from '../../../domain/ledger';

describe('SummaryRow（M2）', () => {
  it('淨變動是每一筆增減的加總，包含第一筆', () => {
    const rows = [
      { transactionId: 'a', amount: -90, afterBalance: -90 },
      { transactionId: 'b', amount: 120, afterBalance: 30 },
    ] as LedgerTransaction[];
    const group = { studentId: '001', studentNameSnapshot: '甲', latestCreatedAt: '', mealTotal: 90, paidTotal: 120, afterBalance: 30, recordCount: 1, transactions: rows } as LedgerGroup;
    const { container } = render(<SummaryRow group={group} groupIndex={0} />);
    expect(container.textContent).toContain('淨變動 +$30');
  });
});
