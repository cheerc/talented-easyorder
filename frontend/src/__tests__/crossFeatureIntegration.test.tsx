/**
 * 跨功能整合測試：
 * 整合 U3（改編號與缺號、歷史歸戶）、U2b（全系統「便當」→「餐點」新用語、PWA 品牌）、
 * U4（學生帳戶退款、F1 退款框、F2 現金算式、停用退款入口）。
 *
 * 涵蓋要求：
 * 1. 改號後退款 → E / F2 / F5 / undo / reload 一致
 * 2. 停用改號後可退款
 * 3. 改號稽核 snapshot 與 refund validator 共存
 * 4. 品牌 / 付款理由流程
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// @ts-expect-error 此測試使用 node API 讀取實體檔案，不在瀏覽器型別範圍。
import { readFileSync } from 'node:fs';
// @ts-expect-error 同上。
import path from 'node:path';

vi.mock('../hooks/useFirebase', () => ({
  useFirebase: () => ({ fb: null, fbError: null, access: { ok: false, reason: 'signed_out' } }),
}));

declare const __dirname: string;

import { usePosStore } from '../store/posStore';
import { buildPosTransactionDraft, buildRefundTransactionDraft } from '../domain/posTransaction';
import { createLocalAccount } from '../domain/student';
import { resolveCurrentBusinessDate } from '../store/currentBusinessDate';
import { calculateLedgerTotals } from '../domain/ledgerReport';
import { describeAuditEvents, matchesAuditQuery } from '../domain/auditView';
import { validateLedgerTransaction } from '../storage/posStateValidator';
import { validatePersistedState } from '../storage/posStateValidator';
import { TransactionStatusView } from '../components/pos/TransactionStatusView';
import { RefundDialog } from '../components/pos/RefundDialog';
import { UNDO_REASON } from '../hooks/useUndoCountdown';

const TODAY = resolveCurrentBusinessDate(null);

beforeEach(() => {
  usePosStore.getState().startBlankData();
  usePosStore.setState(state => ({
    simulationDate: TODAY,
    todayMenu: { ...state.todayMenu, businessDate: TODAY, itemName: '排骨餐點', price: 90 },
  }));
});

describe('跨功能整合測試 (U3 改號 + U2b 新用語 + U4 學生退款)', () => {
  describe('1. 改號後退款 → E / F2 / F5 / undo / reload 一致', () => {
    it('學生改號後執行退款，E 明細、F2 報表、F5 查詢、undo 撤回與 reload 持久化皆完全一致', async () => {
      const store = usePosStore.getState();

      // 1.1 建立學生 005，初始餘額 500
      const student005 = createLocalAccount(
        { studentId: '005', displayName: '甲同學', openingBalance: 500, openingNote: '期初餘額', asOfDate: TODAY },
        '2026-10-15T08:00:00Z'
      );
      store.addLocalStudent(student005);

      // 1.2 進行訂餐（餐費 90，未付現 0，餘額 -> 410）
      const orderDraft = buildPosTransactionDraft({
        intent: { businessDate: TODAY, studentId: '005', type: 'order', mealPrice: 90, paidAmount: 0, note: '', sourceDevice: 'pc' },
        student: usePosStore.getState().students.find(s => s.studentId === '005')!,
        menu: usePosStore.getState().todayMenu,
      });
      const orderRes = usePosStore.getState().commitPosTransactionDraft(orderDraft);
      expect(orderRes.ok).toBe(true);

      // 1.3 進行繳費（收款 100，餘額 -> 510）
      const payDraft = buildPosTransactionDraft({
        intent: { businessDate: TODAY, studentId: '005', type: 'payment', mealPrice: 0, paidAmount: 100, note: '繳預繳費', sourceDevice: 'pc' },
        student: usePosStore.getState().students.find(s => s.studentId === '005')!,
        menu: usePosStore.getState().todayMenu,
      });
      const payRes = usePosStore.getState().commitPosTransactionDraft(payDraft);
      expect(payRes.ok).toBe(true);

      expect(usePosStore.getState().students.find(s => s.studentId === '005')?.currentBalance).toBe(510);

      // 1.4 改號：005 -> 009，姓名改為「甲改名」，別名「小甲」
      usePosStore.getState().updateLocalStudent(
        '005',
        { displayName: '甲改名', aliases: ['小甲'], newStudentId: '009', reason: '甲改號005至009' },
        '2026-10-15T09:00:00Z'
      );

      const student009 = usePosStore.getState().students.find(s => s.studentId === '009')!;
      expect(student009).toBeDefined();
      expect(student009.currentBalance).toBe(510);
      expect(usePosStore.getState().students.find(s => s.studentId === '005')).toBeUndefined();

      // 1.5 對改號後的 009 進行退款 $200（理由「多繳退款」）
      const refundDraft = buildRefundTransactionDraft({
        businessDate: TODAY,
        student: student009,
        amount: 200,
        note: '多繳退款',
        sourceDevice: 'pc',
      });
      const refundRes = usePosStore.getState().commitPosTransactionDraft(refundDraft);
      expect(refundRes.ok).toBe(true);
      const refundTxId = (refundRes as { ok: true; transactionId: string }).transactionId;

      // 驗證退款後餘額 510 - 200 = 310
      const currentStudent = usePosStore.getState().students.find(s => s.studentId === '009')!;
      expect(currentStudent.currentBalance).toBe(310);

      // 1.6 驗證 E（TransactionStatusView 付款明細）
      const studentTxList = usePosStore.getState().transactions.filter(t => t.studentId === '009');
      expect(studentTxList.some(t => t.type === 'refund')).toBe(true);

      const { container: statusContainer } = render(
        <TransactionStatusView
          student={currentStudent}
          transactions={studentTxList}
        />
      );
      expect(statusContainer.textContent).toContain('甲改名 今日付款明細');
      expect(statusContainer.textContent).toContain('退款');
      expect(statusContainer.textContent).toContain('−$200');
      expect(statusContainer.textContent).toContain('多繳退款');

      // 1.7 驗證 F2（calculateLedgerTotals 報表算式）
      const totals = calculateLedgerTotals(usePosStore.getState().transactions);
      expect(totals.totalRefund).toBe(200);
      expect(totals.totalIncome).toBe(100);
      expect(totals.mealTotal).toBe(90);
      expect(totals.totalExpense).toBe(0);
      // 淨現金公式：收現 − 支出 − 退款 = 100 - 0 - 200 = -100
      expect(totals.netCash).toBe(-100);

      // 1.8 驗證 F5（AuditView / 歷史查詢歸戶）
      const auditRows = describeAuditEvents(
        usePosStore.getState().auditEvents,
        usePosStore.getState().transactions,
        usePosStore.getState().students
      );
      // 查新編號 009
      expect(auditRows.some(r => matchesAuditQuery(r, '009'))).toBe(true);
      // 查舊編號 005（歷史曾用號）
      expect(auditRows.some(r => matchesAuditQuery(r, '005'))).toBe(true);
      // 查別名「小甲」
      expect(auditRows.some(r => matchesAuditQuery(r, '小甲'))).toBe(true);

      // 1.9 驗證 Undo（5 秒撤回退款，透過 deleteTransaction）
      const undoRes = usePosStore.getState().deleteTransaction(refundTxId, { reason: UNDO_REASON });
      expect(undoRes.ok).toBe(true);
      // 餘額回復為 510
      expect(usePosStore.getState().students.find(s => s.studentId === '009')?.currentBalance).toBe(510);
      // F2 totalRefund 回歸為 0
      const totalsAfterUndo = calculateLedgerTotals(usePosStore.getState().transactions);
      expect(totalsAfterUndo.totalRefund).toBe(0);
      expect(totalsAfterUndo.netCash).toBe(100);

      // 1.10 再次退款並驗證 Reload / Validator
      const refundDraft2 = buildRefundTransactionDraft({
        businessDate: TODAY,
        student: usePosStore.getState().students.find(s => s.studentId === '009')!,
        amount: 200,
        note: '再次多繳退款',
        sourceDevice: 'pc',
      });
      const refundRes2 = usePosStore.getState().commitPosTransactionDraft(refundDraft2);
      expect(refundRes2.ok).toBe(true);

      const stateNow = usePosStore.getState();
      for (const tx of stateNow.transactions) {
        expect(validateLedgerTransaction(tx).ok).toBe(true);
      }
      expect(validatePersistedState(stateNow).ok).toBe(true);
    });
  });

  describe('2. 停用改號後可退款', () => {
    it('停用帳戶改號後狀態仍為停用，且不需先恢復即可成功辦理退款', () => {
      const store = usePosStore.getState();

      // 2.1 建立停用學生 010，初始餘額 300
      const inactiveStudent = createLocalAccount(
        { studentId: '010', displayName: '停用生', openingBalance: 300, openingNote: '離班未結清', asOfDate: TODAY },
        '2026-10-15T08:00:00Z'
      );
      store.addLocalStudent(inactiveStudent);
      store.setLocalStudentStatus('010', 'inactive', '2026-10-15T08:05:00Z');

      const s010 = usePosStore.getState().students.find(s => s.studentId === '010')!;
      expect(s010.status).toBe('inactive');
      expect(s010.currentBalance).toBe(300);

      // 2.2 改號：010 -> 012
      usePosStore.getState().updateLocalStudent(
        '010',
        { displayName: '停用改號生', aliases: [], newStudentId: '012', reason: '整理學號改號' },
        '2026-10-15T09:00:00Z'
      );

      const s012 = usePosStore.getState().students.find(s => s.studentId === '012')!;
      expect(s012).toBeDefined();
      expect(s012.status).toBe('inactive'); // 依然是 inactive
      expect(s012.currentBalance).toBe(300);

      // 2.3 執行退款 150，停用帳戶可直接退款
      const refundDraft = buildRefundTransactionDraft({
        businessDate: TODAY,
        student: s012,
        amount: 150,
        note: '離班退款手續',
        sourceDevice: 'pc',
      });
      const res = usePosStore.getState().commitPosTransactionDraft(refundDraft);
      expect(res.ok).toBe(true);

      const s012After = usePosStore.getState().students.find(s => s.studentId === '012')!;
      expect(s012After.currentBalance).toBe(150);
      expect(s012After.status).toBe('inactive'); // 退款後仍保持停用狀態

      // 2.4 超額退款（退款 200 > 150）應被阻擋
      const overRefundDraft = buildRefundTransactionDraft({
        businessDate: TODAY,
        student: s012After,
        amount: 200,
        note: '超額退款測試',
        sourceDevice: 'pc',
      });
      const overRes = usePosStore.getState().commitPosTransactionDraft(overRefundDraft);
      expect(overRes.ok).toBe(false);
      expect((overRes as { ok: false; message: string }).message).toContain('退款金額不能超過目前餘額');
    });
  });

  describe('3. 改號稽核 snapshot 與 refund validator 共存', () => {
    it('改號產生的不可變歷史快照與退款交易的資料結構共存，且皆通過嚴格校驗', () => {
      const store = usePosStore.getState();

      const student = createLocalAccount(
        { studentId: '020', displayName: '快照測試生', openingBalance: 400, openingNote: '', asOfDate: TODAY },
        '2026-10-15T08:00:00Z'
      );
      store.addLocalStudent(student);

      // 改號 020 -> 025
      usePosStore.getState().updateLocalStudent(
        '020',
        { displayName: '快照測試生', aliases: [], newStudentId: '025', reason: '學號正規化' },
        '2026-10-15T08:30:00Z'
      );

      // 退款 100
      const refundDraft = buildRefundTransactionDraft({
        businessDate: TODAY,
        student: usePosStore.getState().students.find(s => s.studentId === '025')!,
        amount: 100,
        note: '溢繳退還',
        sourceDevice: 'pc',
      });
      const refundRes = usePosStore.getState().commitPosTransactionDraft(refundDraft);
      expect(refundRes.ok).toBe(true);

      const state = usePosStore.getState();

      // 3.1 檢查改號事件的歷史快照未被破壞
      const codeChangeEvent = state.auditEvents.find(e => e.eventType === 'student_code_changed')!;
      expect(codeChangeEvent).toBeDefined();
      expect(codeChangeEvent.before).toMatchObject({ studentId: '020' });
      expect(codeChangeEvent.after).toMatchObject({ studentId: '025' });
      expect(codeChangeEvent.entityId).toBe('025');
      expect(codeChangeEvent.studentId).toBe('025');

      // 3.2 檢查退款交易的校驗規則
      const refundTx = state.transactions.find(t => t.type === 'refund')!;
      expect(validateLedgerTransaction(refundTx).ok).toBe(true);

      // 模擬非法退款交易：mealPrice 不為 0
      const invalidRefundTx1 = { ...refundTx, mealPrice: 50 };
      expect(validateLedgerTransaction(invalidRefundTx1).ok).toBe(false);

      // 模擬非法退款交易：amount 不為正整數
      const invalidRefundTx2 = { ...refundTx, amount: -10 };
      expect(validateLedgerTransaction(invalidRefundTx2).ok).toBe(false);

      // 模擬非法退款交易：note 為空
      const invalidRefundTx3 = { ...refundTx, note: '   ' };
      expect(validateLedgerTransaction(invalidRefundTx3).ok).toBe(false);

      // 3.3 describeAuditEvents 同時解析改號與退款
      const auditRows = describeAuditEvents(state.auditEvents, state.transactions, state.students);
      const codeChangeRow = auditRows.find(r => r.reason === '學號正規化')!;
      expect(codeChangeRow.subject).toContain('025 快照測試生');
      expect(codeChangeRow.changes).toBe('編號 020 → 025');
    });
  });

  describe('4. 品牌 / 付款理由流程（新用語 + 退款流程）', () => {
    it('PWA manifest 與 index.html 為新用語「訂餐櫃台」，RefundDialog 流程完整且無舊用語殘留', async () => {
      const frontendRoot = path.resolve(__dirname, '..', '..');
      const manifestPath = path.join(frontendRoot, 'public', 'manifest.json');
      const indexPath = path.join(frontendRoot, 'index.html');

      // 4.1 品牌驗證
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      expect(manifest.name).toBe('訂餐櫃台');
      expect(manifest.short_name).toBe('訂餐櫃台');
      expect(manifest.description).toBe('校園訂餐 POS 管理系統');
      expect(manifest.name).not.toContain('便當櫃台');

      const indexHtml = readFileSync(indexPath, 'utf8');
      expect(indexHtml).toContain('<title>訂餐櫃台</title>');
      expect(indexHtml).toContain('content="校園訂餐 POS 管理系統"');
      expect(indexHtml).not.toContain('便當櫃台');

      // 4.2 RefundDialog UI 與理由流程
      const mockConfirm = vi.fn().mockReturnValue({ ok: true });
      const mockCancel = vi.fn();
      const testStudent = {
        studentId: '088',
        displayName: '測試學生',
        status: 'active' as const,
        currentBalance: 300,
        aliases: [],
        faceEnrollmentStatus: 'none' as const,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        revision: 1,
      };

      const user = userEvent.setup();
      const { unmount } = render(
        <RefundDialog
          open={true}
          student={testStudent}
          onConfirm={mockConfirm}
          onCancel={mockCancel}
        />
      );

      expect(screen.getByText('退款給學生')).toBeDefined();
      expect(screen.getAllByText('測試學生').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('$300').length).toBeGreaterThanOrEqual(1);

      const confirmBtn = screen.getByRole('button', { name: '確認退款' });
      // 理由為空時確認按鈕不可點
      expect(confirmBtn).toBeDisabled();

      // 填寫理由
      const reasonInput = screen.getByLabelText('退款理由');
      await user.type(reasonInput, '溢繳退回');
      expect(confirmBtn).not.toBeDisabled();

      // 改填超額金額 500
      const amountInput = screen.getByLabelText('退款金額');
      await user.clear(amountInput);
      await user.type(amountInput, '500');
      expect(confirmBtn).toBeDisabled();
      expect(screen.getByText(/不能超過目前餘額/)).toBeDefined();

      // 改回合法金額 150
      await user.clear(amountInput);
      await user.type(amountInput, '150');
      expect(confirmBtn).not.toBeDisabled();

      // 點擊確認
      await user.click(confirmBtn);
      expect(mockConfirm).toHaveBeenCalledWith(150, '溢繳退回');

      unmount();
    });
  });
});
