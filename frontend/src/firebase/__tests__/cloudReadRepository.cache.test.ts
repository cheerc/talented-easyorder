import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';

const firestoreMocks = vi.hoisted(() => ({
  doc: vi.fn(),
  getDocFromServer: vi.fn(),
}));

vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return { ...actual, doc: firestoreMocks.doc, getDocFromServer: firestoreMocks.getDocFromServer };
});

import { createCloudReadRepository } from '../cloudReadRepository';
import { plainMessage } from './helpers/plainMessage';

const user = {
  uid: 'synthetic-operator',
  email: 'operator@example.test',
  emailVerified: true,
  providerData: [{ providerId: 'google.com' }],
} as unknown as User;
const range = { kind: 'custom' as const, startDate: '2026-10-01', endDate: '2026-10-01' };

function serverRead(cachedPath: string) {
  firestoreMocks.doc.mockImplementation((_db: unknown, path: string) => ({ path }));
  firestoreMocks.getDocFromServer.mockImplementation(async (ref: { path: string }) => ({
    id: ref.path.split('/').at(-1),
    exists: () => true,
    data: () => ({}),
    metadata: { fromCache: ref.path === cachedPath, hasPendingWrites: false },
  }));
}

describe('#684 cloud read repository: a cached or unconfirmed read names no internal record', () => {
  beforeEach(() => vi.resetAllMocks());
  const subject = () => createCloudReadRepository({} as Firestore, { currentUser: () => user });

  it.each([
    ['system/dataHead', '營業資料狀態尚未由伺服器確認，無法作為完整報表；請重新載入'],
    ['system/accessLease', '使用權狀態尚未由伺服器確認，無法作為完整報表；請重新載入'],
  ])('%s read from the cache says what is unconfirmed in plain words', async (cachedPath, message) => {
    serverRead(cachedPath);
    await expect(subject().readSummary({ range, leaseEpoch: 7 }))
      .rejects.toMatchObject({ code: 'INCOMPLETE_SNAPSHOT', message });
    await expect(subject().readSummary({ range, leaseEpoch: 7 }))
      .rejects.toMatchObject({ message: plainMessage() });
  });
});
