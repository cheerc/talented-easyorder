# Plan: PosState Slice Interfaces — Type-Level Domain Separation

> Issue: #234
> Complexity: simple (type-only change, 1 file, zero consumer impact)
> Created: 2026-06-03

## Background

Issue #234 指出 `PosState` 混合 5 個領域（Domain/System/Accounting/Audit），維護困難。實際上 store 已經有模組化的 action files（8 files in `posActions/`）和 derived hooks（4 files in `derived/`），但 `PosState` 本身仍是單一 monolithic interface。

本 plan 在 type level 將 `PosState` 拆分為 composable slice interfaces，明確化 domain boundary，為未來真正的 store 拆分鋪路。純 type-level 變更，零 consumer 影響。

## Scope

### Included
1. 在 `posTypes.ts` 中定義 5 個 state slice interfaces（純 data fields）
2. `PosState` 改為 extends 這些 slice interfaces
3. 驗證 tsc + lint 全 PASS

### Excluded
- 不建立新的 Zustand store
- 不修改任何 consumer（33 files untouched）
- 不更動 action files / derived hooks
- 不進行 runtime store 拆分

## Affected Files

| File | Change |
|------|--------|
| `frontend/src/store/posTypes.ts` | Add 5 slice interfaces; `PosState` extends them |

## Slice Interfaces Design

```typescript
// posTypes.ts — new slice interfaces

/** Student domain: 學生帳戶管理 */
export interface StudentStateSlice {
  students: StudentAccount[];
}

/** Transaction domain: 每日交易記錄 */
export interface TransactionStateSlice {
  transactions: LedgerTransaction[];
}

/** Menu domain: 菜單與廠商 */
export interface MenuStateSlice {
  vendors: Vendor[];
  todayMenu: TodayMenu;
}

/** Audit domain: 審計追蹤 */
export interface AuditStateSlice {
  auditEvents: LedgerAuditEvent[];
}

/** Settlement domain: 關帳、營業日狀態、現金收銀 */
export interface SettlementStateSlice {
  dailySettlements: DailySettlement[];
  businessDateStatuses: Record<string, BusinessDateStatus>;
  cashSessions: Record<string, DailyCashSession>;
}

// PosState 改為 composition
export interface PosState
  extends StudentStateSlice,
    TransactionStateSlice,
    MenuStateSlice,
    AuditStateSlice,
    SettlementStateSlice {
  // Actions — unchanged
  setTodayMenu: (menu: TodayMenu) => void;
  setVendors: (vendors: Vendor[]) => void;
  // ... rest of actions unchanged
}
```

## Verification Steps

1. `npx tsc --noEmit` — 確認 `PosState` 仍滿足所有 consumer 的型別要求
2. `npm run lint` — ESLint pass
3. `npx vitest run` — all tests pass（type-only change, should be transparent）

## Risk Assessment

- **Risk**: LOW — pure type composition, `PosState` interface surface unchanged
- **Rollback**: Revert `posTypes.ts`
- **Blast radius**: None — `PosState` public API unchanged
- **Value**: Documents domain boundaries at type level; makes future incremental store splitting straightforward
