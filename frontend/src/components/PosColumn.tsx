import React, { useMemo, useState } from 'react';
import { SearchBox, CustomerCard, ActionBar, IdleHero, RecentStrip, DuplicateWarningBanner, MidnightBanner, ExpensePanel } from './pos-components';
import { useActiveOrderCount, useMergedTransactions } from '../store/derived/useLedger';
import type { PosColumnProps } from './PosColumn.types';

export const PosColumn = React.memo(function PosColumn(props: PosColumnProps) {
  const {
    state, isHistorical, dateStatus, viewDate, systemDate, setViewDate,
    picked, currentMode, currentPaidAmount, students, selectStudent,
    expenseProps,
    updateExpenseAmount, confirmExpenseAmount, selectExpenseDirection, selectExpenseReason,
    updateExpenseNote, confirmExpenseNote,
    setPaidAmountText, handleConfirm, cancelFlow, changeMode, setFocusZone, focusZone, openCancelConfirm,
    setSearchText, searchFocusKey, hasFlash,
    crashDraftRestored, setCrashDraftRestored,
    todayMenu, todayCount, vendors, enterExpenseMode, tweaks,
    tx, priceOverride, priceOverrideLabel, setPriceOverride, setPriceOverrideLabel,
    handleDeleteOrder, onViewHistory,
  } = props;

  const orderedTodayCount = useActiveOrderCount(picked?.studentId ?? null, viewDate);
  const mergedTx = useMergedTransactions(tx);
  // Ref: #323 — Memoize mapped array to avoid defeating React.memo on RecentStrip
  const recentStripData = useMemo(
    () => mergedTx.map((t, i) => ({ ...t, uid: i + '-' + t.createdAt })),
    [mergedTx],
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
              />
            )}
            {state.kind === 'duplicate_warning' && (
              <DuplicateWarningBanner
                orderedTodayCount={orderedTodayCount}
                onConfirm={handleConfirm}
                onCancel={cancelFlow}
              />
            )}
            <ActionBar
              mode={currentMode}
              setMode={(m) => {
                changeMode(m as PosMode);
                setFocusZone('mode-' + m);
              }}
              onDeleteOrder={openCancelConfirm}
              focusZone={focusZone}
              onConfirm={handleConfirm}
              onCancel={cancelFlow}
            />
          </>
        )}
      </div>
      <div className="col-side">
        <RecentStrip
          recent={recentStripData}
          onItemClick={!isHistorical && dateStatus !== 'closed' ? (sid) => selectStudent(sid, 'manual') : undefined}
        />
      </div>
    </div>
  );
});
