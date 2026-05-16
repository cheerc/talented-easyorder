export type SyncIndicatorKind = 'green_synced' | 'yellow_syncing' | 'red_offline_pending' | 'red_conflict';

export interface SyncIndicatorInput {
  online: boolean;
  fromCache: boolean;
  pendingWrites: number;
  conflicts: number;
}

export function deriveSyncIndicator(input: SyncIndicatorInput): { kind: SyncIndicatorKind; label: string } {
  if (input.conflicts > 0) return { kind: 'red_conflict', label: '衝突需處理' };
  if (!input.online || input.fromCache) return { kind: 'red_offline_pending', label: '離線待同步' };
  if (input.pendingWrites > 0) return { kind: 'yellow_syncing', label: '同步中' };
  return { kind: 'green_synced', label: '已同步' };
}
