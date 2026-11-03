import { createElement, useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, renderHook, waitFor } from '@testing-library/react';
import { useConfirmHandler } from '../useConfirmHandler';
import type { PosFlowState } from '../../domain/posFlow';

describe('useConfirmHandler', () => {
  it('calls requestConfirm when student_selected', () => {
    const state: PosFlowState = { kind: 'student_selected', studentId: 's1', mode: 'order', source: 'manual', paidAmountText: '', searchTextHint: '' };
    const requestConfirm = vi.fn();
    const confirmDuplicate = vi.fn();
    const confirmExpenseAmount = vi.fn();

    const { result } = renderHook(() =>
      useConfirmHandler({ state, requestConfirm, confirmDuplicate, confirmExpenseAmount })
    );
    result.current();
    expect(requestConfirm).toHaveBeenCalledOnce();
    expect(confirmDuplicate).not.toHaveBeenCalled();
  });

  it('calls confirmDuplicate when duplicate_warning', () => {
    const state: PosFlowState = { kind: 'duplicate_warning', studentId: 's1', source: 'manual', paidAmountText: '', searchTextHint: '' };
    const requestConfirm = vi.fn();
    const confirmDuplicate = vi.fn();
    const confirmExpenseAmount = vi.fn();

    const { result } = renderHook(() =>
      useConfirmHandler({ state, requestConfirm, confirmDuplicate, confirmExpenseAmount })
    );
    result.current();
    expect(confirmDuplicate).toHaveBeenCalledOnce();
  });

  it('M1：儲存失敗後 Enter 交給 requestConfirm 重送同一筆', () => {
    const state: PosFlowState = { kind: 'error', studentId: 's1', mode: 'order', source: 'manual', paidAmountText: '', message: 'x', retryable: true };
    const requestConfirm = vi.fn();
    const confirmDuplicate = vi.fn();
    const confirmExpenseAmount = vi.fn();

    const { result } = renderHook(() =>
      useConfirmHandler({ state, requestConfirm, confirmDuplicate, confirmExpenseAmount })
    );
    result.current();
    expect(requestConfirm).toHaveBeenCalledOnce();
  });

  it('calls confirmExpenseAmount with parsed amount when expense_input', () => {
    const state: PosFlowState = { kind: 'expense_input', amountText: '50' };
    const requestConfirm = vi.fn();
    const confirmDuplicate = vi.fn();
    const confirmExpenseAmount = vi.fn();

    const { result } = renderHook(() =>
      useConfirmHandler({ state, requestConfirm, confirmDuplicate, confirmExpenseAmount })
    );
    result.current();
    expect(confirmExpenseAmount).toHaveBeenCalledWith(50);
  });

  it('does nothing when idle', () => {
    const state: PosFlowState = { kind: 'idle', searchText: '' };
    const requestConfirm = vi.fn();
    const confirmDuplicate = vi.fn();
    const confirmExpenseAmount = vi.fn();

    const { result } = renderHook(() =>
      useConfirmHandler({ state, requestConfirm, confirmDuplicate, confirmExpenseAmount })
    );
    result.current();
    expect(requestConfirm).not.toHaveBeenCalled();
    expect(confirmDuplicate).not.toHaveBeenCalled();
    expect(confirmExpenseAmount).not.toHaveBeenCalled();
  });

  it('blocks order confirm when orderBlocked (M0 blank menu) but still allows payment', () => {
    const orderState: PosFlowState = { kind: 'student_selected', studentId: 's1', mode: 'order', source: 'manual', paidAmountText: '', searchTextHint: '' };
    const requestConfirm = vi.fn();
    const { result } = renderHook(() =>
      useConfirmHandler({ state: orderState, requestConfirm, confirmDuplicate: vi.fn(), confirmExpenseAmount: vi.fn(), orderBlocked: true })
    );
    result.current();
    expect(requestConfirm).not.toHaveBeenCalled();

    const paymentState: PosFlowState = { ...orderState, mode: 'payment' };
    const requestConfirm2 = vi.fn();
    const { result: result2 } = renderHook(() =>
      useConfirmHandler({ state: paymentState, requestConfirm: requestConfirm2, confirmDuplicate: vi.fn(), confirmExpenseAmount: vi.fn(), orderBlocked: true })
    );
    result2.current();
    expect(requestConfirm2).toHaveBeenCalledOnce();
  });
});

describe('useConfirmHandler right after a commit, before passive effects run (#615)', () => {
  const selected: PosFlowState = { kind: 'student_selected', studentId: 's1', mode: 'order', source: 'manual', paidAmountText: '', searchTextHint: '' };

  /**
   * Renders the hook in a component whose props change outside act() (as a store or timer update would), and presses
   * Enter (calls the returned handler) from a MutationObserver: right after React commits the change, before that
   * commit's passive effects are flushed.
   */
  async function confirmOnNextCommit(initial: { state: PosFlowState; orderBlocked: boolean }, next: typeof initial) {
    const requestConfirm = vi.fn();
    let setProps: (value: typeof initial) => void = () => undefined;
    let handleConfirm: () => void = () => undefined;
    function Harness() {
      const [props, set] = useState(initial);
      setProps = set;
      handleConfirm = useConfirmHandler({
        state: props.state, orderBlocked: props.orderBlocked,
        requestConfirm, confirmDuplicate: vi.fn(), confirmExpenseAmount: vi.fn(),
      });
      return createElement('span', { 'data-testid': 'marker' }, `${props.state.kind}:${String(props.orderBlocked)}`);
    }
    const view = render(createElement(Harness));
    const expected = `${next.state.kind}:${String(next.orderBlocked)}`;
    let pressed = false;
    const observer = new MutationObserver(() => {
      if (pressed || view.getByTestId('marker').textContent !== expected) return;
      pressed = true;
      handleConfirm();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    try {
      await new Promise<void>(resolve => setTimeout(() => { setProps(next); resolve(); }, 0));
      await waitFor(() => expect(pressed).toBe(true));
    } finally {
      observer.disconnect();
    }
    return requestConfirm;
  }

  it('confirms with the state just selected (stateRef)', async () => {
    const requestConfirm = await confirmOnNextCommit(
      { state: { kind: 'idle', searchText: '' }, orderBlocked: false },
      { state: selected, orderBlocked: false },
    );
    expect(requestConfirm).toHaveBeenCalledOnce();
  });

  it('confirms an order as soon as the dinner block lifts (orderBlockedRef)', async () => {
    const requestConfirm = await confirmOnNextCommit(
      { state: selected, orderBlocked: true },
      { state: selected, orderBlocked: false },
    );
    expect(requestConfirm).toHaveBeenCalledOnce();
  });

  it('does not confirm an order the moment the dinner block applies (orderBlockedRef)', async () => {
    const requestConfirm = await confirmOnNextCommit(
      { state: selected, orderBlocked: false },
      { state: selected, orderBlocked: true },
    );
    expect(requestConfirm).not.toHaveBeenCalled();
  });
});
