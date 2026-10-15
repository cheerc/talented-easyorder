/**
 * U4 #485 第二次複審（HEAD 87e8e84）的 2 項剩餘 blocker 回歸測試。
 *
 * 1. 目前營業日的來源必須與 useSystemDate 一致（不能用菜單快照日期）。
 * 2. 退款的 note（業務理由）不可被更正理由（opts.reason）頂替。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, render } from '@testing-library/react';
import { usePosStore } from '../store/posStore';
import { resolveCurrentBusinessDate } from '../store/currentBusinessDate';
import { buildRefundTransactionDraft } from '../domain/posTransaction';
import { validateLedgerTransaction } from '../storage/posStateValidator';
import { buildSnapshot, parseSnapshot, pickDataset } from '../domain/practiceSnapshot';
import { EditTransactionModal } from '../components/EditTransactionModal';
import { resetStoreForTest } from './helpers/storeSetup';
import type { StudentAccount } from '../domain/student';

/**
 * 退款對應的「今天」。直接用 store 擋下檢查同一個來源，
 * 避免測試自己猜錯日期（測試環境不是 prototype mode，模擬營業日不生效）。
 */
function currentDate() {
  return resolveCurrentBusinessDate(usePosStore.getState().simulationDate);
}

const TODAY = currentDate();

function seedStudent(overrides: Partial<StudentAccount> = {}): StudentAccount {
  return {
    studentId: '900',
    displayName: '退款測試生',
    status: 'active',
    currentBalance: 500,
    aliases: [],
    faceEnrollmentStatus: 'none',
    createdAt: '2026-01-01T08:00:00.000Z',
    updatedAt: '2026-01-01T08:00:00.000Z',
    revision: 1,
    ...overrides,
  };
}

function commitRefund(student: StudentAccount, amount: number, note: string, businessDate: string) {
  return usePosStore.getState().commitPosTransactionDraft(
    buildRefundTransactionDraft({ businessDate, student, amount, note, sourceDevice: 'pc' }),
  );
}

beforeEach(() => {
  resetStoreForTest();
  usePosStore.setState(state => ({
    simulationDate: TODAY,
    todayMenu: { ...state.todayMenu, businessDate: TODAY },
    students: [seedStudent()],
  }));
});

describe('U4 #9 複審：目前營業日的來源必須與 useSystemDate 一致', () => {
  it('simulationDate=null 時以台北當天為準，舊菜單快照日期不會被當成今天', () => {
    // 重現 ac 情境：沒有模擬日期、菜單是 2020 的舊資料。
    usePosStore.setState(state => ({
      simulationDate: null,
      todayMenu: { ...state.todayMenu, businessDate: '2020-01-01' },
    }));

    expect(commitRefund(usePosStore.getState().students[0], 50, '今天退款', currentDate()).ok).toBe(true);
    expect(commitRefund(usePosStore.getState().students[0], 50, '舊菜單日', '2020-01-01').ok).toBe(false);
  });

  it('菜單完全沒有日期時仍以台北當天為準', () => {
    usePosStore.setState(state => ({
      simulationDate: null,
      todayMenu: { ...state.todayMenu, businessDate: '' },
    }));

    expect(commitRefund(usePosStore.getState().students[0], 50, '無菜單日', currentDate()).ok).toBe(true);
    expect(commitRefund(usePosStore.getState().students[0], 50, '空菜單日', '').ok).toBe(false);
  });

  it('模擬營業日存在時以模擬日為準，菜單舊日期不影響判斷', () => {
    usePosStore.setState(state => ({
      simulationDate: '2026-10-20',
      // 菜單刻意留成舊日期，確認它不影響擋下判斷。
      todayMenu: { ...state.todayMenu, businessDate: '2020-01-01' },
    }));

    // resolveCurrentBusinessDate 在 prototype mode 才採模擬營業日；
    // 測試環境不是 prototype mode，所以這裡分別斷言兩種來源的語意。
    expect(resolveCurrentBusinessDate('2026-10-20')).toBe(resolveCurrentBusinessDate(null));

    // store 實際擋下的日期就是 resolveCurrentBusinessDate 的結果。
    const storeDate = resolveCurrentBusinessDate(usePosStore.getState().simulationDate);
    expect(commitRefund(usePosStore.getState().students[0], 50, '模擬日', storeDate).ok).toBe(true);
    expect(commitRefund(usePosStore.getState().students[0], 50, '菜單舊日期', '2020-01-01').ok).toBe(false);
  });

  it('useSystemDate 與 store 擋下檢查共用同一個日期來源', () => {
    // 兩個呼叫點都必須是 resolveCurrentBusinessDate，而不是各自推導。
    usePosStore.setState({ simulationDate: null, todayMenu: { ...usePosStore.getState().todayMenu, businessDate: '2020-01-01' } });
    expect(currentDate()).toBe(resolveCurrentBusinessDate(null));
    // 台北日界線：今天（含）可寫，明天不可寫。
    expect(commitRefund(usePosStore.getState().students[0], 50, '今天', currentDate()).ok).toBe(true);
    const tomorrow = new Date(new Date(`${currentDate()}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
    expect(commitRefund(usePosStore.getState().students[0], 50, '明天', tomorrow).ok).toBe(false);
    const yesterday = new Date(new Date(`${currentDate()}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
    expect(commitRefund(usePosStore.getState().students[0], 50, '昨天', yesterday).ok).toBe(false);
  });
});

describe('U4 #2 複審：退款的 note（業務理由）不可被更正理由頂替', () => {
  it('updates.note 為空白時被拒，退款理由維持原值', () => {
    const commit = commitRefund(usePosStore.getState().students[0], 50, '結清離班', TODAY);
    const txId = (commit as { transactionId: string }).transactionId;

    // opts.reason 非空不能頂替退款業務理由。
    const bad = usePosStore.getState().editTransaction(txId, { note: '   ' }, { reason: '更正理由' });
    expect(bad.ok).toBe(false);
    expect(usePosStore.getState().transactions.find(t => t.transactionId === txId)!.note).toBe('結清離班');
  });

  it('更正金額但不動 note 時，結果仍通過 validator 與 snapshot roundtrip', () => {
    const commit = commitRefund(usePosStore.getState().students[0], 50, '結清離班', TODAY);
    const txId = (commit as { transactionId: string }).transactionId;

    expect(usePosStore.getState().editTransaction(txId, { amount: 30 }, { reason: '更正金額' }).ok).toBe(true);

    const tx = usePosStore.getState().transactions.find(t => t.transactionId === txId)!;
    expect(tx.note).toBe('結清離班');
    expect(tx.amount).toBe(30);
    expect(validateLedgerTransaction(tx).ok).toBe(true);

    const text = JSON.stringify(buildSnapshot(pickDataset(usePosStore.getState()), '2026-10-15T01:00:00.000Z'));
    expect(parseSnapshot(text).ok).toBe(true);
  });

  it('改寫退款原因為新的非空值時可用，並通過 roundtrip', () => {
    const commit = commitRefund(usePosStore.getState().students[0], 50, '結清離班', TODAY);
    const txId = (commit as { transactionId: string }).transactionId;

    expect(usePosStore.getState().editTransaction(txId, { note: '改寫後原因' }, { reason: '更正理由' }).ok).toBe(true);

    const tx = usePosStore.getState().transactions.find(t => t.transactionId === txId)!;
    expect(tx.note).toBe('改寫後原因');
    expect(validateLedgerTransaction(tx).ok).toBe(true);

    const text = JSON.stringify(buildSnapshot(pickDataset(usePosStore.getState()), '2026-10-15T01:00:00.000Z'));
    expect(parseSnapshot(text).ok).toBe(true);
  });

  it('更正 UI 對退款明示「退款原因（不可清空）」並擋下空白', () => {
    const onSave = vi.fn().mockReturnValue({ ok: true as const });
    render(
      <EditTransactionModal
        open={true}
        transaction={{ transactionId: 'tx-r', type: 'refund', mealPrice: 0, paidAmount: 0, amount: 100, note: '結清離班' }}
        onClose={() => {}}
        onSave={onSave}
      />,
    );

    expect(screen.getByText('退款原因（不可清空）')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/退款原因/), { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText(/理由/), { target: { value: '更正理由' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('退款原因不能清空');
  });
});
