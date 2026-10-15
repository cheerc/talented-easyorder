/**
 * U4 #485 review rework — F3（今日設定）停用帳戶退款入口回歸測試。
 * 獨立檔案：F3 走本機練習模式（useFirebase → fb: null），不影響 renderApp 的 Firebase 初始化路徑。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, fireEvent, render, within } from '@testing-library/react';
import { usePosStore } from '../store/posStore';
import { buildRefundTransactionDraft } from '../domain/posTransaction';
import { resolveCurrentBusinessDate } from '../store/currentBusinessDate';
import { AdminScreen } from '../components/screens/AdminScreen';
import { FirebaseProvider } from '../providers/FirebaseProvider';
import { resetStoreForTest } from './helpers/storeSetup';
import type { StudentAccount } from '../domain/student';
import type { LedgerMutationResult } from '../domain/ledgerAudit';

vi.mock('../hooks/useFirebase', () => ({
  useFirebase: () => ({ fb: null, fbError: null, access: { ok: false, reason: 'signed_out' } }),
}));

/** AdminScreen 的退款寫入回傳 LedgerMutationResult，直接用這個型別而不是 vi.fn 的寬鬆型別。 */
type RefundWriter = (studentId: string, amount: number, reason: string) => LedgerMutationResult;

/** F3 走 FirebaseProvider（測試 setup 已 mock Firebase 初始化），useFirebase 回傳本機練習模式。 */
async function renderAdmin(onRefund: RefundWriter) {
  // resetStoreForTest 的 persist.rehydrate() 是非同步的；先讓它落地，再覆寫學生，否則範例名單會蓋回來。
  await usePosStore.persist.rehydrate();
  return render(
    <FirebaseProvider>
      <AdminScreen viewDate={TODAY} onRefund={onRefund} />
    </FirebaseProvider>,
  );
}

/** 與 store 擋下檢查同一個日期來源（測試環境不是 prototype mode）。 */
const TODAY = resolveCurrentBusinessDate(null);

function seedStudent(overrides: Partial<StudentAccount> = {}): StudentAccount {
  return {
    studentId: '901',
    displayName: '停用生',
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

beforeEach(() => {
  resetStoreForTest();
  usePosStore.setState(state => ({
    simulationDate: TODAY,
    todayMenu: { ...state.todayMenu, businessDate: TODAY },
  }));
});

describe('U4 #5：停用且今日無交易的帳戶仍可退款（F3 不必先恢復帳戶）', () => {
  it('F3 名單列對停用帳戶提供退款入口並可完成退款', async () => {
    usePosStore.setState({ students: [seedStudent({ status: 'inactive', currentBalance: 60 })] });

    // 走真實 store 路徑，而不是 mock onRefund，才能證明 F3 真的寫入退款交易。
    await renderAdmin((studentId, amount, reason) => {
      const student = usePosStore.getState().students.find(s => s.studentId === studentId)!;
      return usePosStore.getState().commitPosTransactionDraft(
        buildRefundTransactionDraft({ businessDate: TODAY, student, amount, note: reason, sourceDevice: 'pc' }),
      );
    });

    const row = screen.getByTestId('student-row-901');
    expect(within(row).getByText('已停用')).toBeTruthy();

    fireEvent.click(within(row).getByRole('button', { name: '退款 901' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: '退款給學生' })).toBeTruthy());
    expect(within(screen.getByRole('dialog')).getAllByText('停用生').length).toBeGreaterThan(0);

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '結清離班' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '確認退款' }));

    await waitFor(() => {
      const refunds = usePosStore.getState().transactions.filter(t => t.type === 'refund');
      expect(refunds).toHaveLength(1);
      expect(refunds[0].amount).toBe(60);
      expect(refunds[0].note).toBe('結清離班');
      expect(usePosStore.getState().students[0].currentBalance).toBe(0);
    });
  });

  it('餘額非正的帳戶退款鍵停用', async () => {
    usePosStore.setState({ students: [seedStudent({ studentId: '902', currentBalance: 0 })] });
    await renderAdmin(() => ({ ok: true }));
    expect(screen.getByRole('button', { name: '退款 902' }).hasAttribute('disabled')).toBe(true);
  });

  it('F3 的退款寫入失敗時留在對話框顯示原因', async () => {
    usePosStore.setState({ students: [seedStudent({ studentId: '903', currentBalance: 40 })] });

    await renderAdmin(() => ({ ok: false, message: '這天已關帳，不能再記退款。' }));

    fireEvent.click(screen.getByRole('button', { name: '退款 903' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: '退款給學生' })).toBeTruthy());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '結清離班' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '確認退款' }));

    expect(screen.getByRole('dialog', { name: '退款給學生' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('這天已關帳，不能再記退款。');
  });
});