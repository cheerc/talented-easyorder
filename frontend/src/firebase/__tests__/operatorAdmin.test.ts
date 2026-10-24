import { describe, expect, it } from 'vitest';
import { buildOperatorDoc } from '../operatorAdmin';

describe('operatorAdmin: operators 白名單文件形狀', () => {
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
});
