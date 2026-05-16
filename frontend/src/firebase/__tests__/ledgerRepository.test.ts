import { describe, expect, it } from 'vitest';
import { createTransactionId, shouldUseOfflineCommitPath } from '../ledgerRepository';

describe('ledgerRepository', () => {
  it('creates stable idempotency keys from device id and local sequence', () => {
    expect(createTransactionId('pc-1', 42)).toBe('pc-1:tx:42');
  });

  it('uses offline commit path when browser is offline', () => {
    expect(shouldUseOfflineCommitPath({ online: false, forceOffline: false })).toBe(true);
  });

  it('uses online transaction path when online', () => {
    expect(shouldUseOfflineCommitPath({ online: true, forceOffline: false })).toBe(false);
  });
});
