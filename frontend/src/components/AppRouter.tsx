import React, { useCallback } from 'react';
import { ReportScreen, AdminScreen, VendorsScreen, HistoryScreen } from './screens';
import { ErrorBoundary, SectionError } from './ErrorBoundary';
import { PosColumn } from './PosColumn';
import type { ComponentProps } from 'react';

type PosColumnProps = ComponentProps<typeof PosColumn>;

interface AppRouterProps {
  tab: string;
  // ReportScreen
  todayMenu: PosColumnProps['todayMenu'];
  viewDate: string;
  reportStudentFilter: string;
  onClearStudentFilter: () => void;
  // AdminScreen
  setTodayMenu: (m: PosColumnProps['todayMenu']) => void;
  vendors: PosColumnProps['vendors'];
  students: PosColumnProps['students'];
  resetData: () => void;
  openingCash: number;
  dateStatus: string;
  hasCashSession: boolean;
  openCashSession: (input: { businessDate: string; openingCash: number; operatorId: string; openedAt: string }) => void;
  updateOpeningCash: (businessDate: string, amount: number) => void;
  tweaks: PosColumnProps['tweaks'];
  setTweak: (k: string, v: string) => void;
  // VendorsScreen
  setVendors: (v: PosColumnProps['vendors']) => void;
  // PosColumn
  posColumnProps: PosColumnProps;
}

export const AppRouter = React.memo(function AppRouter(props: AppRouterProps) {
  const { tab, todayMenu, viewDate, reportStudentFilter, onClearStudentFilter,
    setTodayMenu, vendors, students, resetData,
    openingCash, dateStatus, hasCashSession, openCashSession, updateOpeningCash,
    tweaks, setTweak, setVendors, posColumnProps } = props;

  const handleOpeningCashChange = useCallback((amount: number) => {
    openCashSession({ businessDate: viewDate, openingCash: amount, operatorId: 'admin', openedAt: new Date().toISOString() });
  }, [viewDate, openCashSession]);

  const handleUpdateOpeningCash = useCallback((amount: number) => {
    updateOpeningCash(viewDate, amount);
  }, [viewDate, updateOpeningCash]);

  return (
    <>
      {tab === 'pos' && <PosColumn {...posColumnProps} />}

      {tab === 'report' && (
        <ErrorBoundary fallback={<SectionError name="報表" />}>
        <ReportScreen
          todayMenu={todayMenu}
          viewDate={viewDate}
          studentFilter={reportStudentFilter}
          onClearStudentFilter={onClearStudentFilter}
        />
        </ErrorBoundary>
      )}
      {tab === 'admin' && (
        <ErrorBoundary fallback={<SectionError name="今日設定" />}>
        <AdminScreen
          todayMenu={todayMenu}
          setTodayMenu={setTodayMenu}
          vendors={vendors}
          students={students}
          resetData={resetData}
          openingCash={openingCash}
          dateStatus={dateStatus}
          hasCashSession={hasCashSession}
          onOpeningCashChange={handleOpeningCashChange}
          onUpdateOpeningCash={handleUpdateOpeningCash}
          tweaks={tweaks} setTweak={setTweak}
        />
        </ErrorBoundary>
      )}
      {tab === 'vendors' && (
        <ErrorBoundary fallback={<SectionError name="供應商" />}>
        <VendorsScreen vendors={vendors} setVendors={setVendors} />
        </ErrorBoundary>
      )}
      {tab === 'history' && (
        <ErrorBoundary fallback={<SectionError name="歷史紀錄" />}>
        <HistoryScreen />
        </ErrorBoundary>
      )}
    </>
  );
});
