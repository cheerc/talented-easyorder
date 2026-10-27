import { describe, expect, it, vi } from 'vitest';
import type { FirestoreRest } from '../firestoreRest';
import { planEmptyActivation } from '../activateEmpty';

const head = { schemaVersion: 1, datasetId: 'anonymous-p17', seq: 0, lastCommandId: null, maintenance: true, goLiveDate: '2026-10-25' };
const operators = [{ uid: 'synthetic-operator', email: 'synthetic@example.test' }];
function rest(overrides = {}) {
  return { getWithUpdateTime: vi.fn(async () => ({ data: { ...head }, updateTime: '2026-10-25T00:00:00Z' })),
    collectionHasDocuments: vi.fn(async () => false), groupHasDocuments: vi.fn(async () => false),
    listDocumentIds: vi.fn(async (name: string) => name === 'system' ? ['dataHead'] : []), commit: vi.fn(), ...overrides } as unknown as FirestoreRest;
}

describe('P17 empty activation', () => {
  it('plans only allowlist, an empty lease and the conditional maintenance clear, without financial data or writes', async () => {
    const api = rest();
    const plan = await planEmptyActivation(api, operators, { _type: 'timestamp', seconds: 1, nanoseconds: 0 });
    expect(plan.datasetId).toBe(head.datasetId);
    expect(plan.writes.map(item => item.path)).toEqual(['operators/synthetic-operator', 'system/accessLease', 'system/dataHead']);
    expect(plan.writes[1]).toMatchObject({ kind: 'create', data: { holderUid: null, epoch: 0 } });
    expect(plan.writes[2]).toMatchObject({ kind: 'update', data: { maintenance: false }, updateTime: '2026-10-25T00:00:00Z' });
    expect(api.commit).not.toHaveBeenCalled();
  });
  it.each([null, { ...head, seq: 1 }, { ...head, lastCommandId: 'exists' }, { ...head, maintenance: false }, { ...head, schemaVersion: 2 }, { ...head, datasetId: '' }])('refuses an invalid or used head', async value => {
    const api = rest({ getWithUpdateTime: vi.fn(async () => value === null ? null : { data: value, updateTime: 't' }) });
    await expect(planEmptyActivation(api, operators, { _type: 'timestamp', seconds: 1, nanoseconds: 0 })).rejects.toThrow();
    expect(api.commit).not.toHaveBeenCalled();
  });
  it('refuses existing business, nested settlements, operators, events or control documents', async () => {
    for (const name of ['commands', 'days', 'students', 'studentCodes', 'transactions', 'vendors', 'backfillDays', 'postCloseEntries', 'operators', 'accessEvents']) {
      const api = rest({ collectionHasDocuments: vi.fn(async collection => collection === name) });
      await expect(planEmptyActivation(api, operators, { _type: 'timestamp', seconds: 1, nanoseconds: 0 }), name).rejects.toThrow();
    }
    for (const overrides of [{ groupHasDocuments: vi.fn(async () => true) }, { listDocumentIds: vi.fn(async () => ['dataHead', 'accessLease']) }]) {
      await expect(planEmptyActivation(rest(overrides), operators, { _type: 'timestamp', seconds: 1, nanoseconds: 0 })).rejects.toThrow();
    }
  });
});
