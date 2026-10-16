# P14 Firestore Rules budget evidence

`RecordBackup` has two writes in one command transaction: immutable `commands/{id}` creation and `system/dataHead` advancement. Both rules independently validate the backup receipt, the current approved holder, the lease epoch, the head sequence, the zero-accounting effect, and the exact empty projection maps. Neither write creates or updates an accounting projection.

## Document access-call estimate

Counting each Rules `get`/`getAfter` separately and assuming no cache hits, command creation performs at most five accesses in the `validRecordBackup` path: operator and lease through `currentHolder`, the explicit lease read, the old head read, and the committed-head `getAfter`. The dataHead update path additionally evaluates `headCommand`'s command `getAfter` and `exists` checks, for a conservative seven accesses on that write. The two-write transaction total is therefore 12, below the per-write limit of 10 and multi-write transaction limit of 20. Firestore may cache repeated reads, so this count is conservative.

## Emulator evidence

- `cloudBackup.spec.ts` proves real `EnsureDay` and `CreateStudent` writer receipts can be exported and checked against their payload semantics, and that an H export can be followed by a later writer command before the original H is registered. It also proves receipt leaseEpoch survives export/decrypt round-trip and unpaired/fabricated, old-epoch, extra-projection, and replayed receipts are rejected by Rules.
- The same real Rules Emulator test verifies that a non-holder cannot list commands.
- Full serial Emulator Vitest passed all legacy Rules suites and P14 after the payload-semantic fixes: 174 files, 1,985 tests. Expected permission-denied logs from negative Rules tests are not test failures.
- A first full run used Vitest's default parallel workers. Firestore Emulator state is shared by those files; unrelated suites collided and produced failures. That run is not evidence. The recorded passing result is the serial `--maxWorkers=1` run.

The Emulator run checks behavior and actual evaluated Rules expression limits for the covered fixtures; it does not replace a production deployment review or a test against the latest `main` rules after P10 lands.
