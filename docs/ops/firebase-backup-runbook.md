# EasyOrder Firebase Backup Runbook

> **P14 scope (2026-10-16; entry moved 2026-11, #649):** F3 `今日設定` › `資料備份` (it used to sit below the close section of F2 `今日`) creates an encrypted, incremental command backup and records `RecordBackup` only after the saved file is selected again and verified locally. This records the browser's local verification; it does not prove a second copy exists. Use only the school-approved storage locations and follow the daily and archive steps below. The P15 restore CLI and its Emulator drill now exist (see the restore runbook); production Firebase deployment and a real-project restore drill remain unverified.

## Encrypted command backup (about once a month)

The backup frequency is not fixed: about once a month. There is no daily reminder and the app does not remind the operator. The home page does not show the last exported sequence (the earlier design did; it was never built). Take an extra one whenever the director/admin wants a fresh copy, for example after an unusually busy period.

1. Sign in as an approved operator and acquire the current F3 lease. Confirm F3 shows the active connection and holder.
2. Open F3 `今日設定` › `資料備份` (last item of the sub-menu). Keep the last verified backup file available and enter its passphrase when creating an increment. For the first backup, leave the previous backup empty; later backups must select and decrypt the previous package so its manifest, dataset, schema, range, and hash are checked locally.
3. Create the package, download it, and save it to the school-approved backup location. The application does not advance the verified sequence when it generates a package or starts a download.
4. Select the saved file again in F3. Wait until F3 verifies its SHA-256, decrypts it, replays its command chain, and records the `RecordBackup` receipt. If the tab closes, selection is cancelled, or verification fails, repeat from the previous verified package; do not treat the generated file as verified.
5. Copy the verified encrypted file to a separate approved location (for example, the school's managed drive plus its approved offline media). Confirm both copies can be read and note the date and file name. This second-copy step is a human responsibility and is not detected by the application.
6. Keep incremental packages for at least 90 days. Do not delete a package until its retention period has elapsed and the monthly archive procedure has been completed.

The package contains immutable commands, including voided orders and audit commands, and is encrypted in the browser with AES-GCM. A passphrase derives its key with PBKDF2-SHA256 (600,000 iterations); each package uses fresh random salt and IV values. Store the passphrase separately from the backup files. A lost passphrase makes those packages unreadable. Never put the passphrase in a filename, note beside the package, source repository, or support log.

## Monthly archive and retention

At least monthly, the director/admin should copy the complete retained increment chain to the approved archive locations, verify that each file opens with its passphrase, and record the first/last sequence covered. The current F3 flow exports increments; it does not merge them into a compact checkpoint or prune the chain. Keep the full chain and its separate passphrase until a reviewed checkpoint/restore procedure replaces it. Retain the monthly archive according to school policy; the application does not enforce retention or archive deletion.

## Daily Firebase usage and storage watch (P16f2 S8)

The system does not archive or thin out accounting history (spec §10 forbids deleting it to make room), so the owner watches the numbers instead. Open the Firebase console → Usage once a day (or at least weekly while traffic is low):

| What | Notice (70 %) | Operating alert (85 %) | What to do |
|---|---|---|---|
| Firestore reads a day (limit 50,000) | 35,000 | 42,500 | Stop opening reports of a month and CSV/print runs for the day, finish the day's orders, take the backup. Tell the developer: the capacity gate (`docs/ops/p16-capacity-gate.json`) models 100 commands a day at about 23,500 reads (the way it counts, which bills every Rules lookup; about 22,700 the way Firebase bills), so a day far above that means a loop or a page left open. **If the Spark quota is used up, reads stop for the rest of the day** (the day's orders cannot be entered until the quota resets), so do not wait for the alert. |
| Firestore writes a day (limit 20,000) | 14,000 | 17,000 | The gate models 200 commands at about 1,600 writes; a much higher number is not normal use. |
| Stored data (limit 1 GiB) | 0.70 GiB (717 MiB) | 0.85 GiB (870 MiB) | At the notice: tell the developer and CheerC. Before 0.85 GiB a retention spec (what may be exported and then removed, with CheerC's approval) must exist; nothing is deleted automatically and no accounting document is deleted by hand. |

**Revisit trigger (coordinator ruling R2):** the gate passes for 100 commands a day; 200 commands a day (about 36,100 reads by the same count) is the documented capacity limit and is not covered. Open the capacity work again (P16g: more read subtraction, or a plan change with CheerC) when the console shows about 20,000 reads on a normal day, or when the day's commands stay above 100 on several days of a week, or at the 70 % reads notice on two days in a row.

Storage forecast (P16f2 S8: no archive is built now): at 100 commands a day the two-year projection is 561 MiB (about 1,133 days to 0.85 GiB); at the 200-command design ceiling it is 1,131 MiB, which reaches 0.85 GiB after about a year and a half. If real traffic is nearer 200 a day than 100, schedule the retention spec at the 70 % notice, not later. Record the console figures of each check (date, reads, writes, stored MiB) in the operator's own log, not in this repository.

## Restore ownership and limits

- Counter operator owns package creation, local re-selection, and the second-copy confirmation.
- Director/admin owns archive custody and restore approval.
- Developer/support may assist only after director/admin approval.

F3 provides no restore or overwrite action. Do not import a package into a live database, manually edit Firestore, or delete production data as a recovery procedure. Restoring from the encrypted chain uses the local maintenance CLI into a new, isolated project only; follow [firebase-restore-runbook.md](firebase-restore-runbook.md). An encrypted package is not evidence that a restore has been tested: the Emulator drill has run, but the independent Spark empty-project drill is still UNVERIFIED until the director/admin runs it and reports the anonymous numbers.

## 未來展望

這一節是方向，不是承諾，也不代表已授權或已排程。

- **每月自動觸發備份到某個雲端位置。** 原因：櫃台人員流動率高，下載到本機再人工複製有外洩與遺失風險，也難以讓新人反覆訓練到熟。目標是把「產生、驗證、存放」變成不依賴人員記憶的流程。
- **限制：** Firebase 的受管備份、排程匯出與 PITR（時間點復原）都需要 Blaze（付費）方案。本案使用 Spark，且不啟用 billing，所以這些都不能直接用。要做就必須另找不需付費的方式，並由使用者決策；目前沒有選定的方案。
- 在那之前維持現況：由操作者在 F3 › 資料備份手動產生、下載、重新選取驗證，第二份副本由人工確認（見上方步驟）。
