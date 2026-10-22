import { Timestamp, type Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { fingerprintCommandInput, normalizeEnabledCommandInput, type EnabledCloudCommandInput } from '../../domain/cloudCommandSchema';
import { describe, expect, it, vi } from 'vitest';
import { createCloudCommandRepository } from '../cloudCommandRepository';
import { createCloudPendingJournal, createMemoryCloudPendingJournalTestAdapter } from '../cloudPendingJournal';
import type {
  CloudRecoveryReader,
  RecoveryDocumentSnapshot,
} from '../cloudRecoveryReader';
import { CloudRecoveryReaderError } from '../cloudRecoveryReader';

const fullSdk = vi.hoisted(() => ({ serverRead: vi.fn(), transaction: vi.fn() }));

vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return { ...actual, getDocFromServer: fullSdk.serverRead, runTransaction: fullSdk.transaction };
});

const userA = {
  uid: 'recovery-owner-a', email: 'owner-a@example.test', emailVerified: true,
  providerData: [{ providerId: 'google.com' }],
} as unknown as User;
const userB = {
  uid: 'recovery-owner-b', email: 'owner-b@example.test', emailVerified: true,
  providerData: [{ providerId: 'google.com' }],
} as unknown as User;
const db = { app: { name: 'recovery-command-test' } } as unknown as Firestore;
const stamp = Timestamp.fromMillis(1_800_000_000_123);

function document(data: unknown, exists = true): RecoveryDocumentSnapshot {
  return { exists: () => exists, data: () => data, metadata: { fromCache: false, hasPendingWrites: false } };
}

function context(options: { datasetId?: string; epoch?: number; holderUid?: string; email?: string } = {}) {
  return {
    head: document({
      schemaVersion: 1, datasetId: options.datasetId ?? 'recovery-dataset', seq: 4,
      lastCommandId: null, maintenance: false, goLiveDate: '2026-01-01', updatedAt: stamp,
    }),
    lease: document({ holderUid: options.holderUid ?? userA.uid, epoch: options.epoch ?? 2, updatedAt: stamp }),
    operator: document({ uid: userA.uid, email: options.email ?? userA.email, active: true }),
  };
}

function reader(options: {
  getContext?: (readNumber: number) => ReturnType<typeof context>;
  readReceipt?: () => Promise<RecoveryDocumentSnapshot>;
  assertCurrent?: () => void;
} = {}) {
  let contextReads = 0;
  const getContext = options.getContext ?? (() => context());
  const recoveryReader: CloudRecoveryReader = {
    assertCurrent: options.assertCurrent ?? vi.fn(),
    readHead: vi.fn(async () => getContext(++contextReads).head),
    readLease: vi.fn(async () => contextReads === 0 ? getContext(1).lease : getContext(contextReads).lease),
    readOperator: vi.fn(async () => contextReads === 0 ? getContext(1).operator : getContext(contextReads).operator),
    readCommandReceipt: options.readReceipt ?? vi.fn(async () => document(undefined, false)),
  };
  return recoveryReader;
}

function repository(currentUser: () => User | null) {
  return createCloudCommandRepository(db, { currentUser });
}

const pendingIdentity = { commandId: '00000000-0000-4000-8000-000000000001', datasetId: 'recovery-dataset', uid: userA.uid };

const studentIntent = {
  commandId: pendingIdentity.commandId,
  kind: 'CreateStudent' as const,
  leaseEpoch: 2,
  targets: { studentId: '10000000-0000-4000-8000-000000000001' },
  expectedRevisions: { student: 0 as const },
  payload: {
    studentCode: '001', displayName: '原學生', aliases: [],
    openingBalance: { amount: 0, asOfDate: '2026-01-01', note: '' },
  },
};

async function storedStudentReceipt(
  input: Extract<EnabledCloudCommandInput, { kind: 'CreateStudent' }> = studentIntent,
) {
  const canonical = normalizeEnabledCommandInput(input);
  if (canonical.kind !== 'CreateStudent') throw new Error('Test fixture requires a CreateStudent command');
  const headBefore = {
    schemaVersion: 1, datasetId: 'recovery-dataset', seq: 4,
    lastCommandId: '00000000-0000-4000-8000-000000000002', maintenance: false,
    goLiveDate: '2026-01-01', updatedAt: stamp,
  };
  const headAfter = { ...headBefore, seq: 5, lastCommandId: input.commandId };
  const studentAfter = {
    studentId: input.targets.studentId, studentCode: canonical.payload.studentCode,
    displayName: canonical.payload.displayName, aliases: canonical.payload.aliases, status: 'active',
    openingBalance: { ...canonical.payload.openingBalance, createdAt: stamp },
    currentBalance: canonical.payload.openingBalance.amount, createdAt: stamp,
    revision: 1, lastCommandId: input.commandId, updatedAt: stamp,
  };
  return {
    commandId: input.commandId, kind: 'CreateStudent', seq: 5, leaseEpoch: 2,
    actor: { uid: userA.uid, email: userA.email }, committedAt: stamp,
    businessDate: null, studentId: input.targets.studentId,
    targets: canonical.targets, expectedRevisions: canonical.expectedRevisions,
    before: { head: headBefore, student: null }, after: { head: headAfter, student: studentAfter },
    reason: null, cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
    payload: canonical.payload, inputFingerprint: await fingerprintCommandInput(canonical),
  };
}

function editStudentIntent(expectedRevision = 1, aliases: string[] = ['編輯別名']) {
  return {
    ...studentIntent,
    kind: 'EditStudent' as const,
    expectedRevisions: { student: expectedRevision },
    payload: { displayName: 'edited name', aliases },
  };
}

async function storedStudentEditReceipt(input = editStudentIntent()) {
  const seed = await storedStudentReceipt();
  const canonical = normalizeEnabledCommandInput(input);
  if (canonical.kind !== 'EditStudent') throw new Error('Test fixture requires an EditStudent command');
  const beforeStudent = seed.after.student;
  const afterStudent = {
    ...beforeStudent,
    displayName: canonical.payload.displayName ?? beforeStudent.displayName,
    aliases: canonical.payload.aliases ?? beforeStudent.aliases,
    revision: 2,
  };
  return {
    ...seed,
    kind: 'EditStudent',
    payload: canonical.payload,
    expectedRevisions: canonical.expectedRevisions,
    before: { head: seed.before.head, student: beforeStudent },
    after: { head: seed.after.head, student: afterStudent },
    inputFingerprint: await fingerprintCommandInput(canonical),
  };
}

describe('Orders recovery reader seam reuses strict command recovery checks', () => {
  it('confirms a real absence only after two Lite contexts and never touches full SDK reads', async () => {
    fullSdk.serverRead.mockReset();
    const recoveryReader = reader();
    const commands = repository(() => userA);

    await expect(commands.confirmPending(pendingIdentity, 2, recoveryReader)).resolves.toEqual({ status: 'not-found' });
    expect(recoveryReader.readHead).toHaveBeenCalledTimes(2);
    expect(recoveryReader.readLease).toHaveBeenCalledTimes(2);
    expect(recoveryReader.readOperator).toHaveBeenCalledTimes(2);
    expect(recoveryReader.readCommandReceipt).toHaveBeenCalledTimes(1);
    expect(fullSdk.serverRead).not.toHaveBeenCalled();
  });

  it('confirms an original Student intent read-only through Lite and checks all semantic fields', async () => {
    fullSdk.serverRead.mockReset();
    fullSdk.transaction.mockReset();
    const stored = await storedStudentReceipt();
    const recoveryReader = reader({ readReceipt: vi.fn(async () => document(stored)) });
    const commands = repository(() => userA);

    await expect(commands.confirmPendingIntent(studentIntent, 2, 'recovery-dataset', userA.uid, recoveryReader))
      .resolves.toMatchObject({ status: 'matched', receipt: { commandId: studentIntent.commandId, kind: 'CreateStudent' } });
    expect(recoveryReader.readHead).toHaveBeenCalledTimes(2);
    expect(recoveryReader.readCommandReceipt).toHaveBeenCalledTimes(1);
    expect(fullSdk.serverRead).not.toHaveBeenCalled();
    expect(fullSdk.transaction).not.toHaveBeenCalled();

    const changedPayload = { ...studentIntent, payload: { ...studentIntent.payload, displayName: '另一個姓名' } };
    await expect(commands.confirmPendingIntent(changedPayload, 2, 'recovery-dataset', userA.uid, recoveryReader))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(fullSdk.transaction).not.toHaveBeenCalled();
  });

  it('cleans only the proven pending identity after network proof and evaluates the lock predicate synchronously', async () => {
    fullSdk.serverRead.mockReset();
    fullSdk.transaction.mockReset();
    const stored = await storedStudentReceipt();
    const recoveryReader = reader({ readReceipt: vi.fn(async () => document(stored)) });
    const removeIf = vi.fn(async (_record: unknown, canRemove: () => boolean) => canRemove());
    const commands = createCloudCommandRepository(db, {
      currentUser: () => userA,
      pendingJournal: { removeIf } as never,
    });
    const isCurrent = vi.fn(() => true);

    await expect(commands.cleanupConfirmedIntent(studentIntent, 2, 'recovery-dataset', userA.uid, recoveryReader, isCurrent))
      .resolves.toBe(true);
    expect(removeIf).toHaveBeenCalledOnce();
    expect(removeIf).toHaveBeenCalledWith({
      commandId: studentIntent.commandId,
      datasetId: 'recovery-dataset',
      uid: userA.uid,
    }, expect.any(Function));
    expect(isCurrent).toHaveBeenCalledOnce();
    expect(recoveryReader.readHead).toHaveBeenCalledTimes(2);
    expect(fullSdk.serverRead).not.toHaveBeenCalled();
    expect(fullSdk.transaction).not.toHaveBeenCalled();
  });

  it('passes the exact captured command identity to journal removal after the caller input mutates', async () => {
    const input = JSON.parse(JSON.stringify(studentIntent)) as Record<string, unknown>;
    const stored = await storedStudentReceipt();
    const recordA = { ...pendingIdentity };
    const recordB = { ...pendingIdentity, commandId: '00000000-0000-4000-8000-000000000099' };
    const recoveryReader = reader({ readReceipt: async () => {
      Object.assign(input, {
        commandId: recordB.commandId,
        kind: 'EditStudent',
        targets: { studentId: '10000000-0000-4000-8000-000000000099' },
        expectedRevisions: { student: 1 },
        payload: { displayName: '另一個操作' },
      });
      return document(stored);
    } });
    const removeIf = vi.fn(async (_record: unknown, canRemove: () => boolean) => canRemove());
    const commands = createCloudCommandRepository(db, {
      currentUser: () => userA,
      pendingJournal: { removeIf } as never,
    });

    await expect(commands.cleanupConfirmedIntent(input, 2, 'recovery-dataset', userA.uid, recoveryReader, () => true))
      .resolves.toBe(true);

    expect(removeIf).toHaveBeenCalledWith(recordA, expect.any(Function));
  });

  it('removes only receipt-confirmed A and retains unrelated journal B when input mutates during the read', async () => {
    const input = JSON.parse(JSON.stringify(studentIntent)) as Record<string, unknown>;
    const stored = await storedStudentReceipt();
    const recordA = { ...pendingIdentity };
    const recordB = { ...pendingIdentity, commandId: '00000000-0000-4000-8000-000000000099' };
    const journal = createCloudPendingJournal(db, createMemoryCloudPendingJournalTestAdapter());
    await journal.put(recordA);
    await journal.put(recordB);
    const recoveryReader = reader({ readReceipt: async () => {
      Object.assign(input, {
        commandId: recordB.commandId,
        kind: 'EditStudent',
        targets: { studentId: '10000000-0000-4000-8000-000000000099' },
        expectedRevisions: { student: 1 },
        payload: { displayName: '另一個操作' },
      });
      return document(stored);
    } });
    const commands = createCloudCommandRepository(db, { currentUser: () => userA, pendingJournal: journal });

    await expect(commands.cleanupConfirmedIntent(input, 2, 'recovery-dataset', userA.uid, recoveryReader, () => true))
      .resolves.toBe(true);

    await expect(journal.readAll()).resolves.toMatchObject({ records: [recordB], total: 1, complete: true });
  });

  it.each(['reader error', 'Auth change', 'reader pair change', 'unmount'] as const)(
    'preserves journal A and B when cleanup loses authority during %s', async failure => {
      const recordA = { ...pendingIdentity };
      const recordB = { ...pendingIdentity, commandId: '00000000-0000-4000-8000-000000000099' };
      const journal = createCloudPendingJournal(db, createMemoryCloudPendingJournalTestAdapter());
      await journal.put(recordA);
      await journal.put(recordB);
      const stored = await storedStudentReceipt();
      let currentUser: User | null = userA;
      let pairCurrent = true;
      let mounted = true;
      const recoveryReader = reader({
        assertCurrent: () => {
          if (failure === 'reader pair change' && !pairCurrent) {
            throw new CloudRecoveryReaderError('UNSUPPORTED_SCHEMA', 'reader pair changed');
          }
        },
        readReceipt: async () => {
          if (failure === 'reader error') throw new Error('receipt read failed');
          if (failure === 'Auth change') currentUser = userB;
          if (failure === 'reader pair change') pairCurrent = false;
          if (failure === 'unmount') mounted = false;
          return document(stored);
        },
      });
      const commands = createCloudCommandRepository(db, {
        currentUser: () => currentUser,
        pendingJournal: journal,
      });
      const cleanup = commands.cleanupConfirmedIntent(
        studentIntent, 2, 'recovery-dataset', userA.uid, recoveryReader, () => mounted,
      );

      if (failure === 'unmount') await expect(cleanup).resolves.toBe(false);
      else await expect(cleanup).rejects.toHaveProperty('code');
      await expect(journal.readAll()).resolves.toMatchObject({ records: [recordA, recordB], total: 2, complete: true });
    },
  );

  it('only reports absence for the expected dataset and stops retry authorization during maintenance', async () => {
    const wrongDataset = reader({ getContext: () => context({ datasetId: 'replacement-dataset' }) });
    const commands = repository(() => userA);
    await expect(commands.confirmPendingIntent(studentIntent, 2, 'recovery-dataset', userA.uid, wrongDataset))
      .resolves.toEqual({ status: 'different-dataset' });
    expect(wrongDataset.readCommandReceipt).not.toHaveBeenCalled();

    const maintenanceReader = reader({
      getContext: readNumber => ({
        ...context(),
        head: document({
          schemaVersion: 1, datasetId: 'recovery-dataset', seq: 4, lastCommandId: null,
          maintenance: readNumber === 1, goLiveDate: '2026-01-01', updatedAt: stamp,
        }),
      }),
    });
    await expect(commands.confirmPendingIntent(studentIntent, 2, 'recovery-dataset', userA.uid, maintenanceReader))
      .rejects.toMatchObject({ code: 'MAINTENANCE' });
    expect(maintenanceReader.readHead).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed, wrong-epoch, changed-Auth and changed-pair original intents before authorizing absence', async () => {
    const commands = repository(() => userA);
    const recoveryReader = reader();
    await expect(commands.confirmPendingIntent({ ...studentIntent, payload: { displayName: '欠欄位' } }, 2, 'recovery-dataset', userA.uid, recoveryReader))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(commands.confirmPendingIntent({ ...studentIntent, leaseEpoch: 3 }, 2, 'recovery-dataset', userA.uid, recoveryReader))
      .rejects.toMatchObject({ code: 'LEASE_LOST' });
    await expect(commands.confirmPendingIntent(studentIntent, 2, 'recovery-dataset', userB.uid, recoveryReader))
      .rejects.toMatchObject({ code: 'LEASE_LOST' });
    expect(recoveryReader.readCommandReceipt).not.toHaveBeenCalled();

    let currentUser: User | null = userA;
    const authReader = reader({ readReceipt: async () => {
      currentUser = userB;
      return document(undefined, false);
    } });
    await expect(repository(() => currentUser).confirmPendingIntent(studentIntent, 2, 'recovery-dataset', userA.uid, authReader))
      .rejects.toMatchObject({ code: 'LEASE_LOST' });

    let assertions = 0;
    const pairReader = reader({ assertCurrent: () => {
      assertions += 1;
      if (assertions === 5) throw new CloudRecoveryReaderError('UNSUPPORTED_SCHEMA', 'pair changed during semantic hashing');
    }, readReceipt: async () => document(await storedStudentReceipt()) });
    await expect(commands.confirmPendingIntent(studentIntent, 2, 'recovery-dataset', userA.uid, pairReader))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
  });

  it('rejects a UID change while recovery context reads are awaiting the reader', async () => {
    let resolveHead!: (value: RecoveryDocumentSnapshot) => void;
    const recoveryReader = reader();
    (recoveryReader.readHead as ReturnType<typeof vi.fn>).mockReturnValueOnce(new Promise(resolve => { resolveHead = resolve; }));
    let currentUser: User | null = userA;
    const commands = repository(() => currentUser);
    const pending = commands.getPendingRecoveryContext(2, recoveryReader);

    await vi.waitFor(() => expect(recoveryReader.readHead).toHaveBeenCalledOnce());
    currentUser = userB;
    resolveHead(context().head);

    await expect(pending).rejects.toMatchObject({ code: 'LEASE_LOST' });
    expect(recoveryReader.readCommandReceipt).not.toHaveBeenCalled();
  });

  it('rejects dataset and lease epoch changes across before and after contexts', async () => {
    const datasetReader = reader({ getContext: readNumber => (
      context(readNumber === 1 ? {} : { datasetId: 'replacement-dataset' })
    ) });
    const datasetChanged = repository(() => userA);
    await expect(datasetChanged.confirmPending(pendingIdentity, 2, datasetReader)).rejects.toMatchObject({ code: 'LEASE_LOST' });

    const epochReader = reader({ getContext: readNumber => (
      context(readNumber === 1 ? {} : { epoch: 3 })
    ) });
    const epochChanged = repository(() => userA);
    await expect(epochChanged.confirmPending(pendingIdentity, 2, epochReader)).rejects.toMatchObject({ code: 'LEASE_LOST' });
  });

  it('fails closed if the registered pair generation changes during a Lite read', async () => {
    let assertions = 0;
    const recoveryReader = reader({ assertCurrent: () => {
      assertions += 1;
      if (assertions === 3) throw new CloudRecoveryReaderError('UNSUPPORTED_SCHEMA', 'pair changed');
    } });
    const commands = repository(() => userA);

    await expect(commands.getPendingRecoveryContext(2, recoveryReader)).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
    expect(recoveryReader.readHead).toHaveBeenCalledOnce();
    expect(recoveryReader.readCommandReceipt).not.toHaveBeenCalled();
  });

  it.each([
    ['permission-denied', 'LEASE_LOST'],
    ['resource-exhausted', 'QUOTA_EXCEEDED'],
    ['unavailable', 'UNKNOWN_RESULT'],
  ])('preserves %s instead of treating it as an absent receipt', async (wireCode, expectedCode) => {
    const failure = Object.assign(new Error(`reader failed: ${wireCode}`), { code: wireCode });
    const recoveryReader = reader({ readReceipt: async () => { throw failure; } });
    const commands = repository(() => userA);

    await expect(commands.confirmPending(pendingIdentity, 2, recoveryReader)).rejects.toMatchObject({ code: expectedCode });
  });

  it('rejects an expected revision changed only by a nested serialization hook', async () => {
    const seed = await storedStudentReceipt();
    const edit = {
      ...studentIntent,
      kind: 'EditStudent' as const,
      expectedRevisions: { student: 1 },
      payload: { displayName: 'edited name' },
    };
    const canonical = normalizeEnabledCommandInput(edit);
    const beforeStudent = { ...seed.after.student };
    const afterStudent = { ...beforeStudent, displayName: 'edited name', revision: 2 };
    const stored = {
      ...seed,
      kind: 'EditStudent',
      payload: canonical.payload,
      expectedRevisions: canonical.expectedRevisions,
      before: { head: seed.before.head, student: beforeStudent },
      after: { head: seed.after.head, student: afterStudent },
      inputFingerprint: await fingerprintCommandInput(canonical),
    };
    const recoveryReader = reader({ readReceipt: vi.fn(async () => document(stored)) });
    const commands = repository(() => userA);

    await expect(commands.confirmPendingIntent(edit, 2, 'recovery-dataset', userA.uid, recoveryReader))
      .resolves.toMatchObject({ status: 'matched' });
    const wrong = { ...edit, expectedRevisions: { student: 2 } };
    await expect(commands.confirmPendingIntent(wrong, 2, 'recovery-dataset', userA.uid, recoveryReader))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });

    let hookCalls = 0;
    Object.defineProperty(wrong.expectedRevisions, 'toJSON', {
      enumerable: false,
      value() {
        hookCalls += 1;
        return { student: 1 };
      },
    });
    expect(normalizeEnabledCommandInput(wrong).expectedRevisions).toEqual({ student: 2 });

    await expect(commands.confirmPendingIntent(wrong, 2, 'recovery-dataset', userA.uid, recoveryReader))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(hookCalls).toBe(0);
  });

  it('does not clear a journal identity when a nested serialization hook replaces its revision semantics', async () => {
    const seed = await storedStudentReceipt();
    const edit = {
      ...studentIntent,
      kind: 'EditStudent' as const,
      expectedRevisions: { student: 1 },
      payload: { displayName: 'edited name' },
    };
    const canonical = normalizeEnabledCommandInput(edit);
    const beforeStudent = { ...seed.after.student };
    const afterStudent = { ...beforeStudent, displayName: 'edited name', revision: 2 };
    const stored = {
      ...seed,
      kind: 'EditStudent',
      payload: canonical.payload,
      expectedRevisions: canonical.expectedRevisions,
      before: { head: seed.before.head, student: beforeStudent },
      after: { head: seed.after.head, student: afterStudent },
      inputFingerprint: await fingerprintCommandInput(canonical),
    };
    const recoveryReader = reader({ readReceipt: vi.fn(async () => document(stored)) });
    const journal = createCloudPendingJournal(db, createMemoryCloudPendingJournalTestAdapter());
    const recordB = { ...pendingIdentity, commandId: '00000000-0000-4000-8000-000000000099' };
    await journal.put(pendingIdentity);
    await journal.put(recordB);
    const commands = createCloudCommandRepository(db, { currentUser: () => userA, pendingJournal: journal });

    const wrong = { ...edit, expectedRevisions: { student: 2 } };
    await expect(commands.confirmPendingIntent(wrong, 2, 'recovery-dataset', userA.uid, recoveryReader))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    let hookCalls = 0;
    Object.defineProperty(wrong.expectedRevisions, 'toJSON', {
      enumerable: false,
      value() {
        hookCalls += 1;
        return { student: 1 };
      },
    });
    expect(normalizeEnabledCommandInput(wrong).expectedRevisions).toEqual({ student: 2 });

    await expect(commands.cleanupConfirmedIntent(wrong, 2, 'recovery-dataset', userA.uid, recoveryReader, () => true))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(hookCalls).toBe(0);
    await expect(journal.readAll()).resolves.toMatchObject({ records: [pendingIdentity, recordB], total: 2, complete: true });
  });

  it('rejects a nested accessor descriptor without invoking it', async () => {
    const revisions: Record<string, unknown> = { student: 2 };
    let hookCalls = 0;
    Object.defineProperty(revisions, 'toJSON', {
      enumerable: false,
      get() {
        hookCalls += 1;
        return () => ({ student: 1 });
      },
    });
    const recoveryReader = reader();
    const input = { ...editStudentIntent(2), expectedRevisions: revisions };
    const commands = repository(() => userA);

    await expect(commands.confirmPendingIntent(input, 2, 'recovery-dataset', userA.uid, recoveryReader))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(hookCalls).toBe(0);
    expect(recoveryReader.readCommandReceipt).not.toHaveBeenCalled();
  });

  it('does not invoke an inherited serialization hook while confirming normalized canonical data', async () => {
    const input = editStudentIntent();
    const stored = await storedStudentEditReceipt(input);
    const recoveryReader = reader({ readReceipt: vi.fn(async () => document(stored)) });
    const original = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
    let hookCalls = 0;
    Object.defineProperty(Object.prototype, 'toJSON', {
      configurable: true,
      value() {
        hookCalls += 1;
        return this;
      },
    });
    let outcome: unknown;
    try {
      outcome = await repository(() => userA).confirmPendingIntent(input, 2, 'recovery-dataset', userA.uid, recoveryReader);
    } catch (error) {
      outcome = error;
    } finally {
      if (original) Object.defineProperty(Object.prototype, 'toJSON', original);
      else Reflect.deleteProperty(Object.prototype, 'toJSON');
    }

    expect(outcome).toMatchObject({ status: 'matched' });
    expect(hookCalls).toBe(0);
  });

  it('retains a matched frozen intent with nested aliases, targets, and revisions', async () => {
    const input = editStudentIntent(1, ['凍結別名']);
    Object.freeze(input.payload.aliases);
    Object.freeze(input.payload);
    Object.freeze(input.targets);
    Object.freeze(input.expectedRevisions);
    Object.freeze(input);
    const stored = await storedStudentEditReceipt(input);
    const recoveryReader = reader({ readReceipt: vi.fn(async () => document(stored)) });

    await expect(repository(() => userA).confirmPendingIntent(input, 2, 'recovery-dataset', userA.uid, recoveryReader))
      .resolves.toMatchObject({ status: 'matched' });
  });

  it('keeps the detached canonical values and exact A cleanup when nested input mutates during the read', async () => {
    const input: Extract<EnabledCloudCommandInput, { kind: 'CreateStudent' }> = {
      ...studentIntent,
      targets: { ...studentIntent.targets },
      expectedRevisions: { student: 0 },
      payload: {
        ...studentIntent.payload,
        aliases: ['原始別名'],
        openingBalance: { ...studentIntent.payload.openingBalance },
      },
    };
    const sourceReceipt = await storedStudentReceipt(input);
    const stored = {
      ...sourceReceipt,
      targets: { ...sourceReceipt.targets },
      expectedRevisions: { ...sourceReceipt.expectedRevisions },
      payload: {
        ...sourceReceipt.payload,
        aliases: [...sourceReceipt.payload.aliases],
        openingBalance: { ...sourceReceipt.payload.openingBalance },
      },
      after: {
        ...sourceReceipt.after,
        head: { ...sourceReceipt.after.head },
        student: sourceReceipt.after.student && {
          ...sourceReceipt.after.student,
          aliases: [...sourceReceipt.after.student.aliases],
          openingBalance: { ...sourceReceipt.after.student.openingBalance },
        },
      },
    };
    const recordB = { ...pendingIdentity, commandId: '00000000-0000-4000-8000-000000000099' };
    const journal = createCloudPendingJournal(db, createMemoryCloudPendingJournalTestAdapter());
    await journal.put(pendingIdentity);
    await journal.put(recordB);
    const recoveryReader = reader({ readReceipt: async () => {
      input.targets.studentId = recordB.commandId;
      (input.expectedRevisions as { student: number }).student = 2;
      input.payload.studentCode = '999';
      input.payload.aliases[0] = '被修改別名';
      input.payload.openingBalance.amount = 12;
      return document(stored);
    } });
    const commands = createCloudCommandRepository(db, { currentUser: () => userA, pendingJournal: journal });

    await expect(commands.cleanupConfirmedIntent(input, 2, 'recovery-dataset', userA.uid, recoveryReader, () => true))
      .resolves.toBe(true);
    await expect(journal.readAll()).resolves.toMatchObject({ records: [recordB], total: 1, complete: true });
  });

  it('rejects unsupported nested attributes, cycles, sparse aliases, and class instances', async () => {
    const cyclicRevisions: Record<string, unknown> = { student: 1 };
    Object.defineProperty(cyclicRevisions, 'loop', { enumerable: false, value: cyclicRevisions });
    const sparseAliases = new Array<string>(1);
    const classRevisions = new (class { student = 1; })();
    const inputs = [
      { ...editStudentIntent(1), expectedRevisions: cyclicRevisions },
      { ...studentIntent, payload: { ...studentIntent.payload, aliases: sparseAliases } },
      { ...editStudentIntent(1), expectedRevisions: classRevisions },
    ];
    const commands = repository(() => userA);

    for (const input of inputs) {
      await expect(commands.confirmPendingIntent(input, 2, 'recovery-dataset', userA.uid, reader()))
        .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
  });
});
