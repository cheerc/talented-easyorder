import React, { useMemo, useState, useCallback } from 'react';
import { SearchBox, CustomerCard, ActionBar, IdleHero, RecentStrip, MidnightBanner, ExpensePanel, DeleteConfirmDialog } from './pos-components';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { useActiveOrderCount } from '../store/derived/useLedger';
import { useTransactionActions } from '../store/selectors';
import { groupLedgerRowsByStudent } from '../domain/ledgerReport';
import type { LedgerTransaction, TransactionEditView } from '../domain/ledger';
import { EditTransactionModal } from './EditTransactionModal';
import type { PosColumnProps } from './PosColumn.types';
import type { StudentAccount } from '../domain/student';
import type { PosMode } from '../domain/posFlow';

export const PosColumn = React.memo(function PosColumn(props: PosColumnProps) {
  const {
    state, isHistorical, dateStatus, viewDate, systemDate, setViewDate,
    picked, currentMode, currentPaidAmount, students, selectStudent,
    expenseProps,
    updateExpenseAmount, confirmExpenseAmount, selectExpenseDirection, selectExpenseReason,
    updateExpenseNote, confirmExpenseNote,
    setPaidAmountText, handleConfirm, cancelFlow, changeMode, setFocusZone, focusZone, openCancelConfirmForTx,
    setSearchText, searchFocusKey, hasFlash,
    crashDraftRestored, setCrashDraftRestored,
    todayMenu, todayCount, vendors, enterExpenseMode, tweaks,
    tx, operatorUid, priceOverride, priceOverrideLabel, setPriceOverride, setPriceOverrideLabel,
    handleDeleteOrder, onViewHistory,
  } = props;

  const orderedTodayCount = useActiveOrderCount(picked?.studentId ?? null, viewDate);

  const { deleteTransaction, editTransaction } = useTransactionActions();

  // Group raw transactions by student for RecentStrip
  const recentGroups = useMemo(
    () => groupLedgerRowsByStudent(tx as LedgerTransaction[]),
    [tx],
  );

  // Edit modal state
  const [editingTx, setEditingTx] = useState<TransactionEditView | null>(null);

  // Delete confirm dialog state (for payment/expense)
  const [deleteConfirmTx, setDeleteConfirmTx] = useState<LedgerTransaction | null>(null);

  const handleRecentEditClick = (t: LedgerTransaction) => {
    setEditingTx({
      transactionId: t.transactionId,
      mealPrice: t.mealPrice,
      paidAmount: t.paidAmount,
      note: t.note,
    });
  };

  const handleRecentDeleteClick = (t: LedgerTransaction) => {
    if (t.type === 'order') {
      openCancelConfirmForTx(t);
    } else {
      setDeleteConfirmTx(t);
    }
  };

  const handleRecentEditSave = useCallback(
    (transactionId: string, updates: { mealPrice: number; paidAmount: number; note: string }) => {
      editTransaction(transactionId, updates, operatorUid);
    },
    [editTransaction, operatorUid],
  );

  const [activeIdx, setActiveIdx] = useState(0);

  const suggestions = useMemo(() => {
    const query = state.kind === 'idle' ? state.searchText : '';
    if (!query) return [];
    const q = query.toLowerCase();
    return students.filter(s => s.studentId.includes(q) || s.displayName.toLowerCase().includes(q));
  }, [state, students]);

  const choose = (s: StudentAccount) => {
    selectStudent(s.studentId, 'manual');
    setFocusZone('mode-order');
  };

  const submitSearch = () => {
    if (suggestions.length > 0) choose(suggestions[activeIdx]);
  };

  const showHistoricalLock = isHistorical || state.kind === 'historical_readonly' || dateStatus === 'closed';

  // Student transactions for TransactionStatusView
  const studentTransactions = useMemo(() => {
    if (!picked) return [];
    return (tx as LedgerTransaction[]).filter(t => t.studentId === picked.studentId);
  }, [tx, picked]);

  // All-date transactions for history view (sorted newest-first)
  const allStudentTransactions = useMemo(() => {
    if (!picked) return [];
    return (props.allTx as LedgerTransaction[])
      .filter(t => t.studentId === picked.studentId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [props.allTx, picked]);

  return (
    <div className="main">
      <div className="col-main">
        {!isHistorical && !(state.kind === 'historical_readonly') && dateStatus !== 'closed' && viewDate !== systemDate && (
          <MidnightBanner viewDate={viewDate} systemDate={systemDate} onSwitchToToday={() => setViewDate(systemDate)} />
        )}
        {showHistoricalLock ? (
          <div className="historical-lock" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--c-text-dim)', textAlign: 'center' }}>
            <h2 style={{ color: 'var(--c-warn)', fontSize: '1.5rem', marginBottom: '8px' }}>目前檢視歷史紀錄</h2>
            <p style={{ marginBottom: '24px' }}>您正在檢視 {viewDate} 的資料。<br />為確保帳務正確，歷史紀錄模式下已暫停結帳與訂餐功能。</p>
            <button className="btn-confirm" onClick={() => setViewDate(systemDate)}>返回今日</button>
          </div>
        ) : !picked ? (
          <>
            {expenseProps ? (
              <ExpensePanel
                kind={expenseProps.kind}
                amountText={expenseProps.amountText}
                amount={expenseProps.amount}
                onAmountChange={updateExpenseAmount}
                onAmountConfirm={confirmExpenseAmount}
                onDirectionSelect={selectExpenseDirection}
                onReasonSelect={selectExpenseReason}
                onNoteChange={updateExpenseNote}
                onNoteConfirm={confirmExpenseNote}
                onCancel={cancelFlow}
              />
            ) : (
              <>
                {crashDraftRestored && (
                  <div className="midnight-banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: 'var(--r)', marginBottom: '12px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--accent-ink)' }}>偵測到未完成交易草稿，已自動恢復</span>
                    <button className="ghost-btn" style={{ fontSize: '12px' }} onClick={() => setCrashDraftRestored(false)}>關閉</button>
                  </div>
                )}
                <SearchBox
                  value={state.kind === 'idle' ? state.searchText : ''}
                  onChange={(v) => { setSearchText(v); setActiveIdx(0); }}
                  onSubmit={submitSearch}
                  onEsc={() => { setSearchText(''); setActiveIdx(0); }}
                  suggestions={suggestions}
                  activeIdx={activeIdx}
                  onPick={choose}
                  onHover={setActiveIdx}
                  focusKey={searchFocusKey}
                  disabled={hasFlash}
                  onEnterExpense={enterExpenseMode}
                  disableHoverSelection={tweaks.disableHoverSelection}
                />
                <IdleHero
                  todayMenu={todayMenu}
                  todayCount={todayCount}
                  vendorPhone={vendors.find(v => v.name === todayMenu.vendorNameSnapshot)?.phone}
                />
              </>
            )}
          </>
        ) : (
          <>
            <ActionBar
              mode={currentMode}
              setMode={(m) => {
                changeMode(m as PosMode);
                setFocusZone('mode-' + m);
              }}
              onStatusMode={() => setFocusZone('view-status')}
              focusZone={focusZone}
            />
            {expenseProps ? (
              <ExpensePanel
                kind={expenseProps.kind}
                amountText={expenseProps.amountText}
                amount={expenseProps.amount}
                onAmountChange={updateExpenseAmount}
                onAmountConfirm={confirmExpenseAmount}
                onDirectionSelect={selectExpenseDirection}
                onReasonSelect={selectExpenseReason}
                onNoteChange={updateExpenseNote}
                onNoteConfirm={confirmExpenseNote}
                onCancel={cancelFlow}
              />
            ) : (
              <CustomerCard
                student={picked}
                todayMenu={todayMenu}
                mode={currentMode}
                orderedTodayCount={orderedTodayCount}
                payAmount={currentPaidAmount}
                setPayAmount={setPaidAmountText}
                onViewHistory={onViewHistory}
                priceOverride={priceOverride}
                priceOverrideLabel={priceOverrideLabel}
                setPriceOverride={setPriceOverride}
                setPriceOverrideLabel={setPriceOverrideLabel}
                onDeleteOrder={handleDeleteOrder}
                focusZone={focusZone}
                studentTransactions={studentTransactions}
                onEditClick={handleRecentEditClick}
                onDeleteClick={handleRecentDeleteClick}
                locked={showHistoricalLock}
                allStudentTransactions={allStudentTransactions}
                onViewHistoryBack={() => setFocusZone('mode-' + currentMode)}
              />
            )}
            <ConfirmDialog
              open={state.kind === 'duplicate_warning'}
              title="❗ 已經訂過便當"
              message={`該學生今天已經訂過 ${orderedTodayCount} 次便當。確定要再訂一份嗎？ (家長可能用同一帳號為多位學員訂餐)`}
              onConfirm={handleConfirm}
              onCancel={cancelFlow}
              confirmLabel="是，再訂一份"
              cancelLabel="否"
              variant="danger"
            />
          </>
        )}
      </div>
      <div className="col-side">
        <RecentStrip
          groups={recentGroups}
          onStudentClick={!isHistorical && dateStatus !== 'closed' ? (sid) => { selectStudent(sid, 'manual', 'view-status'); setFocusZone('view-status'); } : undefined}
          dateStatus={dateStatus}
        />
      </div>
      <EditTransactionModal
        open={editingTx !== null}
        transaction={editingTx}
        onClose={() => setEditingTx(null)}
        onSave={handleRecentEditSave}
      />
      <DeleteConfirmDialog
        open={deleteConfirmTx !== null}
        studentName={deleteConfirmTx ? (students.find(s => s.studentId === deleteConfirmTx.studentId)?.displayName ?? '') : ''}
        transactionType={(deleteConfirmTx?.type === 'expense' ? 'expense' : 'payment') as 'payment' | 'expense'}
        amount={deleteConfirmTx ? (deleteConfirmTx.type === 'expense' ? deleteConfirmTx.amount : deleteConfirmTx.paidAmount) : 0}
        onConfirm={() => {
          if (deleteConfirmTx) {
            deleteTransaction(deleteConfirmTx.transactionId);
          }
          setDeleteConfirmTx(null);
        }}
        onCancel={() => setDeleteConfirmTx(null)}
      />
    </div>
  );
});
