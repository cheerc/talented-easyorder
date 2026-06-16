import { describe, it, expect } from 'vitest';

/**
 * Ref: #311 — Unit tests for Number.isFinite() guards in financial input paths.
 * These are pure logic tests — no DOM rendering needed.
 */

// Extracted guard logic matching the patterns in AdminScreen and ExpensePanel
function isValidPrice(input: string): boolean {
  const n = Number(input);
  return Number.isFinite(n) && Number.isSafeInteger(n) && n > 0;
}

function isValidOpeningCash(input: string): boolean {
  const n = Number(input);
  return Number.isFinite(n) && Number.isSafeInteger(n) && n >= 0;
}

function isValidExpenseAmount(input: string): boolean {
  const n = Number(input);
  return Number.isFinite(n) && n > 0;
}

describe('#311 — NaN/Infinity guard in financial inputs', () => {
  describe('price validation (AdminScreen pattern)', () => {
    it('rejects NaN from empty string', () => {
      expect(isValidPrice('')).toBe(false); // Number('') === 0, rejected by > 0
    });

    it('rejects NaN from non-numeric string', () => {
      expect(isValidPrice('abc')).toBe(false);
    });

    it('rejects Infinity', () => {
      expect(isValidPrice('Infinity')).toBe(false);
    });

    it('rejects negative Infinity', () => {
      expect(isValidPrice('-Infinity')).toBe(false);
    });

    it('rejects zero', () => {
      expect(isValidPrice('0')).toBe(false);
    });

    it('rejects negative numbers', () => {
      expect(isValidPrice('-50')).toBe(false);
    });

    it('rejects floating point', () => {
      expect(isValidPrice('50.5')).toBe(false);
    });

    it('accepts valid integer price', () => {
      expect(isValidPrice('60')).toBe(true);
    });
  });

  describe('opening cash validation (AdminScreen pattern)', () => {
    it('accepts zero (valid opening cash)', () => {
      expect(isValidOpeningCash('0')).toBe(true);
    });

    it('rejects NaN', () => {
      expect(isValidOpeningCash('abc')).toBe(false);
    });

    it('rejects Infinity', () => {
      expect(isValidOpeningCash('Infinity')).toBe(false);
    });

    it('accepts valid amount', () => {
      expect(isValidOpeningCash('5000')).toBe(true);
    });
  });

  describe('expense amount validation (ExpensePanel pattern)', () => {
    it('rejects NaN', () => {
      expect(isValidExpenseAmount('abc')).toBe(false);
    });

    it('rejects empty string (produces 0)', () => {
      expect(isValidExpenseAmount('')).toBe(false);
    });

    it('rejects Infinity', () => {
      expect(isValidExpenseAmount('Infinity')).toBe(false);
    });

    it('accepts valid amount', () => {
      expect(isValidExpenseAmount('100')).toBe(true);
    });

    it('accepts decimal amount', () => {
      expect(isValidExpenseAmount('50.5')).toBe(true);
    });
  });
});
