import { describe, it, expect, vi, beforeEach } from 'vitest';
import { posPersistenceConfig } from '../posPersistence';
import type { PosState } from '../posTypes';
import { INITIAL_STUDENTS, INITIAL_TODAY_MENU, INITIAL_TODAY_TX, VENDORS } from '../../mocks/initialData';

vi.mock('../../errors/errorLogger', () => ({
  appendErrorLog: vi.fn(),
}));

describe('posPersistence — onRehydrateStorage fallback', () => {
  let rehydrateCallback: (state: PosState | undefined, error?: unknown) => void;

  beforeEach(async () => {
    const { appendErrorLog } = await import('../../errors/errorLogger');
    (appendErrorLog as ReturnType<typeof vi.fn>).mockClear();
    // onRehydrateStorage returns the callback
    rehydrateCallback = posPersistenceConfig.onRehydrateStorage!() as typeof rehydrateCallback;
  });

  it('rehydrateCallback is a function', () => {
    expect(typeof rehydrateCallback).toBe('function');
  });

  it('falls back to INITIAL_DATA on error', async () => {
    const { appendErrorLog } = await import('../../errors/errorLogger');
    const state = {} as PosState;
    rehydrateCallback(state, new Error('corrupted'));

    expect(appendErrorLog).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'storage', message: expect.stringContaining('rehydration failed') }),
    );
  });

  it('falls back to INITIAL_DATA when state is undefined', async () => {
    const { appendErrorLog } = await import('../../errors/errorLogger');
    rehydrateCallback(undefined);
    expect(appendErrorLog).toHaveBeenCalled();
  });

  it('falls back to INITIAL_DATA on validation failure', async () => {
    const { appendErrorLog } = await import('../../errors/errorLogger');
    // Invalid state: missing required keys
    const state = { students: 'not-an-array' } as unknown as PosState;
    rehydrateCallback(state);

    expect(appendErrorLog).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('validation failed') }),
    );
    // State should be replaced with initial data
    expect(state.students).toEqual(INITIAL_STUDENTS);
    expect(state.transactions).toEqual(INITIAL_TODAY_TX);
    expect(state.vendors).toEqual(VENDORS);
    expect(state.todayMenu).toEqual(INITIAL_TODAY_MENU);
  });

  it('does not overwrite on valid state', async () => {
    const { appendErrorLog } = await import('../../errors/errorLogger');
    // Construct a valid state with all required keys
    const validState = {
      students: [],
      transactions: [],
      vendors: [],
      todayMenu: {
        businessDate: '2026-06-15',
        itemName: '便當',
        price: 60,
        vendorId: 'v1',
        vendorNameSnapshot: '廠商A',
        updatedAt: '2026-06-15T08:00:00Z',
        revision: 1,
      },
      auditEvents: [],
      dailySettlements: [],
      businessDateStatuses: {},
      cashSessions: {},
      schemaVersion: 2,
    } as unknown as PosState;

    rehydrateCallback(validState);
    // Valid state should not be overwritten
    expect(validState.students).toEqual([]);
    // appendErrorLog should NOT have been called with validation failed
    const calls = (appendErrorLog as ReturnType<typeof vi.fn>).mock.calls;
    const hasValidationFail = calls.some(([arg]: [{ message: string }]) => arg.message?.includes('validation failed'));
    expect(hasValidationFail).toBe(false);
  });
});
