import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFlashData } from '../useFlashData';
import type { StudentAccount } from '../../domain/student';
import type { TodayMenu } from '../../domain/menu';

const menu: TodayMenu = {
  businessDate: '2026-06-01', vendorId: 'v1', vendorNameSnapshot: '店', itemName: '排骨餐點', price: 90,
  updatedAt: '2026-06-01T08:00:00+08:00', revision: 1,
} as TodayMenu;

function student(balance: number): StudentAccount {
  return {
    studentId: '001', displayName: '甲', status: 'active', currentBalance: balance, aliases: [],
    faceEnrollmentStatus: 'none', createdAt: '', updatedAt: '', revision: 1,
  } as StudentAccount;
}

type Args = Parameters<typeof useFlashData>[0];
const base: Args = {
  isSuccess: true, picked: student(110), currentMode: 'order', currentPaidAmount: '', todayMenu: menu,
  flashKey: 1, priceOverride: null, allTx: [],
};

describe('useFlashData（M1 成功畫面）', () => {
  it('送出當下的結果凍結，之後餘額或菜單再變也不重算', () => {
    const { result, rerender } = renderHook((a: Args) => useFlashData(a), { initialProps: base });
    expect(result.current).toMatchObject({ amount: -90, after: 110, detail: '訂餐: 排骨餐點' });

    rerender({ ...base, picked: student(20), todayMenu: { ...menu, itemName: '雞腿餐點', price: 120 } });
    expect(result.current).toMatchObject({ amount: -90, after: 110, detail: '訂餐: 排骨餐點' });
  });

  it('離開成功畫面後放掉，下一筆重新計算', () => {
    const { result, rerender } = renderHook((a: Args) => useFlashData(a), { initialProps: base });
    rerender({ ...base, isSuccess: false });
    expect(result.current).toBeNull();
    rerender({ ...base, flashKey: 2, picked: student(20) });
    expect(result.current).toMatchObject({ id: 2, after: 20 });
  });

  it('特殊餐顯示特殊餐的品項與價格', () => {
    const { result } = renderHook((a: Args) => useFlashData(a), {
      initialProps: { ...base, priceOverride: 110, priceOverrideLabel: '素食餐點' },
    });
    expect(result.current).toMatchObject({ amount: -110, detail: '訂餐: 素食餐點' });
  });
});
