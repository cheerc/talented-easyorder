import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp, type Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { CloudPendingJournal } from '../cloudPendingJournal';

const firestoreMocks = vi.hoisted(() => ({
  doc: vi.fn(),
  collection: vi.fn(),
  documentId: vi.fn(),
  getDocFromServer: vi.fn(),
  getDocsFromServer: vi.fn(),
  limit: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  startAfter: vi.fn(),
  where: vi.fn(),
}));

const commands = vi.hoisted(() => ({
  commitCommand: vi.fn(),
  confirmPendingIntent: vi.fn(),
  cleanupConfirmedIntent: vi.fn(),
  readCommand: vi.fn(),
}));

vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return { ...actual, ...firestoreMocks };
});

vi.mock('../cloudCommandRepository', async importOriginal => {
  const actual = await importOriginal<typeof import('../cloudCommandRepository')>();
  return { ...actual, createCloudCommandRepository: () => commands };
});

import {
  CloudDayCloseGuardRejected,
  createCloudDayCloseRepository,
  type CloudDayCloseCommandIntent,
} from '../cloudDayCloseRepository';
import { CloudCommandReadError } from '../cloudCommandRepository';

const db = {} as Firestore;
const recoveryReader = { assertCurrent: vi.fn() };
const user = (uid: string) => ({
  uid, email: 'operator@example.test', emailVerified: true, providerData: [{ providerId: 'google.com' }],
}) as unknown as User;
let currentUid = 'uid-a';

const ts = (iso: string) => Timestamp.fromDate(new Date(iso));
const totals = () => ({
  activeTransactionCount: 0, bentoCount: 0, otherMealCount: 0, mealTotal: 0,
  retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0,
});
const head = () => ({
  schemaVersion: 1, datasetId: 'dataset-a', seq: 10, lastCommandId: null, maintenance: false,
  goLiveDate: '2026-10-01', updatedAt: ts('2026-10-01T00:00:00.000Z'),
});

function repository(extra: { pendingJournal?: CloudPendingJournal } = {}) {
  return createCloudDayCloseRepository(db, {
    currentUser: () => user(currentUid), recoveryReader: recoveryReader as never, ...extra,
  });
}

const ids = {
  close: '10000000-0000-4000-8000-000000000001',
  entry: '10000000-0000-4000-8000-000000000002',
  reopen: '10000000-0000-4000-8000-000000000003',
  opening: '10000000-0000-4000-8000-000000000004',
  ensure: '10000000-0000-4000-8000-000000000005',
  start: '10000000-0000-4000-8000-000000000006',
};

const intents: Array<{ intent: CloudDayCloseCommandIntent; canonical: Record<string, unknown> }> = [
  {
    intent: { kind: 'close-day', input: {
      commandId: ids.close, leaseEpoch: 7, dayId: '2026-10-20', expectedDayRevision: 5, expectedSettlementRevision: 2,
      expectedCash: 1170, countedCash: 1160, note: '找零少收',
    } },
    canonical: {
      commandId: ids.close, kind: 'CloseDay', leaseEpoch: 7,
      targets: { dayId: '2026-10-20', settlementRevision: 3 },
      expectedRevisions: { day: 5, settlement: 2 },
      payload: { countedCash: 1160, note: '找零少收', expectedCash: 1170 },
    },
  },
  {
    intent: { kind: 'close-day', input: {
      commandId: ids.close, leaseEpoch: 7, dayId: '2026-10-14', expectedDayRevision: 5, expectedSettlementRevision: 0,
      expectedCash: 950, countedCash: 950, note: '', alignWithDayId: null,
    } },
    canonical: {
      commandId: ids.close, kind: 'CloseDay', leaseEpoch: 7,
      targets: { dayId: '2026-10-14', settlementRevision: 1 },
      expectedRevisions: { day: 5, settlement: 0 },
      payload: { countedCash: 950, note: '', expectedCash: 950, alignWithDayId: null },
    },
  },
  {
    intent: { kind: 'record-post-close-entry', input: {
      commandId: ids.entry, leaseEpoch: 7, dayId: '2026-10-14', expectedDayRevision: 7, expectedSettlementRevision: 1,
      direction: 'expense', amount: 50, reason: '開店少 50 元',
    } },
    canonical: {
      commandId: ids.entry, kind: 'RecordPostCloseEntry', leaseEpoch: 7,
      targets: { dayId: '2026-10-14' },
      expectedRevisions: { day: 7, settlement: 1 },
      payload: { direction: 'expense', amount: 50, reason: '開店少 50 元' },
    },
  },
  {
    intent: { kind: 'reopen-day', input: {
      commandId: ids.reopen, leaseEpoch: 7, dayId: '2026-10-14', expectedDayRevision: 7, expectedSettlementRevision: 1,
      reason: '補登漏記',
    } },
    canonical: {
      commandId: ids.reopen, kind: 'ReopenDay', leaseEpoch: 7,
      targets: { dayId: '2026-10-14', settlementRevision: 2 },
      expectedRevisions: { day: 7, settlement: 1 },
      payload: { reason: '補登漏記' },
    },
  },
  {
    intent: { kind: 'backfill-opening', input: {
      commandId: ids.opening, leaseEpoch: 7, dayId: '2026-10-14', expectedDayRevision: 1, openingCash: 870, reason: '那天斷線',
    } },
    canonical: {
      commandId: ids.opening, kind: 'BackfillOpeningCash', leaseEpoch: 7,
      targets: { dayId: '2026-10-14' },
      expectedRevisions: { day: 1 },
      payload: { openingCash: 870, reason: '那天斷線' },
    },
  },
  {
    intent: { kind: 'ensure-day', input: { commandId: ids.ensure, leaseEpoch: 7, dayId: '2026-10-14' } },
    canonical: {
      commandId: ids.ensure, kind: 'EnsureDay', leaseEpoch: 7,
      targets: { dayId: '2026-10-14' },
      expectedRevisions: { day: 0 },
      payload: { businessDate: '2026-10-14' },
    },
  },
  {
    intent: { kind: 'start-backfill', input: {
      commandId: ids.start, leaseEpoch: 7, dayId: '2026-10-14', expectedDayRevision: 2, reason: '那天斷線',
    } },
    canonical: {
      commandId: ids.start, kind: 'StartBackfill', leaseEpoch: 7,
      targets: { dayId: '2026-10-14' },
      expectedRevisions: { day: 2 },
      payload: { reason: '那天斷線' },
    },
  },
];

function legacyCall(subject: ReturnType<typeof repository>, intent: CloudDayCloseCommandIntent) {
  if (intent.kind === 'close-day') return subject.closeDay(intent.input);
  if (intent.kind === 'record-post-close-entry') return subject.recordPostCloseEntry(intent.input);
  if (intent.kind === 'reopen-day') return subject.reopenDay(intent.input);
  if (intent.kind === 'backfill-opening') return subject.backfillOpening(intent.input);
  if (intent.kind === 'ensure-day') return subject.ensureDay(intent.input);
  return subject.startBackfill(intent.input);
}

/** Server days for the nearest-opened-day preflight; ids are the document IDs under `days`. */
function serveDays(days: string[], reads: { order: string[] }) {
  firestoreMocks.documentId.mockReturnValue('__name__');
  firestoreMocks.doc.mockImplementation((_db: unknown, path: string) => ({ path }));
  firestoreMocks.collection.mockImplementation((_db: unknown, path: string) => ({ path }));
  firestoreMocks.where.mockImplementation((field: unknown, op: string, value: unknown) => ({ type: 'where', field, op, value }));
  firestoreMocks.orderBy.mockImplementation(() => ({ type: 'orderBy' }));
  firestoreMocks.startAfter.mockImplementation(() => ({ type: 'startAfter' }));
  firestoreMocks.limit.mockImplementation((count: number) => ({ type: 'limit', count }));
  firestoreMocks.query.mockImplementation((collectionRef: { path: string }, ...constraints: Array<{ type: string; op?: string; value?: unknown }>) => ({ collectionRef, constraints }));
  firestoreMocks.getDocFromServer.mockImplementation(async (ref: { path: string }) => {
    reads.order.push(`doc:${ref.path}`);
    const value = ref.path === 'system/dataHead' ? head()
      : ref.path === 'system/accessLease' ? { holderUid: currentUid, epoch: 7, updatedAt: ts('2026-10-17T02:00:00.000Z') }
        : undefined;
    return { id: ref.path.split('/').at(-1), exists: () => value !== undefined, data: () => value, metadata: { fromCache: false, hasPendingWrites: false } };
  });
  firestoreMocks.getDocsFromServer.mockImplementation(async (request: { collectionRef: { path: string }; constraints: Array<{ type: string; op?: string; value?: unknown }> }) => {
    reads.order.push(`docs:${request.collectionRef.path}`);
    let selected = [...days].sort();
    for (const item of request.constraints) {
      if (item.type !== 'where') continue;
      const value = String(item.value);
      selected = selected.filter(id => (item.op === '>' ? id > value : item.op === '<=' ? id <= value : item.op === '>=' ? id >= value : item.op === '<' ? id < value : true));
    }
    const docs = selected.map(id => ({
      id,
      data: () => ({
        status: 'open', revision: 3, menu: null, openingCash: 950, openedBy: null, openedAt: null,
        totals: totals(), lastSettlementRevision: 0, lastCommandId: 'c', updatedAt: ts('2026-10-01T00:00:00.000Z'),
      }),
      metadata: { fromCache: false, hasPendingWrites: false },
    }));
    return { size: docs.length, docs, metadata: { fromCache: false, hasPendingWrites: false } };
  });
}

describe('CloudDayCloseRepository recovery intent mapping', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    currentUid = 'uid-a';
    commands.commitCommand.mockResolvedValue({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
    commands.confirmPendingIntent.mockResolvedValue({ status: 'not-found' });
    commands.cleanupConfirmedIntent.mockResolvedValue(true);
    commands.readCommand.mockResolvedValue(null);
  });

  it.each(intents)('proves a receipt with the canonical mapping and no write or business preflight: $intent.kind', async ({ intent, canonical }) => {
    await repository().confirmPendingIntent(intent, 'dataset-a', 'uid-a');
    expect(commands.confirmPendingIntent).toHaveBeenCalledWith(canonical, 7, 'dataset-a', 'uid-a', recoveryReader);
    // A pure receipt proof never commits and never runs the alignment or previous-day business preflight.
    expect(commands.commitCommand).not.toHaveBeenCalled();
    expect(commands.readCommand).not.toHaveBeenCalled();
    expect(firestoreMocks.getDocsFromServer).not.toHaveBeenCalled();
    expect(firestoreMocks.getDocFromServer).not.toHaveBeenCalled();
  });

  it.each(intents)('writes the same canonical command through the typed intent and the typed method: $intent.kind', async ({ intent, canonical }) => {
    // No later opened day exists, so an aligned close with a null alignment passes its preflight.
    serveDays([], { order: [] });
    const subject = repository();
    await subject.commitDayCloseIntent(intent);
    expect(commands.commitCommand).toHaveBeenNthCalledWith(1, canonical);
    await legacyCall(subject, intent);
    expect(commands.commitCommand).toHaveBeenNthCalledWith(2, canonical);
  });

  it('keeps the receipt-aware nearest-next-opened-day alignment preflight for actual close writes', async () => {
    const subject = repository();
    const aligned: CloudDayCloseCommandIntent = { kind: 'close-day', input: {
      commandId: ids.close, leaseEpoch: 7, dayId: '2026-10-14', expectedDayRevision: 5, expectedSettlementRevision: 0,
      expectedCash: 950, countedCash: 950, note: '', alignWithDayId: '2026-10-16',
    } };
    const reads = { order: [] as string[] };
    serveDays(['2026-10-15', '2026-10-16'], reads);
    const refused = await subject.commitDayCloseIntent(aligned);
    expect(refused).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
    expect(commands.commitCommand).not.toHaveBeenCalled();

    serveDays(['2026-10-16'], reads);
    await subject.commitDayCloseIntent(aligned);
    expect(commands.commitCommand).toHaveBeenCalledOnce();

    commands.commitCommand.mockClear();
    serveDays(['2026-10-15'], reads);
    commands.readCommand.mockResolvedValue({ commandId: ids.close });
    await subject.commitDayCloseIntent(aligned);
    expect(commands.commitCommand).toHaveBeenCalledOnce();
  });

  it('returns invalid normalized input as a command result and never commits it', async () => {
    const subject = repository();
    const result = await subject.commitDayCloseIntent({ kind: 'reopen-day', input: {
      commandId: ids.reopen, leaseEpoch: 7, dayId: '2026-10-14', expectedDayRevision: 7, expectedSettlementRevision: 1,
      reason: 'x'.repeat(501),
    } });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(commands.commitCommand).not.toHaveBeenCalled();
  });

  it('turns an invalid expected intent into a read error instead of a business result', async () => {
    const subject = repository();
    await expect(subject.confirmPendingIntent({ kind: 'reopen-day', input: {
      commandId: ids.reopen, leaseEpoch: 7, dayId: '2026-10-14', expectedDayRevision: 7, expectedSettlementRevision: 1,
      reason: 'x'.repeat(501),
    } }, 'dataset-a', 'uid-a')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(commands.confirmPendingIntent).not.toHaveBeenCalled();
    expect(CloudCommandReadError).toBeDefined();
  });

  it('delegates exact confirmed cleanup to the shared command boundary', async () => {
    const subject = repository();
    const isCurrent = vi.fn(() => true);
    await subject.cleanupConfirmedIntent(intents[2].intent, 'dataset-a', 'uid-a', isCurrent);
    expect(commands.cleanupConfirmedIntent).toHaveBeenCalledWith(
      intents[2].canonical, 7, 'dataset-a', 'uid-a', recoveryReader, isCurrent,
    );
  });
});

describe('CloudDayCloseRepository commit guard', () => {
  const aligned: CloudDayCloseCommandIntent = { kind: 'close-day', input: {
    commandId: ids.close, leaseEpoch: 7, dayId: '2026-10-14', expectedDayRevision: 5, expectedSettlementRevision: 0,
    expectedCash: 950, countedCash: 950, note: '', alignWithDayId: '2026-10-16',
  } };

  beforeEach(() => {
    vi.resetAllMocks();
    currentUid = 'uid-a';
    commands.commitCommand.mockResolvedValue({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'unknown' } });
    commands.readCommand.mockResolvedValue(null);
  });

  it('asks the guard after the alignment preflight awaits and before entering the commit', async () => {
    const reads = { order: [] as string[] };
    serveDays(['2026-10-16'], reads);
    const guard = vi.fn(async () => {
      reads.order.push('guard');
      return true;
    });
    await repository().commitDayCloseIntent(aligned, guard);
    expect(guard).toHaveBeenCalledOnce();
    expect(reads.order.at(-1)).toBe('guard');
    expect(reads.order.filter(entry => entry.startsWith('docs:')).length).toBeGreaterThan(0);
    expect(commands.commitCommand).toHaveBeenCalledOnce();
  });

  it('does not commit when the guard rejects after the preflight, and says nothing was sent', async () => {
    const reads = { order: [] as string[] };
    serveDays(['2026-10-16'], reads);
    await expect(repository().commitDayCloseIntent(aligned, () => false)).rejects.toBeInstanceOf(CloudDayCloseGuardRejected);
    expect(commands.commitCommand).not.toHaveBeenCalled();
  });

  it('guards every intent kind immediately before the commit', async () => {
    const reads = { order: [] as string[] };
    serveDays([], reads);
    for (const { intent } of intents.filter(item => item.intent.kind !== 'close-day')) {
      await expect(repository().commitDayCloseIntent(intent, () => false)).rejects.toBeInstanceOf(CloudDayCloseGuardRejected);
    }
    expect(commands.commitCommand).not.toHaveBeenCalled();
  });

  it('rejects instead of borrowing a new UID when the signed-in user changes during the preflight', async () => {
    const reads = { order: [] as string[] };
    serveDays(['2026-10-16'], reads);
    firestoreMocks.getDocsFromServer.mockImplementationOnce(async () => {
      currentUid = 'uid-b';
      return { size: 1, docs: [{ id: '2026-10-16', data: () => ({
        status: 'open', revision: 3, menu: null, openingCash: 950, openedBy: null, openedAt: null,
        totals: totals(), lastSettlementRevision: 0, lastCommandId: 'c', updatedAt: ts('2026-10-01T00:00:00.000Z'),
      }), metadata: { fromCache: false, hasPendingWrites: false } }], metadata: { fromCache: false, hasPendingWrites: false } };
    });
    await expect(repository().commitDayCloseIntent(aligned)).rejects.toBeInstanceOf(CloudDayCloseGuardRejected);
    expect(commands.commitCommand).not.toHaveBeenCalled();
  });
});

describe('CloudDayCloseRepository other pending identities', () => {
  const journal = (records: Array<{ commandId: string; datasetId: string; uid: string }> | Error) => ({
    readAll: vi.fn(async () => {
      if (records instanceof Error) throw records;
      return { records, total: records.length, complete: true as const };
    }),
  }) as unknown as CloudPendingJournal;
  const record = (commandId: string) => ({ commandId, datasetId: 'dataset-a', uid: 'uid-a' });

  beforeEach(() => vi.resetAllMocks());

  it('is false only when the journal holds nothing but the operation\'s own identity', async () => {
    expect(await repository({ pendingJournal: journal([]) }).hasOtherUnresolvedCommands(ids.close)).toBe(false);
    expect(await repository({ pendingJournal: journal([record(ids.close)]) }).hasOtherUnresolvedCommands(ids.close)).toBe(false);
  });

  it('blocks on any other identity and on an unreadable journal, and never clears anything', async () => {
    const other = journal([record(ids.close), record(ids.entry)]);
    expect(await repository({ pendingJournal: other }).hasOtherUnresolvedCommands(ids.close)).toBe(true);
    const unreadable = journal(new Error('journal unavailable'));
    expect(await repository({ pendingJournal: unreadable }).hasOtherUnresolvedCommands(ids.close)).toBe(true);
    expect(commands.cleanupConfirmedIntent).not.toHaveBeenCalled();
  });
});
