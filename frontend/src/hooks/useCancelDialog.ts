import { useState, useCallback } from 'react';
import { usePosStore } from '../store/posStore';
import type { StudentAccount } from '../domain/student';
import type { WorkflowTransactionView } from '../domain/transactionViews';

export function useCancelDialog(args: {
  picked: StudentAccount | null;
  allTx: WorkflowTransactionView[];
  viewDate: string;
}) {
  const { picked, allTx, viewDate } = args;
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [noOrderDialogOpen, setNoOrderDialogOpen] = useState(false);

  const openCancelConfirm = useCallback(() => {
    if (!picked) return;
    const orderTx = allTx.find(t =>
      t.studentId === picked.studentId && t.businessDate === viewDate && t.type === 'order'
    );
    if (orderTx) {
      setCancelDialogOpen(true);
    } else {
      setNoOrderDialogOpen(true);
    }
  }, [picked, viewDate, allTx]);

  const handleDeleteOrder = useCallback(() => {
    if (!picked) return;
    const store = usePosStore.getState();
    store.deleteOrderWithRefundCheck(
      store.transactions.find(t =>
        t.studentId === picked.studentId && t.businessDate === viewDate && t.type === 'order'
      )?.transactionId ?? ''
    );
  }, [picked, viewDate]);

  return {
    cancelDialogOpen, setCancelDialogOpen,
    noOrderDialogOpen, setNoOrderDialogOpen,
    openCancelConfirm, handleDeleteOrder,
  };
}
