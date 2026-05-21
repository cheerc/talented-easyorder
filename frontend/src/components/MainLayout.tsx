import React from 'react';
import { TopBar } from './pos-components';
import { ConfirmBanner } from './pos-components';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { TodayDashboard } from './TodayDashboard';
import { PwaInstallBanner } from './PwaInstallBanner';

export interface FlashData {
  id: number;
  name: string;
  sid: string;
  detail: string;
  amount: number;
  after: number;
}

interface MainLayoutProps {
  tab: string;
  setTab: (tab: string) => void;
  online: boolean;
  syncing: boolean;
  lastSync: string;
  todayCount: number;
  viewDate: string;
  setViewDate: (date: string) => void;
  systemDate: string;
  queuedCount: number;
  failedSyncCount: number;
  conflictSyncCount: number;
  onDashboard: () => void;
  flashData: FlashData | null;
  onDismissFlash: () => void;
  onUndo: () => void;
  undoCountdown: number;
  cancelDialogOpen: boolean;
  picked: { displayName: string } | null;
  onCancelDialogConfirm: () => void;
  onCancelDialogCancel: () => void;
  showDashboard: boolean;
  onCloseDashboard: () => void;
  children: React.ReactNode;
}

export const MainLayout = React.memo(function MainLayout(props: MainLayoutProps) {
  const {
    tab, setTab, online, syncing, lastSync, todayCount, viewDate, setViewDate,
    systemDate, queuedCount, failedSyncCount, conflictSyncCount, onDashboard,
    flashData, onDismissFlash, onUndo, undoCountdown,
    cancelDialogOpen, picked, onCancelDialogConfirm, onCancelDialogCancel,
    showDashboard, onCloseDashboard, children,
  } = props;

  return (
    <div className="app">
      <TopBar tab={tab} setTab={setTab} online={online} syncing={syncing} lastSync={lastSync} todayCount={todayCount} viewDate={viewDate} setViewDate={setViewDate} systemDate={systemDate} queuedCount={queuedCount} failedSyncCount={failedSyncCount} conflictSyncCount={conflictSyncCount} onDashboard={onDashboard} />
      {children}
      <ConfirmBanner flash={flashData} onDismiss={onDismissFlash} onUndo={onUndo} undoCountdown={undoCountdown} />
      <ConfirmDialog
        open={cancelDialogOpen}
        title="取消訂餐"
        message={`確定要取消 ${picked?.displayName ?? ''} 的訂餐嗎？`}
        confirmLabel="確認取消"
        cancelLabel="返回"
        variant="danger"
        onConfirm={onCancelDialogConfirm}
        onCancel={onCancelDialogCancel}
      />
      {showDashboard && <TodayDashboard onClose={onCloseDashboard} />}
      <PwaInstallBanner />
    </div>
  );
});
