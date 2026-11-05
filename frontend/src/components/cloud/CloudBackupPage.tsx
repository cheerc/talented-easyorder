// #649 P3: F3 › 資料備份. The P14 backup used to sit under the close section of F2 今日; it now has its own page.
// This page is the host of BackupScreen and keeps what the day-close page used to do for it:
//  1. it reports the navigation lock while a backup command (or the file verification before it) is unconfirmed;
//  2. no cloud command runs next to the backup: the App's hasUnresolvedPendingCommands (the pending journal) locks the
//     backup while any other command is unresolved, and the navigation lock keeps the operator on this page while the
//     backup itself is unresolved, so no other page can start a command meanwhile;
//  3. the page shows no server data, so it has no data-updated notice (#596). F2 reads the server again on entry.
import { useCallback, useEffect, useState } from 'react';
import { BackupScreen } from '../screens/BackupScreen';
import './CloudBackupPage.css';

export interface CloudBackupPageProps {
  identityKey: string;
  onNavigationStateChange?: (identityKey: string, state: 'recovering' | 'revoked' | 'resolved') => void;
  /** Another cloud command of this device has no confirmed result yet (the App's pending journal). */
  hasUnresolvedPendingCommands?: boolean;
}

export function CloudBackupPage({ identityKey, onNavigationStateChange, hasUnresolvedPendingCommands = false }: CloudBackupPageProps) {
  const [backupRecovering, setBackupRecovering] = useState(false);
  const onRecoveryChange = useCallback((active: boolean) => setBackupRecovering(active), []);
  useEffect(() => {
    onNavigationStateChange?.(identityKey, backupRecovering ? 'recovering' : 'resolved');
  }, [backupRecovering, identityKey, onNavigationStateChange]);

  return (
    <div className="cloud-backup">
      <header className="cloud-backup__header">
        <h1>資料備份</h1>
      </header>
      <BackupScreen cloudPage onRecoveryChange={onRecoveryChange} locked={hasUnresolvedPendingCommands} />
    </div>
  );
}

export default CloudBackupPage;
