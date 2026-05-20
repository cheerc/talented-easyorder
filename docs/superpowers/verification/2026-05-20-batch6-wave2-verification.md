# Wave 2 Verification — Batch 6 Badge & Report Fixes

> Generated: 2026-05-20
> Task: t-20260520083733541955-1
> Branch: feat/batch6-wave2

## CI Chain

| ID | Command | Result |
|----|---------|--------|
| t1 | `npx tsc --noEmit` | PASS ✅ |
| t2 | `npm run lint` | PASS ✅ (0 errors, 0 warnings) |
| t3 | `npx vitest run` | PASS ✅ (48 files, 369 tests) |
| t4 | `npm run build` | PASS ✅ |

## Scope Gate

```
frontend/src/index.css
frontend/src/components/pos-components.tsx
frontend/src/components/report/LedgerGroupedTable.tsx
frontend/src/domain/__tests__/ledgerReport.test.ts
frontend/src/domain/ledgerReport.ts
```

## §7 — RecentStrip Badge CSS 統一 (B6-7)

- [x] `.type-income` / `.type-payment` → green (`#16a34a`) on green bg
- [x] `.type-expense` → red (`#dc2626`) on red bg
- [x] `.recent-amt.neg` → `color: #dc2626`

## §8 — RecentStrip 備註前 4 字 (B6-8)

- [x] expense-type rows show `note.slice(0, 4)` after studentNameSnapshot

## §9 — 總交易筆數修正 (B6-9)

- [x] `calculateLedgerTotals`: transactionCount excludes unpaid orders (type=order, paidAmount=0)
- [x] Test: `excludes unpaid order transactions from transactionCount` ✅
- [x] Updated existing test (`counts transactionCount` → with cash flow transactions)

## §10 — LedgerGroupedTable 櫃台 rows 不顯示 (B6-10)

- [x] Expense section: grid 7 欄 → 5 欄 (`80px 60px 1fr 1fr auto`)
- [x] 對應 5 個子 div: 時間、類型、金額、備註、操作
