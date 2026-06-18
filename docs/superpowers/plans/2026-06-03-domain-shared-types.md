# Plan: Extract Shared Domain Types — Break ledger→cashClose Coupling

> Issue: #239
> Complexity: simple (extract 2 types, update 3-4 imports)
> Created: 2026-06-03

## Background

Graph analysis 建議分離 Transaction Domain 與 Settlement Domain（內聚度 0.07）。實際上兩者已在獨立檔案中（`ledger.ts` + `cashClose.ts`），唯一耦合點是 `cashClose.ts` 從 `ledger.ts` import `LedgerSyncStatus`。

將 shared types 抽出到獨立檔案即可完全斷開 domain 間的 type-level coupling。

## Scope

### Included
1. 建立 `frontend/src/domain/types.ts` — 集中 shared domain types（`LedgerSyncStatus`、`TransactionType`）
2. 更新 `ledger.ts` — 從 `types.ts` re-export 或直接 import
3. 更新 `cashClose.ts` — 從 `types.ts` import `LedgerSyncStatus` 而非 `ledger.ts`
4. 更新 `ledgerAudit.ts` — 從 `types.ts` import `LedgerSyncStatus` 而非 `ledger.ts`
5. 驗證 tsc + lint + vitest 全 PASS

### Excluded
- 不移動 business logic functions
- 不更動 store layer
- 不更動 `ledgerReport.ts` / `ledgerExport.ts`

## Affected Files

| File | Change |
|------|--------|
| `frontend/src/domain/types.ts` | **NEW** — `LedgerSyncStatus`, `TransactionType` |
| `frontend/src/domain/ledger.ts` | Import from `./types` instead of inline definition |
| `frontend/src/domain/cashClose.ts` | Import `LedgerSyncStatus` from `./types` instead of `./ledger` |
| `frontend/src/domain/ledgerAudit.ts` | Import `LedgerSyncStatus` from `./types` instead of `./ledger` |

## Target Types

```typescript
// domain/types.ts
export type LedgerSyncStatus = 'local' | 'queued' | 'synced' | 'failed' | 'conflict';
export type TransactionType = 'order' | 'payment' | 'expense';
```

## Import Changes

```typescript
// ledger.ts — before
export type TransactionType = 'order' | 'payment' | 'expense';
export type LedgerSyncStatus = 'local' | 'queued' | 'synced' | 'failed' | 'conflict';

// ledger.ts — after
export type { TransactionType, LedgerSyncStatus } from './types';

// cashClose.ts — before
import type { LedgerSyncStatus } from './ledger';

// cashClose.ts — after
import type { LedgerSyncStatus } from './types';

// ledgerAudit.ts — before
import type { LedgerSyncStatus } from './ledger';

// ledgerAudit.ts — after
import type { LedgerSyncStatus } from './types';
```

## Verification Steps

1. `npx tsc --noEmit` — type-check all consumers
2. `npm run lint` — ESLint pass
3. `npx vitest run` — all tests pass
4. Verify `cashClose.ts` has zero imports from `ledger.ts`

## Risk Assessment

- **Risk**: LOW — pure type re-export, no runtime behavior change
- **Rollback**: Revert 4 files
- **Blast radius**: 3 domain files, transparent to all consumers (types re-exported from ledger.ts)
