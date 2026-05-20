# Wave 1 Verification — Batch 6 Accounting & UX Fixes

> Generated: 2026-05-20
> Task: t-20260520083733541955-1
> Branch: feat/batch6-wave1

## CI Chain

| ID | Command | Result |
|----|---------|--------|
| t1 | `npx tsc --noEmit` | PASS ✅ |
| t2 | `npm run lint` | PASS ✅ (0 errors, 0 warnings) |
| t3 | `npx vitest run` | PASS ✅ (48 files, 368 tests) |
| t4 | `npm run build` | PASS ✅ |

## Scope Gate

`git diff --name-only origin/main...HEAD`:

```
frontend/src/App.tsx
frontend/src/components/__tests__/pos-components.test.tsx
frontend/src/components/pos-components.tsx
frontend/src/hooks/__tests__/useKeyboardShortcuts.test.ts
frontend/src/hooks/useKeyboardShortcuts.ts
```

All files within allowed scope.

## §1 — POS 金額輸入焦點 & 快捷鍵 A (B6-1, B6-16)

- [x] CustomerCard: `payInputRef` + `useEffect` watch `mode` → auto `.focus()`
- [x] useKeyboardShortcuts: `a` key → `enterExpenseMode()` in idle, suppressed in text inputs
- [x] App.tsx: pass `enterExpenseMode` to `useKeyboardShortcuts`
- [x] Test: 4 new `A key` test cases in useKeyboardShortcuts.test.ts

## §2 — Expense Flash Banner 顯示淨現金 (B6-2)

- [x] flashData memo: compute `counterNetCash` from all `__cashier__` expense txs
- [x] Replace `after: 0` with `after: counterNetCash`

## §3 — 備註 Enter 被 ConfirmBanner 搶走 (B6-3)

- [x] expense_other_note onKeyDown: `e.nativeEvent.stopImmediatePropagation()` before `onNoteConfirm`

## §4 — RecentStrip __cashier__ 文字重疊 (B6-4)

- [x] `__cashier__` studentId → display as empty string
- [x] Test: `hides __cashier__ id in studentId column`

## §5 — ExpensePanel 鍵盤導航 (B6-5)

- [x] `selIdx` state + window keydown listener for `expense_direction` / `expense_reason`
- [x] ArrowLeft/ArrowRight → navigate selIdx
- [x] Enter → confirm selection
- [x] Escape → cancel
- [x] Visual ring outline on selected button

## §6 — Expense Note 輸入欄位佈局修正 (B6-6)

- [x] Replace `pay-input-container` className with custom flex column layout
- [x] `gap: 12px`, `padding: 8px 0`, `marginTop: 4px` on hint

## New Tests

| File | Tests Added |
|------|-------------|
| useKeyboardShortcuts.test.ts | 4 (A key behaviors) |
| pos-components.test.tsx | 1 (__cashier__ id hidden) |

Total: 368 tests (was 363, +5 new)
