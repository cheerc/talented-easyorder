import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';

vi.mock('../hooks/useFirebase', () => ({
  useFirebase: () => ({ fb: null, fbError: null, access: { ok: false, reason: 'signed_out' } }),
}));

import { ReportScreen } from '../components/screens/ReportScreen';
import { usePosStore } from '../store/posStore';
import { buildPosTransactionDraft } from '../domain/posTransaction';
import { CASHIER_SENTINEL } from '../domain/ledger';

// M3 F2（D03／D04）：固定的晚餐日情境，數字照驗收清單手算。
// 開帳 1000；甲訂 90 收 0、乙訂 90 收 100、丙只繳 500、甲另訂 110 收 0、櫃台付餐費給廠商 270。
// 淨現金 = 100 + 500 − 270 = 330，應有 1330。
const DATE = '2026-10-13';

function commit(studentId: string, type: 'order' | 'payment' | 'expense', mealPrice: number, paidAmount: number, note = '') {
  const s = usePosStore.getState();
  const student = s.students.find(x => x.studentId === studentId);
  const draft = buildPosTransactionDraft({
    intent: { businessDate: DATE, studentId: type === 'expense' ? CASHIER_SENTINEL : studentId, type, mealPrice, paidAmount, note, sourceDevice: 'pc' },
    student: student ?? { ...s.students[0], studentId: CASHIER_SENTINEL, displayName: '櫃台' },
    menu: { ...s.todayMenu, businessDate: DATE },
  });
  const r = s.commitPosTransactionDraft(draft);
  if (!r.ok) throw new Error(r.message);
}

beforeEach(() => {
  usePosStore.getState().loadSampleData();
  usePosStore.getState().openCashSession({ businessDate: DATE, openingCash: 1000, operatorId: 'counter', openedAt: '2026-10-13T09:00:00.000Z' });
  commit('001', 'order', 90, 0);
  commit('002', 'order', 90, 100);
  commit('003', 'payment', 0, 500);
  commit('001', 'order', 110, 0);
  commit(CASHIER_SENTINEL, 'expense', 270, 0, '付餐費給廠商');
});

const bar = () => screen.getByRole('region', { name: '日末結帳' });

function closeWith(counted: string, note: string) {
  fireEvent.click(screen.getByRole('button', { name: '日末點現金' }));
  fireEvent.change(screen.getByLabelText('實際點算金額'), { target: { value: counted } });
  if (note) fireEvent.change(screen.getByLabelText('關帳備註'), { target: { value: note } });
  fireEvent.click(screen.getByRole('button', { name: '確認關帳' }));
  fireEvent.click(screen.getByRole('button', { name: '確定關帳' }));
}

describe('F2 日末點現金（D03／D04）', () => {
  it('明細在前、點現金表單預設收起；橫條就看得到開帳、淨現金、應有', () => {
    render(<ReportScreen viewDate={DATE} />);
    expect(screen.queryByLabelText('實際點算金額')).toBeNull();
    expect(bar().textContent).toContain('開帳 $1,000');
    expect(bar().textContent).toContain('淨現金 $330');
    expect(bar().textContent).toContain('應有 $1,330');
    fireEvent.click(screen.getByRole('button', { name: '日末點現金' }));
    expect(document.activeElement).toBe(screen.getByLabelText('實際點算金額'));
    fireEvent.click(screen.getByRole('button', { name: '收起點現金' }));
    expect(screen.queryByLabelText('實際點算金額')).toBeNull();
  });

  it('D03：搜尋某人、切到本週後，日結仍算全日；差 −10 沒寫原因不能關', () => {
    render(<ReportScreen viewDate={DATE} />);
    fireEvent.change(screen.getByLabelText('搜尋學員編號或姓名'), { target: { value: '003' } });
    fireEvent.click(screen.getByRole('button', { name: '本週' }));
    expect(bar().textContent).toContain('應有 $1,330');

    fireEvent.click(screen.getByRole('button', { name: '日末點現金' }));
    fireEvent.change(screen.getByLabelText('實際點算金額'), { target: { value: '1320' } });
    expect(within(bar()).getByText('−$10')).toBeTruthy();
    expect((screen.getByRole('button', { name: '確認關帳' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('D03→D04：關帳後顯示結帳摘要；重開、補收入 10、點 1340 再關，保留兩版', () => {
    render(<ReportScreen viewDate={DATE} />);
    const txCount = usePosStore.getState().transactions.length;
    closeWith('1320', '點算短少10，待查');

    // 差額不會自動造一筆交易把帳沖平。
    expect(usePosStore.getState().transactions.length).toBe(txCount);
    expect(bar().textContent).toContain('已關帳');
    expect(bar().textContent).toContain('第 1 版');
    expect(bar().textContent).toContain('應有 $1,330');
    expect(bar().textContent).toContain('實點 $1,320');
    expect(bar().textContent).toContain('差異 −$10');
    expect(bar().textContent).toContain('原因：點算短少10，待查');
    expect(screen.queryByRole('button', { name: '日末點現金' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '重新開啟日期' }));
    fireEvent.change(screen.getByPlaceholderText('請說明重新開啟的原因'), { target: { value: '漏記櫃台收入10' } });
    fireEvent.click(screen.getByRole('button', { name: '確認重開' }));
    expect(bar().textContent).toContain('已重開（上次關帳第 1 版：實點 $1,320，差異 −$10）');
    // 重開後表單仍收起，要再按才展開。
    expect(screen.queryByLabelText('實際點算金額')).toBeNull();

    act(() => commit(CASHIER_SENTINEL, 'expense', 0, 10, '漏記收入'));
    expect(bar().textContent).toContain('應有 $1,340');
    closeWith('1340', '');

    expect(bar().textContent).toContain('第 3 版');
    expect(bar().textContent).toContain('實點 $1,340');
    expect(bar().textContent).toContain('差異 ✓ 平');
    const closed = usePosStore.getState().dailySettlements.filter(s => s.businessDate === DATE && s.status === 'closed');
    expect(closed.map(s => [s.expectedCash, s.countedCash, s.difference])).toEqual([[1330, 1320, -10], [1340, 1340, 0]]);
  });
});
