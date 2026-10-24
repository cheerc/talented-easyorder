# EasyOrder Firebase Backup Runbook

> **P14 scope (2026-10-16):** F3 `今日設定` now creates an encrypted, incremental command backup and records `RecordBackup` only after the saved file is selected again and verified locally. This records the browser's local verification; it does not prove a second copy exists. Use only the school-approved storage locations and follow the daily and archive steps below. The P15 restore CLI and its Emulator drill now exist (see the restore runbook); production Firebase deployment and a real-project restore drill remain unverified.

## Daily encrypted command backup

1. Sign in as an approved operator and acquire the current F3 lease. Confirm F3 shows the active connection and holder.
2. Open `今日設定` → `命令備份`. Keep the last verified backup file available and enter its passphrase when creating an increment. For the first backup, leave the previous backup empty; later backups must select and decrypt the previous package so its manifest, dataset, schema, range, and hash are checked locally.
3. Create the package, download it, and save it to the school-approved backup location. The application does not advance the verified sequence when it generates a package or starts a download.
4. Select the saved file again in F3. Wait until F3 verifies its SHA-256, decrypts it, replays its command chain, and records the `RecordBackup` receipt. If the tab closes, selection is cancelled, or verification fails, repeat from the previous verified package; do not treat the generated file as verified.
5. Copy the verified encrypted file to a separate approved location (for example, the school's managed drive plus its approved offline media). Confirm both copies can be read and note the date and file name. This second-copy step is a human responsibility and is not detected by the application.
6. Keep daily incremental packages for at least 90 days. Do not delete a package until its retention period has elapsed and the monthly archive procedure has been completed.

The package contains immutable commands, including voided orders and audit commands, and is encrypted in the browser with AES-GCM. A passphrase derives its key with PBKDF2-SHA256 (600,000 iterations); each package uses fresh random salt and IV values. Store the passphrase separately from the backup files. A lost passphrase makes those packages unreadable. Never put the passphrase in a filename, note beside the package, source repository, or support log.

## Monthly archive and retention

At least monthly, the director/admin should copy the complete retained increment chain to the approved archive locations, verify that each file opens with its passphrase, and record the first/last sequence covered. The current F3 flow exports increments; it does not merge them into a compact checkpoint or prune the chain. Keep the full chain and its separate passphrase until a reviewed checkpoint/restore procedure replaces it. Retain the monthly archive according to school policy; the application does not enforce retention or archive deletion.

## Daily Firebase usage and storage watch (P16f2 S8)

The system does not archive or thin out accounting history (spec §10 forbids deleting it to make room), so the owner watches the numbers instead. Open the Firebase console → Usage once a day (or at least weekly while traffic is low):

| What | Notice (70 %) | Operating alert (85 %) | What to do |
|---|---|---|---|
| Firestore reads a day (limit 50,000) | 35,000 | 42,500 | Stop opening reports of a month and CSV/print runs for the day, finish the day's orders, take the backup. Tell the developer: the capacity gate (`docs/ops/p16-capacity-gate.json`) models 100 commands a day at about 21,700 reads and 200 at about 33,400 (the way it counts, which bills every Rules lookup), so a day far above that means a loop or a page left open; at 200 commands a day the 35,000 notice is within reach, which is why the gate is FAIL at that size. |
| Firestore writes a day (limit 20,000) | 14,000 | 17,000 | The gate models 200 commands at about 1,600 writes; a much higher number is not normal use. |
| Stored data (limit 1 GiB) | 0.70 GiB (717 MiB) | 0.85 GiB (870 MiB) | At the notice: tell the developer and CheerC. Before 0.85 GiB a retention spec (what may be exported and then removed, with CheerC's approval) must exist; nothing is deleted automatically and no accounting document is deleted by hand. |

Storage forecast (P16f2 S8: no archive is built now): at 100 commands a day the two-year projection is 561 MiB (about 1,133 days to 0.85 GiB); at the 200-command design ceiling it is 1,131 MiB, which reaches 0.85 GiB after about a year and a half. If real traffic is nearer 200 a day than 100, schedule the retention spec at the 70 % notice, not later. Record the console figures of each check (date, reads, writes, stored MiB) in the operator's own log, not in this repository.

## Restore ownership and limits

- Counter operator owns daily package creation, local re-selection, and the second-copy confirmation.
- Director/admin owns archive custody and restore approval.
- Developer/support may assist only after director/admin approval.

F3 provides no restore or overwrite action. Do not import a package into a live database, manually edit Firestore, or delete production data as a recovery procedure. Restoring from the encrypted chain uses the local maintenance CLI into a new, isolated project only; follow [firebase-restore-runbook.md](firebase-restore-runbook.md). An encrypted package is not evidence that a restore has been tested: the Emulator drill has run, but the independent Spark empty-project drill is still UNVERIFIED until the director/admin runs it and reports the anonymous numbers.
