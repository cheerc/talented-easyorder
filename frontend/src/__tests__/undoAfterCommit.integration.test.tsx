import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetStoreForTest } from './helpers/storeSetup';
import { renderApp } from './helpers/renderApp';
import { usePosStore } from '../store/posStore';
import { UNDO_REASON } from '../hooks/useUndoCountdown';

// M2 L05：F1 送出後，成功畫面上看得到撤回鍵；撤回後交易消失、餘額回原值，稽核留原單和理由。
async function payFor015(user: ReturnType<typeof userEvent.setup>, amount: string) {
  await user.type(screen.getByPlaceholderText(/015/), '015');
  await user.keyboard('{Enter}');
  await waitFor(() => expect(screen.getByText('訂便當')).toBeTruthy());
  await user.click(screen.getByRole('radio', { name: /繳費/ }));
  await user.type(screen.getByLabelText('付款金額'), amount);
  await user.keyboard('{Enter}');
  await waitFor(() => expect(screen.getByTestId('payment-success')).toBeTruthy());
}

describe('F1 送出後撤回（L05）', () => {
  beforeEach(() => resetStoreForTest());

  it('成功畫面上就出現撤回鍵，按下去交易撤掉、餘額回原值、稽核有理由', async () => {
    await renderApp();
    const user = userEvent.setup();
    const before = usePosStore.getState();
    const balanceBefore = before.students.find(s => s.studentId === '015')!.currentBalance;
    const txCountBefore = before.transactions.length;

    await payFor015(user, '100');

    const after = usePosStore.getState();
    expect(after.transactions.length).toBe(txCountBefore + 1);
    const committed = after.transactions[0];
    expect(committed.paidAmount).toBe(100);

    const undo = await screen.findByRole('button', { name: /撤回這筆/ });
    await user.click(undo);

    await waitFor(() => expect(screen.queryByTestId('payment-success')).toBeNull());
    const final = usePosStore.getState();
    expect(final.transactions.find(t => t.transactionId === committed.transactionId)).toBeUndefined();
    expect(final.transactions.length).toBe(txCountBefore);
    expect(final.students.find(s => s.studentId === '015')!.currentBalance).toBe(balanceBefore);

    const audit = final.auditEvents.find(e => e.entityId === committed.transactionId);
    expect(audit).toBeDefined();
    expect(audit!.reason).toBe(UNDO_REASON);
  });

  it('焦點在撤回鍵上按 Enter 是撤回，不是下一位', async () => {
    await renderApp();
    const user = userEvent.setup();
    const txCountBefore = usePosStore.getState().transactions.length;

    await payFor015(user, '100');
    const undo = await screen.findByRole('button', { name: /撤回這筆/ });
    undo.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.queryByTestId('payment-success')).toBeNull());
    expect(usePosStore.getState().transactions.length).toBe(txCountBefore);
  });

  it('直接按 Enter 回下一位時，交易保留', async () => {
    await renderApp();
    const user = userEvent.setup();
    const txCountBefore = usePosStore.getState().transactions.length;

    await payFor015(user, '100');
    expect(screen.getByRole('button', { name: /撤回這筆/ })).toBeTruthy();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.queryByTestId('payment-success')).toBeNull());
    expect(usePosStore.getState().transactions.length).toBe(txCountBefore + 1);
  });
});
