# RecentStrip 簡化 + E 訂餐狀況重設計 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 簡化 RecentStrip（移除展開明細），重設計 E 訂餐狀況面板（右對齊金額+編輯刪除），DRY 重構 Q/W 結帳明細，修正「檢視歷史」為就地顯示所有日期交易。

**Architecture:** 純前端 UI 層改動，不動 store / domain。RecentStrip 移除展開邏輯；TransactionStatusView 重設計為單行列表+操作按鈕；CustomerCard 用 shared render function DRY 化 Q/W 結帳明細並新增 view-history 模式；App.tsx 修改 onViewHistory 行為。

**Tech Stack:** React 19 + TypeScript 6 + Vitest 4 + Testing Library

**Spec:** `docs/superpowers/specs/2026-06-22-recent-strip-e-tab-redesign.md`  
**Issue:** #419

---

### Task 1: RecentStrip 簡化 — 移除展開明細邏輯

**Files:**
- Modify: `frontend/src/components/pos/RecentStrip.tsx`
- Modify: `frontend/src/components/PosColumn.tsx:203-209`
- Modify: `frontend/src/styles/pos.css:1149-1162`
- Test: `frontend/src/components/__tests__/pos-components.test.tsx`

- [ ] **Step 1: 更新 RecentStrip 測試 — 移除展開相關斷言、新增簡化行為測試**

在 `frontend/src/components/__tests__/pos-components.test.tsx` 中，找到 RecentStrip 相關測試。移除任何「展開明細」的測試，新增「點擊只觸發 onStudentClick」的測試。

先讀取現有 RecentStrip 測試內容，確認具體測試名稱後再修改。

- [ ] **Step 2: 執行測試確認失敗**

```bash
./workflow.sh t4-file src/components/__tests__/pos-components.test.tsx
```

Expected: 部分測試 FAIL（因為展開相關 props 還在）

- [ ] **Step 3: 簡化 RecentStrip 元件**

修改 `frontend/src/components/pos/RecentStrip.tsx`：

```tsx
import React, { useCallback } from 'react';
import type { LedgerGroup } from '../../domain/ledgerReport';
import { fmt } from './utils';

interface RecentStripProps {
  groups: LedgerGroup[];
  onStudentClick?: (studentId: string) => void;
  dateStatus: string;
}

export const RecentStrip = React.memo(function RecentStrip({
  groups,
  onStudentClick,
  dateStatus,
}: RecentStripProps) {
  // Show max 20 groups
  const displayGroups = groups.slice(0, 20);

  return (
    <div className="recent">
      <div className="recent-head">最近帳戶</div>
      <div className="recent-list">
        {displayGroups.length === 0 && <div className="recent-empty">尚無交易</div>}
        {displayGroups.map(g => {
          const isNeg = g.afterBalance < 0;
          return (
            <div key={g.studentId} className="recent-group">
              <div
                className="recent-row recent-row--group"
                onClick={() => onStudentClick?.(g.studentId)}
                style={{ cursor: onStudentClick ? 'pointer' : 'default' }}
              >
                <span className="recent-name">{g.studentNameSnapshot}</span>
                <span className="recent-group-count">{g.transactions.filter(t => t.type === 'order').length}個便當</span>
                <span className={'recent-amt mono ' + (isNeg ? 'neg' : 'pos')}>
                  餘額 {isNeg ? '−' : '+'}{fmt(g.afterBalance)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
```

關鍵移除：
- `useState` import（`expandedSids`）
- `useCallback` import 不再需要（`toggleExpand`、`handleStudentRowClick` 都移除）
- `RecentDetailRow` 子元件整段移除
- `onEditClick`、`onDeleteClick` props 移除
- 展開圖示 `▸` / `▾` 移除
- `isExpanded` 判斷和展開明細 JSX 移除

- [ ] **Step 4: 更新 PosColumn — 移除傳給 RecentStrip 的展開相關 props**

修改 `frontend/src/components/PosColumn.tsx` 第 203-209 行：

```tsx
      <RecentStrip
          groups={recentGroups}
          onStudentClick={!isHistorical && dateStatus !== 'closed' ? (sid) => { selectStudent(sid, 'manual', 'view-status'); setFocusZone('view-status'); } : undefined}
          dateStatus={dateStatus}
        />
```

移除 `onEditClick` 和 `onDeleteClick` props。

- [ ] **Step 5: 移除 CSS 中 RecentStrip 展開明細樣式**

修改 `frontend/src/styles/pos.css`，移除第 1149-1162 行：

```css
/* --- RecentStrip dual-column detail rows --- */
.recent-detail-header,
.recent-detail-row {
  display: grid;
  grid-template-columns: 70px 30px 1fr 1fr auto;
  gap: 4px;
  padding: 3px 8px;
  align-items: center;
  font-size: 0.85rem;
}
.recent-detail-header {
  color: var(--text-secondary, #888);
  border-bottom: 1px solid var(--border-light, #eee);
}
```

同時移除 `.recent-row--expanded` 相關的 CSS（如果有）。

- [ ] **Step 6: 執行測試確認通過**

```bash
./workflow.sh t4-file src/components/__tests__/pos-components.test.tsx
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/pos/RecentStrip.tsx frontend/src/components/PosColumn.tsx frontend/src/styles/pos.css frontend/src/components/__tests__/pos-components.test.tsx
git commit -m "refactor(pos): simplify RecentStrip — remove expand detail, click-to-navigate only

Closes part of #419"
```

---

### Task 2: TransactionStatusView 重設計 — 右對齊金額 + 編輯/刪除按鈕

**Files:**
- Modify: `frontend/src/components/pos/TransactionStatusView.tsx`
- Modify: `frontend/src/styles/pos.css:1114-1147`
- Modify: `frontend/src/components/pos/__tests__/TransactionStatusView.test.tsx`

- [ ] **Step 1: 更新 TransactionStatusView 測試**

修改 `frontend/src/components/pos/__tests__/TransactionStatusView.test.tsx`：

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { TransactionStatusView } from '../../pos-components';
import type { LedgerTransaction } from '../../../domain/ledger';

const baseTx: LedgerTransaction = {
  transactionId: 'tx-1',
  businessDate: '2026-06-18',
  createdAt: '2026-06-18T09:13:41Z',
  studentId: 's1',
  studentNameSnapshot: '王柏翰',
  menuNameSnapshot: '',
  vendorNameSnapshot: '',
  type: 'order',
  mealPrice: 60,
  paidAmount: 0,
  amount: 0,
  afterBalance: 440,
  sourceDevice: 'pc',
  syncStatus: 'synced',
  revision: 1,
  note: '',
} as LedgerTransaction;

function mockTx(overrides: Partial<LedgerTransaction> = {}): LedgerTransaction {
  return { ...baseTx, ...overrides };
}

describe('TransactionStatusView', () => {
  it('renders type badge', () => {
    render(<TransactionStatusView transactions={[mockTx({ type: 'order' })]} />);
    expect(screen.getByText('訂')).toBeInTheDocument();
  });

  it('renders time from createdAt', () => {
    const txs = [mockTx({ createdAt: '2026-06-18T09:13:41Z' })];
    render(<TransactionStatusView transactions={txs} />);
    const expected = new Date('2026-06-18T09:13:41Z').toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('renders empty state when no transactions', () => {
    render(<TransactionStatusView transactions={[]} />);
    expect(screen.getByText('今日無交易紀錄')).toBeInTheDocument();
  });

  it('shows right-aligned expense amount for order type', () => {
    const { container } = render(<TransactionStatusView transactions={[mockTx({ type: 'order', mealPrice: 60 })]} />);
    const amountEl = container.querySelector('.tx-amount');
    expect(amountEl?.textContent).toBe('−60');
    expect(amountEl?.className).toContain('neg');
  });

  it('shows right-aligned income amount for payment type', () => {
    const { container } = render(<TransactionStatusView transactions={[mockTx({ type: 'payment', paidAmount: 300 })]} />);
    const amountEl = container.querySelector('.tx-amount');
    expect(amountEl?.textContent).toBe('+300');
    expect(amountEl?.className).toContain('pos');
  });

  it('renders edit and delete buttons when callbacks provided and not locked', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(<TransactionStatusView transactions={[mockTx()]} onEditClick={onEdit} onDeleteClick={onDelete} />);
    expect(screen.getByLabelText('編輯')).toBeInTheDocument();
    expect(screen.getByLabelText('刪除')).toBeInTheDocument();
  });

  it('calls onEditClick when edit button clicked', () => {
    const onEdit = vi.fn();
    render(<TransactionStatusView transactions={[mockTx()]} onEditClick={onEdit} />);
    fireEvent.click(screen.getByLabelText('編輯'));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ transactionId: 'tx-1' }));
  });

  it('calls onDeleteClick when delete button clicked', () => {
    const onDelete = vi.fn();
    render(<TransactionStatusView transactions={[mockTx()]} onDeleteClick={onDelete} />);
    fireEvent.click(screen.getByLabelText('刪除'));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ transactionId: 'tx-1' }));
  });

  it('hides action buttons when locked', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(<TransactionStatusView transactions={[mockTx()]} onEditClick={onEdit} onDeleteClick={onDelete} locked />);
    expect(screen.queryByLabelText('編輯')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('刪除')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
./workflow.sh t4-file src/components/pos/__tests__/TransactionStatusView.test.tsx
```

Expected: FAIL（新 props 和新 class 尚未實作）

- [ ] **Step 3: 實作 TransactionStatusView 新設計**

修改 `frontend/src/components/pos/TransactionStatusView.tsx`：

```tsx
import React from 'react';
import type { LedgerTransaction } from '../../domain/ledger';
import { getIncome, getExpense } from '../../domain/transactionUtils';
import { fmt } from './utils';

interface TransactionStatusViewProps {
  transactions: LedgerTransaction[];
  onEditClick?: (tx: LedgerTransaction) => void;
  onDeleteClick?: (tx: LedgerTransaction) => void;
  locked?: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  order: '訂',
  payment: '繳',
  expense: '支',
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export const TransactionStatusView = React.memo(function TransactionStatusView({
  transactions,
  onEditClick,
  onDeleteClick,
  locked,
}: TransactionStatusViewProps) {
  if (transactions.length === 0) {
    return (
      <div className="tx-status-view">
        <div className="tx-status-empty">今日無交易紀錄</div>
      </div>
    );
  }

  return (
    <div className="tx-status-view">
      {transactions.map((tx) => {
        const income = getIncome(tx);
        const expense = getExpense(tx);
        const isIncome = income != null;
        const displayAmount = isIncome ? income : expense!;
        const sign = isIncome ? '+' : '−';
        const colorClass = isIncome ? 'pos' : 'neg';

        return (
          <div key={tx.transactionId} className="tx-status-row">
            <span className="tx-time">{formatTime(tx.createdAt)}</span>
            <span className={'tx-type-badge tx-type-' + tx.type}>{TYPE_LABELS[tx.type] ?? tx.type}</span>
            <span className={`tx-amount mono ${colorClass}`}>{sign}{fmt(displayAmount)}</span>
            {!locked && (onEditClick || onDeleteClick) && (
              <span className="tx-actions">
                {onEditClick && tx.type !== 'expense' && (
                  <button
                    className="recent-mini-btn"
                    onClick={() => onEditClick(tx)}
                    aria-label="編輯"
                  >✏️</button>
                )}
                {onDeleteClick && (
                  <button
                    className="recent-mini-btn recent-mini-del"
                    onClick={() => onDeleteClick(tx)}
                    aria-label="刪除"
                  >✕</button>
                )}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
});
```

關鍵改動：
- 移除 `actions` render prop，改用 `onEditClick` / `onDeleteClick` / `locked` props
- 移除雙欄 header（收入/支出）
- 每列改為：時間 + 類型 badge + **右對齊金額**（單一金額欄） + 操作按鈕
- import `fmt` from `./utils` 確保金額格式一致
- expense type 的 edit 按鈕不顯示（與 RecentStrip 邏輯一致）

- [ ] **Step 4: 更新 CSS — TransactionStatusView 新佈局**

修改 `frontend/src/styles/pos.css` 第 1114-1147 行，替換為：

```css
/* --- TransactionStatusView single-row layout --- */
.tx-status-view { width: 100%; }
.tx-status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px;
  font-size: 1rem;
  border-bottom: 1px solid var(--border-light, #eee);
}
.tx-status-row:last-child { border-bottom: 0; }
.tx-time { color: var(--ink-2); font-family: 'JetBrains Mono', monospace; white-space: nowrap; }
.tx-amount {
  margin-left: auto;
  text-align: right;
  font-weight: 600;
  font-size: 1.1rem;
  font-family: 'JetBrains Mono', monospace;
  white-space: nowrap;
}
.tx-amount.pos { color: var(--c-pos, #2e7d32); }
.tx-amount.neg { color: var(--c-neg, #c62828); }
.tx-type-badge {
  display: inline-block;
  width: 24px; height: 24px;
  line-height: 24px;
  text-align: center;
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 600;
}
.tx-type-order { background: var(--badge-order-bg, #e3f2fd); color: var(--badge-order-fg, #1565c0); }
.tx-type-payment { background: var(--badge-pay-bg, #e8f5e9); color: var(--badge-pay-fg, #2e7d32); }
.tx-type-expense { background: var(--badge-exp-bg, #fce4ec); color: var(--badge-exp-fg, #c62828); }
.tx-actions { display: flex; gap: 4px; margin-left: 8px; }
.tx-status-empty {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary, #888);
  font-size: 1rem;
}
```

同時移除不再使用的舊 class：`.tx-status-header`、`.tx-col-income`、`.tx-col-expense`。

**注意：** `.tx-col-income` 和 `.tx-col-expense` 也被 RecentStrip 的展開明細使用（已在 Task 1 移除），確認無其他使用方後再移除。

- [ ] **Step 5: 執行測試確認通過**

```bash
./workflow.sh t4-file src/components/pos/__tests__/TransactionStatusView.test.tsx
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/pos/TransactionStatusView.tsx frontend/src/styles/pos.css frontend/src/components/pos/__tests__/TransactionStatusView.test.tsx
git commit -m "feat(pos): redesign TransactionStatusView — right-aligned amount, edit/delete buttons

Part of #419"
```

---

### Task 3: CustomerCard DRY 重構 — Q/W 結帳明細共用化

**Files:**
- Modify: `frontend/src/components/pos/CustomerCard.tsx:73-170`
- Modify: `frontend/src/components/pos/__tests__/CustomerCard.test.tsx`

- [ ] **Step 1: 執行現有 CustomerCard 測試確認 baseline**

```bash
./workflow.sh t4-file src/components/pos/__tests__/CustomerCard.test.tsx
```

Expected: PASS（確認 baseline）

- [ ] **Step 2: 重構 CustomerCard 結帳明細區段**

修改 `frontend/src/components/pos/CustomerCard.tsx` 的 `bill-summary` 區段（約第 76-170 行）。

將 Q 和 W 模式的結帳明細合併為一個 shared block：

```tsx
{focusZone === 'view-status' ? (
  <TransactionStatusView
    transactions={studentTransactions ?? []}
    onEditClick={onEditClick}
    onDeleteClick={onDeleteClick}
    locked={locked}
  />
) : (<>
<div className="pay-title">結帳明細</div>
{/* Shared bill items for order & payment modes */}
<div className="bill-item no-border">
  <span className="bill-label">目前帳戶餘額</span>
  <span className={`bill-val${student.currentBalance < 0 ? ' neg' : ''}`}>
    {student.currentBalance < 0 ? '−' : ''}${fmt(student.currentBalance)}
  </span>
</div>
{mode === 'order' && (
  <div className="bill-item no-border">
    <span className="bill-label">今日便當 ({priceOverrideLabel || todayMenu.itemName})</span>
    <span className="bill-val neg">−${fmt(effectiveMealPrice)}</span>
  </div>
)}
<div className="bill-item no-border">
  <span className="bill-label">此次繳費金額</span>
  <span className="bill-val pos">
    +${fmt(parsedPayAmount)}
  </span>
</div>
<div className="bill-divider" />
<div className="bill-item bill-total">
  <span className="bill-label">預計結帳後餘額</span>
  <span className={`bill-val${projectedBalance < 0 ? ' neg' : ''}`}>
    {projectedBalance < 0 ? '−' : ''}${fmt(projectedBalance)}
  </span>
</div>
{/* ... price-override section stays unchanged, guarded by mode === 'order' ... */}
</>)}
```

**關鍵改動：**
- 移除 `{mode === 'order' && (<>` 和 `{mode === 'payment' && (<>` 的兩段重複 JSX
- 共用欄位（餘額、繳費金額、預計結帳後餘額）只寫一次
- 「今日便當」行只在 `mode === 'order'` 條件下顯示
- `projectedBalance` 計算已正確處理兩種模式（已有邏輯：order = balance - mealPrice + pay，payment = balance + pay）

**同時需新增 CustomerCard props：**
- `onEditClick?: (tx: LedgerTransaction) => void`
- `onDeleteClick?: (tx: LedgerTransaction) => void`
- `locked?: boolean`

這些 props 從 PosColumn 層傳入，用於 E 模式下的 TransactionStatusView。

- [ ] **Step 3: 更新 PosColumn 傳 props 給 CustomerCard**

修改 `frontend/src/components/PosColumn.tsx`，在 `<CustomerCard>` 呼叫處加上新 props：

```tsx
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
/>
```

- [ ] **Step 4: 執行測試確認通過**

```bash
./workflow.sh t4-file src/components/pos/__tests__/CustomerCard.test.tsx
```

Expected: PASS（現有測試斷言不變，因為 DOM 結構一致）

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/pos/CustomerCard.tsx frontend/src/components/PosColumn.tsx
git commit -m "refactor(pos): DRY CustomerCard bill summary — merge Q/W duplicate JSX, wire edit/delete to E tab

Part of #419"
```

---

### Task 4: 檢視歷史 — 就地顯示所有日期交易

**Files:**
- Modify: `frontend/src/App.tsx:148`
- Modify: `frontend/src/components/pos/CustomerCard.tsx`
- Modify: `frontend/src/components/PosColumn.tsx`
- Modify: `frontend/src/components/PosColumn.types.ts`
- Modify: `frontend/src/hooks/usePosColumnProps.ts`
- Test: `frontend/src/components/pos/__tests__/CustomerCard.test.tsx`

- [ ] **Step 1: 新增 CustomerCard 測試 — view-history 模式**

在 `frontend/src/components/pos/__tests__/CustomerCard.test.tsx` 新增 describe block：

```tsx
describe('view-history mode (#419)', () => {
  const historyTxs: LedgerTransaction[] = [
    mockTx({ transactionId: 'h1', businessDate: '2026-06-22', createdAt: '2026-06-22T10:00:00Z', type: 'order', mealPrice: 60 }),
    mockTx({ transactionId: 'h2', businessDate: '2026-06-21', createdAt: '2026-06-21T09:00:00Z', type: 'payment', paidAmount: 500 }),
  ];

  // Need to add LedgerTransaction import and mockTx helper at file top if not already present

  it('shows all-date transactions when focusZone is view-history', () => {
    renderCard({ focusZone: 'view-history', allStudentTransactions: historyTxs });
    // Should show date labels
    expect(screen.getByText(/2026-06-22/)).toBeDefined();
    expect(screen.getByText(/2026-06-21/)).toBeDefined();
  });

  it('shows back button in view-history mode', () => {
    renderCard({ focusZone: 'view-history', allStudentTransactions: historyTxs });
    expect(screen.getByText('返回')).toBeDefined();
  });

  it('hides bill summary in view-history mode', () => {
    const { container } = renderCard({ focusZone: 'view-history', allStudentTransactions: historyTxs });
    expect(container.querySelector('.bill-item')).toBeNull();
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
./workflow.sh t4-file src/components/pos/__tests__/CustomerCard.test.tsx
```

Expected: FAIL（`allStudentTransactions` prop 和 `view-history` 邏輯尚未實作）

- [ ] **Step 3: 更新 App.tsx — 修改 onViewHistory 行為**

修改 `frontend/src/App.tsx` 第 148 行：

```tsx
// Before:
onViewHistory: () => { setReportStudentFilter(picked!.studentId); setTab('report'); },
// After:
onViewHistory: () => { setFocusZone('view-history'); },
```

- [ ] **Step 4: 更新 PosColumn.types.ts — 新增 allStudentTransactions prop**

`allStudentTransactions` 不需要加到 PosColumnProps（它在 PosColumn 內部用 useMemo 從 allTx 派生），但 CustomerCard 需要新 prop。

在 `frontend/src/components/pos/CustomerCard.tsx` 的 `CustomerCardProps` interface 新增：

```tsx
allStudentTransactions?: LedgerTransaction[];
```

- [ ] **Step 5: 更新 PosColumn — 計算 allStudentTransactions 並傳入**

修改 `frontend/src/components/PosColumn.tsx`：

在現有的 `studentTransactions` useMemo 下方新增：

```tsx
// All-date transactions for history view (sorted newest-first)
const allStudentTransactions = useMemo(() => {
  if (!picked) return [];
  return (allTx as LedgerTransaction[])
    .filter(t => t.studentId === picked.studentId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}, [allTx, picked]);
```

在 `<CustomerCard>` 呼叫處加上 `allStudentTransactions={allStudentTransactions}`。

注意：`allTx` 已是 PosColumnProps 的一部分（`allTx: WorkflowTransactionView[]`），可直接使用。

- [ ] **Step 6: 更新 CustomerCard — 新增 view-history 渲染區段**

修改 `frontend/src/components/pos/CustomerCard.tsx`，在 `bill-summary` 區段增加 `view-history` 條件：

```tsx
{focusZone === 'view-history' ? (
  <div className="tx-history-view">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
      <div className="pay-title">交易歷史</div>
      <button className="ghost-btn" onClick={onViewHistoryBack} style={{ fontSize: '13px' }}>返回</button>
    </div>
    {allStudentTransactions && allStudentTransactions.length > 0 ? (
      (() => {
        // Group by businessDate
        const grouped = new Map<string, LedgerTransaction[]>();
        for (const tx of allStudentTransactions) {
          const arr = grouped.get(tx.businessDate) ?? [];
          arr.push(tx);
          grouped.set(tx.businessDate, arr);
        }
        return Array.from(grouped.entries()).map(([date, txs]) => (
          <div key={date} className="tx-history-date-group">
            <div className="tx-history-date-label">{date}</div>
            <TransactionStatusView transactions={txs} />
          </div>
        ));
      })()
    ) : (
      <div className="tx-status-empty">無交易紀錄</div>
    )}
  </div>
) : focusZone === 'view-status' ? (
  // ... existing view-status code
```

新增 CustomerCardProps：
- `allStudentTransactions?: LedgerTransaction[]`
- `onViewHistoryBack?: () => void`（返回按鈕的 callback）

`onViewHistoryBack` 在 PosColumn 層實作為 `() => setFocusZone('view-status')` 或 `() => setFocusZone('mode-' + currentMode)`。

- [ ] **Step 7: 新增 CSS — 歷史視圖日期分隔**

在 `frontend/src/styles/pos.css` 末尾新增：

```css
/* --- History view date groups --- */
.tx-history-view { width: 100%; max-height: 400px; overflow-y: auto; }
.tx-history-date-group { margin-bottom: 8px; }
.tx-history-date-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--ink-2);
  padding: 4px 0;
  border-bottom: 1px solid var(--line-2);
  margin-bottom: 4px;
}
```

- [ ] **Step 8: 更新 ActionBar — view-history 時隱藏 pay-panel**

在 `frontend/src/components/pos/CustomerCard.tsx` 中，右側 `pay-panel` 的條件判斷需加入 `view-history`：

現有判斷（約第 174 行）：
```tsx
{focusZone !== 'view-status' && mode !== 'expense' ? (
```

改為：
```tsx
{focusZone !== 'view-status' && focusZone !== 'view-history' && mode !== 'expense' ? (
```

結尾的 null 分支也需更新。

- [ ] **Step 9: 執行測試確認通過**

```bash
./workflow.sh t4-file src/components/pos/__tests__/CustomerCard.test.tsx
```

Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/pos/CustomerCard.tsx frontend/src/components/PosColumn.tsx frontend/src/App.tsx frontend/src/styles/pos.css frontend/src/components/pos/__tests__/CustomerCard.test.tsx
git commit -m "feat(pos): view-history in POS — show all-date student transactions in-place

Part of #419"
```

---

### Task 5: 字體放大 + 最終整合測試

**Files:**
- Modify: `frontend/src/styles/pos.css`

- [ ] **Step 1: 放大 mode-lbl 字體**

修改 `frontend/src/styles/pos.css` 第 710-713 行：

```css
.mode-lbl {
  font-size: 20px;
  font-weight: 500;
}
```

（從 15px → 20px）

- [ ] **Step 2: 確認 TransactionStatusView 字體已在 Task 2 調整**

Task 2 已將 `.tx-status-row` font-size 設為 `1rem`（16px），`.tx-amount` 為 `1.1rem`。確認無遺漏。

- [ ] **Step 3: 執行完整測試套件**

```bash
./workflow.sh t2
./workflow.sh t3
./workflow.sh t4
./workflow.sh t1
```

Expected: 全 PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/styles/pos.css
git commit -m "style(pos): increase font size for ActionBar labels and TransactionStatusView

Closes #419"
```

---

### Task 6: 清理 — 移除不再使用的 import 和 type

**Files:**
- Verify: `frontend/src/components/pos/RecentStrip.tsx` — 確認無 dead import
- Verify: `frontend/src/components/pos/TransactionStatusView.tsx` — 確認 `actions` render prop 已完全移除
- Verify: `frontend/src/components/PosColumn.tsx` — 確認 dead handlers 已清理或仍被使用
- Verify: `frontend/src/App.tsx` — 如果 `setReportStudentFilter` / `reportStudentFilter` 仍被其他地方使用則保留

- [ ] **Step 1: 確認 reportStudentFilter 是否仍被使用**

`reportStudentFilter` 仍由 AppRouter 使用（tab='report' 時），保留不動。`onViewHistory` 不再使用它，但其他進入報表的路徑可能仍需要。

- [ ] **Step 2: 檢查 .tx-col-income / .tx-col-expense CSS class 的使用**

```bash
grep -r "tx-col-income\|tx-col-expense" frontend/src/ --include="*.tsx" --include="*.ts"
```

如果已無 TSX/TS 使用，移除 pos.css 中的：
```css
.tx-col-income { ... }
.tx-col-expense { ... }
```

- [ ] **Step 3: 最終 typecheck + lint + full test**

```bash
./workflow.sh t2
./workflow.sh t3
./workflow.sh t4
./workflow.sh t1
```

Expected: 全 PASS

- [ ] **Step 4: Commit 清理（如有改動）**

```bash
git add -A
git commit -m "chore(pos): remove dead CSS classes and unused imports from RecentStrip/TSV refactor

Part of #419"
```
