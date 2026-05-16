import type { SyncIndicatorKind } from '../firebase/syncStatus';

const iconByKind: Record<SyncIndicatorKind, string> = {
  green_synced: '\u{1F7E2}',
  yellow_syncing: '\u{1F7E1}',
  red_offline_pending: '\u{1F534}',
  red_conflict: '\u{1F534}',
};

export function SyncStatusBadge({ kind, label }: { kind: SyncIndicatorKind; label: string }) {
  return (
    <div className={`sync-badge ${kind}`} role="status" aria-live="polite">
      <span aria-hidden="true">{iconByKind[kind]}</span>
      <span>{label}</span>
    </div>
  );
}
