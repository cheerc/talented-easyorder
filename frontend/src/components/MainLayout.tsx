import React from 'react';
import { TopBar } from './pos-components';
import { ConfirmBanner } from './pos-components';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { CancelOrderDialog } from './CancelOrderDialog';
import type { LedgerTransaction } from '../domain/ledger';
import type { StudentAccount } from '../domain/student';
import { TodayDashboard } from './TodayDashboard';
import { PwaInstallBanner } from './PwaInstallBanner';
import type { StorageMode } from '../appMode';
import type { LedgerMutationResult } from '../domain/ledgerAudit';

export interface FlashData {
  id: number;
  name: string;
  sid: string;
  detail: string;
  amount: number;
  /** 帳戶餘額；櫃台收支沒有（櫃台現金到日末點現金再核對）。 */
  after?: number;
}

interface MainLayoutProps {
  tab: string;
  setTab: (tab: string) => void;
  online: boolean;
  syncing: boolean;
  lastSync: string;
  todayCount: number;
  todayOtherCount?: number;
  todayMenu?: { itemName: string } | null;
  todayMenuName?: string;
  viewDate: string;
  setViewDate: (date: string) => void;
  systemDate: string;
  queuedCount: number;
  failedSyncCount: number;
  conflictSyncCount: number;
  onDashboard: () => void;
  storageMode?: StorageMode;
  flashData: FlashData | null;
  onDismissFlash: () => void;
  onUndo: () => void;
  undoCountdown: number;
  cancelDialogOpen: boolean;
  picked: StudentAccount | null;
  orderTx?: LedgerTransaction | null;
  onCancelDialogConfirm: (keepPaymentAsDeposit: boolean, reason: string) => LedgerMutationResult;
  onCancelDialogCancel: () => void;
  noOrderDialogOpen: boolean;
  onNoOrderDialogClose: () => void;
  showDashboard: boolean;
  onCloseDashboard: () => void;
  children: React.ReactNode;
}

export const MainLayout = React.memo(function MainLayout(props: MainLayoutProps) {
  const {
    tab, setTab, online, syncing, lastSync, todayCount, todayOtherCount = 0, todayMenu, todayMenuName, viewDate, setViewDate, systemDate,
    queuedCount, failedSyncCount, conflictSyncCount, onDashboard, storageMode,
    flashData, onDismissFlash, onUndo, undoCountdown,
    cancelDialogOpen, picked, orderTx, onCancelDialogConfirm, onCancelDialogCancel,
    noOrderDialogOpen, onNoOrderDialogClose,
    showDashboard, onCloseDashboard, children,
  } = props;

  return (
    <div className="app">
      <TopBar tab={tab} setTab={setTab} online={online} syncing={syncing} lastSync={lastSync} todayCount={todayCount} todayOtherCount={todayOtherCount} todayMenu={todayMenu} todayMenuName={todayMenuName} viewDate={viewDate} setViewDate={setViewDate} queuedCount={queuedCount} failedSyncCount={failedSyncCount} conflictSyncCount={conflictSyncCount} onDashboard={onDashboard} storageMode={storageMode} />
      {children}
      <ConfirmBanner flash={flashData} onDismiss={onDismissFlash} onUndo={onUndo} undoCountdown={undoCountdown} />
      <CancelOrderDialog
        open={cancelDialogOpen}
        account={picked}
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
      {showDashboard && <TodayDashboard systemDate={systemDate} onClose={onCloseDashboard} />}
      <PwaInstallBanner />
    </div>
  );
});
