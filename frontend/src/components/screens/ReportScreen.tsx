import React, { useState, useMemo, useEffect } from "react";
import { type LedgerTransaction, mergeLedgerTransactions } from '../../domain/ledger';
import type { TodayMenu } from '../../domain/menu';
import { EditTransactionModal } from '../EditTransactionModal';
import {
  createLedgerDateRange,
  calculateLedgerTotals,
  groupLedgerRowsByStudent,
  type LedgerDateRangeKind,
} from '../../domain/ledgerReport';
import { getOpeningCash } from '../../domain/cashClose';
import {
  TRANSACTION_CSV_COLUMNS,
  buildTransactionCsvRows,
  serializeCsv,
  triggerCsvDownload,
} from '../../domain/ledgerExport';
import { ReportDateRangeControls } from '../report/ReportDateRangeControls';
import { ReportSummaryStats } from '../report/ReportSummaryStats';
import { LedgerGroupedTable } from '../report/LedgerGroupedTable';
import { CashClosePanel } from '../report/CashClosePanel';
import { ExportActions } from '../report/ExportActions';
import { ReopenDialog } from '../report/ReopenDialog';
import { usePosStore } from '../../store/posStore';

interface ReportScreenProps {
  todayMenu: TodayMenu;
  viewDate: string;
  studentFilter?: string;
  onClearStudentFilter?: () => void;
}
export const ReportScreen = React.memo(function ReportScreen({ todayMenu, viewDate, studentFilter, onClearStudentFilter }: ReportScreenProps) {
  const [dateRange, setDateRange] = useState<LedgerDateRangeKind>('today');
  const [displayMode, setDisplayMode] = useState<'merged' | 'original'>('merged');
  const [customStart, setCustomStart] = useState(viewDate);
  const [customEnd, setCustomEnd] = useState(viewDate);
  const [expandedSids, setExpandedSids] = useState<Set<string>>(new Set());
  const [showReopen, setShowReopen] = useState(false);
  const [editingTx, setEditingTx] = useState<LedgerTransaction | null>(null);
  const [studentSearch, setStudentSearch] = useState(studentFilter || '');

  const transactions = usePosStore((s) => s.transactions);
  const closeBusinessDate = usePosStore((s) => s.closeBusinessDate);
  const reopenBusinessDate = usePosStore((s) => s.reopenBusinessDate);
  const deleteOrderWithRefundCheck = usePosStore((s) => s.deleteOrderWithRefundCheck);
  const deleteTransaction = usePosStore((s) => s.deleteTransaction);
  const editTransaction = usePosStore((s) => s.editTransaction);
  const dateStatus = usePosStore((s) => s.getBusinessDateStatus(viewDate));
  const cashSessions = usePosStore((s) => s.cashSessions);
  const dailySettlements = usePosStore((s) => s.dailySettlements as import('../../domain/cashClose').DailySettlement[]);
  const currentCashSession = cashSessions[viewDate];
  const openingCash = getOpeningCash(viewDate, dailySettlements || [], currentCashSession);

  const range = useMemo(() => createLedgerDateRange(
    dateRange,
    viewDate,
    dateRange === 'custom' ? { startDate: customStart, endDate: customEnd } : undefined,
  ), [dateRange, viewDate, customStart, customEnd]);

  const filtered = useMemo(() =>
    transactions.filter(t => t.businessDate >= range.startDate && t.businessDate <= range.endDate),
  [transactions, range]);

  const expenseRows = useMemo(() =>
    filtered.filter(t => t.type === 'expense'),
  [filtered]);

  const counterCashFlow = useMemo(() => {
    const income = expenseRows.filter(t => t.paidAmount > 0);
    const expenseOnly = expenseRows.filter(t => t.paidAmount === 0);
    return {
      incomeCount: income.length,
      incomeAmount: income.reduce((s, t) => s + t.paidAmount, 0),
      expenseCount: expenseOnly.length,
      expenseAmount: expenseOnly.reduce((s, t) => s + t.mealPrice, 0),
    };
  }, [expenseRows]);

  const totals = useMemo(() => calculateLedgerTotals(filtered), [filtered]);
  const groups = useMemo(() => groupLedgerRowsByStudent(filtered), [filtered]);

  // When studentFilter arrives from App, schedule auto-expand
  useEffect(() => {
    if (!studentFilter) return;
    const sid = studentFilter;
    const t = setTimeout(() => {
      setExpandedSids(prev => {
        if (prev.has(sid)) return prev;
        return new Set(prev).add(sid);
      });
    }, 0);
    return () => clearTimeout(t);
  }, [studentFilter]);

  const filteredGroups = useMemo(() => {
    if (!studentSearch.trim()) return groups;
    const q = studentSearch.toLowerCase();
    return groups.filter(g =>
      g.studentId.toLowerCase().includes(q) ||
      g.studentNameSnapshot.toLowerCase().includes(q)
    );
  }, [groups, studentSearch]);

  const hasQueuedRows = filtered.some(t => t.syncStatus === 'queued');
  const hasFailedConflict = filtered.some(t => t.syncStatus === 'failed' || t.syncStatus === 'conflict');

  const todayStr = useMemo(() => {
    const [, m, d] = viewDate.split('-');
    return `${parseInt(m)}/${parseInt(d)}`;
  }, [viewDate]);

  const toggleExpand = (sid: string) => {
    const next = new Set(expandedSids);
    if (next.has(sid)) next.delete(sid);
    else next.add(sid);
    setExpandedSids(next);
  };

  const handleEditClick = (t: LedgerTransaction) => {
    setEditingTx(t);
  };

  const handleDeleteClick = (t: LedgerTransaction) => {
    if (t.type === 'order') {
      deleteOrderWithRefundCheck(t.transactionId);
    } else {
      deleteTransaction(t.transactionId);
    }
  };

  const handleCashClose = (countedCash: number, note: string) => {
    try {
      closeBusinessDate({ businessDate: viewDate, countedCash, note, queuedSettlementAccepted: true, operatorId: 'op-report' });
    } catch (err) {
      console.error('closeBusinessDate failed', err);
    }
  };

  const handleReopen = (reason: string) => {
    reopenBusinessDate({ businessDate: viewDate, reason, operatorId: 'op-report' });
    setShowReopen(false);
  };

  return (
    <div className="screen report">
      <div className="rpt-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--ink-2)' }}>顯示模式：</span>
          <div className="rpt-filters">
            <button
              className={'rpt-filter ' + (displayMode === 'merged' ? 'rpt-on' : '')}
              onClick={() => setDisplayMode('merged')}
            >
              合併模式
            </button>
            <button
              className={'rpt-filter ' + (displayMode === 'original' ? 'rpt-on' : '')}
              onClick={() => setDisplayMode('original')}
            >
              原始模式
            </button>
          </div>
        </div>
      </div>
      <ReportDateRangeControls
        dateRange={dateRange}
        setDateRange={setDateRange}
        todayStr={todayStr}
        txCount={filtered.length}
        customStart={customStart}
        customEnd={customEnd}
        setCustomStart={setCustomStart}
        setCustomEnd={setCustomEnd}
      />

      <ReportSummaryStats totals={totals} itemName={todayMenu.itemName} counterCashFlow={counterCashFlow} />

      {dateStatus === 'closed' && (
        <button className="ghost-btn" style={{ marginBottom: '12px' }} onClick={() => setShowReopen(true)}>
          重新開啟日期
        </button>
      )}

      <CashClosePanel
        totals={totals}
        businessDate={viewDate}
        dateStatus={dateStatus}
        hasQueuedRows={hasQueuedRows}
        queuedRowCount={filtered.filter(t => t.syncStatus === 'queued').length}
        hasFailedConflict={hasFailedConflict}
        openingCash={openingCash}
        onClose={handleCashClose}
      />

      <ExportActions
        onExportCsv={() => {
          const txsToExport = displayMode === 'merged' ? mergeLedgerTransactions(filtered) : filtered;
          const txRows = buildTransactionCsvRows(txsToExport);
          const csv = serializeCsv(TRANSACTION_CSV_COLUMNS, txRows);
          triggerCsvDownload(`easyorder-report-${viewDate}.csv`, csv);
        }}
        onPrint={() => window.print()}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <input
          className="adm-input"
          aria-label="搜尋學員編號或姓名"
          value={studentSearch}
          onChange={e => setStudentSearch(e.target.value)}
          placeholder="搜尋學員編號或姓名…"
          style={{ flex: '1', maxWidth: '280px' }}
        />
        {studentSearch && (
          <button className="ghost-btn" style={{ fontSize: '12px' }}
                  onClick={() => { setStudentSearch(''); onClearStudentFilter?.(); }}>
            清除
          </button>
        )}
      </div>

      <LedgerGroupedTable
        groups={filteredGroups}
        expenseRows={expenseRows}
        onToggleExpand={toggleExpand}
        expandedSids={expandedSids}
        onEditClick={handleEditClick}
        onDeleteClick={handleDeleteClick}
        dateStatus={dateStatus}
        displayMode={displayMode}
      />

      {showReopen && (
        <ReopenDialog
          businessDate={viewDate}
          onReopen={handleReopen}
          onCancel={() => setShowReopen(false)}
        />
      )}

      <EditTransactionModal
        open={editingTx !== null}
        transaction={editingTx}
        onClose={() => setEditingTx(null)}
        onSave={(updates) => {
          if (editingTx) {
            editTransaction(editingTx.transactionId, updates);
          }
          setEditingTx(null);
        }}
      />
    </div>
  );
});
