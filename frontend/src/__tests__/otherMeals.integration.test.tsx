import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetStoreForTest } from './helpers/storeSetup';
import { renderApp } from './helpers/renderApp';
import { usePosStore } from '../store/posStore';
import { countMeals, isOtherMealOrder } from '../domain/ledgerReport';

// 今日便當份數與其他餐點分開算；櫃台收支成功畫面只顯示這一筆。
const counter = () => document.querySelector('.counter') as HTMLElement;

async function selectAndOrder(user: ReturnType<typeof userEvent.setup>, id: string, other?: { item: string; price: string }) {
  await user.type(screen.getByPlaceholderText(/015/), id);
  await user.keyboard('{Enter}');
  await waitFor(() => expect(screen.getByText('訂便當')).toBeTruthy());
  await user.click(screen.getByRole('radio', { name: /訂便當/ }));
  if (other) {
    await user.click(screen.getByRole('button', { name: '訂購其他餐點' }));
    await user.clear(screen.getByLabelText('品項或原因'));
    await user.type(screen.getByLabelText('品項或原因'), other.item);
    await user.clear(screen.getByLabelText('價格'));
    await user.type(screen.getByLabelText('價格'), other.price);
  }
  await user.keyboard('{Enter}');
  await waitFor(() => expect(screen.getByTestId('payment-success')).toBeTruthy());
  await user.keyboard('{Enter}');
  await waitFor(() => expect(screen.queryByTestId('payment-success')).toBeNull());
}

describe('今日便當 N 份 + 其他 M 份', () => {
  beforeEach(() => resetStoreForTest());

  it('訂購其他餐點記下品項；頂部與 F1 分開顯示；改備註、當天改價都不影響分類', async () => {
    await renderApp();
    const user = userEvent.setup();
    await selectAndOrder(user, '015');
    await selectAndOrder(user, '016', { item: '雞腿便當', price: '110' });

    const txs = usePosStore.getState().transactions;
    const other = txs.find(t => t.mealPrice === 110)!;
    expect(other.otherItemName).toBe('雞腿便當');
    expect(isOtherMealOrder(other)).toBe(true);
    expect(counter().textContent).toContain('1');
    expect(counter().textContent).toContain('今日便當 ＋其他 1');
    expect(document.querySelector('.idle')!.textContent).toContain('已訂 今日便當 1 份 ＋ 其他 1 份');

    // 用 E 改掉備註：仍是其他餐點（以前只靠備註開頭判斷，改了就被算成今日便當）。
    act(() => { usePosStore.getState().editTransaction(other.transactionId, { note: '改過的備註' }, { reason: '測試' }); });
    // 當天改價：前面那份今日便當仍算今日便當（以前要求單價等於現在菜單）。
    const date = usePosStore.getState().transactions[0].businessDate;
    act(() => { usePosStore.getState().setMenuForDate(date, { itemName: '排骨便當', price: 100, vendorId: '', vendorNameSnapshot: '' }, 'now'); });
    const todays = usePosStore.getState().transactions.filter(t => t.businessDate === date);
    expect(countMeals(todays)).toEqual({ bento: 1, other: 1 });
    await waitFor(() => expect(counter().textContent).toContain('今日便當 ＋其他 1'));
  });
});

describe('其他餐點的價格欄', () => {
  beforeEach(() => resetStoreForTest());

  it('清空後不會跳回今日價格；空著不能送出；打 110 就是 110', async () => {
    await renderApp();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/015/), '015');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText('訂便當')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: '訂購其他餐點' }));
    const price = screen.getByLabelText('價格') as HTMLInputElement;
    await user.clear(price);
    expect(price.value).toBe('');
    const before = usePosStore.getState().transactions.length;
    await user.keyboard('{Enter}');
    expect(screen.queryByTestId('payment-success')).toBeNull();
    expect(usePosStore.getState().transactions.length).toBe(before);
    expect(screen.getByText('請輸入其他餐點的價格。')).toBeTruthy();
    await user.type(price, '110');
    expect(price.value).toBe('110');
  });
});

describe('櫃台收支成功畫面', () => {
  beforeEach(() => resetStoreForTest());

  it('只顯示這一筆：沒有「#」、金額只出現一次、沒有餘額', async () => {
    await renderApp();
    const user = userEvent.setup();
    await user.click(screen.getByText('新增櫃台收支', { exact: true }));
    await user.type(screen.getByLabelText('金額'), '270');
    await user.keyboard('{Enter}');
    await user.click(screen.getAllByRole('button', { name: /支出/ })[0]);
    await user.click(screen.getByRole('button', { name: '付便當錢' }));
    const flash = await waitFor(() => {
      const el = document.querySelector('.flash') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    const text = flash.querySelector('.flash-card')!.textContent ?? '';
    expect(text).toContain('支出：付便當錢');
    expect(text).not.toContain('#');
    expect(text).not.toContain('餘額');
    expect(text.match(/270/g)).toHaveLength(1);
  });
});
