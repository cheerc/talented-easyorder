import { useState, useCallback } from 'react';
import { usePosStore } from '../store/posStore';
import type { StudentAccount } from '../domain/student';
import type { WorkflowTransactionView } from '../domain/transactionViews';
import type { LedgerTransaction } from '../domain/ledger';

export function useCancelDialog(args: {
  picked: StudentAccount | null;
  allTx: WorkflowTransactionView[];
  viewDate: string;
  allStudents?: StudentAccount[];
  selectStudent?: (studentId: string, source: string) => void;
}) {
  const { picked, allTx, viewDate, allStudents, selectStudent } = args;
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

  const handleDeleteOrder = useCallback((keepPaymentAsDeposit?: boolean) => {
    if (!picked && !orderTx) return;
    const store = usePosStore.getState();
    const txToDelete = orderTx ?? store.transactions.find(t =>
      t.studentId === picked!.studentId && t.businessDate === viewDate && t.type === 'order'
    );
    if (txToDelete) {
      store.deleteOrderWithRefundCheck(txToDelete.transactionId, undefined, keepPaymentAsDeposit);
    }
    setOrderTx(null);
  }, [picked, viewDate, orderTx]);

  return {
    cancelDialogOpen, setCancelDialogOpen,
    noOrderDialogOpen, setNoOrderDialogOpen,
    openCancelConfirm, openCancelConfirmForTx, handleDeleteOrder,
  };
}
