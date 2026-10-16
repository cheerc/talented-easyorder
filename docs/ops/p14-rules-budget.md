# P14 Firestore Rules budget evidence

`RecordBackup` has two writes in one command transaction: immutable `commands/{id}` creation and `system/dataHead` advancement. Both rules independently validate the backup receipt, the current approved holder, the lease epoch, the head sequence, the zero-accounting effect, and the exact empty projection maps. Neither write creates or updates an accounting projection.

## Document access-call estimate

Counting each Rules `get`/`getAfter` separately and assuming no cache hits, command creation performs at most five accesses in the `validRecordBackup` path: operator and lease through `currentHolder`, the explicit lease read, the old head read, and the committed-head `getAfter`. The dataHead update path adds its command `getAfter` and repeats those five checks, for at most six accesses. This stays below the per-write limit of 10 and the multi-write transaction limit of 20. Firestore may cache repeated reads, so this count is conservative.

## Emulator evidence

- `cloudBackup.spec.ts` proves one atomic `RecordBackup` advances only the head and command receipt, and that an unpaired/fabricated receipt is rejected by Rules.
- The same real Rules Emulator test verifies that a non-holder cannot list commands.
- Full serial Emulator Vitest passes all legacy Rules suites and P14: 173 files, 1,977 tests. This includes old command kinds, writer atomicity, replay/forgery denials, and P14 receipt acceptance/denial. Expected permission-denied logs from negative Rules tests are not test failures.
- A first full run used Vitest's default parallel workers. Firestore Emulator state is shared by those files; unrelated suites collided and produced failures. That run is not evidence. The recorded passing result is the serial `--maxWorkers=1` run.

The Emulator run checks behavior and actual evaluated Rules expression limits for the covered fixtures; it does not replace a production deployment review or a test against the latest `main` rules after P10 lands.
