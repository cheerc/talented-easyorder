# RecentStrip 學生帳戶群組模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor RecentStrip from a flat order-only list to a student-account-grouped collapsible panel with inline edit/delete, showing all transaction types.

**Architecture:** RecentStrip becomes a grouped accordion. Each student row shows name + balance; clicking expands to show all transactions (order, payment) sorted by time. Detail rows have edit (✏️) and delete (✕) buttons. Grouping logic reuses the existing `groupLedgerRowsByStudent()` from `domain/ledgerReport.ts`. Edit/delete reuses `EditTransactionModal` and `useTransactionActions()`.

**Tech Stack:** React 19, TypeScript, Zustand (existing store actions), existing UI components

**refs:** #392, #381, #370, #375

---

## Required Reads

```yaml
required_reads:
  - frontend/src/components/pos/RecentStrip.tsx
  - frontend/src/components/PosColumn.tsx
  - frontend/src/components/PosColumn.types.ts
  - frontend/src/domain/ledger.ts
  - frontend/src/domain/ledgerReport.ts
  - frontend/src/components/report/LedgerGroupedTable.tsx
  - frontend/src/components/report/DetailRow.tsx
  - frontend/src/components/screens/ReportScreen.tsx
  - frontend/src/components/EditTransactionModal.tsx
  - frontend/src/store/selectors.ts
  - frontend/src/store/posActions/editActions.ts
  - frontend/src/__tests__/pos-components.test.tsx
```

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `components/pos/RecentStrip.tsx` | **Major rewrite** | Grouped accordion with expand/collapse, detail rows, edit/delete buttons |
| `components/PosColumn.tsx` | **Modify** | Pass raw `tx` (LedgerTransaction[]) + edit/delete handlers to RecentStrip |
| `components/PosColumn.types.ts` | **Modify** | Add `operatorUid` to props (needed for audit trail on edit/delete) |
| `__tests__/pos-components.test.tsx` | **Major rewrite** | Update RecentStrip tests for grouped mode |

⚠️ **Scope boundary:** 本 plan 不改 `domain/ledger.ts`、`domain/ledgerReport.ts`、`store/` 或任何 report/ 元件。所有 grouping 邏輯使用現有的 `groupLedgerRowsByStudent()`，edit/delete 使用現有的 `useTransactionActions()`。

---

## Test Impact

以下測試檔/fixture 可能受影響（impl 須在實作前先讀）：

- `frontend/src/components/__tests__/pos-components.test.tsx` — RecentStrip section (L11-106, L352-357) **需完全重寫**（現有 8 edge case 測 flat order-only，新版測 grouped + expand/collapse + edit/delete）
- 其他 pos-components 測試（同檔案其他 section）**不受影響**

---

## Task 1: 擴展 PosColumn props — 傳遞 raw transactions + operatorUid

**Files:**
- Modify: `frontend/src/components/PosColumn.types.ts`
- Modify: `frontend/src/components/PosColumn.tsx`

**Why:** RecentStrip 群組模式需要原始 `LedgerTransaction[]`（非 merged）來展示每筆明細，也需要 `operatorUid` 做 edit/delete 的 audit trail。目前 PosColumn 只傳 merged data 給 RecentStrip。

- [ ] **Step 1: 在 PosColumn.types.ts 增加 operatorUid prop**

在 `PosColumnProps` interface 增加：
```ts
operatorUid: string;
```

確認 `tx` prop 已存在（`WorkflowTransactionView[]`，可直接當 `LedgerTransaction[]` 用——`transactionViews.ts` 有 compile-time assertion）。

- [ ] **Step 2: 在 PosColumn.tsx 引入 edit/delete 依賴**

```ts
// 新增 imports
import { useTransactionActions } from '../store/selectors';
import { groupLedgerRowsByStudent } from '../domain/ledgerReport';
import type { LedgerTransaction, TransactionEditView } from '../domain/ledger';
```

- [ ] **Step 3: 在 PosColumn 內新增 grouped data + edit/delete state**

在 component body（destructure props 後）加入：

```ts
const { operatorUid } = props;
const { deleteOrderWithRefundCheck, deleteTransaction, editTransaction } = useTransactionActions();

// Group raw transactions by student for RecentStrip
const recentGroups = useMemo(
  () => groupLedgerRowsByStudent(tx as LedgerTransaction[]),
  [tx],
);

// Edit modal state
const [editingTx, setEditingTx] = useState<TransactionEditView | null>(null);

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
    deleteOrderWithRefundCheck(t.transactionId, operatorUid);
  } else {
    deleteTransaction(t.transactionId);
  }
};

const handleRecentEditSave = useCallback(
  (transactionId: string, updates: { mealPrice: number; paidAmount: number; note: string }) => {
    editTransaction(transactionId, updates, operatorUid);
  },
  [editTransaction, operatorUid],
);
```

- [ ] **Step 4: 更新 RecentStrip 呼叫，傳遞新 props**

將原本的：
```tsx
<RecentStrip
  recent={recentStripData}
  onItemClick={...}
/>
```

改為：
```tsx
<RecentStrip
  groups={recentGroups}
  onStudentClick={!isHistorical && dateStatus !== 'closed' ? (sid) => selectStudent(sid, 'manual') : undefined}
  onEditClick={showHistoricalLock ? undefined : handleRecentEditClick}
  onDeleteClick={showHistoricalLock ? undefined : handleRecentDeleteClick}
  dateStatus={dateStatus}
/>
```

- [ ] **Step 5: 在 PosColumn 的 JSX 末尾加入 EditTransactionModal**

```tsx
import { EditTransactionModal } from './EditTransactionModal';
// ...
{/* 在 col-side div 外面、component return 的最外層 div 內加 */}
<EditTransactionModal
  open={editingTx !== null}
  transaction={editingTx}
  onClose={() => setEditingTx(null)}
  onSave={handleRecentEditSave}
/>
```

- [ ] **Step 6: 移除不再需要的 recentStripData**

`recentStripData` 和 `useMergedTransactions` 若不再被其他地方使用（搜尋確認），從 PosColumn 移除。**注意：** `useActiveOrderCount` 仍在使用 `useMergedTransactions` 所在的檔案的 export，不要刪 import。`mergedTx` 若被 `orderedTodayCount` 外的地方引用則保留。

> **驗證：** `grep -n 'mergedTx\|recentStripData' PosColumn.tsx` 確認移除乾淨。

- [ ] **Step 7: Commit**
```bash
git add frontend/src/components/PosColumn.tsx frontend/src/components/PosColumn.types.ts
git commit -m "refactor(PosColumn): pass grouped data + edit/delete handlers to RecentStrip (#392)"
```

---

## Task 2: 重寫 RecentStrip — 群組摺疊模式

**Files:**
- Rewrite: `frontend/src/components/pos/RecentStrip.tsx` (~120 lines target, not hard limit)

**Why:** 核心改動。從 flat order list 變成 student-grouped accordion with expand/collapse + detail rows。

- [ ] **Step 1: 定義新的 Props interface**

```tsx
import React, { useState, useCallback } from 'react';
import type { LedgerGroup } from '../../domain/ledgerReport';
import type { LedgerTransaction } from '../../domain/ledger';
import { fmt } from './utils';

interface RecentStripProps {
  groups: LedgerGroup[];
  onStudentClick?: (studentId: string) => void;
  onEditClick?: (tx: LedgerTransaction) => void;
  onDeleteClick?: (tx: LedgerTransaction) => void;
  dateStatus: string;
}
```

- [ ] **Step 2: 實作主 component + student group row**

```tsx
export const RecentStrip = React.memo(function RecentStrip({
  groups,
  onStudentClick,
  onEditClick,
  onDeleteClick,
  dateStatus,
}: RecentStripProps) {
  const [expandedSids, setExpandedSids] = useState<Set<string>>(new Set());
  const locked = dateStatus === 'closed';

  const toggleExpand = useCallback((sid: string) => {
    setExpandedSids(prev => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  }, []);

  const handleStudentRowClick = useCallback((sid: string) => {
    toggleExpand(sid);
    onStudentClick?.(sid);
  }, [toggleExpand, onStudentClick]);

  // Show max 20 groups
  const displayGroups = groups.slice(0, 20);

  return (
    <div className="recent">
      <div className="recent-head">最近帳戶</div>
      <div className="recent-list">
        {displayGroups.length === 0 && <div className="recent-empty">尚無交易</div>}
        {displayGroups.map(g => {
          const isExpanded = expandedSids.has(g.studentId);
          const isNeg = g.afterBalance < 0;
          return (
            <div key={g.studentId} className="recent-group">
              {/* Student summary row */}
              <div
                className={'recent-row recent-row--group' + (isExpanded ? ' recent-row--expanded' : '')}
                onClick={() => handleStudentRowClick(g.studentId)}
                style={{ cursor: 'pointer' }}
              >
                <span className="recent-expand-icon">{isExpanded ? '▾' : '▸'}</span>
                <span className="recent-name">{g.studentNameSnapshot}</span>
                <span className="recent-group-count">{g.recordCount}筆</span>
                <span className={'recent-amt mono ' + (isNeg ? 'neg' : 'pos')}>
                  餘額 {isNeg ? '−' : ''}{fmt(g.afterBalance)}
                </span>
              </div>
              {/* Expanded detail rows */}
              {isExpanded && (
                <div className="recent-details">
                  {g.transactions.map(tx => (
                    <RecentDetailRow
                      key={tx.transactionId}
                      tx={tx}
                      locked={locked}
                      onEditClick={onEditClick}
                      onDeleteClick={onDeleteClick}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
```

- [ ] **Step 3: 實作 RecentDetailRow 子元件**

在同一檔案內（private sub-component）：

```tsx
const TYPE_LABELS: Record<string, string> = {
  order: '訂',
  payment: '繳',
  expense: '支',
};

const RecentDetailRow = React.memo(function RecentDetailRow({
  tx,
  locked,
  onEditClick,
  onDeleteClick,
}: {
  tx: LedgerTransaction;
  locked: boolean;
  onEditClick?: (tx: LedgerTransaction) => void;
  onDeleteClick?: (tx: LedgerTransaction) => void;
}) {
  const time = tx.createdAt.slice(11, 19);
  const typeLabel = TYPE_LABELS[tx.type] ?? tx.type;
  const amount = tx.type === 'order' ? -tx.mealPrice : tx.paidAmount;
  const isNeg = amount < 0;

  return (
    <div className="recent-detail-row">
      <span className="recent-time mono">{time}</span>
      <span className={'recent-type type-' + tx.type}>{typeLabel}</span>
      <span className={'recent-detail-amt mono ' + (isNeg ? 'neg' : 'pos')}>
        {isNeg ? '−' : '+'}{fmt(amount)}
      </span>
      {!locked && (onEditClick || onDeleteClick) && (
        <span className="recent-detail-actions">
          {onEditClick && tx.type !== 'expense' && (
            <button
              className="recent-mini-btn"
              onClick={(e) => { e.stopPropagation(); onEditClick(tx); }}
              aria-label="編輯"
            >✏️</button>
          )}
          {onDeleteClick && (
            <button
              className="recent-mini-btn recent-mini-del"
              onClick={(e) => { e.stopPropagation(); onDeleteClick(tx); }}
              aria-label="刪除"
            >✕</button>
          )}
        </span>
      )}
    </div>
  );
});
```

- [ ] **Step 4: 加入 CSS**

在 `frontend/src/index.css`（或 RecentStrip 使用的 CSS 檔）加入新 class：

```css
/* RecentStrip grouped mode */
.recent-group { border-bottom: 1px solid var(--border-1, #e5e7eb); }
.recent-row--group { display: flex; align-items: center; gap: 6px; padding: 6px 8px; }
.recent-row--group:hover { background: var(--surface-hover, #f3f4f6); }
.recent-row--expanded { background: var(--surface-active, #eff6ff); }
.recent-expand-icon { font-size: 10px; width: 14px; color: var(--ink-3, #9ca3af); }
.recent-group-count { font-size: 12px; color: var(--ink-3, #9ca3af); margin-left: auto; margin-right: 8px; }
.recent-details { padding-left: 20px; background: var(--surface-1, #fafafa); }
.recent-detail-row { display: flex; align-items: center; gap: 6px; padding: 4px 8px; font-size: 13px; }
.recent-detail-row:hover { background: var(--surface-hover, #f3f4f6); }
.recent-detail-amt { margin-left: auto; }
.recent-detail-actions { display: flex; gap: 4px; margin-left: 8px; }
.recent-mini-btn { background: none; border: none; cursor: pointer; font-size: 13px; padding: 2px 4px; border-radius: 3px; }
.recent-mini-btn:hover { background: var(--surface-hover, #e5e7eb); }
.recent-mini-del { color: var(--danger, #ef4444); }
.recent-mini-del:hover { background: rgba(239, 68, 68, 0.1); }
```

> **驗證：** CSS 變數名使用前 grep 確認專案內已有定義（`grep -r 'var(--surface' frontend/src/index.css`），缺少則用 fallback 值。

- [ ] **Step 5: Commit**
```bash
git add frontend/src/components/pos/RecentStrip.tsx frontend/src/index.css
git commit -m "feat(RecentStrip): grouped student accordion with expand/collapse + edit/delete (#392)"
```

---

## Task 3: 更新 RecentStrip 測試

**Files:**
- Rewrite: `frontend/src/components/__tests__/pos-components.test.tsx` (RecentStrip section only, L11-106, L352-357)

**Why:** 現有 8 個 edge case 測試完全基於 flat order-only 模式，需要重寫為 grouped mode。

- [ ] **Step 1: 重寫 RecentStrip test fixtures**

用 `LedgerGroup[]` 取代原本的 `MergedTransaction[]`。建立 helper：

```ts
import type { LedgerGroup } from '../../domain/ledgerReport';
import type { LedgerTransaction } from '../../domain/ledger';

function makeTx(overrides: Partial<LedgerTransaction> & { transactionId: string; studentId: string; type: string }): LedgerTransaction {
  return {
    businessDate: '2026-01-01',
    createdAt: '2026-01-01T10:00:00Z',
    studentNameSnapshot: 'Test Student',
    mealPrice: 0,
    paidAmount: 0,
    amount: 0,
    afterBalance: 0,
    menuNameSnapshot: '',
    vendorNameSnapshot: '',
    sourceDevice: 'pc' as const,
    syncStatus: 'synced' as any,
    revision: 1,
    note: '',
    ...overrides,
  } as LedgerTransaction;
}

function makeGroup(studentId: string, name: string, transactions: LedgerTransaction[], balance: number): LedgerGroup {
  return {
    studentId,
    studentNameSnapshot: name,
    latestCreatedAt: transactions[transactions.length - 1]?.createdAt ?? '',
    mealTotal: transactions.filter(t => t.type === 'order').reduce((s, t) => s + t.mealPrice, 0),
    paidTotal: transactions.reduce((s, t) => s + t.paidAmount, 0),
    afterBalance: balance,
    recordCount: transactions.length,
    transactions,
  };
}
```

- [ ] **Step 2: 測試群組摘要列顯示**

```ts
it('renders student group rows with name and balance', () => {
  const groups = [
    makeGroup('S001', '王小明', [
      makeTx({ transactionId: 't1', studentId: 'S001', type: 'order', mealPrice: 90, afterBalance: -90 }),
    ], -90),
  ];
  render(<RecentStrip groups={groups} dateStatus="open" />);
  expect(screen.getByText('王小明')).toBeInTheDocument();
  expect(screen.getByText(/餘額/)).toBeInTheDocument();
  expect(screen.getByText('1筆')).toBeInTheDocument();
});
```

- [ ] **Step 3: 測試展開/收合**

```ts
it('expands to show detail rows on click, collapses on second click', async () => {
  const groups = [
    makeGroup('S001', '王小明', [
      makeTx({ transactionId: 't1', studentId: 'S001', type: 'order', mealPrice: 90, createdAt: '2026-01-01T10:00:00Z' }),
      makeTx({ transactionId: 't2', studentId: 'S001', type: 'payment', paidAmount: 90, createdAt: '2026-01-01T10:05:00Z' }),
    ], 0),
  ];
  render(<RecentStrip groups={groups} dateStatus="open" />);

  // Initially collapsed — no detail rows
  expect(screen.queryByText('10:00:00')).not.toBeInTheDocument();

  // Click to expand
  await userEvent.click(screen.getByText('王小明'));
  expect(screen.getByText('10:00:00')).toBeInTheDocument();
  expect(screen.getByText('10:05:00')).toBeInTheDocument();

  // Click to collapse
  await userEvent.click(screen.getByText('王小明'));
  expect(screen.queryByText('10:00:00')).not.toBeInTheDocument();
});
```

- [ ] **Step 4: 測試 edit/delete buttons**

```ts
it('shows edit and delete buttons in expanded detail rows', async () => {
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  const tx1 = makeTx({ transactionId: 't1', studentId: 'S001', type: 'order', mealPrice: 90 });
  const groups = [makeGroup('S001', '王小明', [tx1], -90)];

  render(<RecentStrip groups={groups} dateStatus="open" onEditClick={onEdit} onDeleteClick={onDelete} />);
  await userEvent.click(screen.getByText('王小明'));

  const editBtn = screen.getByRole('button', { name: '編輯' });
  const deleteBtn = screen.getByRole('button', { name: '刪除' });

  await userEvent.click(editBtn);
  expect(onEdit).toHaveBeenCalledWith(tx1);

  await userEvent.click(deleteBtn);
  expect(onDelete).toHaveBeenCalledWith(tx1);
});

it('hides edit/delete when dateStatus is closed', async () => {
  const tx1 = makeTx({ transactionId: 't1', studentId: 'S001', type: 'order', mealPrice: 90 });
  const groups = [makeGroup('S001', '王小明', [tx1], -90)];

  render(<RecentStrip groups={groups} dateStatus="closed" onEditClick={vi.fn()} onDeleteClick={vi.fn()} />);
  await userEvent.click(screen.getByText('王小明'));

  expect(screen.queryByRole('button', { name: '編輯' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '刪除' })).not.toBeInTheDocument();
});
```

- [ ] **Step 5: 測試 empty state + multiple groups**

```ts
it('shows empty state when no groups', () => {
  render(<RecentStrip groups={[]} dateStatus="open" />);
  expect(screen.getByText('尚無交易')).toBeInTheDocument();
});

it('renders multiple student groups', () => {
  const groups = [
    makeGroup('S001', '王小明', [makeTx({ transactionId: 't1', studentId: 'S001', type: 'order', mealPrice: 90 })], -90),
    makeGroup('S002', '李小華', [makeTx({ transactionId: 't2', studentId: 'S002', type: 'payment', paidAmount: 500 })], 500),
  ];
  render(<RecentStrip groups={groups} dateStatus="open" />);
  expect(screen.getByText('王小明')).toBeInTheDocument();
  expect(screen.getByText('李小華')).toBeInTheDocument();
});
```

- [ ] **Step 6: 測試 balance 顏色（neg/pos）**

```ts
it('applies neg class for negative balance', () => {
  const groups = [makeGroup('S001', '王小明', [
    makeTx({ transactionId: 't1', studentId: 'S001', type: 'order', mealPrice: 90 }),
  ], -90)];
  render(<RecentStrip groups={groups} dateStatus="open" />);
  const amtEl = screen.getByText(/餘額/).closest('.recent-amt');
  expect(amtEl?.className).toContain('neg');
});

it('applies pos class for non-negative balance', () => {
  const groups = [makeGroup('S001', '王小明', [
    makeTx({ transactionId: 't1', studentId: 'S001', type: 'payment', paidAmount: 500 }),
  ], 500)];
  render(<RecentStrip groups={groups} dateStatus="open" />);
  const amtEl = screen.getByText(/餘額/).closest('.recent-amt');
  expect(amtEl?.className).toContain('pos');
});
```

- [ ] **Step 7: 測試 onStudentClick 回調**

```ts
it('calls onStudentClick when group row is clicked', async () => {
  const onStudentClick = vi.fn();
  const groups = [makeGroup('S001', '王小明', [
    makeTx({ transactionId: 't1', studentId: 'S001', type: 'order', mealPrice: 90 }),
  ], -90)];
  render(<RecentStrip groups={groups} dateStatus="open" onStudentClick={onStudentClick} />);

  await userEvent.click(screen.getByText('王小明'));
  expect(onStudentClick).toHaveBeenCalledWith('S001');
});
```

- [ ] **Step 8: Run tests**
```bash
./workflow.sh t4-file components/__tests__/pos-components.test.tsx
```
Expected: All tests PASS

- [ ] **Step 9: Commit**
```bash
git add frontend/src/components/__tests__/pos-components.test.tsx
git commit -m "test(RecentStrip): rewrite tests for grouped mode (#392)"
```

---

## Task 4: 最終驗證 + PR

- [ ] **Step 1: Full test suite**
```bash
./workflow.sh t1
./workflow.sh t2
./workflow.sh t3
./workflow.sh t4
```
Expected: All PASS

- [ ] **Step 2: 檢查 PosColumn 的 parent caller**

確認 `PosColumn` 的 parent 有傳 `operatorUid` prop。搜尋：
```bash
grep -rn 'PosColumn' frontend/src/ --include='*.tsx' | grep -v test | grep -v __tests__
```
找到 parent → 確認它有 `operatorUid` 可傳。若 parent 尚未有此 prop，需在 parent 加入（從 `useFirebase()` 或 store 取得）。

- [ ] **Step 3: Create PR**
```bash
gh pr create --base dev --title "feat(RecentStrip): grouped student account mode with expand/collapse + edit/delete (#392)" --body "## What
Refactor RecentStrip from flat order-only list to student-account-grouped accordion mode.

## How
- Group by student using existing \`groupLedgerRowsByStudent()\`
- Expand/collapse per student (click to toggle)
- Detail rows show all tx types (order/payment) with time + amount
- Edit (✏️) and delete (✕) buttons on detail rows
- Reuse \`EditTransactionModal\` and \`useTransactionActions()\`

## Scope
- Rewrite: \`RecentStrip.tsx\`
- Modify: \`PosColumn.tsx\`, \`PosColumn.types.ts\`
- Tests: \`pos-components.test.tsx\` RecentStrip section rewritten

Closes #392"
```

---

## Verification Steps

| Step | Command | Expected |
|------|---------|----------|
| Build | `./workflow.sh t1` | PASS |
| TypeCheck | `./workflow.sh t2` | PASS |
| Lint | `./workflow.sh t3` | PASS |
| Unit tests | `./workflow.sh t4` | All tests PASS |
| Scope check | `git diff --stat origin/dev..HEAD` | Only 3-4 files changed |
| Manual smoke | 開啟 POS 頁面，確認 RecentStrip 群組顯示、展開/收合、edit/delete 功能正常 | UI 正常 |
