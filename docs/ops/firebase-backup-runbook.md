# EasyOrder Firebase Backup Runbook

> **P14 scope (2026-10-16):** F3 `今日設定` now creates an encrypted, incremental command backup and records `RecordBackup` only after the saved file is selected again and verified locally. This records the browser's local verification; it does not prove a second copy exists. Use only the school-approved storage locations and follow the daily and archive steps below. P15 restore tooling, production Firebase deployment, and an operational restore drill remain unverified.

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

## Restore ownership and limits

- Counter operator owns daily package creation, local re-selection, and the second-copy confirmation.
- Director/admin owns archive custody and restore approval.
- Developer/support may assist only after director/admin approval.

P14 provides no normal F3 restore or overwrite action. Do not import a package into a live database, manually edit Firestore, or delete production data as a recovery procedure. A restore CLI, tested replay into an isolated project, production deployment, and restore drill require P15 and separate review. An encrypted package is not evidence that a restore has been tested.
