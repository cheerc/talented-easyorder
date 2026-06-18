# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

# [0.3.0] - 2026-06-15

### Added

- **e2e: expand Playwright tests to 3+ business scenarios** (#269, #277): order→settlement flow, multi-student batch, payment + report verification
- **ci: dedicated e2e-tests.yml** (#268, #270): Playwright e2e moved to release gate + nightly schedule, separated from per-PR `build-and-test`

### Changed

- **refactor: decompose App.tsx god component** (#265, #275): extract `FirebaseProvider`, `AppRouter`, `AuthGate`, `PosColumn.types.ts`; eliminate prop drilling with context + domain selectors
- **refactor: posStore domain selector hooks** (#264, #274): `useStudents()`, `useTransactions()`, `useMenu()`, `useSession()` via `useShallow` for re-render isolation
- **refactor: decouple subsystems from LedgerTransaction** (#267, #276): introduce `ReportTransactionView` DTO, break direct domain type coupling in report/storage layers
- **refactor: decouple errorBus from errorLogger** (#266, #273): lightweight event bus pattern — core modules emit via `emitError()` instead of importing `appendErrorLog` directly
- **refactor: workflow.sh overhaul** (#271, #272): split into 3 files + per-test log + t6 summary; align t-numbering with payroll canonical (#279)

# [0.2.0] - 2026-06-02

### Added

- **feat: e2e-in-CI bootstrap** (#263): Playwright smoke test pipeline with Firebase Emulator
- **feat: TransactionEditView DTO** (#255): decouple `EditTransactionModal` from `LedgerTransaction` god node
- **test: DailySettlement state machine tests** (#256): settlement status transitions coverage

### Changed

- **refactor: storage wire format types** (#238, #257): introduce `WirePersistedState`, decouple persistence layer from domain types
- **refactor: extract shared domain types** (#239, #258): break `ledger→cashClose` circular coupling via `domain/types.ts`
- **refactor: PosState slice interfaces** (#234, #259): type-level domain separation for store consumers
- **fix: extract PosColumnProps** (#237, #254): move to `PosColumn.types.ts`, reduce App.tsx coupling
- **fix: lazy-load Firebase modules** (#236, #253): dynamic `import('firebase/auth')` + `import('firebase/firestore')` — cut initial bundle
- **fix: skip deep validation on normal boot** (#235, #252): performance — `skipDeepValidation` for schema v2+ rehydration
- **fix: useLedgerReport selector optimization** (#251): narrow selector with date filter + `useShallow`

### Fixed

- **Wave 1 quick wins** (#250): PII sanitization patterns, `useShallow` consolidation, barrel import cleanup

### Docs

- **docs: refresh living specs** (#261): deprecate Google Sheets sync, align with current architecture
- **docs: archive 46 old plans** (#260): relocate stray files, clean `docs/superpowers/plans/`

# [0.1.0] - 2026-05-31

### Fixed

- **Security hardening** (#184): prototype pollution guard, PII stack sanitization, unsafe `JSON.parse` type guard, Firestore bootstrap deadlock fix
- **SW cache + IndexedDB fallback** (#183): service worker excludes Firebase endpoints, IndexedDB storage with localStorage fallback
- **ErrorBoundary PII sanitization** (#211): sanitize error messages, wrap PosColumn in ErrorBoundary, use `appendErrorLog`
- **sessionStorage handoff** (#212): localStorage→sessionStorage for iPad handoff, camera policy, SW cache fix, remove hardcoded API key
- **Pagination + derived hooks** (#213): history table pagination, `useShallow` consolidation, tx filter limit, derived report hooks
- **Firestore rules alignment** (#214): DRY balance recalculation, emulator test coverage, `restoreMocks` cleanup
- **Firebase Repo integration** (#230): #216 Firebase repository pattern + #217 IndexedDB connection leak fix
- **Component + config fixes** (#231): #218 `useMemo` posColumnProps, #219 AdminScreen pagination, #220 AppCrashPage reload, #221 tsconfig strict, #222 remove console.error, #226 `useShallow`
- **LOW/INFO cleanup** (#232): #223 remove unused SyncStatusBadge, #224/#225 `useShallow` consolidation, #227 onSnapshot error logging, #228 remove unnecessary useMemo, #229 queueMicrotask

### Changed

- **Wave 5 final cleanup** (#215): #203 error log localStorage rationale, #205/#206 Firebase import verification, #207 crashDraft error logging, #208/#209 documentation
