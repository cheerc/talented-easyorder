import { describe, expect, it } from 'vitest';
import { operatorDisplayLabel } from '../operatorDisplay';

describe('operatorDisplayLabel', () => {
  const self = { uid: 'uid-self', name: '測試操作員甲' };

  it('目前操作員自己的 UID 顯示操作員名稱', () => {
    expect(operatorDisplayLabel('uid-self', self)).toBe('測試操作員甲');
  });

  it('其他 UID 一律顯示「其他操作員」，不洩漏 UID', () => {
    const label = operatorDisplayLabel('uid-other', self);
    expect(label).toBe('其他操作員');
    expect(label).not.toContain('uid-other');
  });

  it('空字串、null、undefined 顯示「其他操作員」', () => {
    expect(operatorDisplayLabel('', self)).toBe('其他操作員');
    expect(operatorDisplayLabel(null, self)).toBe('其他操作員');
    expect(operatorDisplayLabel(undefined, self)).toBe('其他操作員');
  });

  it('沒有目前操作員資訊時，任何 UID 都顯示「其他操作員」', () => {
    expect(operatorDisplayLabel('uid-self', null)).toBe('其他操作員');
  });

  it('自己的名稱本身就是 UID 時改用中性文字，不顯示 UID', () => {
    const label = operatorDisplayLabel('uid-self', { uid: 'uid-self', name: 'uid-self' });
    expect(label).toBe('目前操作員');
    expect(label).not.toContain('uid-self');
  });

  it('自己的名稱是空白時也改用中性文字', () => {
    expect(operatorDisplayLabel('uid-self', { uid: 'uid-self', name: '  ' })).toBe('目前操作員');
  });
});
