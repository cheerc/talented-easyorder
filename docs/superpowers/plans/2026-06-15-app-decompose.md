---
required_reads:
  - frontend/src/App.tsx
  - frontend/src/components/AppRouter.tsx
  - frontend/src/components/MainLayout.tsx
  - frontend/src/components/screens/AdminScreen.tsx
  - frontend/src/components/screens/VendorsScreen.tsx
  - frontend/src/components/screens/ReportScreen.tsx
  - frontend/src/store/selectors.ts
  - frontend/src/store/posStore.ts
  - frontend/src/hooks/useAppState.ts
  - frontend/src/hooks/usePosFlow.ts
  - frontend/src/hooks/useTweaks.ts
  - frontend/src/hooks/useCancelDialog.ts
  - frontend/src/hooks/useUndoCountdown.ts
  - frontend/src/hooks/useFlashData.ts
  - frontend/src/hooks/useFocusSync.ts
  - frontend/src/hooks/usePosColumnProps.ts
  - frontend/src/firebase/firebaseApp.ts
  - frontend/src/firebase/authService.ts
  - frontend/src/auth/AuthGate.tsx
  - frontend/src/components/__tests__/screens.test.tsx
  - frontend/src/__tests__/helpers/storeSetup.ts
audit_method: "grep -n 'state\\.|props\\.' + full file read for all prop-drilled components"
---

# App.tsx Decomposition — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate prop drilling in App.tsx (261 lines, 30+ state vars, ~40 prop-drilled values) by having sub-components pull state directly from domain selector hooks (from #264). Extract Firebase/Auth initialization into provider components.

**Architecture:** Two-pronged approach:
1. **Leaf-first migration** — AdminScreen, VendorsScreen pull state from domain selectors instead of receiving props. AppRouter's prop interface shrinks.
2. **Provider extraction** — Firebase init + Auth state extracted into `FirebaseProvider` context, removing 20+ lines from App.tsx body.

**Why leaf-first:** Safer than top-down — each screen can be migrated independently with its own test cycle. App.tsx shrinks incrementally as each screen stops needing its props.

**Tech Stack:** React 19, Zustand 5 (useShallow via selectors.ts), TypeScript 6, Vitest 4

**refs #265**

---

## Prop Drilling Audit (grep-verified)

### App.tsx → AppRouter (18 props passed)
| Prop | Source in App.tsx | Used By (leaf) | Can Pull From |
|------|------------------|----------------|---------------|
| todayMenu | useAppState | ReportScreen, AdminScreen | useMenu() |
| setTodayMenu | useAppState | AdminScreen | useMenuActions() |
| vendors | useAppState | AdminScreen, VendorsScreen | useMenu() |
| students | useAppState | AdminScreen | useStudents() |
| resetData | useAppState | AdminScreen | useGlobalActions() |
| openingCash | computed (getOpeningCash) | AdminScreen | useCashClose(viewDate) |
| dateStatus | computed (getBusinessDateStatus) | AdminScreen | useCashClose(viewDate) |
| hasCashSession | computed (!!cashSessions[viewDate]) | AdminScreen | useCashClose(viewDate) |
| openCashSession | useAppState | AppRouter→AdminScreen | useSessionActions() |
| updateOpeningCash | useAppState | AppRouter→AdminScreen | useSessionActions() |
| setVendors | useAppState | VendorsScreen | useMenuActions() |
| tweaks, setTweak | useTweaks() | AdminScreen | useTweaks() (called in screen) |
| viewDate | useSystemDate | ReportScreen, AppRouter | React context or keep prop |
| reportStudentFilter | local state | ReportScreen | keep prop (local UI state) |
| onClearStudentFilter | local state | ReportScreen | keep prop (local UI state) |
| tab | local state | AppRouter | keep prop (routing) |
| posColumnProps | buildPosColumnProps | PosColumn | keep (complex orchestration) |

**12 of 18 props can be eliminated** by having screens pull from domain selectors directly.

### AppRouter → AdminScreen (12 props)
All 12 can be eliminated — AdminScreen can call `useMenu()`, `useStudents()`, `useSession()`, `useGlobalActions()`, `useTweaks()`, and `useCashClose(viewDate)` directly.

### AppRouter → VendorsScreen (2 props)
Both (`vendors`, `setVendors`) can be eliminated — VendorsScreen calls `useMenu()` + `useMenuActions()`.

### AppRouter → ReportScreen (4 props)
`todayMenu` → `useMenu()`. `viewDate` needs to stay (or use context). `reportStudentFilter` + `onClearStudentFilter` are local UI state, keep as props.

---

## File Structure

### New files to create:
- `frontend/src/providers/FirebaseProvider.tsx` — Firebase init + auth context
- `frontend/src/providers/__tests__/FirebaseProvider.test.tsx` — Provider tests
- `frontend/src/hooks/useFirebase.ts` — Context consumer hook

### Files to modify:
- `frontend/src/App.tsx` — Remove 60%+ of code (Firebase init, prop drilling)
- `frontend/src/components/AppRouter.tsx` — Remove 12+ props, slim interface
- `frontend/src/components/screens/AdminScreen.tsx` — Pull state from hooks
- `frontend/src/components/screens/VendorsScreen.tsx` — Pull state from hooks
- `frontend/src/components/screens/ReportScreen.tsx` — Pull todayMenu from hooks
- `frontend/src/hooks/useAppState.ts` — Potentially deprecate (consumers use selectors)

### Test files to update:
- `frontend/src/components/__tests__/screens.test.tsx` — Update mocks for new architecture

---

## Task 1: Migrate AdminScreen to Pull Own State

**Files:**
- Modify: `frontend/src/components/screens/AdminScreen.tsx`
- Modify: `frontend/src/components/AppRouter.tsx` — Remove AdminScreen props
- Modify: `frontend/src/App.tsx` — Stop passing AdminScreen-related props to AppRouter
- Test: Run existing AdminScreen tests

This is the highest-impact migration (removes 12 props from the drilling chain).

- [ ] **Step 1: Rewrite AdminScreen to use hooks**

Replace the 12-prop interface with direct hook calls:

```typescript
// Before: interface AdminScreenProps { todayMenu, setTodayMenu, vendors, students, resetData, openingCash, dateStatus, hasCashSession, ... }
// After:
import { useMenu, useMenuActions } from '../../store/selectors';
import { useStudents } from '../../store/selectors';
import { useGlobalActions } from '../../store/selectors';
import { useSessionActions } from '../../store/selectors';
import { useCashClose } from '../../store/derived/useCashClose';
import { useTweaks } from '../../hooks/useTweaks';

interface AdminScreenProps {
  viewDate: string;  // Only prop needed — from routing context
}

export const AdminScreen = React.memo(function AdminScreen({ viewDate }: AdminScreenProps) {
  const { todayMenu, vendors } = useMenu();
  const { setTodayMenu } = useMenuActions();
  const { students } = useStudents();
  const { resetData } = useGlobalActions();
  const { openCashSession, updateOpeningCash } = useSessionActions();
  const { openingCash, dateStatus, currentCashSession } = useCashClose(viewDate);
  const hasCashSession = !!currentCashSession;
  const { tweaks, setTweak } = useTweaks();
  // ... rest of component unchanged
});
```

- [ ] **Step 2: Update AppRouter — remove AdminScreen props**

Remove `setTodayMenu`, `vendors`, `students`, `resetData`, `openingCash`, `dateStatus`, `hasCashSession`, `openCashSession`, `updateOpeningCash`, `tweaks`, `setTweak` from AppRouterProps. Pass only `viewDate` to AdminScreen.

- [ ] **Step 3: Update App.tsx — stop passing removed props to AppRouter**

Remove the corresponding props from `<AppRouter ... />` in App.tsx render.

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run src/components/__tests__/ src/components/screens/`
Expected: PASS (AdminScreen pulls own state, tests may need mock updates)

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor: AdminScreen pulls own state from hooks, eliminate 12 prop-drilled values (#265)"
```

---

## Task 2: Migrate VendorsScreen to Pull Own State

**Files:**
- Modify: `frontend/src/components/screens/VendorsScreen.tsx`
- Modify: `frontend/src/components/AppRouter.tsx` — Remove VendorsScreen props
- Modify: `frontend/src/App.tsx` — Stop passing VendorsScreen-related props

- [ ] **Step 1: Rewrite VendorsScreen to use hooks**

```typescript
import { useMenu, useMenuActions } from '../../store/selectors';

// No props needed
export const VendorsScreen = React.memo(function VendorsScreen() {
  const { vendors } = useMenu();
  const { setVendors } = useMenuActions();
  // ... rest unchanged
});
```

- [ ] **Step 2: Update AppRouter — remove vendors/setVendors props**

- [ ] **Step 3: Update App.tsx — remove setVendors from AppRouter props**

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor: VendorsScreen pulls own state from hooks (#265)"
```

---

## Task 3: Migrate ReportScreen todayMenu prop

**Files:**
- Modify: `frontend/src/components/screens/ReportScreen.tsx`
- Modify: `frontend/src/components/AppRouter.tsx` — Remove todayMenu prop
- Modify: `frontend/src/App.tsx` — Stop passing todayMenu to AppRouter

- [ ] **Step 1: ReportScreen pulls todayMenu from hooks**

```typescript
import { useMenu } from '../../store/selectors';

// Remove todayMenu from props
export function ReportScreen({ viewDate, studentFilter, onClearStudentFilter }: ReportScreenProps) {
  const { todayMenu } = useMenu();
  // ... rest unchanged
}
```

- [ ] **Step 2: Update AppRouter — remove todayMenu prop**

- [ ] **Step 3: Update App.tsx**

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run src/components/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor: ReportScreen pulls todayMenu from hooks (#265)"
```

---

## Task 4: Extract FirebaseProvider

**Files:**
- Create: `frontend/src/providers/FirebaseProvider.tsx`
- Create: `frontend/src/hooks/useFirebase.ts`
- Modify: `frontend/src/App.tsx` — Replace inline Firebase/Auth init with provider

- [ ] **Step 1: Write FirebaseProvider test**

Create `frontend/src/providers/__tests__/FirebaseProvider.test.tsx`:

```typescript
import { renderHook, act } from '@testing-library/react';
import { FirebaseProvider, useFirebase } from '../FirebaseProvider';

it('provides null firebase before init', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <FirebaseProvider>{children}</FirebaseProvider>
  );
  const { result } = renderHook(() => useFirebase(), { wrapper });
  expect(result.current.fb).toBeNull();
});
```

- [ ] **Step 2: Create FirebaseProvider**

```typescript
// frontend/src/providers/FirebaseProvider.tsx
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { ensureFirebaseInitialized } from '../firebase/firebaseApp';
import { subscribeOperatorAccess, type OperatorAccess } from '../firebase/authService';

interface FirebaseContextValue {
  fb: Awaited<ReturnType<typeof ensureFirebaseInitialized>> | null;
  fbError: string | null;
  access: OperatorAccess;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

export function FirebaseProvider({ children }: { children: ReactNode }) {
  const [fb, setFb] = useState<FirebaseContextValue['fb']>(null);
  const [fbError, setFbError] = useState<string | null>(null);
  const [access, setAccess] = useState<OperatorAccess>({ ok: false, reason: 'signed_out' });

  useEffect(() => {
    let cancelled = false;
    ensureFirebaseInitialized().then(
      services => { if (!cancelled) setFb(services); },
      err => { if (!cancelled) setFbError(err instanceof Error ? err.message : String(err)); },
    );
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!fb?.auth || !fb?.db) return;
    return subscribeOperatorAccess(fb.auth, fb.db, setAccess);
  }, [fb?.auth, fb?.db]);

  return (
    <FirebaseContext.Provider value={{ fb, fbError, access }}>
      {children}
    </FirebaseContext.Provider>
  );
}

export function useFirebase() {
  const ctx = useContext(FirebaseContext);
  if (!ctx) throw new Error('useFirebase must be used within FirebaseProvider');
  return ctx;
}
```

- [ ] **Step 3: Update App.tsx — use FirebaseProvider**

Replace 20+ lines of inline Firebase init + Auth subscription with:

```typescript
import { FirebaseProvider, useFirebase } from './providers/FirebaseProvider';

function AppContent() {
  const { fb, fbError, access } = useFirebase();
  // ... rest of current App() body (minus Firebase init)
}

export default function App() {
  return (
    <FirebaseProvider>
      <AppContent />
    </FirebaseProvider>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `cd .. && ./workflow.sh t4`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor: extract FirebaseProvider from App.tsx (#265)"
```

---

## Task 5: Slim Down AppRouter + Clean Up App.tsx

**Files:**
- Modify: `frontend/src/components/AppRouter.tsx` — Final slimming
- Modify: `frontend/src/App.tsx` — Remove useAppState, dead code
- Possibly deprecate: `frontend/src/hooks/useAppState.ts`

- [ ] **Step 1: Final AppRouter interface audit**

After Tasks 1-4, AppRouter should only need:
- `tab` (routing)
- `viewDate` (for AdminScreen + ReportScreen)
- `reportStudentFilter` + `onClearStudentFilter` (local UI state for ReportScreen)
- `posColumnProps` (complex POS orchestration — keeps prop drilling for now)

Remove any remaining dead props.

- [ ] **Step 2: Audit useAppState usage**

```bash
grep -rn "useAppState" frontend/src/ --include="*.ts" --include="*.tsx"
```

If only App.tsx uses it, and App.tsx now gets most state from domain selectors, consider:
- Inlining remaining useAppState logic into App.tsx
- Or deprecating useAppState with `@deprecated` JSDoc

- [ ] **Step 3: Run full verification chain**

```bash
cd .. && ./workflow.sh t1 && ./workflow.sh t2 && ./workflow.sh t3 && ./workflow.sh t4
```
Expected: ALL PASS

- [ ] **Step 4: Verify prop drilling reduction**

Count remaining props in AppRouter interface — should be ≤6 (from original 18).
Count remaining state vars in App.tsx — should be significantly reduced from 30+.

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor: slim AppRouter interface, clean up App.tsx dead code (#265)"
```

---

## Task 6: Create PR

- [ ] **Step 1: Push and create PR**

```bash
git push origin feat/265-app-decompose
gh pr create --base dev --title "Refactor: Decompose App.tsx god component (#265)" \
  --body "Closes #265

## Summary
Eliminate prop drilling in App.tsx by having sub-components pull state from
domain selector hooks (from #264). Extract Firebase/Auth into FirebaseProvider.

## Changes
- AdminScreen: 12 props → 1 (viewDate) — pulls from useMenu, useStudents, useSession, useTweaks
- VendorsScreen: 2 props → 0 — pulls from useMenu + useMenuActions
- ReportScreen: todayMenu prop → useMenu() hook
- App.tsx: Firebase init extracted to FirebaseProvider (-20 lines)
- AppRouter: 18 props → ≤6

## Testing
- t1 (build) + t2 (typecheck) + t3 (lint) + t4 (unit tests) all pass"
```

---

## Verification Steps

| # | Check | Command | Expected |
|---|-------|---------|----------|
| 1 | TypeScript compiles | `./workflow.sh t2` | PASS |
| 2 | Lint clean | `./workflow.sh t3` | PASS |
| 3 | Unit tests pass | `./workflow.sh t4` | PASS |
| 4 | Build succeeds | `./workflow.sh t1` | PASS |
| 5 | AppRouter props ≤ 6 | `grep -c 'Props {' AppRouter.tsx` then count interface fields | ≤ 6 fields |
| 6 | AdminScreen props = 1 | `grep 'interface AdminScreenProps' AdminScreen.tsx` | only viewDate |
