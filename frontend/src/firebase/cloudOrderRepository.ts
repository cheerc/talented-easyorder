import { getAuth, type User } from 'firebase/auth';
import {
  collection,
  getDocsFromServer,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import type {
  CommandErrorCode,
  CommandResult,
} from '../domain/cloudCommands';
import {
  createCloudCommandRepository,
  type CloudCommandRepositoryOptions,
} from './cloudCommandRepository';
import type { CloudTransactionDoc } from './firestoreSchema';

type CurrentUser = Pick<User, 'uid' | 'email' | 'emailVerified' | 'providerData'>;

export interface CreateCloudOrderInput {
  commandId: string;
  leaseEpoch: number;
  studentId: string;
  dayId: string;
  transactionId?: string;
  expectedStudentRevision: number;
  expectedDayRevision: number;
  mealKind: 'bento' | 'other';
  mealPrice: number;
  paidAmount: number;
  menuRevision?: number | null;
  otherItemName?: string | null;
  note?: string;
}

export type CloudOrderReadErrorCode = CommandErrorCode | 'UNSUPPORTED_SCHEMA';

export class CloudOrderRepositoryError extends Error {
  readonly code: CloudOrderReadErrorCode;

  constructor(code: CloudOrderReadErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'CloudOrderRepositoryError';
  }
}

export type CloudOrderRepositoryOptions = CloudCommandRepositoryOptions;

function getCurrentUser(): CurrentUser | null {
  try {
    const auth = getAuth();
    return auth.currentUser;
  } catch {
    return null;
  }
}

function assertAuthenticated(options: CloudOrderRepositoryOptions): void {
  const user = options.currentUser ? options.currentUser() : getCurrentUser();
  if (!user || !user.uid || !user.email || user.emailVerified !== true
    || !user.providerData.some(provider => provider.providerId === 'google.com')) {
    throw new CloudOrderRepositoryError('UNAUTHORIZED', '需要已驗證的 Google 操作員身分');
  }
}

function readError(error: unknown): CloudOrderRepositoryError {
  if (error instanceof CloudOrderRepositoryError) return error;
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code.includes('permission-denied')) return new CloudOrderRepositoryError('LEASE_LOST', '目前帳號沒有讀取交易紀錄的有效使用權');
  if (code.includes('unauthenticated')) return new CloudOrderRepositoryError('UNAUTHORIZED', '請重新登入 Google 操作員帳號');
  if (code.includes('resource-exhausted')) return new CloudOrderRepositoryError('QUOTA_EXCEEDED', '目前讀取次數已達服務限制');
  if (code.includes('unavailable') || code.includes('deadline-exceeded') || code.includes('cancelled')) {
    return new CloudOrderRepositoryError('OFFLINE', '無法連線確認雲端交易紀錄');
  }
  return new CloudOrderRepositoryError('UNKNOWN_RESULT', '無法從伺服器確認交易紀錄');
}

export function createCloudOrderRepository(
  db: Firestore,
  options: CloudOrderRepositoryOptions = {},
) {
  const commands = createCloudCommandRepository(db, options);

  async function createOrder(input: CreateCloudOrderInput): Promise<CommandResult> {
    assertAuthenticated(options);
    const transactionId = input.transactionId ?? crypto.randomUUID();
    return commands.commitCommand({
      commandId: input.commandId,
      kind: 'CreateOrder',
      leaseEpoch: input.leaseEpoch,
      targets: {
        transactionId,
        studentId: input.studentId,
        dayId: input.dayId,
      },
      expectedRevisions: {
        transaction: 0,
        student: input.expectedStudentRevision,
        day: input.expectedDayRevision,
      },
      payload: {
        mealKind: input.mealKind,
        mealPrice: input.mealPrice,
        paidAmount: input.paidAmount,
        ...(input.mealKind === 'bento' && input.menuRevision !== null && input.menuRevision !== undefined
          ? { menuRevision: input.menuRevision }
          : {}),
        ...(input.mealKind === 'other' && input.otherItemName
          ? { otherItemName: input.otherItemName.trim() }
          : {}),
        note: input.note ?? '',
      },
    });
  }

  function parseTimestampMillis(ts: unknown): number {
    if (ts && typeof (ts as { toMillis?: () => number }).toMillis === 'function') {
      return (ts as { toMillis: () => number }).toMillis()!;
    }
    if (ts && typeof (ts as { toDate?: () => Date }).toDate === 'function') {
      return (ts as { toDate: () => Date }).toDate()!.getTime();
    }
    if (ts instanceof Date) return ts.getTime();
    return 0;
  }

  async function listDayTransactions(dayId: string): Promise<CloudTransactionDoc[]> {
    assertAuthenticated(options);
    try {
      const q = query(
        collection(db, 'transactions'),
        where('businessDate', '==', dayId),
      );
      const snapshot = await getDocsFromServer(q);
      const records: CloudTransactionDoc[] = [];
      for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        if (data.businessDate === dayId && data.status === 'active') {
          records.push(data as CloudTransactionDoc);
        }
      }
      records.sort((a, b) => parseTimestampMillis(b.createdAt) - parseTimestampMillis(a.createdAt));
      return records;
    } catch (error) {
      throw readError(error);
    }
  }

  return {
    createOrder,
    listDayTransactions,
  };
}

export type CloudOrderRepository = ReturnType<typeof createCloudOrderRepository>;
