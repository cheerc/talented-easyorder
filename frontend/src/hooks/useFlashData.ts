import { useMemo } from 'react';
import type { FlashData } from '../components/MainLayout';
import type { StudentAccount } from '../domain/student';
import type { WorkflowTransactionView } from '../domain/transactionViews';
import type { TodayMenu } from '../domain/menu';

export function useFlashData(args: {
  isSuccess: boolean;
  picked: StudentAccount | null;
  currentMode: string;
  currentPaidAmount: string;
  todayMenu: TodayMenu;
  flashKey: number;
  priceOverride: number | null;
  allTx: WorkflowTransactionView[];
}): FlashData | null {
  const { isSuccess, picked, currentMode, currentPaidAmount, todayMenu, flashKey, priceOverride, allTx } = args;

  return useMemo(() => {
    if (!isSuccess || !picked) {
      // F4-2: expense mode — picked is null, generate virtual flashData
      if (isSuccess && !picked) {
        const latestExpense = allTx.find(t => t.studentId === '__cashier__' && t.type === 'expense');
        if (!latestExpense) return null;
        const counterNetCash = allTx
          .filter(t => t.studentId === '__cashier__' && t.type === 'expense')
          .reduce((sum, t) => sum + (t.paidAmount > 0 ? t.paidAmount : -t.mealPrice), 0);
        const isIncome = latestExpense.paidAmount > 0;
        return {
          id: flashKey,
          name: '櫃台',
          sid: '',
          detail: isIncome
            ? `收入: ${latestExpense.note} +$${latestExpense.paidAmount}`
            : `支出: ${latestExpense.note} −$${latestExpense.mealPrice}`,
          amount: isIncome ? latestExpense.paidAmount : -latestExpense.mealPrice,
          after: counterNetCash,
        };
      }
      return null;
    }
    const amt = Number(currentPaidAmount || 0);
    if (!Number.isSafeInteger(amt) || amt < 0) return null;
    const mealPrice = currentMode === 'order' ? (priceOverride ?? todayMenu.price) : 0;
    return {
      id: flashKey,
      name: picked.displayName,
      sid: picked.studentId,
      detail: currentMode === 'order' ? `訂餐: ${todayMenu.itemName}` + (amt > 0 ? `, 收現 ${amt}` : '') :
              currentMode === 'payment' ? `繳費: 收現 ${amt}` :
                '',
      amount: amt - mealPrice,
      after: picked.currentBalance,
    };
  }, [isSuccess, picked, currentMode, currentPaidAmount, todayMenu, flashKey, priceOverride, allTx]);
}
