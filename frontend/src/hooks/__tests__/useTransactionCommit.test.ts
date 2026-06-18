import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTransactionCommit } from '../useTransactionCommit';
import { CASHIER_SENTINEL } from '../../domain/ledger';
import type { PosFlowState } from '../../domain/posFlow';
import type { StudentAccount } from '../../domain/student';
import type { TodayMenu } from '../../domain/menu';
import type { LedgerTransaction } from '../../domain/ledger';
import type { PosTransactionDraft } from '../../domain/posTransaction';

// Mock crash draft to avoid localStorage side effects
vi.mock('../../storage/crashDraft', () => ({
  saveCrashDraft: vi.fn(),
  clearCrashDraft: vi.fn(),
}));

vi.mock('../../storage/storageHealth', () => ({
  checkStorageHealth: vi.fn(() => ({ ok: true })),
}));

const makeStudent = (overrides?: Partial<StudentAccount>): StudentAccount => ({
  studentId: 's1',
  displayName: '測試學生',
  status: 'active',
  currentBalance: 1000,
  aliases: [],
  faceEnrollmentStatus: 'none',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  revision: 1,
  ...overrides,
});

const makeMenu = (): TodayMenu => ({
  businessDate: '2026-06-15',
  itemName: '便當',
  price: 60,
  vendorId: 'v1',
  vendorNameSnapshot: '廠商A',
  updatedAt: '2026-06-15T08:00:00Z',
  revision: 1,
});

const makeArgs = () => ({
  businessDate: '2026-06-15',
  priceOverride: null as number | null,
  priceOverrideLabel: '',
});

describe('useTransactionCommit', () => {
  let dispatch: ReturnType<typeof vi.fn>;
  let commitDraft: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dispatch = vi.fn();
    commitDraft = vi.fn();
  });

  // --- #283: CASHIER_SENTINEL regression test ---
  it('expense flow uses CASHIER_SENTINEL as studentId', () => {
    const state: PosFlowState = {
      kind: 'committing',
      studentId: 's1',
      mode: 'expense',
      source: 'manual',
      paidAmountText: '',
      searchTextHint: '',
      expenseAmount: 100,
      expenseNote: '文具費',
      expenseDirection: 'out',
    };
    const students = [makeStudent()];
    const menu = makeMenu();
    const transactions: LedgerTransaction[] = [];

    const { result } = renderHook(() =>
      useTransactionCommit(dispatch, state, students, menu, transactions, commitDraft, makeArgs()),
    );

    act(() => {
      result.current.commitTransaction();
    });

    expect(commitDraft).toHaveBeenCalledOnce();
    const draft: PosTransactionDraft = commitDraft.mock.calls[0][0];
    expect(draft.intent.studentId).toBe(CASHIER_SENTINEL);
    expect(draft.intent.studentId).not.toBe('expense-operator');
  });

  // --- Duplicate detection ---
  it('requestConfirm dispatches hasDuplicateOrder=true when active order exists', () => {
    const state: PosFlowState = {
      kind: 'student_selected',
      studentId: 's1',
      mode: 'order',
      source: 'manual',
      paidAmountText: '',
      searchTextHint: '',
    };
    const tx: LedgerTransaction = {
      transactionId: 'tx1',
      businessDate: '2026-06-15',
      createdAt: '2026-06-15T10:00:00Z',
      studentId: 's1',
      studentNameSnapshot: '測試',
      type: 'order',
      mealPrice: 60,
      paidAmount: 0,
      amount: -60,
      afterBalance: 940,
      menuNameSnapshot: '便當',
      vendorNameSnapshot: '廠商A',
      sourceDevice: 'pc',
      syncStatus: 'local',
      revision: 1,
      note: '',
    };
    const students = [makeStudent()];
    const menu = makeMenu();

    const { result } = renderHook(() =>
      useTransactionCommit(dispatch, state, students, menu, [tx], commitDraft, makeArgs()),
    );

    act(() => {
      result.current.requestConfirm();
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'requestCommit', hasDuplicateOrder: true }),
    );
  });

  it('requestConfirm dispatches hasDuplicateOrder=false when no active order', () => {
    const state: PosFlowState = {
      kind: 'student_selected',
      studentId: 's1',
      mode: 'order',
      source: 'manual',
      paidAmountText: '',
      searchTextHint: '',
    };

    const { result } = renderHook(() =>
      useTransactionCommit(dispatch, state, [makeStudent()], makeMenu(), [], commitDraft, makeArgs()),
    );

    act(() => {
      result.current.requestConfirm();
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'requestCommit', hasDuplicateOrder: false }),
    );
  });

  // --- Double-submit guard ---
  it('commitTransaction ignores non-committing states', () => {
    const state: PosFlowState = { kind: 'idle', searchTextHint: '' };

    const { result } = renderHook(() =>
      useTransactionCommit(dispatch, state, [], makeMenu(), [], commitDraft, makeArgs()),
    );

    act(() => {
      result.current.commitTransaction();
    });

    expect(commitDraft).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  // --- Crash draft save for order ---
  it('saves crash draft for order commit', async () => {
    const { saveCrashDraft } = await import('../../storage/crashDraft');
    const state: PosFlowState = {
      kind: 'committing',
      studentId: 's1',
      mode: 'order',
      source: 'manual',
      paidAmountText: '',
      searchTextHint: '',
    };

    const { result } = renderHook(() =>
      useTransactionCommit(dispatch, state, [makeStudent()], makeMenu(), [], commitDraft, makeArgs()),
    );

    act(() => {
      result.current.commitTransaction();
    });

    expect(saveCrashDraft).toHaveBeenCalledOnce();
  });

  // --- requestConfirm ignores non-student-selected ---
  it('requestConfirm does nothing in idle state', () => {
    const state: PosFlowState = { kind: 'idle', searchTextHint: '' };

    const { result } = renderHook(() =>
      useTransactionCommit(dispatch, state, [], makeMenu(), [], commitDraft, makeArgs()),
    );

    act(() => {
      result.current.requestConfirm();
    });

    expect(dispatch).not.toHaveBeenCalled();
  });
});
