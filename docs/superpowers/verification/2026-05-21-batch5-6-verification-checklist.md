# Batch 5-6 Verification Checklist

> Based on plan: `docs/superpowers/plans/2026-05-21-batch5-6-verification-fixes.md`
> Date: 2026-05-20

## Section 1: Keyboard & Focus

| # | Item | Expected Behavior | Status |
|---|------|-------------------|--------|
| 1.1 | SearchBox - Enter blurs input | Press Enter in search box → input loses focus (blur) | ✅ |
| 1.2 | Auto-focus before digit key | Press digit key when no input focused → student search auto-focuses, digit prepended | ✅ |
| 1.3 | (A) shortcut hint visibility | `(A)` shortcut label visible in UI; pressing `A` triggers action | ✅ |
| 1.4 | ExpensePanel - `e` key stopImmediatePropagation | Pressing `e` inside ExpensePanel does not bubble to window handler | ✅ |
| 1.5 | ConfirmDialog - Enter key confirm | Press Enter while ConfirmDialog is open → fires onConfirm | ✅ |

## Section 2: Numeric Input

| # | Item | Expected Behavior | Status |
|---|------|-------------------|--------|
| 2.1 | Price fields - regex filter `/^\d*$/` | 6 price/numeric inputs only accept digits; non-digit keystrokes blocked via onKeyDown | ✅ |

## Section 3: UI Layout

| # | Item | Expected Behavior | Status |
|---|------|-------------------|--------|
| 3.1 | Debt warning removal | 「⚠️ 本月未繳便當累積超額」warning no longer appears | ✅ |
| 3.2 | 「本日便當」sidebar removal | 本日便當 sidebar section removed from POS view | ✅ |
| 3.3 | Quick amount buttons removal | Quick order amount buttons (e.g. 50/60/70/80/90) removed from customer panel | ✅ |
| 3.4 | RecentStrip expense note format | Expense transactions show formatted note with 支/收 prefix, not raw amount | ✅ |

## Section 4: Settlement (結算)

| # | Item | Expected Behavior | Status |
|---|------|-------------------|--------|
| 4.1 | CashClosePanel - disabled close button always visible | Close button stays visible (disabled state) instead of being hidden | ✅ |
| 4.2 | LedgerGroupedTable pagination | Groups > 20 rows per page; shows 上一頁/下一頁 and page indicator (e.g. 1 / 2) | ✅ |
| 4.3 | Opening cash - no-op when unchanged | Opening cash input on new date that matches previous opening cash → no transaction created | ✅ |

## Test Suite

| Check | Result |
|-------|--------|
| All tests pass | ✅ 377 tests passing |
| No new test failures | ✅ |
| ConfirmDialog test (Enter handler) | ✅ |
| RecentStrip test (expense formatting) | ✅ |
| LedgerGroupedTable test (pagination) | ✅ |
| Numeric input test coverage | ✅ |

## Manual Verification Notes

- ConfirmDialog: Press Enter while dialog is open → confirm action fires
- SearchBox: Press Enter in search field → keyboard dismisses on mobile
- Digit key auto-focus: Press any digit (0-9) when no input focused → student search receives focus + digit
- ExpensePanel: Press `e` inside expense panel → expense panel toggles, not global shortcut
- Numeric inputs: Try typing letters/symbols into price fields → rejected
- Pagination: Open report with 25+ student groups → pagination controls appear and work
- Opening cash: Start new date with same opening cash as previous → no duplicate transaction
