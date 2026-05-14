# Talented EasyOrder Development Roadmap

> **For agentic workers:** This roadmap is the sequencing source of truth for follow-up implementation plans. Do not implement from this roadmap directly; each phase requires its own execution plan under `docs/superpowers/plans/` after roadmap approval.

**Goal:** Bring Talented EasyOrder from the current high-fidelity local PC POS prototype to a production-ready, auditable, offline-capable Google Sheets-backed POS, then extend it with Phase 2 iPad face-recognition handoff.

**Architecture:** The system remains local-first on the PC. Domain logic and ledger state commit locally before sync; Google Sheets is the inspectable persistence/backup layer; iPad recognition automates student lookup only and never becomes the accounting authority.

**Tech Stack:** Vite 8, React 19, TypeScript 6, Zustand 5, Vitest 4, Testing Library, Google Sheets/Apps Script or an equivalent adapter selected in Phase 1.3.

---

## Source Specs

- `docs/superpowers/specs/2026-05-14-student-account-management-spec.md`
- `docs/superpowers/specs/2026-05-14-menu-vendor-management-spec.md`
- `docs/superpowers/specs/2026-05-14-pc-pos-order-flow-spec.md`
- `docs/superpowers/specs/2026-05-14-order-ledger-cash-close-spec.md`
- `docs/superpowers/specs/2026-05-14-google-sheets-sync-offline-spec.md`
- `docs/superpowers/specs/2026-05-14-ipad-face-auth-handoff-spec.md`

## Phase Overview

| Phase | Goal | Scope | Estimate | Priority | Depends On |
|---|---|---|---:|---|---|
| Phase 1.0 | Foundation hardening | Domain models, store refactor, test infra, compatibility with current UI | 4-6 dev days | P0 | Current prototype |
| Phase 1.1 | PC POS formalization | POS state machine, snapshots, text + future scan input boundary, error/cancel/retry handling | 4-6 dev days | P0 | Phase 1.0 |
| Phase 1.2 | Reporting and settlement | Ledger report filters, audit trail, correction/void, cash close/reopen, CSV/print | 6-8 dev days | P0 | Phase 1.1 |
| Phase 1.3 | Sheets sync and offline | Three-sheet mapping, durable queue, retry/idempotency, conflicts, restore, migration | 8-12 dev days | P1 | Phase 1.2 |
| Phase 2 | iPad face handoff | iPad camera feasibility, enrollment metadata, privacy-safe screen, PC handoff receiver | 8-12 dev days | P2 | Phase 1.0, Phase 1.1, Phase 1.3 metadata path |

Estimates assume one implementer with focused reviews and no major product scope changes. Phase 1.3 and Phase 2 should be split further if transport/model feasibility creates uncertainty.

## Dependency Graph

```text
Current prototype
  |
  v
Phase 1.0 Foundation hardening
  |
  v
Phase 1.1 PC POS formalization
  |
  v
Phase 1.2 Reporting and settlement
  |
  v
Phase 1.3 Google Sheets sync and offline
  |
  v
Phase 2 iPad face handoff

Phase 2 also depends directly on Phase 1.0 student/profile domain types
and Phase 1.1 PC handoff/state-machine receiver behavior.
```

## Phase Details

### Phase 1.0: 基礎架構補強

**Goal:** Establish the shared domain layer that every later phase uses.

**Scope:**

- Add TypeScript domain models for `StudentAccount`, `StudentSnapshot`, `Vendor`, `TodayMenu`, `MenuSnapshot`, `LedgerTransaction`, `DailySettlement`, business date status, and sync status fields.
- Move transaction math, student import validation, menu validation, duplicate/cancel availability, and after-balance recalculation into pure functions.
- Refactor Zustand store to use the domain helpers while preserving current UI behavior.
- Add focused Vitest coverage for domain functions and existing store behavior.
- Preserve current mock data values and localStorage compatibility or document migration needs.

**Out of scope:**

- New admin UI screens.
- Google Sheets transport.
- iPad camera/enrollment UI.

**Milestone:** Current POS still behaves the same, but core business rules are covered by tests and no longer live only inside React component state.

### Phase 1.1: PC POS 核心流程正式化

**Goal:** Turn the prototype POS flow into a robust, testable state machine.

**Scope:**

- Implement `PosFlowState` and transition helpers for idle, selected, duplicate warning, committing, success, error, and historical read-only states.
- Preserve existing id/name text search and define the QR/barcode scan input boundary without requiring scanner hardware yet.
- Capture student/menu/vendor snapshots at transaction creation.
- Add explicit error, cancel, retry, duplicate-submit, and historical-lock behavior.
- Add integration tests for keyboard flow, duplicate warning, success reset, historical lock, and the future iPad handoff receiver boundary.

**Out of scope:**

- Cash close and audit UI.
- Real barcode scanner integration beyond input boundary.
- Face recognition implementation.

**Milestone:** Operators can keep using the current POS flow, but keyboard shortcuts and write guards are backed by a formal state machine and tests.

### Phase 1.2: 報表與結算

**Goal:** Make the report screen an auditable ledger and daily closeout tool.

**Scope:**

- Implement today/week/month/custom report filters from `businessDate`.
- Implement required totals: order count, order sales, cash collected, refunds, net cash, new debt, top-up amount, cancellation count, transaction count.
- Replace unsafe edit/delete behavior with correction, void/reversal, required reason, and audit events.
- Implement formal cash close/reopen, settlement revisions, closed-date read-only guards, and discrepancy note rules.
- Implement 20-column transaction CSV, 15-column settlement CSV, and print view model.

**Out of scope:**

- Remote sync transport.
- External accounting package integration.
- Tax/invoice handling.

**Milestone:** A business date can be closed, reopened with reason, exported, printed, and protected from accidental edits.

### Phase 1.3: Google Sheets 同步與離線

**Goal:** Add reliable persistence and recovery without blocking lunch service.

**Scope:**

- Decide the Sheets transport architecture: Apps Script API, backend proxy, or direct Google API with OAuth.
- Map the three PDF sheets: student master, transaction ledger, daily settlement summary.
- Implement durable queue lifecycle: local commit, queue, retrying, synced, failed, conflict.
- Implement idempotency keys, dependency ordering, retry/backoff, online/offline detection plus remote health check, and automatic reconnection補登.
- Implement conflict strategies: server-wins and last-write-wins for mutable master data; manual resolve for transactions and settlements.
- Implement restore preview/apply and old first-form migration preview/commit with migration batch id.

**Out of scope:**

- Biometric model/profile distribution beyond metadata needed by Phase 2.
- Long-term database replacement beyond Google Sheets.
- Credential provisioning runbook unless required by chosen transport plan.

**Milestone:** PC can continue offline, survive browser refresh with queued rows, and sync to Sheets automatically after reconnection with repairable failed/conflict states.

### Phase 2: iPad 人臉辨識 Handoff

**Goal:** Add privacy-safe iPad recognition that selects/queues students on the PC POS.

**Scope:**

- Run and document target iPad feasibility for camera access, HTTPS/trusted deployment, recognition model latency, and offline profile index.
- Add face profile metadata and admin enrollment/disable/re-enroll workflow.
- Build student-facing iPad recognition screen that never displays balance, debt, transaction history, meal price, or payment amount.
- Implement idempotent `FaceHandoffEvent` creation and PC receiver behavior.
- Add tests for privacy boundary, no-match/ambiguous/camera-denied/offline states, PC idle accept, PC active queue/reject, duplicate event ignore, and no auto-created transaction.

**Out of scope:**

- Autonomous iPad checkout.
- Payment on iPad.
- Parent/student mobile app.
- Final biometric legal/consent policy text beyond technical privacy constraints.

**Milestone:** iPad can identify a student and hand off to PC safely, while PC remains the only transaction authority.

## Milestone Definitions

### M0: Roadmap Approved

- Six specs approved.
- This roadmap approved.
- Phase plan writing may begin.

### M1: Phase 1.0 Ready For Implementation

- Phase 1.0 execution plan written and approved.
- Task board items can be created directly from task IDs in the plan.

### M2: Phase 1.1 POS Formalization Complete

- POS state machine merged.
- Current operator flow verified by integration tests.
- Transaction snapshots created on every new transaction.

### M3: Phase 1.2 Closeout Complete

- Ledger audit/correction model merged.
- Cash close/reopen merged.
- CSV/print exports verified.

### M4: Phase 1.3 Sync Pilot Complete

- Fake adapter tests pass.
- Real selected transport can sync a pilot sheet.
- Offline queue and reconnection補登 verified.

### M5: Phase 2 Feasibility Approved

- Target iPad feasibility documented.
- Privacy boundary tests exist.
- Production face-recognition rollout decision can be made.

## Global Verification Gate

Run from `frontend/` before every implementation PR:

```bash
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```

Each phase plan must add its own focused tests and define what counts as unit, integration, and e2e verification for that phase.

## Planning Checkpoint

Do not write phase execution plans until this roadmap is reviewed and approved. After approval, create one plan per phase under `docs/superpowers/plans/`, using task IDs that can be copied directly to the AgEnD task board.
