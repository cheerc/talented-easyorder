import { useState, useCallback } from 'react';
import { usePosStore } from '../store/posStore';
import type { StudentAccount } from '../domain/student';
import type { WorkflowTransactionView } from '../domain/transactionViews';
import type { LedgerTransaction } from '../domain/ledger';
import type { LedgerMutationResult } from '../domain/ledgerAudit';

export function useCancelDialog(args: {
  picked: StudentAccount | null;
  allTx: WorkflowTransactionView[];
  viewDate: string;
  allStudents?: StudentAccount[];
  selectStudent?: (studentId: string, source: string) => void;
  operatorId?: string;
}) {
  const { picked, allTx, viewDate, allStudents, selectStudent, operatorId } = args;
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [noOrderDialogOpen, setNoOrderDialogOpen] = useState(false);
  const [orderTx, setOrderTx] = useState<LedgerTransaction | null>(null);

  const openCancelConfirm = useCallback(() => {
    if (!picked) return;
    const tx = allTx.find(t =>
      t.studentId === picked.studentId && t.businessDate === viewDate && t.type === 'order'
    );
    if (tx) {
      setOrderTx(tx as LedgerTransaction);
      setCancelDialogOpen(true);
    } else {
      setNoOrderDialogOpen(true);
    }
  }, [picked, viewDate, allTx]);

  const openCancelConfirmForTx = useCallback((tx: LedgerTransaction) => {
    if (allStudents && selectStudent) {
      const student = allStudents.find(s => s.studentId === tx.studentId);
      if (student) {
        selectStudent(student.studentId, 'manual');
      }
    }
    setOrderTx(tx);
    setCancelDialogOpen(true);
  }, [allStudents, selectStudent]);

  // M2：理由必填；已關帳或缺理由時回傳失敗，對話框留著顯示原因。
  const handleDeleteOrder = useCallback((keepPaymentAsDeposit: boolean, reason: string): LedgerMutationResult => {
    const store = usePosStore.getState();
    const txToDelete = orderTx ?? (picked ? store.transactions.find(t =>
      t.studentId === picked.studentId && t.businessDate === viewDate && t.type === 'order'
    ) : undefined);
    if (!txToDelete) return { ok: false, message: '找不到這筆訂餐，可能已經取消。' };
    const result = store.deleteOrderWithRefundCheck(txToDelete.transactionId, { reason, operatorId, keepPaymentAsDeposit });
    if (!result.deleted) return { ok: false, message: result.message ?? '取消失敗。' };
    setOrderTx(null);
    return { ok: true };
  }, [picked, viewDate, orderTx, operatorId]);

  return {
    cancelDialogOpen, setCancelDialogOpen,
    noOrderDialogOpen, setNoOrderDialogOpen,
    /** 對話框要取消的那一筆（從最近帳戶點的那筆，或今天第一筆訂餐）。 */
    orderTx,
    openCancelConfirm, openCancelConfirmForTx, handleDeleteOrder,
  };
}
