# P07 Rules findings closure review

Exact reviewed immutable head: `9923a0385bfec572ae1ae7f8f6eedc0ba8c436dd`.
Compared prior finding head: `5e7362d7c8543fa329f0af2a2d0456f0dc0b9b4b`.
Scope: closure of SaveVendor create receipt/status and SetOpeningCash stored-number findings; Rules budget hash; independently parsed existing r11 reports. Read-only review, no test execution, Emulator, repository edits, or commits.

## Verdict

Both previously reported findings are CLOSED in this exact source. Static correction and the nine executed focused cases support closure. This is not P07 phase acceptance: legal inherited-menu P07.9 still fails, five source-query cases fail, and both P07 browser cases remain reported failing. No required CI or production acceptance is claimed.

## Exact source and budget

`git show` of the exact head yields:

- Rules SHA-256: `0392052e3a1f80d51bf8344e954f294b2170511911a2c070762de024bcfb6f39`.
- cloudCommands.spec.ts SHA-256: `9e168967130498712ab73b08db5efe664bcd66d3d38151103ccde8fd049a484d`.

Both match the current tracked P07 budget appendix. The Rules delta from 5e7362d consists exclusively of the reviewed SaveVendor create guards/status binding and the two actual SetOpeningCash int checks. No new document accesses are added; budget remains vendor/opening 11, direct menu 14, inherited menu 17 per atomic request, with per-writer maxima within 10. These are static no-cache source calculations, not measured access/expression counters.

## SaveVendor finding closed

The create branch now requires `command.before.vendor == null`, binds `vendorAfter.status == command.payload.status`, and requires `command.payload.status == 'active'`. The existing actual vendor getAfter and !exists, fresh receipt, real vendor create leaf, full vendor schema, head advance, and exact snapshot linkage remain. Missing before.vendor now errors/denies; nonnull before.vendor fails; missing or nonactive payload.status cannot pass. Update branch is unchanged.

The exact tests construct all real head/vendor/receipt writers under `authedDb(operatorA)`. Four P07.6b cases vary payload.status (missing/inactive/invalid/null) while explicitly restoring the actual vendor projection and receipt-after vendor to active. Two P07.6c cases omit or replace before.vendor while retaining an otherwise coherent active create. All six use expectRawP07DeniedUnchanged, which snapshots actual head, target vendor, and command; asserts the authenticated batch fails; then compares all three snapshots unchanged.

All six cases are individually present and passed in independently parsed `/tmp/p07-p05-p07-commands-r11.json`, with nonzero execution durations. Their log blocks also contain max-1000 diagnostics; therefore denial/unchanged execution is confirmed, but these runs do not independently demonstrate each predicate rejecting without the cap. The complete static conjunction closes the missing guard finding; no claim of a cap-free isolated guard proof is made.

## SetOpeningCash finding closed

The central helper now checks `dayAfter.openingCash is int` and `dayAfter.revision is int`, where dayAfter is the real getAfter target, before the corresponding payload/revision equalities. Mandatory day update and leaf snapshot/actor/time/diff constraints remain. These checks reject actual double-typed changed fields; no duplicated leaf check is needed.

The REST fixture serializes normal integral values as integerValue and selects genuine doubleValue encoding for openingCash or revision in both the actual target and matching receipt-after day. It preserves all three real writes (head/day/command), server timestamp transforms, fresh command precondition, and valid payload/actor/epoch. The REST request uses `Authorization: Bearer <unsigned emulator mock JWT for operatorA>` with Google provider, matching UID/email and verified email. It does not use an owner/Admin bypass token. Admin helpers are used only for fixture setup and inspection, not the tested REST commit.

P07.10a passed with HTTP 200 for the same authenticated integerValue fixture and asserted committed head/target/receipt plus initial actor/server timestamp. P07.10b openingCash and revision each passed with HTTP 403 and exact before/after equality for head, target day, and command. All three are separately present and passed with nonzero durations in the r11 JSON. The positive control establishes that the REST protocol/auth/server transforms can execute a valid Rules-authorized commit; the negative variants differ in the selected persisted numeric encoding.

Receipt DTO semantics remain integer-valued JavaScript numbers and canonical fingerprints; no additional requirement for identical int/double Firestore encoding inside receipts is imposed or introduced as a blocker. Stored projection types matter because later Rules use is int.

## Independently parsed regression evidence

Existing seven r11 JSON reports were parsed and deduplicated by file name plus full test name:

- A01 10 passed; P01 36 passed; lease 19 passed.
- Command 148 passed / 1 failed / 0 skipped, 149 total; sole failure P07.9 inherited-menu positive.
- Post-commit recovery 6 passed; student reads 11 passed.
- Day/vendor reads 4 passed / 5 failed.
- Unique total: 240 cases, 234 passed, 6 failed, zero skipped.

Nine new focused cases are six SaveVendor denials plus REST integer control and two double denials. Their execution is confirmed rather than inferred from test source or skip status. The tracked artifact index in docs/ops/free-production-evidence.md matches these counts and identifies the existing cap, DESC-query, and browser blockers. Browser outcomes were read from that index; no browser run or independent browser JSON review is claimed in this narrow closure report.

## Remaining phase gate

P07 remains NOT PASS. The existing legal inherited-menu cap failure, five DESC-query read failures, and two P07 browser failures remain outstanding. Closure of these two guard findings does not resolve expression costs, demonstrate pure-Rules infeasibility, validate a newer Emulator, or authorize P08. Required CI, PR/merge and production receipts remain pending.
