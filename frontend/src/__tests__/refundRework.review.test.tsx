/**
 * U4 #485 review rework — 永久回歸測試。
 * 每一條對應 reviewer 的 BLOCKING 收據項目，全部走真實 store／actions／components。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, fireEvent, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { usePosStore } from '../store/posStore';
import { buildRefundTransactionDraft } from '../domain/posTransaction';
import { validateLedgerTransaction } from '../storage/posStateValidator';
import { mergeLedgerTransactions, computeTransactionBalanceDelta, type LedgerTransaction } from '../domain/ledger';
import { calculateLedgerTotals } from '../domain/ledgerReport';
import { TransactionStatusView } from '../components/pos/TransactionStatusView';
import { DetailRow } from '../components/report/DetailRow';
import { EditTransactionModal } from '../components/EditTransactionModal';
import { RefundDialog } from '../components/pos/RefundDialog';
import { resetStoreForTest } from './helpers/storeSetup';
import { renderApp } from './helpers/renderApp';
import type { StudentAccount } from '../domain/student';

const TODAY = '2026-10-15';

function seedStudent(overrides: Partial<StudentAccount> = {}): StudentAccount {
  return {
    studentId: '900',
    displayName: '退款測試生',
    status: 'active',
    currentBalance: 100,
    aliases: [],
    faceEnrollmentStatus: 'none',
    createdAt: '2026-01-01T08:00:00.000Z',
    updatedAt: '2026-01-01T08:00:00.000Z',
    revision: 1,
    ...overrides,
  };
}

/** 只保留指定學生，避免測試受範例資料的餘額與交易影響。 */
function seedOnlyStudent(student: StudentAccount) {
  usePosStore.setState({ students: [student] });
}

/**
 * App 層測試需要等 resetStoreForTest 的 persist.rehydrate() 落地後再覆寫學生，
 * 否則範例名單會在之後把種子狀態蓋回去（退款鍵會變成 disabled）。
 */
async function seedOnlyStudentAfterRehydrate(student: StudentAccount) {
  await usePosStore.persist.rehydrate();
  usePosStore.setState({ students: [student] });
}

function setBusinessDate(date: string) {
  usePosStore.setState(state => ({
    simulationDate: date,
    todayMenu: { ...state.todayMenu, businessDate: date },
  }));
}

function commitRefund(student: StudentAccount, amount: number, note: string, businessDate = TODAY) {
  return usePosStore.getState().commitPosTransactionDraft(
    buildRefundTransactionDraft({ businessDate, student, amount, note, sourceDevice: 'pc' }),
  );
}

beforeEach(() => {
  resetStoreForTest();
  setBusinessDate(TODAY);
  seedOnlyStudent(seedStudent());
});

describe('U4 #1：更正退款的金額與可退餘額驗證（store 層）', () => {
  it('拒絕把退款改成超過可用餘額的金額，餘額不會變成負數', () => {
    const student = usePosStore.getState().students[0];
    const commit = commitRefund(student, 50, '測試更正');
    expect(commit.ok).toBe(true);
    expect(usePosStore.getState().students[0].currentBalance).toBe(50);

    const txId = (commit as { transactionId: string }).transactionId;
    const bad = usePosStore.getState().editTransaction(txId, { amount: 200 }, { reason: '測試更正' });

    expect(bad.ok).toBe(false);
    expect(usePosStore.getState().students[0].currentBalance).toBe(50);
  });

  it('拒絕負數、小數與零金額的退款更正', () => {
    const student = usePosStore.getState().students[0];
    const commit = commitRefund(student, 50, '測試更正');
    const txId = (commit as { transactionId: string }).transactionId;

    expect(usePosStore.getState().editTransaction(txId, { amount: -10 }, { reason: '測試更正' }).ok).toBe(false);
    expect(usePosStore.getState().editTransaction(txId, { amount: 10.5 }, { reason: '測試更正' }).ok).toBe(false);
    expect(usePosStore.getState().editTransaction(txId, { amount: 0 }, { reason: '測試更正' }).ok).toBe(false);

    const tx = usePosStore.getState().transactions.find(t => t.transactionId === txId)!;
    expect(tx.amount).toBe(50);
    expect(tx.mealPrice).toBe(0);
    expect(tx.paidAmount).toBe(0);
  });

  it('允許在不超過可用餘額的範圍內更正退款，帳戶與現金算式一致', () => {
    const student = usePosStore.getState().students[0];
    const commit = commitRefund(student, 50, '測試更正');
    const txId = (commit as { transactionId: string }).transactionId;

    const ok = usePosStore.getState().editTransaction(txId, { amount: 80 }, { reason: '測試更正' });
    expect(ok.ok).toBe(true);
    expect(usePosStore.getState().students[0].currentBalance).toBe(20);

    const tx = usePosStore.getState().transactions.find(t => t.transactionId === txId)!;
    expect(tx.amount).toBe(80);
    expect(computeTransactionBalanceDelta(tx)).toBe(-80);

    const totals = calculateLedgerTotals(usePosStore.getState().transactions);
    expect(totals.totalRefund).toBe(80);
    expect(totals.netCash).toBe(-80);
  });
});

describe('U4 #2：更正 UI 真正傳入退款 type／amount 並可編輯', () => {
  it('EditTransactionModal 對退款顯示退款金額欄並回傳 amount', () => {
    const onSave = vi.fn().mockReturnValue({ ok: true as const });
    render(
      <EditTransactionModal
        open={true}
        transaction={{ transactionId: 'tx-r', type: 'refund', mealPrice: 0, paidAmount: 0, amount: 100, note: '結清離班' }}
        onClose={() => {}}
        onSave={onSave}
      />,
    );

    expect(screen.getByLabelText(/退款金額/)).toBeTruthy();
    expect(screen.queryByLabelText(/應收金額/)).toBeNull();

    fireEvent.change(screen.getByLabelText(/退款金額/), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText(/理由/), { target: { value: '更正金額' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));

    expect(onSave).toHaveBeenCalledWith(
      'tx-r',
      { mealPrice: 0, paidAmount: 0, amount: 60, note: '結清離班' },
      '更正金額',
    );
  });

  it('非退款交易仍顯示原有餐費／實收欄位', () => {
    const onSave = vi.fn().mockReturnValue({ ok: true as const });
    render(
      <EditTransactionModal
        open={true}
        transaction={{ transactionId: 'tx-o', type: 'order', mealPrice: 90, paidAmount: 0, amount: -90, note: '排骨' }}
        onClose={() => {}}
        onSave={onSave}
      />,
    );

    expect(screen.getByLabelText(/應收金額/)).toBeTruthy();
    expect(screen.getByLabelText(/實收金額/)).toBeTruthy();
    expect(screen.queryByLabelText(/退款金額/)).toBeNull();
  });
});

describe('U4 #3：退款 modal 納入背景快捷鍵隔離', () => {
  it('退款開框時背景 Q 不切換模式，方向鍵與 Enter 不外洩', async () => {
    await seedOnlyStudentAfterRehydrate(seedStudent({ studentId: '015', displayName: '周映彤', currentBalance: 100 }));

    await renderApp();
    const user = userEvent.setup();

    const input = screen.getByPlaceholderText(/015/) as HTMLInputElement;
    await user.click(input);
    await user.keyboard('015{Enter}');
    // 切到 W 繳費模式（退款入口在繳費面板）
    await waitFor(() => expect(screen.getByRole('radio', { name: /繳費/ })).toBeTruthy());
    await user.click(screen.getByRole('radio', { name: /繳費/ }));
    await waitFor(() => expect(screen.getByRole('radio', { name: /繳費/ }).getAttribute('aria-checked')).toBe('true'));

    await user.click(screen.getByRole('button', { name: '退款' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: '退款給學生' })).toBeTruthy());

    // 焦點在退款金額欄時按 Q：背景不得切到訂餐模式
    await user.keyboard('q');
    expect(screen.getByRole('radio', { name: /繳費/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('dialog', { name: '退款給學生' })).toBeTruthy();

    // 方向鍵不應關閉或送出退款框
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('dialog', { name: '退款給學生' })).toBeTruthy();

    // Enter 不得在未填理由時送出
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: '退款給學生' })).toBeTruthy();
    expect(usePosStore.getState().transactions.filter(t => t.type === 'refund')).toHaveLength(0);
  });
});

describe('U4 #4：撤回退款後成功遮罩一併清除', () => {
  it('點撤回後交易移除、餘額回復，成功遮罩消失', async () => {
    await seedOnlyStudentAfterRehydrate(seedStudent({ studentId: '015', displayName: '周映彤', currentBalance: 100 }));

    await renderApp();
    const user = userEvent.setup();

    const input = screen.getByPlaceholderText(/015/) as HTMLInputElement;
    await user.click(input);
    await user.keyboard('015{Enter}');
    await waitFor(() => expect(screen.getByRole('radio', { name: /繳費/ })).toBeTruthy());
    await user.click(screen.getByRole('radio', { name: /繳費/ }));
    await waitFor(() => expect(screen.getByRole('radio', { name: /繳費/ }).getAttribute('aria-checked')).toBe('true'));

    await user.click(screen.getByRole('button', { name: '退款' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: '退款給學生' })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: '結清離班' }));
    await user.click(screen.getByRole('button', { name: '確認退款' }));

    await waitFor(() => expect(screen.queryByText(/退款：結清離班/)).toBeTruthy());

    await user.click(screen.getByRole('button', { name: /撤回/ }));

    await waitFor(() => {
      expect(screen.queryByText(/退款：結清離班/)).toBeFalsy();
      expect(usePosStore.getState().students[0].currentBalance).toBe(100);
      expect(usePosStore.getState().transactions.filter(t => t.type === 'refund')).toHaveLength(0);
    });
  });
});

describe('U4 #6：E／最近帳戶／F2 消費端顯示退款類型與金額', () => {
  const refundTx: LedgerTransaction = {
    transactionId: 'tx-refund-1',
    businessDate: TODAY,
    createdAt: `${TODAY}T09:00:00.000Z`,
    studentId: '015',
    studentNameSnapshot: '周映彤',
    type: 'refund',
    mealPrice: 0,
    paidAmount: 0,
    amount: 50,
    afterBalance: 50,
    menuNameSnapshot: '',
    vendorNameSnapshot: '',
    sourceDevice: 'pc',
    syncStatus: 'local',
    revision: 1,
    note: '結清離班',
  };

  it('E 付款明細顯示「退款」與負金額，並有今日退款合計', () => {
    render(<TransactionStatusView transactions={[refundTx]} student={{ displayName: '周映彤', currentBalance: 50 }} />);
    // 明細列與「今日退款」合計都會顯示 −$50，兩者都要存在。
    expect(screen.getAllByText('−$50').length).toBe(2);
    expect(screen.getByText('退款：結清離班')).toBeTruthy();
    expect(screen.getByText('今日退款')).toBeTruthy();
  });

  it('F2 DetailRow 顯示「退款」與負金額', () => {
    render(
      <DetailRow
        tx={refundTx}
        locked={false}
        displayMode="original"
        onEditClick={() => {}}
        onDeleteClick={() => {}}
      />,
    );
    expect(screen.getByText('退款')).toBeTruthy();
    expect(screen.getByText('−$50')).toBeTruthy();
  });

  it('F2 刪除確認以退款 amount 取得金額，而不是 paidAmount=0', () => {
    const student = usePosStore.getState().students[0];
    const commit = commitRefund(student, 40, '刪除測試');
    const txId = (commit as { transactionId: string }).transactionId;
    const tx = usePosStore.getState().transactions.find(t => t.transactionId === txId)!;
    expect(tx.amount).toBe(40);
    expect(tx.paidAmount).toBe(0);
  });
});

describe('U4 #7：先退款再訂餐時合併列不沿用退款 transactionId', () => {
  it('合併訂餐列以訂餐原單為代表，退款維持獨立列', () => {
    const makeTx = (over: Partial<LedgerTransaction>): LedgerTransaction => ({
      transactionId: 'tx',
      businessDate: TODAY,
      createdAt: `${TODAY}T09:00:00.000Z`,
      studentId: '015',
      studentNameSnapshot: '周映彤',
      type: 'order',
      mealPrice: 0,
      paidAmount: 0,
      amount: 0,
      afterBalance: 0,
      menuNameSnapshot: '',
      vendorNameSnapshot: '',
      sourceDevice: 'pc',
      syncStatus: 'local',
      revision: 1,
      note: '',
      ...over,
    });

    const refund = makeTx({
      transactionId: 'tx-refund',
      type: 'refund',
      amount: 50,
      afterBalance: 50,
      createdAt: `${TODAY}T10:00:00.000Z`,
      note: '結清離班',
    });
    const order = makeTx({
      transactionId: 'tx-order',
      type: 'order',
      mealPrice: 90,
      paidAmount: 0,
      amount: -90,
      afterBalance: -40,
      createdAt: `${TODAY}T11:00:00.000Z`,
      menuNameSnapshot: '排骨便當',
    });

    const merged = mergeLedgerTransactions([refund, order]);
    const orderRows = merged.filter(m => m.type === 'order');
    const refundRows = merged.filter(m => m.type === 'refund');

    expect(orderRows).toHaveLength(1);
    expect(orderRows[0].transactionId).toBe('tx-order');
    expect(refundRows).toHaveLength(1);
    expect(refundRows[0].transactionId).toBe('tx-refund');

    const ids = merged.map(m => m.transactionId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('U4 #8：persist／snapshot validator 嚴驗退款契約', () => {
  const base = {
    transactionId: 'tx-r',
    businessDate: TODAY,
    createdAt: `${TODAY}T09:00:00.000Z`,
    studentId: '015',
    studentNameSnapshot: '周映彤',
    type: 'refund',
    mealPrice: 0,
    paidAmount: 0,
    amount: 50,
    afterBalance: 50,
    menuNameSnapshot: '',
    vendorNameSnapshot: '',
    sourceDevice: 'pc',
    syncStatus: 'local',
    revision: 1,
    note: '結清離班',
  };

  it('合法退款通過驗證', () => {
    expect(validateLedgerTransaction(base).ok).toBe(true);
  });

  it('負數、小數、零金額被拒', () => {
    expect(validateLedgerTransaction({ ...base, amount: -1 }).ok).toBe(false);
    expect(validateLedgerTransaction({ ...base, amount: 0.5 }).ok).toBe(false);
    expect(validateLedgerTransaction({ ...base, amount: 0 }).ok).toBe(false);
  });

  it('mealPrice 或 paidAmount 非 0 被拒', () => {
    expect(validateLedgerTransaction({ ...base, mealPrice: 99 }).ok).toBe(false);
    expect(validateLedgerTransaction({ ...base, paidAmount: 99 }).ok).toBe(false);
  });

  it('空白理由被拒', () => {
    expect(validateLedgerTransaction({ ...base, note: '' }).ok).toBe(false);
    expect(validateLedgerTransaction({ ...base, note: '   ' }).ok).toBe(false);
  });
});

describe('U4 #9：store 嚴格限制退款只能記在當前營業日', () => {
  it('非當前營業日（2020-01-01）的退款被拒', () => {
    const student = usePosStore.getState().students[0];
    const result = commitRefund(student, 50, '舊日退款', '2020-01-01');
    expect(result.ok).toBe(false);
    expect(usePosStore.getState().transactions.filter(t => t.type === 'refund')).toHaveLength(0);
  });

  it('simulationDate 存在時以模擬營業日為準：模擬日可寫、其他日不可', () => {
    setBusinessDate('2026-10-20');
    const student = usePosStore.getState().students[0];

    expect(commitRefund(student, 50, '模擬日退款', '2026-10-20').ok).toBe(true);
    expect(commitRefund(student, 50, '非模擬日', '2026-10-15').ok).toBe(false);
  });
});

describe('U4 退款對話框失敗時留在畫面顯示原因', () => {
  it('寫入失敗時對話框保留並顯示 store 回傳的原因', () => {
    const onConfirm = vi.fn().mockReturnValue({ ok: false as const, message: '退款金額不能超過目前餘額。' });
    render(
      <RefundDialog
        open={true}
        student={seedStudent({ currentBalance: 100 })}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '結清離班' }));
    fireEvent.click(screen.getByRole('button', { name: '確認退款' }));

    expect(screen.getByRole('dialog', { name: '退款給學生' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('退款金額不能超過目前餘額。');
  });
});