import { describe, expect, it, vi } from 'vitest';
vi.unmock('../authService');
import { isAllowedWorkspaceEmail, shouldForceSignOut, toOperatorProfile, isValidOperatorDoc } from '../authService';

describe('authService', () => {
  it('allows talented.com.tw Workspace email only', () => {
    expect(isAllowedWorkspaceEmail('cheerc@talented.com.tw')).toBe(true);
    expect(isAllowedWorkspaceEmail('staff@talented.com.tw')).toBe(true);
    expect(isAllowedWorkspaceEmail('staff@gmail.com')).toBe(false);
    expect(isAllowedWorkspaceEmail(null)).toBe(false);
  });

  it('maps Firebase user to operator profile', () => {
    expect(toOperatorProfile({
      uid: 'uid-1',
      email: 'counter@talented.com.tw',
      displayName: 'Counter One',
    })).toEqual({
      uid: 'uid-1',
      email: 'counter@talented.com.tw',
      displayName: 'Counter One',
    });
  });

  it('forces sign-out for domain and whitelist failures', () => {
    expect(shouldForceSignOut({ ok: false, reason: 'wrong_domain' })).toBe(true);
    expect(shouldForceSignOut({ ok: false, reason: 'not_whitelisted' })).toBe(true);
    expect(shouldForceSignOut({ ok: false, reason: 'inactive' })).toBe(true);
    expect(shouldForceSignOut({ ok: false, reason: 'signed_out' })).toBe(false);
  });

  describe('isValidOperatorDoc', () => {
    it('accepts valid operator doc with active and role', () => {
      expect(isValidOperatorDoc({ active: true, role: 'admin' })).toBe(true);
      expect(isValidOperatorDoc({ active: false, role: 'counter' })).toBe(true);
    });

    it('accepts doc with only active field', () => {
      expect(isValidOperatorDoc({ active: true })).toBe(true);
    });

    it('accepts empty object (no active or role)', () => {
      expect(isValidOperatorDoc({})).toBe(true);
    });

    it('rejects null and undefined', () => {
      expect(isValidOperatorDoc(null)).toBe(false);
      expect(isValidOperatorDoc(undefined)).toBe(false);
    });

    it('rejects non-object values', () => {
      expect(isValidOperatorDoc('string')).toBe(false);
      expect(isValidOperatorDoc(42)).toBe(false);
      expect(isValidOperatorDoc(true)).toBe(false);
    });

    it('rejects doc with active as non-boolean', () => {
      expect(isValidOperatorDoc({ active: 'yes' })).toBe(false);
      expect(isValidOperatorDoc({ active: 1 })).toBe(false);
    });

    it('rejects doc with invalid role value', () => {
      expect(isValidOperatorDoc({ active: true, role: 'superadmin' })).toBe(false);
      expect(isValidOperatorDoc({ active: true, role: 123 })).toBe(false);
    });
  });
});
