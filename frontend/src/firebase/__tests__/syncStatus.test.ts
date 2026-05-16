import { describe, expect, it } from 'vitest';
import { deriveSyncIndicator } from '../syncStatus';

describe('deriveSyncIndicator', () => {
  it('is green when online and there are no pending writes', () => {
    expect(deriveSyncIndicator({ online: true, fromCache: false, pendingWrites: 0, conflicts: 0 })).toEqual({
      kind: 'green_synced',
      label: '已同步',
    });
  });

  it('is yellow when Firestore has pending writes', () => {
    expect(deriveSyncIndicator({ online: true, fromCache: false, pendingWrites: 2, conflicts: 0 }).kind).toBe('yellow_syncing');
  });

  it('is red when offline with pending writes', () => {
    expect(deriveSyncIndicator({ online: false, fromCache: true, pendingWrites: 1, conflicts: 0 }).kind).toBe('red_offline_pending');
  });

  it('is red conflict when any accounting conflict exists', () => {
    expect(deriveSyncIndicator({ online: true, fromCache: false, pendingWrites: 0, conflicts: 1 }).kind).toBe('red_conflict');
  });
});
