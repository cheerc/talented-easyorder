import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { SummaryRow } from '../SummaryRow';
import type { LedgerGroup } from '../../../domain/ledgerReport';
import { mergeLedgerTransactions, type LedgerTransaction } from '../../../domain/ledger';
import { groupLedgerRowsByStudent } from '../../../domain/ledgerReport';
import { usePosStore } from '../../../store/posStore';
import { createLocalAccount } from '../../../domain/student';
import { buildPosTransactionDraft } from '../../../domain/posTransaction';
import { resolveMenuForDate } from '../../../domain/menu';

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

// M4：取消訂餐但收款留在帳戶（櫃台或平板取消），原單改成繳費；摘要要照交易現在的類型算，不能還寫「訂餐」。
describe('SummaryRow 依交易現在的類型計數', () => {
  const D = '2026-10-14';
  const s = () => usePosStore.getState();
  const summaryFor = (studentId: string) => {
    const merged = mergeLedgerTransactions(s().transactions.filter(t => t.businessDate === D)) as unknown as LedgerTransaction[];
    const group = groupLedgerRowsByStudent(merged).find(g => g.studentId === studentId)!;
    const { container } = render(<SummaryRow group={group} groupIndex={0} />);
    return container.textContent ?? '';
  };
  const counterOrder = (studentId: string, paid: number) => {
    const st = s();
    const r = st.commitPosTransactionDraft(buildPosTransactionDraft({
      intent: { businessDate: D, studentId, type: 'order', mealPrice: 90, paidAmount: paid, note: '', sourceDevice: 'pc' },
      student: st.students.find(x => x.studentId === studentId)!, menu: resolveMenuForDate(st.menusByDate, st.todayMenu, D).menu,
    }));
    if (!r.ok) throw new Error(r.message);
  };

  beforeEach(() => {
    s().startBlankData();
    s().addLocalStudent(createLocalAccount({ studentId: '003', displayName: '丙', openingBalance: 0, openingNote: '', asOfDate: D }, 'now'));
    s().setMenuForDate(D, { itemName: '排骨便當', price: 90, vendorId: '', vendorNameSnapshot: '' }, 'now');
  });

  it('平板取消（付過現金）後原單改成繳費：合併模式摘要顯示繳費 1 筆，不是訂餐', () => {
    counterOrder('003', 100);
    const ev = s().handleFaceEvent({ eventId: 'c1', deviceId: 'faceorder-01', action: 'cancel', studentId: '003', businessDate: D, recognizedAt: `${D}T02:00:00.000Z` }, `${D}T02:00:00.000Z`);
    expect(ev.status).toBe('accepted');
    expect(s().transactions[0]).toMatchObject({ type: 'payment', note: '取消訂餐：保留繳費 100' });
    const text = summaryFor('003');
    expect(text).toContain('繳費 1 筆');
    expect(text).not.toContain('訂餐');
  });

  it('櫃台取消訂餐、收款留在帳戶（同一條路徑）：摘要同樣顯示繳費 1 筆', () => {
    counterOrder('003', 100);
    const tx = s().transactions[0];
    const r = s().deleteOrderWithRefundCheck(tx.transactionId, { reason: '家長取消', operatorId: 'pc', keepPaymentAsDeposit: true });
    expect(r.deleted).toBe(true);
    const text = summaryFor('003');
    expect(text).toContain('繳費 1 筆');
    expect(text).not.toContain('訂餐');
  });

  it('有訂餐也有繳費（原始模式）時兩種都列出', () => {
    counterOrder('003', 0);
    s().processTransaction('003', 'payment', 0, 100);
    const group = groupLedgerRowsByStudent(s().transactions).find(g => g.studentId === '003')!;
    const { container } = render(<SummaryRow group={group} groupIndex={0} />);
    expect(container.textContent).toContain('訂餐 1 筆');
    expect(container.textContent).toContain('繳費 1 筆');
  });
});
