# Plan: TransactionStatusView 收入/支出雙欄修復

**Issue:** #421
**Regression from:** #419 (PR #420)
**Original requirement:** #402
**Complexity:** simple
**Affected files:** 2 files

---

## 背景

PR #420 (#419) 將 TransactionStatusView 從收入/支出雙欄改為單一金額欄，違背 #402 的需求。需修復為：
- 恢復雙欄（收入 / 支出）顯示
- **加上標頭行**（「收入」/「支出」）
- 保留 #419 改進：type badge、edit/delete 按鈕、右對齊、font-size、`locked` prop

## 金額顯示規則（同 #402）

| 交易類型 | 收入欄 | 支出欄 | 說明 |
|---------|--------|--------|------|
| 訂餐（order） | — | `−{mealPrice}` | 訂餐是支出 |
| 繳費/儲值（payment） | `+{paidAmount}` | — | 繳費是收入 |
| 訂餐同時繳費 | `+{paidAmount}` | `−{mealPrice}` | 雙欄同時顯示 |
| 支出（expense） | — | `−{amount}` | 支出是支出 |

---

### Task 1: 修復 TransactionStatusView — 恢復雙欄 + 加標頭

**Files:**
- Modify: `frontend/src/components/pos/TransactionStatusView.tsx`
- Modify: `frontend/src/styles/pos.css`
- Modify: `frontend/src/components/pos/__tests__/TransactionStatusView.test.tsx`

- [ ] **Step 1: 更新測試 — 新增雙欄 + 標頭測試**

修改 `frontend/src/components/pos/__tests__/TransactionStatusView.test.tsx`：

新增測試：

```tsx
it('renders header row with 收入 and 支出 labels', () => {
  render(<TransactionStatusView transactions={[mockTx({ type: 'order', mealPrice: 60 })]} />);
  expect(screen.getByText('收入')).toBeInTheDocument();
  expect(screen.getByText('支出')).toBeInTheDocument();
});

it('renders dual columns — order shows expense only', () => {
  const { container } = render(<TransactionStatusView transactions={[mockTx({ type: 'order', mealPrice: 60, paidAmount: 0 })]} />);
  const incomeCell = container.querySelector('.tx-col-income');
  const expenseCell = container.querySelector('.tx-col-expense');
  expect(incomeCell?.textContent).toBe('');
  expect(expenseCell?.textContent).toBe('−60');
});

it('renders dual columns — payment shows income only', () => {
  const { container } = render(<TransactionStatusView transactions={[mockTx({ type: 'payment', paidAmount: 500, mealPrice: 0 })]} />);
  const incomeCell = container.querySelector('.tx-col-income');
  const expenseCell = container.querySelector('.tx-col-expense');
  expect(incomeCell?.textContent).toBe('+500');
  expect(expenseCell?.textContent).toBe('');
});

it('renders dual columns — order with payment shows both', () => {
  const { container } = render(<TransactionStatusView transactions={[mockTx({ type: 'order', mealPrice: 90, paidAmount: 200 })]} />);
  const incomeCell = container.querySelector('.tx-col-income');
  const expenseCell = container.querySelector('.tx-col-expense');
  expect(incomeCell?.textContent).toBe('+200');
  expect(expenseCell?.textContent).toBe('−90');
});

it('renders dual columns — expense shows expense only', () => {
  const { container } = render(<TransactionStatusView transactions={[mockTx({ type: 'expense', amount: 150 })]} />);
  const incomeCell = container.querySelector('.tx-col-income');
  const expenseCell = container.querySelector('.tx-col-expense');
  expect(incomeCell?.textContent).toBe('');
  expect(expenseCell?.textContent).toBe('−150');
});
```

移除舊的 `shows right-aligned expense amount for order type` 測試（已被新的雙欄測試取代）。

- [ ] **Step 2: 修改 TransactionStatusView — 雙欄 + 標頭**

修改 `frontend/src/components/pos/TransactionStatusView.tsx`：

替換 render 邏輯，加標頭行 + 雙欄：

```tsx
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
      {/* Header row */}
      <div className="tx-status-header">
        <span className="tx-time"></span>
        <span className="tx-type-badge-placeholder"></span>
        <span className="tx-col-income">收入</span>
        <span className="tx-col-expense">支出</span>
        <span className="tx-actions-placeholder"></span>
      </div>
      {transactions.map((tx) => {
        const income = getIncome(tx);
        const expense = getExpense(tx);

        return (
          <div key={tx.transactionId} className="tx-status-row">
            <span className="tx-time">{formatTime(tx.createdAt)}</span>
            <span className={'tx-type-badge tx-type-' + tx.type}>{TYPE_LABELS[tx.type] ?? tx.type}</span>
            <span className="tx-col-income mono pos">
              {income != null ? `+${fmt(income)}` : ''}
            </span>
            <span className="tx-col-expense mono neg">
              {expense != null ? `−${fmt(expense)}` : ''}
            </span>
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

**關鍵改動：**
- 加 `.tx-status-header` 標頭行，顯示「收入」「支出」
- 每列改為 `.tx-col-income` + `.tx-col-expense` 雙欄
- `income` 和 `expense` 獨立計算、獨立顯示（不再合成單一金額）
- 「訂餐同時繳費」時兩欄同時有值

- [ ] **Step 3: 更新 CSS — 雙欄 grid layout**

修改 `frontend/src/styles/pos.css`，將 `.tx-status-row` 從 flex 改為 grid，配合標頭：

```css
/* --- TransactionStatusView dual-column layout --- */
.tx-status-view { width: 100%; }
.tx-status-header,
.tx-status-row {
  display: grid;
  grid-template-columns: auto 28px 1fr 1fr auto;
  gap: 8px;
  padding: 8px 4px;
  font-size: 1rem;
  align-items: center;
}
.tx-status-header {
  color: var(--text-secondary, #888);
  font-size: 0.85rem;
  font-weight: 600;
  border-bottom: 1px solid var(--border-light, #eee);
  padding-bottom: 4px;
}
.tx-status-row {
  border-bottom: 1px solid var(--border-light, #eee);
}
.tx-status-row:last-child { border-bottom: 0; }
.tx-time { color: var(--ink-2); font-family: 'JetBrains Mono', monospace; white-space: nowrap; }
.tx-type-badge-placeholder { width: 28px; } /* spacer for header alignment */
.tx-col-income,
.tx-col-expense {
  text-align: right;
  font-weight: 600;
  font-size: 1.1rem;
  font-family: 'JetBrains Mono', monospace;
  white-space: nowrap;
}
.tx-col-income { color: var(--c-pos, #2e7d32); }
.tx-col-expense { color: var(--c-neg, #c62828); }
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
.tx-actions { display: flex; gap: 4px; }
.tx-actions-placeholder { width: 52px; } /* spacer for header alignment with action buttons */
.tx-status-empty {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary, #888);
  font-size: 1rem;
}
```

移除不再使用的 `.tx-amount` class（已被 `.tx-col-income` / `.tx-col-expense` 取代）。

- [ ] **Step 4: 執行測試**

```bash
./workflow.sh t4-file src/components/pos/__tests__/TransactionStatusView.test.tsx
```

Expected: PASS

- [ ] **Step 5: 全套測試**

```bash
./workflow.sh t2
./workflow.sh t3
./workflow.sh t4
./workflow.sh t1
```

Expected: 全 PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/pos/TransactionStatusView.tsx frontend/src/styles/pos.css frontend/src/components/pos/__tests__/TransactionStatusView.test.tsx
git commit -m "fix(pos): restore TransactionStatusView dual-column income/expense display with header

Fixes #421
Regression from #419 (PR #420) — single amount column broke #402 requirement.
Restores income/expense dual columns with header row (收入/支出).
Keeps #419 improvements: type badge, edit/delete buttons, locked prop, font-size."
```
