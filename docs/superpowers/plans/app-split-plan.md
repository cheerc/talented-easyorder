---
required_reads:
  - frontend/src/App.tsx
  - frontend/src/hooks/usePosFlow.ts
  - frontend/src/hooks/useUndoCountdown.ts
  - frontend/src/components/MainLayout.tsx
  - frontend/src/components/screens/index.ts
---

# Plan: App.tsx God Component 拆分 (#147)

## Objective
將 `App.tsx` (556 lines) 拆分為 composition hook + sub-components，目標 ≤ 250 lines。

## Files

| 檔案 | 語意 |
|------|------|
| `frontend/src/hooks/useAppState.ts` (new) | 集中所有 Zustand store subscriptions + derived values |
| `frontend/src/components/AppRouter.tsx` (new) | Tab-based screen routing（5 個 tab 的 JSX） |
| `frontend/src/components/PosColumn.tsx` (new) | POS 主欄：SearchBox/CustomerCard/ExpensePanel + ActionBar |
| `frontend/src/App.tsx` (modify) | 改為 composition root：組合 hooks + MainLayout + AppRouter |

## Section 1: Extract `useAppState` Hook

建立 `frontend/src/hooks/useAppState.ts`

集中所有 Zustand store subscriptions（目前分散在 App.tsx lines 24-35, 53）：

```typescript
function useAppState(viewDate: string) {
  // Store subscriptions
  const students = usePosStore(s => s.students);
  const allTx = usePosStore(s => s.transactions);
  const todayMenu = usePosStore(s => s.todayMenu);
  const vendors = usePosStore(s => s.vendors);
  const setTodayMenu = usePosStore(s => s.setTodayMenu);
  const setVendors = usePosStore(s => s.setVendors);
  const resetData = usePosStore(s => s.resetData);
  const getBusinessDateStatus = usePosStore(s => s.getBusinessDateStatus);
  const cashSessions = usePosStore(s => s.cashSessions);
  const dailySettlements = usePosStore(s => s.dailySettlements);
  const openCashSession = usePosStore(s => s.openCashSession);
  const updateOpeningCash = usePosStore(s => s.updateOpeningCash);

  // Derived
  const tx = useMemo(() => allTx.filter(t => t.businessDate === viewDate).reverse(), [allTx, viewDate]);
  const todayCount = useMemo(() => { /* lines 266-274 */ }, [tx, todayMenu]);
  const queuedCount = useMemo(() => allTx.filter(t => t.syncStatus === 'queued').length, [allTx]);
  const failedSyncCount = useMemo(() => allTx.filter(t => t.syncStatus === 'failed').length, [allTx]);
  const conflictSyncCount = useMemo(() => allTx.filter(t => t.syncStatus === 'conflict').length, [allTx]);

  return { students, allTx, todayMenu, vendors, setTodayMenu, setVendors, resetData,
    getBusinessDateStatus, cashSessions, dailySettlements, openCashSession, updateOpeningCash,
    tx, todayCount, queuedCount, failedSyncCount, conflictSyncCount };
}
```

**Verification**: `npx tsc --noEmit`（確認所有 consumer 型別相容）

## Section 2: Extract `PosColumn` Component

建立 `frontend/src/components/PosColumn.tsx`

抽取 POS 主欄 JSX（App.tsx lines 393-503）—— 即 `tab === 'pos'` 內的 `<div className="main">` 內容：

- Historical lock screen
- Idle state: MidnightBanner + CrashDraftBanner + SearchBox + IdleHero
- Expense flow: ExpensePanel
- Student selected: CustomerCard + DuplicateWarningBanner
- ActionBar（所有狀態共用）

Props interface 從 App 傳入：
```typescript
interface PosColumnProps {
  // Flow state
  state: PosFlowState;
  isHistorical: boolean;
  dateStatus: string;
  viewDate: string;
  systemDate: string;
  // Student
  picked: StudentAccount | null;
  currentMode: PosMode;
  currentPaidAmount: string;
  orderedTodayCount: number;
  // Expense
  expenseProps: ExpenseProps | null;
  updateExpenseAmount: (t: string) => void;
  confirmExpenseAmount: (n: number) => void;
  selectExpenseDirection: (d: ExpenseDirection) => void;
  selectExpenseReason: (r: string) => void;
  updateExpenseNote: (n: string) => void;
  confirmExpenseNote: (n: string) => void;
  // Actions
  setPaidAmountText: (t: string) => void;
  handleConfirm: () => void;
  cancelFlow: () => void;
  changeMode: (m: PosMode) => void;
  setFocusZone: (z: string) => void;
  focusZone: string;
  openCancelConfirm: () => void;
  // Search
  searchText: string;
  setSearchText: (t: string) => void;
  suggestions: StudentAccount[];
  activeIdx: number;
  setActiveIdx: (i: number) => void;
  choose: (s: StudentAccount) => void;
  submitSearch: () => void;
  searchFocusKey: number;
  hasFlash: boolean;
  // Misc
  crashDraftRestored: boolean;
  setCrashDraftRestored: (v: boolean) => void;
  todayMenu: TodayMenu;
  todayCount: number;
  vendors: VendorAccount[];
  enterExpenseMode: () => void;
  tweaks: Tweaks;
  // Recent strip
  tx: LedgerTransaction[];
  selectStudent: (id: string, src: PosSelectionSource) => void;
  // Price override
  priceOverride: number | null;
  priceOverrideLabel: string;
  setPriceOverride: (v: number | null) => void;
  setPriceOverrideLabel: (v: string) => void;
  handleDeleteOrder: () => void;
  onViewHistory: () => void;
}
```

⚠️ Props 很多——這是 App.tsx 拆分的必然結果。PosColumn 是純展示 component，不做 business logic。

**Verification**: `npx tsc --noEmit` + POS 相關 component tests PASS

## Section 3: Extract `AppRouter` Component

建立 `frontend/src/components/AppRouter.tsx`

抽取 tab-based screen routing（App.tsx lines 513-550）：

```typescript
function AppRouter(props: AppRouterProps) {
  // Switch on props.tab, render the 5 screens
  // Each screen wrapped in <ErrorBoundary fallback={<SectionError name="..." />}>
}
```

Props:
```typescript
interface AppRouterProps {
  tab: string;
  // ReportScreen props
  todayMenu: TodayMenu;
  viewDate: string;
  reportStudentFilter: string;
  onClearStudentFilter: () => void;
  // AdminScreen props
  setTodayMenu: ...;
  vendors: ...;
  students: ...;
  resetData: ...;
  openingCash: number;
  dateStatus: string;
  hasCashSession: boolean;
  onOpeningCashChange: ...;
  onUpdateOpeningCash: ...;
  tweaks: Tweaks;
  setTweak: ...;
  // VendorsScreen props
  setVendors: ...;
  // POS view
  posColumnProps: PosColumnProps;
  // Misc
  isHistorical: boolean;
  setViewDate: (d: string) => void;
  systemDate: string;
}
```

**Verification**: same as Section 2

## Section 4: Slim Down `App.tsx`

App.tsx 改為 composition root（目標 ≤ 250 lines）：

**移除**（移入 useAppState / PosColumn / AppRouter）：
- Store subscriptions (12 行) → useAppState
- Count computations: todayCount/queuedCount/failedSyncCount/conflictSyncCount (~20 行) → useAppState
- `expenseProps` useMemo (~10 行) → PosColumn（接收 `state` prop，內部計算）
- `flashData` useMemo (~50 行) → `useFlashData` hook（new，在 App.tsx 呼叫，因 flashData 需傳給 MainLayout prop，無法移入子 component）
- `suggestions` useMemo + `choose` + `submitSearch` (~15 行) → PosColumn
- `openCancelConfirm` + `handleDeleteOrder` (~25 行) → 移入 PosColumn（接收 `picked`、`viewDate`、`allTx` props）
- `focusZone sync` useEffect (~18 行) → 移入 custom hook `useFocusSync`（new，見下方）
- `handleOpeningCashChange` + `handleUpdateOpeningCash` (~8 行) → AppRouter（僅 AdminScreen 使用）
- Render JSX (~165 行) → PosColumn + AppRouter
- `orderedTodayCount` useMemo → 移入 PosColumn（接收 `picked`、`allTx`、`viewDate` props）

共移除約 273 行（flashData ~50 行保留在 App.tsx 作為 useFlashData hook），加回 composition render (~35 行) 後淨效果約 −238 行。

**保留在 App.tsx**：
1. **Hook composition**: useSystemDate, useAppState, usePosFlow, useCrashDraftRecovery, useOnlineStatus, useUndoCountdown
2. **Pinned student logic** (~35 行) — coordinate state.kind + usePosFlow + useAppState 的關鍵橋樑
3. **handleConfirm callback** (~15 行) — coordinate expense/duplicate/student_selected 的跨 mode 邏輯
4. **Success effect** (~39 行) — 依賴 prevKindRef、commitTxIdRef、clearCrashDraft、setUndoCountdown
5. **Keyboard shortcut hooks** (~20 行) — useKeyboardShortcuts + useAppNavigationShortcuts
6. **Tweaks + theme effect** (~12 行)
7. **Local state** (tab、reportStudentFilter 等，~15 行)
8. **MainLayout + AppRouter + PosColumn** composition (~35 行)
9. **Imports** (~12 行)
10. **`countActiveOrdersForStudent` import** — `orderedTodayCount` computation 已移入 PosColumn，但若 App.tsx 仍需要此 import（例如傳給 PosColumn），保留之

保守估算：35 + 15 + 39 + 20 + 12 + 15 + 35 + 12 = **~183 行**（不含 useFlashData hook call），加回 pinned student logic（~35 行，v2 漏計）與 useFlashData hook 呼叫（~3 行）後 **~221 行**（不含空白行）→ **≤250 行目標可達成**。

**新增 helper**: `useFocusSync` hook（可內聯在 App.tsx 或獨立檔案）
```typescript
function useFocusSync(state: PosFlowState, tab: string, setSearchText, setSearchFocusKey, setFocusZone) {
  useEffect(() => { /* 原 App.tsx lines 293-309 */ }, [...]);
}
```

**Verification**: `npx tsc --noEmit` + `npx vitest run`（所有 635 tests PASS）+ `npm run build`

## Affected Callers
- 無外部 caller — `App.tsx` 是 entry point，只有 `main.tsx` import 它
- `main.tsx` 不需變更

## Test Impact
- `pos-components.test.tsx` — 部分測試可能引用 App.tsx 中已移動的邏輯，需確認 PASS
- 既有 integration tests (`pcPosFlow.integration.test.tsx`) 必須 PASS
- 功能行為完全保持不變（純重構）

## ⚠️ Risk
- **PosColumn props explosion**：~45 props，這是拆分大型 component 的 trade-off。後續可考慮進一步分組
- **Pinned student logic** 是協調 state.kind + usePosFlow + useAppState 的關鍵橋樑——不要移動
- **Success effect** 依賴 prevKindRef、commitTxIdRef、clearCrashDraft、setUndoCountdown 等——保持在 App.tsx
- 每個 section 完成後立刻跑 full test suite（t1~t4）

## Success Criteria
1. App.tsx ≤ 250 lines（composition only，從 556 行縮減 ≥55%）
2. 3 個 new files 存在（useAppState.ts、AppRouter.tsx、PosColumn.tsx）
3. t1~t4 全 PASS
4. 所有既有功能不變（POS flow、報表、管理、供應商、歷史紀錄）
5. `npm run build` 成功產出
