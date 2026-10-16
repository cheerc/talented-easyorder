# P14 implementation receipt

Date: 2026-10-16 (Asia/Taipei)

Branch: `codex/p14-incremental-backup`

Implementation base: `e01ebdff5e784522b15a6f16278ef303a9c63110`
Tested implementation commit: `6cce710` (source and behavior under test; this receipt is a documentation-only follow-up).

## Delivered

- Added paged, server-only command export over a fixed dataHead `H`, contiguous sequence and dataset/schema checks, empty `S=H` increments, previous-package validation, immutable command replay, projection before/after chain checks, settlement revision replay, and recalculated/reconciled daily totals.
- Added versioned encrypted packages using Web Crypto AES-GCM and PBKDF2-SHA256 at 600,000 iterations with fresh salt and IV. Wrong passwords, malformed/corrupt packages, unsupported kinds, incompatible ranges and oversized packages fail closed.
- Added `RecordBackup` to the fixed command schema/writer/Rules. It records only verified local file sequence/range/hash, advances the immutable head atomically and changes no accounting projection.
- Embedded the backup flow in F3 `今日設定`. It needs a downloaded file to be reselected, hashed and decrypted before it writes `RecordBackup`. Session/lease changes clear package and password state. No live restore or overwrite control is added.
- Updated the daily backup runbook, this receipt, and the Rules budget evidence. The coordinator's implementation plan is included in this change.

## Focused behavior evidence

Real Firestore Emulator tests use anonymous synthetic fixtures and the repository's actual Rules file. `frontend/src/firebase/__tests__/cloudBackup.spec.ts` covers H=0, contiguous prefix including an earlier `RecordBackup`, fixed H while the head advances during paging, `S=H` and resume, missing/duplicate seq, non-holder denial, dataset/schema mismatch, atomic receipt, fabricated receipt denial, fresh encryption parameters, bad passphrase/tampering, and synthetic P10 `CorrectTransaction` plus P11 `CloseDay`/`ReopenDay` replay with a wrong-target rejection.

The dedicated `BackupScreen.test.tsx` renders the F3 screen with an anonymous test lease and mocked repository boundary. It proves generate alone makes no receipt call, file selection invokes verification, and only after verification the component sends `RecordBackup`. Repository export and Rules behavior are separately tested against the real Firestore Emulator.

## Verification

- `npx firebase emulators:exec --project demo-easyorder --config ../firebase.json --only firestore "npx vitest run --maxWorkers=1"` — **174 files, 1,978 tests passed**. Serial execution is required because the test files share one emulator database.
- A full Vitest run with default parallel workers produced cross-suite emulator collisions and unrelated Rules failures; it is discarded as evidence. The passing serial run is the evidence used here.
- `npm run lint` — pass.
- `npm run build` — pass (Vite prints its existing native-config `__dirname` warning).
- `npx tsc -p tsconfig.app.json --noEmit` — exits 2 on this base because of existing project diagnostics. The base commit was extracted with `git archive` to `/tmp/p14-base` and checked with the same dependencies; base and final outputs are exactly 460 lines and byte-identical. No diagnostics mention changed P14 modules.
- `npm run test:e2e` — first Chromium run: **17/18 passed**; existing P04 A05 lease-clock scenario timed out waiting for its auth-gate element after reload. An isolated rerun of A05 passed **1/1**, indicating a flaky timing failure. Because the chained command stopped on that first-suite failure, prototype E2E was run separately and passed **7/7**. These existing Playwright suites do not exercise P14 backup UI.

## Remaining limits

- P10/P11 real production writers and the latest `main` command schema/Rules are outside this branch's base; synthetic replay coverage is not proof of compatibility with their final merged shape. Re-run the compatibility gate against latest `main` before merge.
- There is no P15 restore CLI, compact checkpoint merger, or automated second-copy/retention enforcement. Monthly archives, 90-day retention and the independent second copy are manual operator responsibilities in the runbook.
- No production Firebase project, production Spark deployment, or operational restore drill is claimed or tested.
- The stock Playwright A05 timing scenario was flaky once, then passed isolated; see E2E results above.
