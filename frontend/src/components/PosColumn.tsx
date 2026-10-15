import React, { useMemo, useState, useCallback } from 'react';
import { SearchBox, CustomerCard, ActionBar, IdleHero, RecentStrip, FaceActivityStrip, MidnightBanner, ExpensePanel, DeleteConfirmDialog } from './pos-components';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { useActiveOrderCount } from '../store/derived/useLedger';
import { useTransactionActions } from '../store/selectors';
import { groupLedgerRowsByStudent } from '../domain/ledgerReport';
import { filterSearchSuggestions } from '../domain/posSearch';
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
    todayMenu, todayCount, todayOtherCount = 0, vendors, enterExpenseMode, tweaks,
    tx, operatorUid, priceOverride, priceOverrideLabel, setPriceOverride, setPriceOverrideLabel,
    onViewAllHistory,
  } = props;

  const orderedTodayCount = useActiveOrderCount(picked?.studentId ?? null, viewDate);

  const { deleteTransaction, editTransaction } = useTransactionActions();

  // Group raw transactions by student for RecentStrip
  const recentGroups = useMemo(
    () => groupLedgerRowsByStudent(tx as LedgerTransaction[]),
    [tx],
  );

  const currentBalances = useMemo(
    () => new Map(students.map(s => [s.studentId, s.currentBalance])),
    [students],
  );

  // 側欄（刷臉訂餐動態、最近帳戶）點一個人：選到 F1 看當日狀況。歷史或關帳日不能點。
  const onSideStudentClick = !isHistorical && dateStatus !== 'closed'
    ? (sid: string) => { selectStudent(sid, 'manual', 'view-status'); setFocusZone('view-status'); }
    : undefined;

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
    (transactionId: string, updates: { mealPrice: number; paidAmount: number; note: string }, reason: string) =>
      editTransaction(transactionId, updates, { reason, operatorId: operatorUid }),
    [editTransaction, operatorUid],
  );

  // M1 F01：選取以帳戶編號記住，不用可能過期的位置；清單變動後找不到就回到第一筆。
  const [activeId, setActiveId] = useState<string | null>(null);

  const suggestions = useMemo(() => {
    const query = state.kind === 'idle' ? state.searchText : '';
    return filterSearchSuggestions(students, query);
  }, [state, students]);

  const activeIdx = Math.max(0, suggestions.findIndex(s => s.studentId === activeId));
  const setActiveIdx = useCallback((idx: number) => {
    setActiveId(suggestions[idx]?.studentId ?? null);
  }, [suggestions]);

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

  // M1／M2：送出失敗要讓櫃台看到原因。櫃台收支沒有選帳戶，畫面回到搜尋列，也要在那裡顯示；
  // 它的金額與原因沒有留在錯誤狀態裡，所以不說「草稿還在」。訊息本身可能已帶句號，避免出現「。。」。
  const commitErrorBanner = state.kind === 'error' ? (
    <div className="pos-commit-error" role="alert">
      沒有存進去：{state.message.replace(/[。.]+$/, '')}。
      {state.studentId
        ? <>這筆草稿還在，{state.retryable ? '按 Enter 重送同一筆，' : ''}按 Esc 取消重來。</>
        : <>這筆櫃台收支沒有記錄，按 Esc 關閉這則提示。</>}
    </div>
  ) : null;

  return (
    <div className="main">
      <div className="col-main">
        {!isHistorical && !(state.kind === 'historical_readonly') && dateStatus !== 'closed' && viewDate !== systemDate && (
          <MidnightBanner viewDate={viewDate} systemDate={systemDate} onSwitchToToday={() => setViewDate(systemDate)} />
        )}
        {showHistoricalLock ? (
          <div className="historical-lock" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--c-text-dim)', textAlign: 'center' }}>
            {viewDate === systemDate && dateStatus === 'closed' ? (
              // M3：今天已關帳時說清楚原因和下一步，不要說成「歷史紀錄」。
              <>
                <h2 style={{ color: 'var(--c-warn)', fontSize: '1.5rem', marginBottom: '8px' }}>今天（{viewDate}）已經關帳</h2>
                <p style={{ marginBottom: '24px' }}>關帳後不能再訂餐、繳費或新增櫃台收支。<br />要補登或更正，請先到今日帳（F2）按「重新開啟日期」並寫下原因。</p>
              </>
            ) : (
              <>
                <h2 style={{ color: 'var(--c-warn)', fontSize: '1.5rem', marginBottom: '8px' }}>目前檢視歷史紀錄</h2>
                <p style={{ marginBottom: '24px' }}>您正在檢視 {viewDate} 的資料。<br />為確保帳務正確，歷史紀錄模式下已暫停結帳與訂餐功能。</p>
                <button className="btn-confirm" onClick={() => setViewDate(systemDate)}>返回今日</button>
              </>
            )}
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
                {commitErrorBanner}
                {crashDraftRestored && (
                  <div className="midnight-banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: 'var(--r)', marginBottom: '12px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--accent-ink)' }}>偵測到未完成交易草稿，已自動恢復</span>
                    <button className="ghost-btn" style={{ fontSize: '12px' }} onClick={() => setCrashDraftRestored(false)}>關閉</button>
                  </div>
                )}
                <SearchBox
                  value={state.kind === 'idle' ? state.searchText : ''}
                  onChange={(v) => { setSearchText(v); setActiveId(null); }}
                  onSubmit={submitSearch}
                  onEsc={() => { setSearchText(''); setActiveId(null); }}
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
                  todayOtherCount={todayOtherCount}
                  vendorPhone={(vendors.find(v => v.vendorId === todayMenu.vendorId) ?? vendors.find(v => v.name === todayMenu.vendorNameSnapshot))?.phone}
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
              <>
              {commitErrorBanner}
              <CustomerCard
                student={picked}
                todayMenu={todayMenu}
                mode={currentMode}
                orderedTodayCount={orderedTodayCount}
                payAmount={currentPaidAmount}
                setPayAmount={setPaidAmountText}
                priceOverride={priceOverride}
                priceOverrideLabel={priceOverrideLabel}
                setPriceOverride={setPriceOverride}
                setPriceOverrideLabel={setPriceOverrideLabel}

                focusZone={focusZone}
                studentTransactions={studentTransactions}
                onEditClick={handleRecentEditClick}
                onDeleteClick={handleRecentDeleteClick}
                onViewAllHistory={() => picked && onViewAllHistory?.(picked)}
                locked={showHistoricalLock}
                onConfirm={handleConfirm}
                onCancel={cancelFlow}
                busy={state.kind === 'committing'}
              />
              </>
            )}
            <ConfirmDialog
              open={state.kind === 'duplicate_warning'}
              title="❗ 已經訂過餐點"
              message={`該學生今天已訂 ${orderedTodayCount} 份餐點。確定要再訂一份嗎？（家長可能用同一帳號為多位學員訂餐）預設是不加訂；要加訂請按 → 移到「是，再訂一份」再按 Enter，或直接點它。`}
              onConfirm={handleConfirm}
              onCancel={cancelFlow}
              confirmLabel="是，再訂一份"
              cancelLabel="否，不加訂"
              variant="danger"
              defaultAction="cancel"
            />
          </>
        )}
      </div>
      <div className="col-side">
        <FaceActivityStrip
          viewDate={viewDate}
          onStudentClick={onSideStudentClick}
        />
        <RecentStrip
          groups={recentGroups}
          balances={currentBalances}
          onStudentClick={onSideStudentClick}
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
        onConfirm={(reason) => {
          if (!deleteConfirmTx) return { ok: true };
          const result = deleteTransaction(deleteConfirmTx.transactionId, { reason, operatorId: operatorUid });
          if (result.ok) setDeleteConfirmTx(null);
          return result;
        }}
        onCancel={() => setDeleteConfirmTx(null)}
      />
    </div>
  );
});
