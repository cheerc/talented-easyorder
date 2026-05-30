---
required_reads:
  - frontend/src/hooks/useSystemDate.ts
  - frontend/src/hooks/useOnlineStatus.ts
  - frontend/src/hooks/useUndoCountdown.ts
  - frontend/src/hooks/useAppNavigationShortcuts.ts
  - frontend/src/hooks/useCrashDraftRecovery.ts
  - frontend/src/hooks/__tests__/useKeyboardShortcuts.test.ts
  - frontend/src/hooks/__tests__/usePosFlow.test.ts
---

# Plan: 5 Custom Hooks Unit Test Coverage (#157)

## Objective
為 5 個零 test coverage 的 custom hooks 補齊 unit test：`useSystemDate`、`useOnlineStatus`、`useUndoCountdown`、`useAppNavigationShortcuts`、`useCrashDraftRecovery`。

## Test Pattern
沿用既有 `useKeyboardShortcuts.test.ts` pattern：`renderHook` + `act`，mock window events / timers / store。

## Section 1: useSystemDate.test.ts

建立 `frontend/src/hooks/__tests__/useSystemDate.test.ts`

| # | Test | 說明 |
|---|------|------|
| S1 | returns systemDate and viewDate on mount | 驗證初始值為今天日期 (ISO format) |
| S2 | setViewDate updates viewDate but not systemDate | 呼叫 setViewDate → viewDate 變、systemDate 不變 |
| S3 | interval tick updates systemDate every 60s | vi.useFakeTimers → advance 60s → systemDate 更新 |
| S4 | visibilitychange event updates systemDate | dispatch visibilitychange → systemDate 更新 |
| S5 | cleanup on unmount | unmount → clearInterval + removeEventListener called |

**Verification**: `npx vitest run --reporter=verbose useSystemDate`

## Section 2: useOnlineStatus.test.ts

建立 `frontend/src/hooks/__tests__/useOnlineStatus.test.ts`

| # | Test | 說明 |
|---|------|------|
| O1 | returns true when navigator.onLine is true | 驗證初始 online = true |
| O2 | returns false when navigator.onLine is false | mock navigator.onLine = false → online = false |
| O3 | window online event sets online to true | dispatch 'online' event → online = true |
| O4 | window offline event sets online to false | dispatch 'offline' event → online = false |
| O5 | cleanup on unmount | unmount → removeEventListener called for both events |

**Verification**: `npx vitest run --reporter=verbose useOnlineStatus`

## Section 3: useUndoCountdown.test.ts

建立 `frontend/src/hooks/__tests__/useUndoCountdown.test.ts`

此 hook 依賴 Zustand store（`deleteTransaction`）和傳入的 callback props。

| # | Test | 說明 |
|---|------|------|
| U1 | initial undoCountdown is 0 | 驗證初始值 |
| U2 | setUndoCountdown starts countdown timer | setUndoCountdown(5) → vi.advanceTimersByTime 5000ms → countdown = 0 |
| U3 | countdown decrements every second | setUndoCountdown(3) → advance 1s → 2, advance 1s → 1 |
| U4 | countdown reaches 0 clears lastCommittedTxIdRef | setUndoCountdown(1) → advance 1s → ref = null |
| U5 | dismissFlash calls all cleanup callbacks | 驗證 dismissSuccess、setFlashKey、setSyncing、setPriceOverride 被呼叫 |
| U6 | handleUndo calls deleteTransaction then dismissFlash | seed txId → handleUndo → deleteTransaction called + dismissFlash called |
| U7 | handleUndo no-ops when lastCommittedTxIdRef is null | handleUndo → deleteTransaction not called |

**Verification**: `npx vitest run --reporter=verbose useUndoCountdown`

## Section 4: useAppNavigationShortcuts.test.ts

建立 `frontend/src/hooks/__tests__/useAppNavigationShortcuts.test.ts`

此 hook 有兩個 useEffect：F-key/digit shortcuts + Arrow key navigation。

| # | Test | 說明 |
|---|------|------|
| A1 | F1 focuses POS tab | dispatch keydown F1 → setTab('pos') + setSearchText('') |
| A2 | F2-F5 switch tabs | F2→'report', F3→'admin', F4→'vendors', F5→'history' |
| A3 | F6 toggles dashboard | dispatch F6 → setShowDashboard called |
| A4 | digit key sets search text in POS tab | tab='pos', no picked → key '5' → setSearchText('5') |
| A5 | digit key ignored on INPUT/TEXTAREA | target is INPUT → digit key ignored |
| A6 | digit key ignored on non-POS tab | tab='report' → digit key ignored |
| A7 | Enter on btn-confirm calls handleConfirm | focusZone='btn-confirm' → Enter → handleConfirm called |
| A8 | Enter on btn-cancel calls cancelFlow | focusZone='btn-cancel' → Enter → cancelFlow called |
| A8b | Enter on btn-delete-order calls cancelOrder | focusZone='btn-delete-order' → Enter → cancelOrder called |
| A9 | Enter on mode-{currentMode} calls handleConfirm | focusZone='mode-order' + currentMode='order' → handleConfirm called |
| A9b | Enter on mode-{differentMode} calls changeMode | focusZone='mode-payment' + currentMode='order' → changeMode('payment') + setFocusZone |
| A10 | Escape calls cancelFlow | dispatch Escape → cancelFlow called |
| A11 | ArrowLeft/ArrowRight navigate focus zones | ArrowLeft from btn-confirm → btn-cancel; ArrowRight from btn-cancel → btn-confirm |
| A12 | ArrowDown from mode row → btn-confirm | ArrowDown from mode-order → btn-confirm |
| A13 | ArrowUp from btn-confirm → mode row | ArrowUp from btn-confirm → mode-{currentMode} |
| A14 | shortcuts disabled when isDialogOpen | isDialogOpen=true → F1 ignored |
| A15 | cleanup on unmount | unmount → removeEventListener called |

**Verification**: `npx vitest run --reporter=verbose useAppNavigationShortcuts`

## Section 5: useCrashDraftRecovery.test.ts

建立 `frontend/src/hooks/__tests__/useCrashDraftRecovery.test.ts`

此 hook 非同步載入 crash draft 並透過傳入的 callback 恢復 UI state。

| # | Test | 說明 |
|---|------|------|
| C1 | returns false when no crash draft exists | loadCrashDraft resolves null → crashDraftRestored = false |
| C2 | restores student selection from crash draft | mock draft with studentId → selectStudent called |
| C3 | restores paidAmountText when paidAmount > 0 | mock draft with paidAmount=500 → setPaidAmountText('500') |
| C4 | changes mode when type is payment | mock draft type='payment' → changeMode('payment') |
| C5 | clears draft and no-ops when student not found | mock draft, student not in store → clearCrashDraft called, selectStudent not called |
| C6 | sets crashDraftRestored to true on success | mock draft → crashDraftRestored = true |
| C7 | cancelled flag prevents state update after unmount | unmount before async resolve → callbacks not called |

**Verification**: `npx vitest run --reporter=verbose useCrashDraftRecovery`

## Affected Callers
- 無 — 純新增 test files，不修改 source code

## Test Impact
- `useKeyboardShortcuts.test.ts` — 既有 pattern 參考
- `usePosFlow.test.ts` — 既有 pattern 參考（剛合併 PR #167）
- `useServiceWorkerCleanup.test.ts` — 既有 pattern 參考
- 目標：至少新增 41 tests（5 + 5 + 7 + 17 + 7）

## Success Criteria
1. 5 個新 test files，每個獨立可執行
2. `npx vitest run` 全 PASS，test count 從 635 → 660+
3. `npx tsc --noEmit` + `npm run lint` PASS
