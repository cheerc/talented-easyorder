import React from 'react';
import { TopBar } from './pos-components';
import { ConfirmBanner } from './pos-components';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { CancelOrderDialog } from './CancelOrderDialog';
import type { LedgerTransaction } from '../domain/ledger';
import type { StudentAccount } from '../domain/student';
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
  picked: StudentAccount | null;
  orderTx?: LedgerTransaction | null;
  onCancelDialogConfirm: (keepPaymentAsDeposit: boolean) => void;
  onCancelDialogCancel: () => void;
  noOrderDialogOpen: boolean;
  onNoOrderDialogClose: () => void;
  showDashboard: boolean;
  onCloseDashboard: () => void;
  children: React.ReactNode;
}

export const MainLayout = React.memo(function MainLayout(props: MainLayoutProps) {
  const {
    tab, setTab, online, syncing, lastSync, todayCount, viewDate, setViewDate,
    queuedCount, failedSyncCount, conflictSyncCount, onDashboard,
    flashData, onDismissFlash, onUndo, undoCountdown,
    cancelDialogOpen, picked, orderTx, onCancelDialogConfirm, onCancelDialogCancel,
    noOrderDialogOpen, onNoOrderDialogClose,
    showDashboard, onCloseDashboard, children,
  } = props;

  return (
    <div className="app">
      <TopBar tab={tab} setTab={setTab} online={online} syncing={syncing} lastSync={lastSync} todayCount={todayCount} viewDate={viewDate} setViewDate={setViewDate} queuedCount={queuedCount} failedSyncCount={failedSyncCount} conflictSyncCount={conflictSyncCount} onDashboard={onDashboard} />
      {children}
      <ConfirmBanner flash={flashData} onDismiss={onDismissFlash} onUndo={onUndo} undoCountdown={undoCountdown} />
      <CancelOrderDialog
        open={cancelDialogOpen}
        picked={picked}
        orderTx={orderTx ?? null}
        onConfirm={onCancelDialogConfirm}
        onCancel={onCancelDialogCancel}
      />
      <ConfirmDialog
        open={noOrderDialogOpen}
        title="此學生今日尚未訂便當"
        message="學員今日尚未訂餐，無法執行取消動作。"
        confirmLabel="確認"
        cancelLabel="返回"
        onConfirm={onNoOrderDialogClose}
        onCancel={onNoOrderDialogClose}
      />
      {showDashboard && <TodayDashboard onClose={onCloseDashboard} />}
      <PwaInstallBanner />
    </div>
  );
});
