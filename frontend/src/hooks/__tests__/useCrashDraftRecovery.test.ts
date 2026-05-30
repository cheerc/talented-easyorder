import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCrashDraftRecovery } from '../useCrashDraftRecovery';
import { usePosStore } from '../../store/posStore';

vi.mock('../../storage/crashDraft', () => ({
  loadCrashDraft: vi.fn(),
  clearCrashDraft: vi.fn(),
}));

import { loadCrashDraft, clearCrashDraft } from '../../storage/crashDraft';

const SELECT_STUDENT = vi.fn();
const SET_PAID_AMOUNT = vi.fn();
const CHANGE_MODE = vi.fn();

beforeEach(() => {
  usePosStore.getState().resetData();
  vi.resetAllMocks();
});

function makeDraft(overrides: Record<string, unknown> = {}) {
  return {
    intent: {
      businessDate: '2026-05-07',
      studentId: '001',
      type: 'order' as const,
      mealPrice: 90,
      paidAmount: 0,
      note: '',
      sourceDevice: 'pc' as const,
    },
    snapshots: {
      student: { studentId: '001', studentNameSnapshot: '王柏翰' },
      menu: { menuNameSnapshot: '便當', menuPriceSnapshot: 90, vendorIdSnapshot: 'v1', vendorNameSnapshot: '阿榮便當' },
    },
    amount: -90,
    expectedBalanceAfter: -90,
    ...overrides,
  };
}

describe('useCrashDraftRecovery', () => {
  it('C1: returns false when no crash draft exists', async () => {
    vi.mocked(loadCrashDraft).mockResolvedValue(null);

    const { result } = renderHook(() =>
      useCrashDraftRecovery({
        selectStudent: SELECT_STUDENT,
        setPaidAmountText: SET_PAID_AMOUNT,
        changeMode: CHANGE_MODE,
      })
    );

    await waitFor(() => {
      expect(SELECT_STUDENT).not.toHaveBeenCalled();
    });
    expect(result.current).toBe(false);
  });

  it('C2: restores student selection from crash draft', async () => {
    vi.mocked(loadCrashDraft).mockResolvedValue(makeDraft());

    renderHook(() =>
      useCrashDraftRecovery({
        selectStudent: SELECT_STUDENT,
        setPaidAmountText: SET_PAID_AMOUNT,
        changeMode: CHANGE_MODE,
      })
    );

    await waitFor(() => {
      expect(SELECT_STUDENT).toHaveBeenCalledWith('001', 'manual');
    });
  });

  it('C3: restores paidAmountText when paidAmount > 0', async () => {
    vi.mocked(loadCrashDraft).mockResolvedValue(makeDraft({
      intent: {
        businessDate: '2026-05-07',
        studentId: '001',
        type: 'payment' as const,
        mealPrice: 0,
        paidAmount: 500,
        note: '',
        sourceDevice: 'pc' as const,
      },
    }));

    renderHook(() =>
      useCrashDraftRecovery({
        selectStudent: SELECT_STUDENT,
        setPaidAmountText: SET_PAID_AMOUNT,
        changeMode: CHANGE_MODE,
      })
    );

    await waitFor(() => {
      expect(SET_PAID_AMOUNT).toHaveBeenCalledWith('500');
    });
  });

  it('C4: changes mode when type is payment', async () => {
    vi.mocked(loadCrashDraft).mockResolvedValue(makeDraft({
      intent: {
        businessDate: '2026-05-07',
        studentId: '001',
        type: 'payment' as const,
        mealPrice: 0,
        paidAmount: 100,
        note: '',
        sourceDevice: 'pc' as const,
      },
    }));

    renderHook(() =>
      useCrashDraftRecovery({
        selectStudent: SELECT_STUDENT,
        setPaidAmountText: SET_PAID_AMOUNT,
        changeMode: CHANGE_MODE,
      })
    );

    await waitFor(() => {
      expect(CHANGE_MODE).toHaveBeenCalledWith('payment');
    });
  });

  it('C5: clears draft and no-ops when student not found', async () => {
    vi.mocked(loadCrashDraft).mockResolvedValue(makeDraft({
      intent: {
        businessDate: '2026-05-07',
        studentId: 'nonexistent',
        type: 'order' as const,
        mealPrice: 90,
        paidAmount: 0,
        note: '',
        sourceDevice: 'pc' as const,
      },
    }));

    renderHook(() =>
      useCrashDraftRecovery({
        selectStudent: SELECT_STUDENT,
        setPaidAmountText: SET_PAID_AMOUNT,
        changeMode: CHANGE_MODE,
      })
    );

    await waitFor(() => {
      expect(clearCrashDraft).toHaveBeenCalled();
      expect(SELECT_STUDENT).not.toHaveBeenCalled();
    });
  });

  it('C6: sets crashDraftRestored to true on successful restore', async () => {
    vi.mocked(loadCrashDraft).mockResolvedValue(makeDraft());

    const { result } = renderHook(() =>
      useCrashDraftRecovery({
        selectStudent: SELECT_STUDENT,
        setPaidAmountText: SET_PAID_AMOUNT,
        changeMode: CHANGE_MODE,
      })
    );

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it('C7: cancelled flag prevents state update after unmount', async () => {
    // Use a never-resolving promise to test cancellation
    vi.mocked(loadCrashDraft).mockReturnValue(new Promise(() => {}));

    const { unmount } = renderHook(() =>
      useCrashDraftRecovery({
        selectStudent: SELECT_STUDENT,
        setPaidAmountText: SET_PAID_AMOUNT,
        changeMode: CHANGE_MODE,
      })
    );

    unmount();

    // Callbacks should not have been called since cancelled flag is set
    expect(SELECT_STUDENT).not.toHaveBeenCalled();
    expect(SET_PAID_AMOUNT).not.toHaveBeenCalled();
    expect(CHANGE_MODE).not.toHaveBeenCalled();
  });
});
