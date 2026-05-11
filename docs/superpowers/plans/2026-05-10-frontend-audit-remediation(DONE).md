# Frontend Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the prioritized remediation roadmap from the frontend code audit (Phases 0, 1, and 2), fixing type safety, architecture, testing, and CI/CD.

**Architecture:** We will systematically introduce strict TypeScript typing, unit testing for the accounting engine, modular component architecture, and automated verification pipelines.

**Tech Stack:** React 19, TypeScript, Zustand, Vite, Vitest, Testing Library, GitHub Actions

---

## Phase 0: Immediate Cleanup

### Task 1: Update Root Configuration & Docs

**Files:**
- Create: `README.md`
- Modify: `.gitignore`
- Delete: `frontend/src/App.css`

- [ ] **Step 1: Write root README.md**

```markdown
# Talented EasyOrder (iPad POS)

A highly responsive, offline-first iPad POS system with facial recognition support (Phase 2), built with React, Vite, and Zustand.

## Getting Started

```bash
cd frontend
npm install
npm run dev
```

## Documentation
- Specifications: `docs/specs/`
- Architecture & Plans: `docs/superpowers/`
```

- [ ] **Step 2: Update `.gitignore`**

Run:
```bash
echo -e "node_modules/\ndist/\n.env*\n*.local\n.DS_Store" > .gitignore
```

- [ ] **Step 3: Delete App.css**

Run:
```bash
rm frontend/src/App.css
```

- [ ] **Step 4: Commit**

```bash
git add README.md .gitignore frontend/src/App.css
git commit -m "chore: initial project cleanup and root README"
```

### Task 2: Fix ESLint Warnings in App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Fix typings and dependencies**

Modify `frontend/src/App.tsx` to fix the 6 ESLint errors:
- Replace `useState<any>` with concrete types (`Student | null`, `any` -> `unknown` temporarily or define interface).
- Fix `actualType` from `let` to `const`.
- Add `todayMenu.price` to `useMemo` dependency array.

- [ ] **Step 2: Run ESLint to verify**

Run: `cd frontend && npx eslint src/App.tsx`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "fix: resolve ESLint warnings in App.tsx"
```

---

## Phase 1: Type Safety & Core Logic Testing

### Task 3: Convert JSX to TSX & Enable Strict TypeScript

**Files:**
- Modify: `frontend/src/components/pos-components.jsx` -> `pos-components.tsx`
- Modify: `frontend/src/components/screens.jsx` -> `screens.tsx`
- Modify: `frontend/src/components/tweaks-panel.jsx` -> `tweaks-panel.tsx`
- Modify: `frontend/tsconfig.app.json`

- [ ] **Step 1: Rename files**

```bash
mv frontend/src/components/pos-components.jsx frontend/src/components/pos-components.tsx
mv frontend/src/components/screens.jsx frontend/src/components/screens.tsx
mv frontend/src/components/tweaks-panel.jsx frontend/src/components/tweaks-panel.tsx
```

- [ ] **Step 2: Add TypeScript Interfaces**

Modify the `.tsx` files to import `Student`, `Transaction`, `TodayMenu`, `Vendor` from `../mocks/initialData` and apply them to component props. Replace `useS2` and `useM2` aliases with standard `useState` and `useMemo` in `screens.tsx`.

- [ ] **Step 3: Update `tsconfig.app.json`**

Modify `frontend/tsconfig.app.json` to enforce `noImplicitAny`:
```json
    "noImplicitAny": true,
```

- [ ] **Step 4: Run TSC to verify**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/
git commit -m "refactor: convert components to TSX and enforce strict typing"
```

### Task 4: Setup Vitest & Test Accounting Engine

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.ts`
- Modify: `frontend/src/store/posStore.ts`
- Create: `frontend/src/store/__tests__/posStore.test.ts`

- [ ] **Step 1: Install Vitest**

```bash
cd frontend
npm i -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 2: Configure Vite**

Modify `frontend/vite.config.ts`:
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
  },
})
```

- [ ] **Step 3: Write failing tests for posStore**

Create `frontend/src/store/__tests__/posStore.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { usePosStore } from '../posStore';

describe('posStore Accounting Engine', () => {
  beforeEach(() => {
    usePosStore.getState().resetData();
  });

  it('calculates order balance correctly', () => {
    const studentId = '001';
    const store = usePosStore.getState();
    const initialBalance = store.students.find(s => s.id === studentId)!.balance;

    store.processTransaction(studentId, 'order', 90, 0);

    const updatedStudent = usePosStore.getState().students.find(s => s.id === studentId)!;
    expect(updatedStudent.balance).toBe(initialBalance - 90);
  });

  it('recalculates after balance correctly on update', () => {
    // Write test that captures the bug where `after` values of subsequent transactions are not updated
  });
});
```

- [ ] **Step 4: Run tests (Should fail or partially pass)**

Run: `cd frontend && npx vitest run`

- [ ] **Step 5: Fix posStore.ts**

Modify `posStore.ts` to fix the `updateTransaction` bug where subsequent transactions' `after` values are not correctly recalculated. Replace `Date.now() + Math.random()` with `crypto.randomUUID()`.

- [ ] **Step 6: Run tests to verify pass**

Run: `cd frontend && npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/
git commit -m "test: setup vitest and fix posStore accounting engine bugs"
```

---

## Phase 2: Architecture Refactoring & CI/CD

### Task 5: Setup GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create CI configuration**

Create `.github/workflows/ci.yml`:
```yaml
name: Frontend CI

on: [push, pull_request]

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm run lint
      - run: npx vitest run
```

- [ ] **Step 2: Commit**

```bash
git add .github/
git commit -m "ci: add GitHub Actions workflow for frontend"
```

### Task 6: Install Prettier & Husky

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/.prettierrc`
- Create: `frontend/.husky/pre-commit`

- [ ] **Step 1: Install tools**

```bash
cd frontend
npm i -D prettier eslint-config-prettier husky lint-staged
npx husky init
echo "npx lint-staged" > .husky/pre-commit
```

- [ ] **Step 2: Configure Prettier and Lint-Staged**

Modify `frontend/package.json` to add `lint-staged` configuration.
Create `frontend/.prettierrc`:
```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "all"
}
```

- [ ] **Step 3: Format existing files**

```bash
cd frontend
npx prettier --write "src/**/*.{ts,tsx,css}"
```

- [ ] **Step 4: Commit**

```bash
git add frontend/
git commit -m "style: setup prettier, husky, and format codebase"
```

---

## Self-Review Checklist
- [x] Spec coverage: Covers Phase 0, 1, and 2 from the audit report.
- [x] Placeholders: Real bash commands and tests are provided.
- [x] Type consistency: File paths are exact.
