import { describe, expect, it, vi } from 'vitest';
import { buildPosColumnProps } from '../usePosColumnProps';

// Ref: #349 — Tests for usePosColumnProps (core POS render path)

function makeMockArgs(): Parameters<typeof buildPosColumnProps>[0] {
  return {
    state: 'idle' as const,
    isHistorical: false,
    dateStatus: 'open',
    viewDate: '2024-01-15',
    systemDate: '2024-01-15',
    setViewDate: vi.fn(),
    picked: null,
    currentMode: 'normal' as const,
    currentPaidAmount: '',
    allTx: [],
    students: [],
    selectStudent: vi.fn(),
    expenseProps: null,
    updateExpenseAmount: vi.fn(),
    confirmExpenseAmount: vi.fn(),
    selectExpenseDirection: vi.fn(),
    selectExpenseReason: vi.fn(),
    updateExpenseNote: vi.fn(),
    confirmExpenseNote: vi.fn(),
    setPaidAmountText: vi.fn(),
    handleConfirm: vi.fn(),
    cancelFlow: vi.fn(),
    changeMode: vi.fn(),
    setFocusZone: vi.fn(),
    focusZone: 'grid',
    openCancelConfirm: vi.fn(),
    setSearchText: vi.fn(),
    searchFocusKey: 0,
    hasFlash: false,
    crashDraftRestored: false,
    setCrashDraftRestored: vi.fn(),
    todayMenu: { itemName: '便當', price: 60, vendorNameSnapshot: 'A' },
    todayCount: 0,
    vendors: [],
    enterExpenseMode: vi.fn(),
    tweaks: { theme: 'warm', fontSize: 'lg', disableHoverSelection: false },
    tx: [],
    priceOverride: null,
    priceOverrideLabel: '',
    setPriceOverride: vi.fn(),
    setPriceOverrideLabel: vi.fn(),
    handleDeleteOrder: vi.fn(),
    onViewHistory: vi.fn(),
  };
}

describe('buildPosColumnProps', () => {
  it('maps all input args to output props', () => {
    const args = makeMockArgs();
    const result = buildPosColumnProps(args);

    // Verify key scalar fields
    expect(result.state).toBe('idle');
    expect(result.isHistorical).toBe(false);
    expect(result.dateStatus).toBe('open');
    expect(result.viewDate).toBe('2024-01-15');
    expect(result.systemDate).toBe('2024-01-15');
    expect(result.currentMode).toBe('normal');
    expect(result.currentPaidAmount).toBe('');
    expect(result.focusZone).toBe('grid');
    expect(result.searchFocusKey).toBe(0);
    expect(result.hasFlash).toBe(false);
    expect(result.crashDraftRestored).toBe(false);
    expect(result.todayCount).toBe(0);
    expect(result.priceOverride).toBeNull();
    expect(result.priceOverrideLabel).toBe('');
  });

  it('passes through callback references unchanged', () => {
    const args = makeMockArgs();
    const result = buildPosColumnProps(args);

    expect(result.setViewDate).toBe(args.setViewDate);
    expect(result.selectStudent).toBe(args.selectStudent);
    expect(result.handleConfirm).toBe(args.handleConfirm);
    expect(result.cancelFlow).toBe(args.cancelFlow);
    expect(result.changeMode).toBe(args.changeMode);
    expect(result.enterExpenseMode).toBe(args.enterExpenseMode);
    expect(result.setPriceOverride).toBe(args.setPriceOverride);
    expect(result.handleDeleteOrder).toBe(args.handleDeleteOrder);
    expect(result.onViewHistory).toBe(args.onViewHistory);
  });

  it('passes through object references unchanged', () => {
    const args = makeMockArgs();
    const result = buildPosColumnProps(args);

    expect(result.todayMenu).toBe(args.todayMenu);
    expect(result.tweaks).toBe(args.tweaks);
    expect(result.allTx).toBe(args.allTx);
    expect(result.students).toBe(args.students);
    expect(result.vendors).toBe(args.vendors);
    expect(result.tx).toBe(args.tx);
  });

  it('includes picked student when provided', () => {
    const args = makeMockArgs();
    const student = { id: 's1', displayName: '王小明', balance: 100, className: '3A' };
    args.picked = student as Record<string, unknown> as Parameters<typeof buildPosColumnProps>[0]['picked'];
    const result = buildPosColumnProps(args);

    expect(result.picked).toBe(student);
  });

  it('includes expense props when in expense mode', () => {
    const args = makeMockArgs();
    args.expenseProps = { kind: 'income', amountText: '500', amount: 500 };
    const result = buildPosColumnProps(args);

    expect(result.expenseProps).toEqual({ kind: 'income', amountText: '500', amount: 500 });
  });

  it('includes price override when set', () => {
    const args = makeMockArgs();
    args.priceOverride = 80;
    args.priceOverrideLabel = '特價';
    const result = buildPosColumnProps(args);

    expect(result.priceOverride).toBe(80);
    expect(result.priceOverrideLabel).toBe('特價');
  });
});
