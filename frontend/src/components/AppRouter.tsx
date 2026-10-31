import React, { Suspense } from 'react';
import { ErrorBoundary, SectionError } from './ErrorBoundary';
import { PosColumn } from './PosColumn';
import type { ComponentProps } from 'react';

const ReportScreen = React.lazy(() => import('./screens/ReportScreen').then(m => ({ default: m.ReportScreen })));
const AdminScreen = React.lazy(() => import('./screens/AdminScreen').then(m => ({ default: m.AdminScreen })));
const VendorsScreen = React.lazy(() => import('./screens/VendorsScreen').then(m => ({ default: m.VendorsScreen })));
const HistoryScreen = React.lazy(() => import('./screens/HistoryScreen').then(m => ({ default: m.HistoryScreen })));

import type { HistoryLookupTarget } from './screens/HistoryScreen';
import type { StudentAccount } from '../domain/student';
import type { LedgerMutationResult } from '../domain/ledgerAudit';
import { PageSkeleton } from './ui/PageSkeleton';

type PosColumnProps = ComponentProps<typeof PosColumn>;

interface AppRouterProps {
  tab: string;
  viewDate: string;
  reportStudentFilter: string;
  onClearStudentFilter: () => void;
  // PosColumn
  posColumnProps: PosColumnProps;
  historyLookupTarget?: HistoryLookupTarget | null;
  onConsumeHistoryLookupTarget?: () => void;
  onViewStudentHistory?: (student: StudentAccount) => void;
  // U4：F1 與 F3 共用的退款寫入路徑（含停用帳戶）
  onRefund?: (studentId: string, amount: number, reason: string) => LedgerMutationResult;
  onRefundDialogOpenChange?: (open: boolean) => void;
}

export const AppRouter = React.memo(function AppRouter(props: AppRouterProps) {
  const {
    tab,
    viewDate,
    reportStudentFilter,
    onClearStudentFilter,
    posColumnProps,
    historyLookupTarget,
    onConsumeHistoryLookupTarget,
    onViewStudentHistory,
    onRefund,
    onRefundDialogOpenChange,
  } = props;

  return (
    <>
      {tab === 'pos' && (
        <ErrorBoundary fallback={<SectionError name="POS櫃台" />}>
        <PosColumn {...posColumnProps} />
        </ErrorBoundary>
      )}

      {tab === 'report' && (
        <ErrorBoundary fallback={<SectionError name="報表" />}>
        <Suspense fallback={<PageSkeleton />}>
        <ReportScreen
          viewDate={viewDate}
          studentFilter={reportStudentFilter}
          onClearStudentFilter={onClearStudentFilter}
        />
        </Suspense>
        </ErrorBoundary>
      )}
      {tab === 'admin' && (
        <ErrorBoundary fallback={<SectionError name="今日設定" />}>
        <Suspense fallback={<PageSkeleton />}>
        <AdminScreen
          viewDate={viewDate}
          onViewStudentHistory={onViewStudentHistory}
          onRefund={onRefund}
          onRefundDialogOpenChange={onRefundDialogOpenChange}
        />
        </Suspense>
        </ErrorBoundary>
      )}
      {tab === 'vendors' && (
        <ErrorBoundary fallback={<SectionError name="供應商" />}>
        <Suspense fallback={<PageSkeleton />}>
        <VendorsScreen viewDate={viewDate} />
        </Suspense>
        </ErrorBoundary>
      )}
      {tab === 'history' && (
        <ErrorBoundary fallback={<SectionError name="歷史紀錄" />}>
        <Suspense fallback={<PageSkeleton />}>
        <HistoryScreen
          viewDate={viewDate}
          lookupTarget={historyLookupTarget}
          onConsumeLookupTarget={onConsumeHistoryLookupTarget}
        />
        </Suspense>
        </ErrorBoundary>
      )}
    </>
  );
});
