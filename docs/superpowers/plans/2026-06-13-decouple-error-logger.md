# [Issue #266] Decouple appendErrorLog from Core Logic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple the error logging implementation from core business logic to allow for better testability and future log destination changes.

**Architecture:** Introduce a `Logger` interface and use dependency injection (or a global provider) to supply the implementation.

**Tech Stack:** TypeScript.

---

### Task 1: Define Logger Interface

**Files:**
- Create: `frontend/src/errors/types.ts`

- [ ] **Step 1: Define ILogger interface**
```typescript
export interface ILogger {
  logError(entry: Omit<ErrorLogEntry, 'id' | 'createdAt'>): void;
  // ...
}
```

- [ ] **Step 2: Commit**
```bash
git add frontend/src/errors/types.ts
git commit -m "chore: define ILogger interface"
```

### Task 2: Create Logger Provider

**Files:**
- Create: `frontend/src/errors/loggerProvider.ts`
- Modify: `frontend/src/errors/errorLogger.ts`

- [ ] **Step 1: Implement LocalStorageLogger**
Wrap the current `appendErrorLog` logic into a class implementing `ILogger`.

- [ ] **Step 2: Create a singleton or context provider for the logger**
```typescript
let currentLogger: ILogger = new LocalStorageLogger();
export const getLogger = () => currentLogger;
export const setLogger = (l: ILogger) => { currentLogger = l; };
```

- [ ] **Step 3: Commit**
```bash
git add frontend/src/errors/loggerProvider.ts frontend/src/errors/errorLogger.ts
git commit -m "feat: implement logger provider and LocalStorageLogger"
```

### Task 3: Refactor Callers to use Provider

**Files:**
- Modify: `frontend/src/firebase/authService.ts`
- Modify: `frontend/src/store/posPersistence.ts`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Replace direct appendErrorLog calls with getLogger().logError()**

- [ ] **Step 2: Commit**
```bash
git add .
git commit -m "refactor: use logger provider in core logic"
```
