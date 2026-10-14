import { describe, expect, it, vi } from 'vitest';
import {
  bootstrapOperator,
  buildOperatorDoc,
  setOperatorActiveStatus,
} from '../operatorAdmin';

const mockSetDoc = vi.fn().mockResolvedValue(undefined);
const mockUpdateDoc = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn().mockReturnValue('mock-doc-ref');
const mockServerTimestamp = vi.fn().mockReturnValue('mock-timestamp');

vi.mock('../firebaseModules', () => ({
  getFirestoreMod: () => ({
    doc: mockDoc,
    setDoc: mockSetDoc,
    updateDoc: mockUpdateDoc,
    serverTimestamp: mockServerTimestamp,
  }),
}));

describe('operatorAdmin: 維護者白名單初始化與狀態更新', () => {
  const fakeDb = {} as Parameters<typeof bootstrapOperator>[0];

  it('buildOperatorDoc 建立標準等權 operator 物件', () => {
    const op = buildOperatorDoc({
      uid: 'uid-admin-1',
      email: 'ADMIN@example.com',
      displayName: '管理員',
    });

    expect(op).toEqual({
      uid: 'uid-admin-1',
      email: 'admin@example.com', // 正規化小寫
      displayName: '管理員',
      active: true, // 預設 active 為 true
    });
  });

  it('buildOperatorDoc 在 uid 或 email 為空時拋錯', () => {
    expect(() => buildOperatorDoc({ uid: '', email: 'test@example.com' })).toThrow();
    expect(() => buildOperatorDoc({ uid: 'uid-1', email: '   ' })).toThrow();
  });

  it('bootstrapOperator 正確呼叫 setDoc 建立文件', async () => {
    mockSetDoc.mockClear();
    mockDoc.mockClear();

    const op = await bootstrapOperator(fakeDb, {
      uid: 'uid-new',
      email: 'new@example.com',
    });

    expect(op.uid).toBe('uid-new');
    expect(mockDoc).toHaveBeenCalledWith(fakeDb, 'operators/uid-new');
    expect(mockSetDoc).toHaveBeenCalledWith('mock-doc-ref', expect.objectContaining({
      uid: 'uid-new',
      email: 'new@example.com',
      active: true,
      createdAt: 'mock-timestamp',
      updatedAt: 'mock-timestamp',
    }));
  });

  it('setOperatorActiveStatus 正確更新 active 欄位', async () => {
    mockUpdateDoc.mockClear();
    mockDoc.mockClear();

    await setOperatorActiveStatus(fakeDb, 'uid-target', false);

    expect(mockDoc).toHaveBeenCalledWith(fakeDb, 'operators/uid-target');
    expect(mockUpdateDoc).toHaveBeenCalledWith('mock-doc-ref', {
      active: false,
      updatedAt: 'mock-timestamp',
    });
  });
});
