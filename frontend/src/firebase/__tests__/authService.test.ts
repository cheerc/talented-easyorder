import { describe, expect, it } from 'vitest';
import { isAllowedWorkspaceEmail, shouldForceSignOut, toOperatorProfile } from '../authService';

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
});
