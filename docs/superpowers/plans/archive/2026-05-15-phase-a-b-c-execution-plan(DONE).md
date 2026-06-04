---
status: approved
date: 2026-05-15
complexity: complex+
---

# Phase A/B/C Execution Plan — Error Handling, Design System, PWA

## Goal

依序實作三個 plan 的前端部分，每個 phase 拆成 1-2 個 PR。

## Context

- Base SHA: `142eae1`
- 現有 230 tests
- Error Boundary 已在 PR #18 完成（Task 2 跳過）
- 參考 plan 在 source repo（`git show 60a3fd0:docs/superpowers/plans/...`）

---

## Phase A — Error Handling Recovery（優先）

參考：`docs/superpowers/plans/2026-05-15-error-handling-recovery-strategy.md` (commit 60a3fd0)

### PR-A1: Error Catalog + Runtime Logger + Store Corruption Detection

**Tasks covered**: Task 1 (Error Catalog), Task 3 (Runtime Logger), Task 4 (Zustand Persist Corruption Detection)

**Scope**:
- `frontend/src/errors/errorCatalog.ts` (new) — 使用者友善錯誤訊息 catalog
- `frontend/src/errors/__tests__/errorCatalog.test.ts` (new)
- `frontend/src/errors/errorLogger.ts` (new) — ring buffer logger + PII sanitizer
- `frontend/src/errors/__tests__/errorLogger.test.ts` (new)
- `frontend/src/storage/posStateValidator.ts` (new) — Zustand persist state validation
- `frontend/src/storage/__tests__/posStateValidator.test.ts` (new)
- `frontend/src/store/posStore.ts` — integrate validate/repair into persist onRehydrateStorage

**Success criteria**:
- Error catalog maps error codes to operator-friendly messages
- Runtime logger captures errors with ring buffer, sanitizes PII
- Zustand persist detects corrupt JSON / missing fields / type errors, repairs or falls back

### PR-A2: Crash Draft Recovery + Commit Boundary + Sync Failure UX

**Tasks covered**: Task 5 (IndexedDB Health Check), Task 6 (Crash Draft Recovery), Task 7 (Commit Boundary And Sync Failure UX)

**Scope**:
- `frontend/src/storage/storageHealth.ts` (new) — localStorage/IndexedDB availability check
- `frontend/src/storage/__tests__/storageHealth.test.ts` (new)
- `frontend/src/storage/crashDraft.ts` (new) — 未完成交易草稿保存與恢復（IndexedDB）
- `frontend/src/storage/__tests__/crashDraft.test.ts` (new)
- `frontend/src/App.tsx` — commit boundary 前後錯誤分界、crash draft save/restore
- `frontend/src/components/pos-components.tsx` — sync failure status UI

**Success criteria**:
- Browser crash/refresh 後可恢復未完成交易草稿
- Local commit 失敗 vs post-commit sync 失敗有明確區分
- IndexedDB 不可用時有 fallback 路徑

---

## Phase B — Design System 元件庫

參考：`docs/superpowers/plans/2026-05-15-design-system-component-library.md` (commit 60a3fd0)

### PR-B1: Token CSS + UI Primitives (Button/Card/Kbd)

**Tasks covered**: Task 1 (Extract token CSS), Task 2 (Button/Card/Kbd)

**Scope**:
- `frontend/src/styles/tokens.css` (new) — extract design tokens from index.css
- `frontend/src/index.css` — import tokens, keep existing rules
- `frontend/src/components/ui/Button.tsx` (new) + CSS
- `frontend/src/components/ui/Card.tsx` (new) + CSS
- `frontend/src/components/ui/Kbd.tsx` (new) + CSS
- `frontend/src/components/ui/__tests__/` — primitive smoke tests

**Success criteria**:
- Token CSS extracted without visual regression
- Button/Card/Kbd primitives reusable and testable
- Button min-height ≥ 44px（a11y，PR #19 已設定）

### PR-B2: Form Components + Modal Replacement

**Tasks covered**: Task 3 (Field/TextField/NumberField/StatusBadge/Tabs/EmptyState), Task 4 (Modal/ConfirmDialog)

**Scope**:
- `frontend/src/components/ui/Field.tsx`, `TextField.tsx`, `NumberField.tsx` (new)
- `frontend/src/components/ui/StatusBadge.tsx`, `Tabs.tsx`, `EmptyState.tsx` (new)
- `frontend/src/components/ui/Modal.tsx`, `ConfirmDialog.tsx` (new)
- Replace browser `confirm()` calls in screens with ConfirmDialog
- Accessibility tests for form components

**Success criteria**:
- Form components with label/help/error patterns
- Modal/ConfirmDialog replaces browser confirm()
- All form elements have accessible names

---

## Phase C — PWA Offline-First（前端部分）

參考：`docs/superpowers/plans/2026-05-15-pwa-offline-first-strategy.md` (commit 60a3fd0)

### PR-C1: Service Worker + Web App Manifest + Install Prompt

**Scope**:
- `frontend/package.json` — add `vite-plugin-pwa` + Workbox
- `frontend/vite.config.ts` — configure `VitePWA` with `generateSW`
- `frontend/public/manifest.json` (new) — Web App Manifest
- `frontend/index.html` — link manifest, theme-color meta
- `frontend/src/components/PwaInstallBanner.tsx` (new) — install prompt UX
- `frontend/src/App.tsx` — integrate install banner

**Success criteria**:
- App can load without network after first visit
- Service worker precaches Vite output assets
- Install prompt shows on supported browsers
- Skip sync/offline queue（Phase 1.3 backend 未定）

---

## Verification Matrix

| PR | t1 (tsc) | t2 (lint) | t3 (vitest) | t4 (build) | Reviewer |
|----|----------|-----------|-------------|------------|----------|
| PR-A1 | ✅ | ✅ | ✅ | ✅ | VERIFIED |
| PR-A2 | ✅ | ✅ | ✅ | ✅ | VERIFIED |
| PR-B1 | ✅ | ✅ | ✅ | ✅ | VERIFIED |
| PR-B2 | ✅ | ✅ | ✅ | ✅ | VERIFIED |
| PR-C1 | ✅ | ✅ | ✅ | ✅ | VERIFIED |

## Execution Order

PR-A1 → PR-A2 → PR-B1 → PR-B2 → PR-C1
Each PR: impl → reviewer → merge gate → cleanup → next
