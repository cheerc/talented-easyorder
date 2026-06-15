import React, { Suspense } from 'react';
import { ErrorBoundary, SectionError } from './ErrorBoundary';
import { PosColumn } from './PosColumn';
import type { ComponentProps } from 'react';

const ReportScreen = React.lazy(() => import('./screens/ReportScreen').then(m => ({ default: m.ReportScreen })));
const AdminScreen = React.lazy(() => import('./screens/AdminScreen').then(m => ({ default: m.AdminScreen })));
const VendorsScreen = React.lazy(() => import('./screens/VendorsScreen').then(m => ({ default: m.VendorsScreen })));
const HistoryScreen = React.lazy(() => import('./screens/HistoryScreen').then(m => ({ default: m.HistoryScreen })));

type PosColumnProps = ComponentProps<typeof PosColumn>;

interface AppRouterProps {
  tab: string;
  viewDate: string;
  reportStudentFilter: string;
  onClearStudentFilter: () => void;
  // PosColumn
  posColumnProps: PosColumnProps;
}

export const AppRouter = React.memo(function AppRouter(props: AppRouterProps) {
  const { tab, viewDate, reportStudentFilter, onClearStudentFilter, posColumnProps } = props;

  return (
    <>
      {tab === 'pos' && (
        <ErrorBoundary fallback={<SectionError name="POS櫃台" />}>
        <PosColumn {...posColumnProps} />
        </ErrorBoundary>
      )}

      {tab === 'report' && (
        <ErrorBoundary fallback={<SectionError name="報表" />}>
        <Suspense fallback={<div className="p-4 text-secondary">載入中...</div>}>
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
        <Suspense fallback={<div className="p-4 text-secondary">載入中...</div>}>
        <AdminScreen viewDate={viewDate} />
        </Suspense>
        </ErrorBoundary>
      )}
      {tab === 'vendors' && (
        <ErrorBoundary fallback={<SectionError name="供應商" />}>
        <Suspense fallback={<div className="p-4 text-secondary">載入中...</div>}>
        <VendorsScreen />
        </Suspense>
        </ErrorBoundary>
      )}
      {tab === 'history' && (
        <ErrorBoundary fallback={<SectionError name="歷史紀錄" />}>
        <Suspense fallback={<div className="p-4 text-secondary">載入中...</div>}>
        <HistoryScreen />
        </Suspense>
        </ErrorBoundary>
      )}
    </>
  );
});
