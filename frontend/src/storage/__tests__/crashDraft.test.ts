import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { saveCrashDraft, loadCrashDraft, clearCrashDraft, isCrashDraftAvailable } from '../crashDraft';
import type { PosTransactionDraft } from '../../domain/posTransaction';

const sampleDraft: PosTransactionDraft = {
  intent: {
    businessDate: '2026-05-15',
    studentId: '001',
    type: 'order',
    mealPrice: 90,
    paidAmount: 0,
    note: '日式唐揚雞便當',
    sourceDevice: 'pc',
  },
  snapshots: {
    student: { studentId: '001', studentNameSnapshot: '王柏翰' },
    menu: { menuNameSnapshot: '日式唐揚雞便當', menuPriceSnapshot: 90, vendorIdSnapshot: 'v1', vendorNameSnapshot: '阿榮便當' },
  },
  amount: -90,
  expectedBalanceAfter: 1160,
};

describe('crashDraft', () => {
  beforeEach(() => {
    clearCrashDraft();
  });

  afterEach(() => {
    clearCrashDraft();
  });

  it('saves and loads a crash draft', async () => {
    await saveCrashDraft(sampleDraft);
    const loaded = await loadCrashDraft();
    expect(loaded).not.toBeNull();
    expect(loaded!.intent.studentId).toBe('001');
    expect(loaded!.intent.type).toBe('order');
    expect(loaded!.amount).toBe(-90);
  });

  it('returns null when no draft is saved', async () => {
    const loaded = await loadCrashDraft();
    expect(loaded).toBeNull();
  });

  it('clears a saved draft', async () => {
    await saveCrashDraft(sampleDraft);
    clearCrashDraft();
    const loaded = await loadCrashDraft();
    expect(loaded).toBeNull();
  });

  it('isCrashDraftAvailable returns true after save', async () => {
    await saveCrashDraft(sampleDraft);
    expect(await isCrashDraftAvailable()).toBe(true);
  });

  it('isCrashDraftAvailable returns false after clear', async () => {
    await saveCrashDraft(sampleDraft);
    clearCrashDraft();
    expect(await isCrashDraftAvailable()).toBe(false);
  });

  it('overwrites previous draft on save', async () => {
    await saveCrashDraft(sampleDraft);
    const updated: PosTransactionDraft = { ...sampleDraft, amount: -100 };
    await saveCrashDraft(updated);
    const loaded = await loadCrashDraft();
    expect(loaded!.amount).toBe(-100);
  });

  describe('finally block cleanup', () => {
    it('calls db.close() even when transaction fails', async () => {
      const closeSpy = vi.fn();
      const originalOpen = window.indexedDB.open;

      window.indexedDB.open = vi.fn(() => {
        const req: Record<string, unknown> = {
          result: undefined,
          onupgradeneeded: null,
          onsuccess: null,
          onerror: null,
          error: null,
        };
        req.result = {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => { /* noop */ },
          close: closeSpy,
          transaction: () => {
            const tx: Record<string, unknown> = {
              oncomplete: null,
              onerror: null,
              error: new Error('transaction failed'),
            };
            tx.objectStore = () => ({
              put: () => ({ result: undefined, onsuccess: null, onerror: null }),
            });
            setTimeout(() => { (tx.onerror as (e: Event) => void)?.({ target: tx } as unknown as Event); }, 0);
            return tx;
          },
        };
        setTimeout(() => { (req.onsuccess as (e: Event) => void)?.({ target: req } as unknown as Event); }, 0);
        return req as IDBOpenDBRequest;
      });

      try {
        await saveCrashDraft(sampleDraft);
        expect(closeSpy).toHaveBeenCalledTimes(1);
      } finally {
        window.indexedDB.open = originalOpen;
      }
    });
  });
});
