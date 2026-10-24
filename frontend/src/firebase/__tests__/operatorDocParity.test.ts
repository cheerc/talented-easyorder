import { describe, expect, it } from 'vitest';
import { buildOperatorDocForRestore } from '../../maintenance/operatorDoc';
import { buildOperatorDoc } from '../operatorAdmin';

describe('P15c operator document parity', () => {
  it('the restore tool builds the same operator document as the app tool for every kind of input', () => {
    const inputs = [
      { uid: 'u1', email: 'A@Example.TEST' },
      { uid: '  u2  ', email: '  b@example.test  ', displayName: '  Bee  ' },
      { uid: 'u3', email: 'c@example.test', displayName: '   ' },
      { uid: 'u4', email: 'd@example.test', active: false },
    ];
    for (const input of inputs) expect(buildOperatorDocForRestore(input)).toEqual(buildOperatorDoc(input));
  });

  it('both refuse an empty uid or e-mail', () => {
    for (const input of [{ uid: ' ', email: 'a@example.test' }, { uid: 'u', email: ' ' }]) {
      expect(() => buildOperatorDoc(input)).toThrow();
      expect(() => buildOperatorDocForRestore(input)).toThrow();
    }
  });
});
