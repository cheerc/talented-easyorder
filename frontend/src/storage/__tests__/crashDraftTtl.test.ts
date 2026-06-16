import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveCrashDraft, loadCrashDraft, clearCrashDraft, CRASH_DRAFT_TTL_MS } from '../crashDraft';
import type { PosTransactionDraft } from '../../domain/posTransaction';

const sampleDraft: PosTransactionDraft = {
  intent: {
    businessDate: '2026-05-15',
    studentId: '001',
    type: 'order',
    mealPrice: 90,
    paidAmount: 0,
    note: '便當',
    sourceDevice: 'pc',
  },
  snapshots: {
    student: { studentId: '001', studentNameSnapshot: '王柏翰' },
    menu: { menuNameSnapshot: '便當', menuPriceSnapshot: 90, vendorIdSnapshot: 'v1', vendorNameSnapshot: '廠商A' },
  },
  amount: -90,
  expectedBalanceAfter: 910,
};

describe('#312 — crash draft TTL', () => {
  beforeEach(() => {
    clearCrashDraft();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearCrashDraft();
  });

  it('saves and loads draft within TTL', async () => {
    await saveCrashDraft(sampleDraft);
    const loaded = await loadCrashDraft();
    expect(loaded).toEqual(sampleDraft);
  });

  it('returns null for expired draft (>24h)', async () => {
    const saveTime = 1_000_000;
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(saveTime);
    await saveCrashDraft(sampleDraft);

    // Advance past TTL
    dateNowSpy.mockReturnValue(saveTime + CRASH_DRAFT_TTL_MS + 1000);
    const loaded = await loadCrashDraft();
    expect(loaded).toBeNull();
  });

  it('returns draft just before TTL expiry', async () => {
    const saveTime = 1_000_000;
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(saveTime);
    await saveCrashDraft(sampleDraft);

    // Just before TTL
    dateNowSpy.mockReturnValue(saveTime + CRASH_DRAFT_TTL_MS - 1000);
    const loaded = await loadCrashDraft();
    expect(loaded).toEqual(sampleDraft);
  });

  it('CRASH_DRAFT_TTL_MS is 24 hours', () => {
    expect(CRASH_DRAFT_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
