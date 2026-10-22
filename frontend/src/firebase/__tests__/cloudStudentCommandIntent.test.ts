import type { Firestore } from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeEnabledCommandInput, type CanonicalEnabledInput } from '../../domain/cloudCommandSchema';
import type { CloudStudentCommandIntent } from '../cloudStudentRepository';
import type { CloudRecoveryReader } from '../cloudRecoveryReader';
import { createCloudStudentRepository } from '../cloudStudentRepository';

const commandRepository = vi.hoisted(() => ({
  commitCommand: vi.fn(async () => ({ ok: false, error: { code: 'UNKNOWN_RESULT', message: 'test' } })),
  confirmPendingIntent: vi.fn(async () => ({ status: 'not-found' })),
  cleanupConfirmedIntent: vi.fn(async () => undefined),
}));

vi.mock('../cloudCommandRepository', () => ({
  createCloudCommandRepository: vi.fn(() => commandRepository),
}));

const db = { app: { name: 'student-intent-test' } } as unknown as Firestore;
const recoveryReader = { assertCurrent: vi.fn() } as unknown as CloudRecoveryReader;
const scope = { datasetId: 'student-intent-dataset', uid: 'student-intent-operator' };

type StudentRepository = ReturnType<typeof createCloudStudentRepository>;

interface IntentCase {
  name: string;
  intent: CloudStudentCommandIntent;
  expected: CanonicalEnabledInput;
  commit: (repository: StudentRepository) => Promise<unknown>;
}

const intentCases: IntentCase[] = [
  {
    name: 'CreateStudent',
    intent: {
      kind: 'create',
      input: {
        commandId: '00000000-0000-4000-8000-000000000101', leaseEpoch: 4,
        studentId: '10000000-0000-4000-8000-000000000101', studentCode: '001', displayName: '新學生',
        aliases: ['小新'], openingBalance: { amount: -5, asOfDate: '2026-10-20', note: '沿用舊帳' },
      },
    },
    expected: normalizeEnabledCommandInput({
      commandId: '00000000-0000-4000-8000-000000000101', kind: 'CreateStudent', leaseEpoch: 4,
      targets: { studentId: '10000000-0000-4000-8000-000000000101' }, expectedRevisions: { student: 0 },
      payload: { studentCode: '001', displayName: '新學生', aliases: ['小新'], openingBalance: { amount: -5, asOfDate: '2026-10-20', note: '沿用舊帳' } },
    }),
    commit: repository => repository.createStudent({
      commandId: '00000000-0000-4000-8000-000000000101', leaseEpoch: 4,
      studentId: '10000000-0000-4000-8000-000000000101', studentCode: '001', displayName: '新學生',
      aliases: ['小新'], openingBalance: { amount: -5, asOfDate: '2026-10-20', note: '沿用舊帳' },
    }),
  },
  {
    name: 'EditStudent',
    intent: {
      kind: 'edit', input: {
        commandId: '00000000-0000-4000-8000-000000000102', leaseEpoch: 4,
        studentId: '10000000-0000-4000-8000-000000000102', expectedRevision: 7,
        displayName: '更正姓名', aliases: ['小甲', '甲同學'],
      },
    },
    expected: normalizeEnabledCommandInput({
      commandId: '00000000-0000-4000-8000-000000000102', kind: 'EditStudent', leaseEpoch: 4,
      targets: { studentId: '10000000-0000-4000-8000-000000000102' }, expectedRevisions: { student: 7 },
      payload: { displayName: '更正姓名', aliases: ['小甲', '甲同學'] },
    }),
    commit: repository => repository.editStudent({
      commandId: '00000000-0000-4000-8000-000000000102', leaseEpoch: 4,
      studentId: '10000000-0000-4000-8000-000000000102', expectedRevision: 7,
      displayName: '更正姓名', aliases: ['小甲', '甲同學'],
    }),
  },
  {
    name: 'ChangeStudentCode',
    intent: {
      kind: 'change-code', input: {
        commandId: '00000000-0000-4000-8000-000000000103', leaseEpoch: 4,
        studentId: '10000000-0000-4000-8000-000000000103', expectedRevision: 3,
        studentCode: '0012', reason: '更正紙本編號',
      },
    },
    expected: normalizeEnabledCommandInput({
      commandId: '00000000-0000-4000-8000-000000000103', kind: 'ChangeStudentCode', leaseEpoch: 4,
      targets: { studentId: '10000000-0000-4000-8000-000000000103' }, expectedRevisions: { student: 3 },
      payload: { studentCode: '0012', reason: '更正紙本編號' },
    }),
    commit: repository => repository.changeStudentCode({
      commandId: '00000000-0000-4000-8000-000000000103', leaseEpoch: 4,
      studentId: '10000000-0000-4000-8000-000000000103', expectedRevision: 3,
      studentCode: '0012', reason: '更正紙本編號',
    }),
  },
  {
    name: 'SetStudentStatus',
    intent: {
      kind: 'status', input: {
        commandId: '00000000-0000-4000-8000-000000000104', leaseEpoch: 4,
        studentId: '10000000-0000-4000-8000-000000000104', expectedRevision: 9,
        status: 'inactive', reason: '暫停就讀',
      },
    },
    expected: normalizeEnabledCommandInput({
      commandId: '00000000-0000-4000-8000-000000000104', kind: 'SetStudentStatus', leaseEpoch: 4,
      targets: { studentId: '10000000-0000-4000-8000-000000000104' }, expectedRevisions: { student: 9 },
      payload: { status: 'inactive', reason: '暫停就讀' },
    }),
    commit: repository => repository.setStudentStatus({
      commandId: '00000000-0000-4000-8000-000000000104', leaseEpoch: 4,
      studentId: '10000000-0000-4000-8000-000000000104', expectedRevision: 9,
      status: 'inactive', reason: '暫停就讀',
    }),
  },
  {
    name: 'EnsureDay',
    intent: {
      kind: 'ensure-day', input: {
        commandId: '00000000-0000-4000-8000-000000000105', leaseEpoch: 4, dayId: '2026-10-20',
      },
    },
    expected: normalizeEnabledCommandInput({
      commandId: '00000000-0000-4000-8000-000000000105', kind: 'EnsureDay', leaseEpoch: 4,
      targets: { dayId: '2026-10-20' }, expectedRevisions: { day: 0 }, payload: { businessDate: '2026-10-20' },
    }),
    commit: repository => repository.ensureOpeningDay({
      commandId: '00000000-0000-4000-8000-000000000105', leaseEpoch: 4, dayId: '2026-10-20',
    }),
  },
  {
    name: 'CorrectOpening',
    intent: {
      kind: 'correct-opening', input: {
        commandId: '00000000-0000-4000-8000-000000000106', leaseEpoch: 4,
        studentId: '10000000-0000-4000-8000-000000000106', dayId: '2026-10-20',
        expectedStudentRevision: 6, expectedDayRevision: 2, amount: 21, note: '核對差額', reason: '憑證補登',
      },
    },
    expected: normalizeEnabledCommandInput({
      commandId: '00000000-0000-4000-8000-000000000106', kind: 'CorrectOpening', leaseEpoch: 4,
      targets: { studentId: '10000000-0000-4000-8000-000000000106', dayId: '2026-10-20' },
      expectedRevisions: { student: 6, day: 2 }, payload: { amount: 21, note: '核對差額', reason: '憑證補登' },
    }),
    commit: repository => repository.correctOpening({
      commandId: '00000000-0000-4000-8000-000000000106', leaseEpoch: 4,
      studentId: '10000000-0000-4000-8000-000000000106', dayId: '2026-10-20',
      expectedStudentRevision: 6, expectedDayRevision: 2, amount: 21, note: '核對差額', reason: '憑證補登',
    }),
  },
];

describe('student write and read-only recovery intent mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(intentCases)('$name uses exactly the same canonical command for commit and receipt confirmation', async ({ intent, expected, commit }) => {
    const repository = createCloudStudentRepository(db, { recoveryReader });
    await commit(repository);
    await expect(repository.confirmPendingIntent(intent, scope.datasetId, scope.uid)).resolves.toEqual({ status: 'not-found' });

    const [committed] = commandRepository.commitCommand.mock.calls[0] as unknown as [CanonicalEnabledInput];
    const [confirmed, epoch, datasetId, uid, reader] = commandRepository.confirmPendingIntent.mock.calls[0] as unknown as [
      CanonicalEnabledInput, number, string, string, CloudRecoveryReader | undefined,
    ];
    expect(committed).toEqual(expected);
    expect(confirmed).toEqual(expected);
    expect(confirmed).toEqual(committed);
    expect([epoch, datasetId, uid, reader]).toEqual([4, scope.datasetId, scope.uid, recoveryReader]);
    expect(commandRepository.commitCommand).toHaveBeenCalledOnce();
  });
});
