# [Issue #265] Reduce Prop Drilling and Decompose App.tsx Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose the `App.tsx` "God Component" into smaller, focused components and hooks to reduce complexity and prop drilling.

**Architecture:** Use a Controller/View pattern. Extract initialization logic into `AppInitializer` and layout logic into `AppLayout`. Introduce React Context for deeply nested props if needed.

**Tech Stack:** React, TypeScript.

---

### Task 1: Extract App Initialization Logic

**Files:**
- Create: `frontend/src/hooks/useAppInitialization.ts`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Move Firebase and Auth initialization to hook**
Extract `ensureFirebaseInitialized` and `subscribeOperatorAccess` logic.

- [ ] **Step 2: Commit**
```bash
git add frontend/src/hooks/useAppInitialization.ts frontend/src/App.tsx
git commit -m "refactor: extract app initialization logic to hook"
```

### Task 2: Decompose App Render into Focused Components

**Files:**
- Create: `frontend/src/components/AppProviders.tsx`
- Create: `frontend/src/components/AppView.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create AppProviders for global state/context**
- [ ] **Step 2: Create AppView to handle the main UI structure**
Move the `MainLayout` and `AppRouter` assembly into `AppView`.

- [ ] **Step 3: Commit**
```bash
git add frontend/src/components/AppProviders.tsx frontend/src/components/AppView.tsx frontend/src/App.tsx
git commit -m "refactor: decompose App.tsx into Providers and View"
```

### Task 3: Simplify Prop Drilling for PosColumn

**Files:**
- Create: `frontend/src/context/PosColumnContext.tsx`
- Modify: `frontend/src/components/PosColumn.tsx`

- [ ] **Step 1: Introduce Context for PosColumn props**
Reduce the 20+ props passed through `AppRouter`.

- [ ] **Step 2: Commit**
```bash
git add frontend/src/context/PosColumnContext.tsx frontend/src/components/PosColumn.tsx
git commit -m "refactor: use Context to reduce prop drilling for PosColumn"
```
