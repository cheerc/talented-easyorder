# P07 exact checkpoint Rules / budget review

Reviewed immutable head: `5e7362d7c8543fa329f0af2a2d0456f0dc0b9b4b`.
Base: `b518eca5fdc2b2d2d3e9197c30b29d6a5f74ce10`.
Rules SHA-256: `ff6f91f0019c2450f8e3343bf256dc06851841da488bcf2ff4e6a647d5547955` (matches tracked budget).
Scope: immutable Rules and P07 budget appendix; static read-only review. No Emulator, tests, repository changes, or commits. Unrelated dirty App.tsx was excluded.

## Verdict

NOT PASS for complete Rules correctness: the r8/r9 inherited redistribution and exact-size equivalence proofs hold, but the broader base-to-head P07 review identifies the following guard gaps. P07 phase acceptance remains NOT PASS independently because the reported gates include P07.9 positive 1 failure, source suite 5 failures, and browser 2 failures. None of this is CI or production acceptance.

## P2 — SaveVendor create accepts malformed or incoherent receipt input

Anchors: firestore.rules:489, 495, 500–506; vendorCreateCommand / vendors create leaf.

The create branch never reads `command.payload.status`. `exactMap` uses only `hasOnly`, so it does not require that key. A raw batch can omit status or set it to inactive/arbitrary data while writing an active valid vendor. All existing predicates can still hold, leaving a receipt that disagrees with its projection and canonical SaveVendor input.

The same branch checks `vendorBefore == null`, but the caller passes literal null. This does not check `command.before.vendor`. Neither the central create branch nor the vendor create leaf requires that receipt field to be null. It can be omitted or hold arbitrary nonnull data despite creation of a new document.

Required fix: explicitly require `command.payload.status == 'active'` (or bind payload status to the active projection) and `command.before.vendor == null` in create. Add raw negative cases that preserve every real writer and other valid field while varying/omitting these fields. This finding is established from the accepted predicate conjunction; no runtime exploit was executed.

## P2 — SetOpeningCash does not enforce integer types on changed stored numbers

Anchors: firestore.rules:704, 716–718, 952–966; outer days update revision equality.

Payload openingCash is checked as int, but stored after.openingCash is only compared using numeric equality. Stored after.revision likewise has equality to before+1 without an int check. The leaf validates full `before`, then diff/actor/time invariants, and does not validate full `after`. Firestore Rules numeric equality permits numerically equal int/float values, so equality to an int is not a stored-int type proof. An integer-valued double projection can satisfy these comparisons while failing the intended persisted schema. SDK JavaScript integer serialization may hide this case; use raw REST doubleValue fixtures for confirmation.

Required fix: enforce `dayAfter.openingCash is int` and `dayAfter.revision is int` (or equivalent complete after schema validation without duplicating unnecessary checks). Retain all existing bounds, actor/time and immutable field constraints. This is a static type-proof finding; no REST exploit was executed.

## Preserved r8/r9 proofs

- Inherited central reads actual target before/getAfter and requires strict revision increase and +1, lastCommandId/time. A receipt-only write cannot satisfy this; the existing day must be updated.
- Mandatory day leaf binds fresh receipt, path target, and exact actual before/after snapshots. It retains full source day/menu schema, current vendor schema/active/deleted/name, copied business fields, and exact eight-key target menu map with integer guards.
- Before-invalid target rejection remains: unchanged non-menu fields inherit after validation through the restricted diff; before keys plus after exact shape exclude extras; old menu/revision/meta remain checked.
- Head full-before schema plus immutable field equality, restricted diff, typed strict seq+1 and current command/time preserve complete after schema. All ten central kinds require actual head advance; fresh receipt cannot authorize an independent head mutation. Dispatcher still exposes exactly ten kinds and leaves twelve denied.
- Cardinality replacements for validDay/validTotals/validMenu/validVendor retain schema exactness: each successful conjunction reads all N required keys, missing keys deny, and size N excludes extras. validDayNonMenu preserves the original key whitelist.

## Static budget

P07 appendix matches this Rules hash and the reviewed graph: vendor/opening central6 + head2 + target2 + Verify1 =11; direct menu central7 + head2 + target2 + Verify3 =14; inherited central6 + head2 + target4 + Verify5 =17. Per writer maxima are 6, 7, 6 respectively, all <=10; request totals <=20. Inherited redistribution changes 8+2 to 6+4 and does not save aggregate calls. Separate BatchGet dependency totals 7/7/9/11 are not counted again in commit closure. These are source estimates, not Emulator access counters or expression counts.

## Remaining blocking work

Fix the receipt/type gaps and confirm isolated raw denial/unchanged-state cases; then resume legal inherited-expression and exact descending source query investigation on an obtainable official Emulator. Current repeated cap diagnostics do not prove individual predicate costs or pure-Rules infeasibility. Do not weaken full source schema, current vendor checks, before-invalid rejection, or mandatory writes. Required CI and phase acceptance remain pending.

## Follow-up narrow fix review (dirty delta after reviewed immutable head)

The exact SaveVendor dirty diff was read: create now requires `command.before.vendor == null`, compares `vendorAfter.status == command.payload.status`, and requires `command.payload.status == 'active'`. This closes both create receipt gaps without changing update. Static delta review PASS; immutable baseline verdict above remains a record of 5e7362d.

Approved SetOpeningCash proposal: add `dayAfter.openingCash is int` and `dayAfter.revision is int` immediately before the corresponding equalities in the central helper, where dayAfter is the actual getAfter target. This guarantees the stored changed numbers have integer type; duplicating these guards at the leaf is unnecessary. Require raw REST doubleValue negative cases for both actual projection fields, preserving all other coherent writers, plus a legal positive. JS SDK integer serialization alone cannot demonstrate this boundary.

Numeric type scope caveat: checking actual getAfter numbers does not itself require identical Firestore int-vs-double encoding inside the receipt's copied after map, because Rules numeric equality may regard those maps as equal. A receipt-only double with a genuine integer target is a separate test/contract question from the confirmed stored-projection type gap. This follow-up does not claim all cross-document numeric encodings are strictly identical.

No Emulator was run by this reviewer. The proposed Opening change must still be applied and frozen by the owner and verified by the integrator; this paragraph does not assert runtime success or a new immutable-head acceptance.

Applied follow-up Rules file was reread; SHA-256 `0392052e3a1f80d51bf8344e954f294b2170511911a2c070762de024bcfb6f39`. Exact dirty delta is limited to the reviewed SaveVendor guards/status binding and the two actual SetOpeningCash integer checks. Static fix delta review PASS; runtime checks remain with the integrator.

Scope resolution from coordinator: receipt DTO/decoder uses semantic `Number.isInteger` and canonical numeric fingerprint identity; integer-valued double and int decode to the same semantic value. No reviewed P07 clause requires identical Firestore numeric encoding inside receipts. The preceding receipt-encoding caveat therefore creates no additional blocker. Actual projection integer guards remain necessary because subsequent Rules depend on persisted `is int` types. No additional receipt encoding changes are requested.
