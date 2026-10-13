import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, renderHook } from '@testing-library/react';

vi.mock('../hooks/useFirebase', () => ({
  useFirebase: () => ({ fb: null, fbError: null, access: { ok: false, reason: 'signed_out' } }),
}));

import { HistoryScreen } from '../components/screens/HistoryScreen';
import { IdleHero } from '../components/pos/IdleHero';
import { usePosStore } from '../store/posStore';
import { useCashClose } from '../store/derived/useCashClose';
import { resolveMenuForDate } from '../domain/menu';
import { buildPosTransactionDraft } from '../domain/posTransaction';
import { buildSnapshot, parseSnapshot, pickDataset } from '../domain/practiceSnapshot';
import { createLocalAccount } from '../domain/student';

const D1 = '2026-10-13';
const D2 = '2026-10-14';

function commit(studentId: string, type: 'order' | 'payment', mealPrice: number, paidAmount: number, date = D1): string {
  const s = usePosStore.getState();
  const student = s.students.find(x => x.studentId === studentId)!;
  const draft = buildPosTransactionDraft({
    intent: { businessDate: date, studentId, type, mealPrice, paidAmount, note: '', sourceDevice: 'pc' },
    student,
    menu: resolveMenuForDate(s.menusByDate, s.todayMenu, date).menu,
  });
  const r = s.commitPosTransactionDraft(draft);
  if (!r.ok) throw new Error(r.message);
  return r.transactionId;
}

beforeEach(() => {
  usePosStore.getState().startBlankData();
  usePosStore.getState().addLocalStudent(createLocalAccount({ studentId: '002', displayName: '測試乙', openingBalance: 0, openingNote: '', asOfDate: D1 }, 'now'));
  usePosStore.getState().setMenuForDate(D1, { itemName: '排骨', price: 90, vendorId: '', vendorNameSnapshot: '' }, 'now');
  usePosStore.getState().openCashSession({ businessDate: D1, openingCash: 1000, operatorId: 'counter', openedAt: `${D1}T09:00:00.000Z` });
});

describe('F5 交易查詢與看原單（D05）', () => {
  it('稽核列「看原單」帶到交易查詢並標出那一筆；三種餘額分開寫；可展開更正內容', () => {
    commit('002', 'order', 90, 0);
    const payId = commit('002', 'payment', 0, 100);
    usePosStore.getState().editTransaction(payId, { paidAmount: 120 }, { reason: '誤記100，實收120' });

    render(<HistoryScreen viewDate={D1} />);
    fireEvent.click(screen.getByRole('button', { name: '稽核軌跡' }));
    fireEvent.click(screen.getByRole('button', { name: '看原單' }));

    expect((screen.getByLabelText('查詢帳戶') as HTMLInputElement).value).toBe('002');
    const note = screen.getByRole('note');
    expect(note.textContent).toContain('002 測試乙');
    expect(note.textContent).toContain('現在餘額 $30');
    expect(note.textContent).toContain(`${D1} 結束時餘額 $30`);

    const highlighted = document.querySelector('[data-highlight="true"]') as HTMLElement;
    expect(highlighted.textContent).toContain('繳費');
    expect(highlighted.textContent).toContain('$120');
    // 標出的那一筆預設展開更正紀錄。
    expect(highlighted.textContent).toContain('實收金額 $100 → $120');
    expect(highlighted.textContent).toContain('理由：誤記100，實收120');
  });

  it('原單已刪除時「看當天」，交易查詢列出那筆並標示已刪除', () => {
    const payId = commit('002', 'payment', 0, 100);
    usePosStore.getState().deleteTransaction(payId, { reason: '誤記，實際沒收到' });

    render(<HistoryScreen viewDate={D1} />);
    fireEvent.click(screen.getByRole('button', { name: '稽核軌跡' }));
    fireEvent.click(screen.getByRole('button', { name: '看當天' }));

    const highlighted = document.querySelector('[data-highlight="true"]') as HTMLElement;
    expect(highlighted.textContent).toContain('已刪除');
    expect(highlighted.textContent).toContain('$100');
    expect(highlighted.textContent).toContain('理由：誤記，實際沒收到');
  });

  it('不需要交易編號：直接用姓名與日期區間查', () => {
    commit('002', 'order', 90, 0);
    render(<HistoryScreen viewDate={D1} />);
    fireEvent.click(screen.getByRole('button', { name: '交易查詢' }));
    fireEvent.change(screen.getByLabelText('查詢帳戶'), { target: { value: '測試乙' } });
    expect(screen.getAllByText('訂餐').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('起始營業日'), { target: { value: D2 } });
    fireEvent.change(screen.getByLabelText('結束營業日'), { target: { value: D2 } });
    expect(screen.getByText('這段期間沒有交易')).toBeTruthy();
  });
});

describe('跨日檢查（D06）', () => {
  it('D1 關帳後進 D2：菜單沿用要提醒、開帳不自動帶入；D1 不能再寫；快照還原後關帳版本都在', () => {
    commit('002', 'order', 90, 100);
    const close = (counted: number, note: string) => usePosStore.getState().closeBusinessDate({ businessDate: D1, countedCash: counted, note, queuedSettlementAccepted: true, operatorId: 'counter' });
    expect(close(1090, '').ok).toBe(false); // 差 −10 沒寫原因不能關
    expect(close(1090, '點算短少10').ok).toBe(true);
    usePosStore.getState().reopenBusinessDate({ businessDate: D1, reason: '重點', operatorId: 'counter' });
    expect(close(1100, '').ok).toBe(true);

    // D2 沒有自己的菜單：F1 提醒沿用 D1，請到 F3 確認。
    const s = usePosStore.getState();
    const d2Menu = resolveMenuForDate(s.menusByDate, s.todayMenu, D2);
    expect(d2Menu.source).toBe('inherited');
    render(<IdleHero todayMenu={d2Menu.menu} todayCount={0} vendorPhone="" />);
    expect(screen.getByRole('note').textContent).toContain(`${D2} 還沒有自己的晚餐設定，目前沿用 ${D1} 的菜單`);

    // D2 的開帳沒有確認前是 null，只有預填建議（D1 最後一版的實點）。
    const { result } = renderHook(() => useCashClose(D2));
    expect(result.current.openingCash).toBeNull();
    expect(result.current.suggestedOpeningCash).toEqual({ amount: 1100, source: 'previous_day' });

    // D1 已關帳：store 層擋下新增。
    expect(() => commit('002', 'payment', 0, 50, D1)).toThrow(/關帳/);

    // 匯出快照 → 清空 → 還原：D1 的兩版關帳、重開紀錄與狀態都在。
    const before = usePosStore.getState();
    const text = JSON.stringify(buildSnapshot(pickDataset(before), '2026-10-14T01:00:00.000Z'));
    usePosStore.getState().startBlankData();
    const parsed = parseSnapshot(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) usePosStore.getState().restoreDataset(parsed.snapshot.data);
    const after = usePosStore.getState();
    expect(after.dailySettlements).toEqual(before.dailySettlements);
    expect(after.dailySettlements.filter(x => x.businessDate === D1).map(x => x.status)).toEqual(['closed', 'reopened', 'closed']);
    expect(after.businessDateStatuses[D1]).toBe('closed');
    expect(after.transactions).toEqual(before.transactions);
  });

  it('D2 存了自己的菜單後不再提醒', () => {
    usePosStore.getState().setMenuForDate(D2, { itemName: '雞腿', price: 100, vendorId: '', vendorNameSnapshot: '' }, 'now');
    const s = usePosStore.getState();
    render(<IdleHero todayMenu={resolveMenuForDate(s.menusByDate, s.todayMenu, D2).menu} todayCount={0} vendorPhone="" />);
    expect(screen.queryByRole('note')).toBeNull();
  });
});
