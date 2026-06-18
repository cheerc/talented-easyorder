# Plan: God Node DTO — TransactionEditView for EditTransactionModal

> Issue: #233
> Complexity: complex+ (3+ files, domain type change)
> Created: 2026-06-02

## Background

`LedgerTransaction` 有 34 條依賴連線（graphify analysis），UI 元件直接接收完整 domain entity，暴露了 `syncStatus`、`revision` 等內部欄位。架構審查建議導入 ViewModel 模式。

本 plan 以 `EditTransactionModal` 為第一個切入點 — 它只需要 4 個欄位（`transactionId`, `mealPrice`, `paidAmount`, `note`），但目前接收完整的 `LedgerTransaction`。

## Scope

### Included
1. 在 `domain/ledger.ts` 建立 `TransactionEditView` DTO type
2. 更新 `EditTransactionModal` 使用 `TransactionEditView` 取代 `LedgerTransaction`
3. 更新 `ReportScreen.tsx` 在呼叫處做 `LedgerTransaction → TransactionEditView` mapping
4. 驗證 tsc + lint + vitest 全 PASS

### Excluded
- 不更動其他 LedgerTransaction consumer（PosColumn、report components、hooks 等）
- 不更動 storage/migration layer
- 不更動 store schema

## Affected Files

| File | Change |
|------|--------|
| `frontend/src/domain/ledger.ts` | Add `TransactionEditView` type |
| `frontend/src/components/EditTransactionModal.tsx` | Switch props from `LedgerTransaction` to `TransactionEditView` |
| `frontend/src/components/screens/ReportScreen.tsx` | Map `LedgerTransaction → TransactionEditView` at call site |

## Target Type

```typescript
// In domain/ledger.ts
export interface TransactionEditView {
  transactionId: string;
  mealPrice: number;
  paidAmount: number;
  note: string;
}
```

## Affected Callers (graphify verified)

- `EditTransactionModal` is only rendered by `ReportScreen.tsx` (line 224)
- `editingTx` state in ReportScreen is `LedgerTransaction | null`
- `handleEditClick` receives `LedgerTransaction` from report table components

## Test Impact

- `frontend/src/components/__tests__/` — check if EditTransactionModal has tests (grep first)
- `frontend/src/components/screens/__tests__/` — check if ReportScreen has tests
- `frontend/src/domain/__tests__/ledger.test.ts` — no change needed (new type is additive)
- All existing vitest tests must PASS

## Verification Steps

1. `npx tsc --noEmit` — type-check the mapping in ReportScreen
2. `npm run lint` — ESLint pass
3. `npx vitest run` — all existing tests pass
4. Manual: verify EditTransactionModal still opens and saves correctly in ReportScreen

## Risk Assessment

- **Risk**: LOW — additive type change, no store/migration impact
- **Rollback**: Revert the 3 files, no data migration needed
- **Blast radius**: Contained to EditTransactionModal + ReportScreen only
