import { useMemo, useState } from 'react';
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
  /** 特殊餐品項；有 priceOverride 時成功畫面顯示這個名稱。 */
  priceOverrideLabel?: string;
  allTx: WorkflowTransactionView[];
}): FlashData | null {
  const { isSuccess, picked, currentMode, currentPaidAmount, todayMenu, flashKey, priceOverride, priceOverrideLabel = '', allTx } = args;

  const live = useMemo(() => {
    if (!isSuccess || !picked) {
      // F4-2: expense mode — picked is null, generate virtual flashData
      if (isSuccess && !picked) {
        const latestExpense = allTx.find(t => t.studentId === '__cashier__' && t.type === 'expense');
        if (!latestExpense) return null;
        const isIncome = latestExpense.paidAmount > 0;
        // 櫃台收支只顯示這一筆；櫃台現金在日末點現金時才核對，不在這裡顯示累計（以前是全部日期加總，金額也重複出現）。
        return {
          id: flashKey,
          name: '櫃台',
          sid: '',
          detail: isIncome ? `收入：${latestExpense.note}` : `支出：${latestExpense.note}`,
          amount: isIncome ? latestExpense.paidAmount : -latestExpense.mealPrice,
        };
      }
      return null;
    }
    const amt = Number(currentPaidAmount || 0);
    if (!Number.isSafeInteger(amt) || amt < 0) return null;
    const mealPrice = currentMode === 'order' ? (priceOverride ?? todayMenu.price) : 0;
    const itemName = (priceOverride !== null && priceOverrideLabel) || todayMenu.itemName;
    return {
      id: flashKey,
      name: picked.displayName,
      sid: picked.studentId,
      detail: currentMode === 'order' ? `訂餐: ${itemName}` + (amt > 0 ? `, 收現 ${amt}` : '') :
              currentMode === 'payment' ? `繳費: 收現 ${amt}` :
                '',
      amount: amt - mealPrice,
      after: picked.currentBalance,
    };
  }, [isSuccess, picked, currentMode, currentPaidAmount, todayMenu, flashKey, priceOverride, priceOverrideLabel, allTx]);

  // M1：成功畫面凍結送出當下的結果。之後名單、餘額、菜單或交易再變（例如同步回來、其他畫面改資料），
  // 這張卡都不重算，不會出現「又扣一次」的預覽。離開成功畫面才放掉。
  const [frozen, setFrozen] = useState<FlashData | null>(null);
  if (isSuccess && frozen === null && live !== null) setFrozen(live);
  if (!isSuccess && frozen !== null) setFrozen(null);
  if (!isSuccess) return null;
  return frozen ?? live;
}
