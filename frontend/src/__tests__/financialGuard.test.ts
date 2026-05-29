import { describe, expect, it } from 'vitest';

const isValidAmount = (s: string): boolean => {
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0;
};

const isValidNonNegative = (s: string): boolean => {
  const n = Number(s);
  return Number.isSafeInteger(n) && n >= 0;
};

describe('financial amount guards (fix #66)', () => {
  describe('amount guard (n > 0)', () => {
    it('rejects float "1.5"', () => {
      expect(isValidAmount('1.5')).toBe(false);
    });

    it('rejects negative "-50"', () => {
      expect(isValidAmount('-50')).toBe(false);
    });

    it('rejects zero "0"', () => {
      expect(isValidAmount('0')).toBe(false);
    });

    it('accepts integer "100"', () => {
      expect(isValidAmount('100')).toBe(true);
    });

    it('rejects unsafe integer "9007199254740992"', () => {
      expect(isValidAmount('9007199254740992')).toBe(false);
    });

    it('rejects NaN string', () => {
      expect(isValidAmount('abc')).toBe(false);
    });
  });

  describe('non-negative guard (n >= 0)', () => {
    it('rejects float "10.5"', () => {
      expect(isValidNonNegative('10.5')).toBe(false);
    });

    it('rejects negative "-1"', () => {
      expect(isValidNonNegative('-1')).toBe(false);
    });

    it('accepts zero "0"', () => {
      expect(isValidNonNegative('0')).toBe(true);
    });

    it('accepts integer "500"', () => {
      expect(isValidNonNegative('500')).toBe(true);
    });
  });
});
