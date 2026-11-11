# P07 frozen interface contract

Base: P06 merge `b518eca5fdc2b2d2d3e9197c30b29d6a5f74ce10`. This contract is frozen for P07 repository, UI, and Rules implementation.

## Enabled kinds and shared invariants

Keep the six enabled kinds: EnsureDay, CreateStudent, EditStudent, SetStudentStatus, CreateOrder, CreatePayment. Enable exactly four: SaveVendor, RemoveVendor, SetDayMenu, SetOpeningCash. Total enabled: 10; remaining 12 stay denied. EnsureDay already permits calendar-valid dates >= dataHead.goLiveDate, including future dates; preserve that contract. It creates only an empty, unconfirmed open day and never resets an existing day.

Every command goes through the sole `commitCommand` path. Keep the existing server transaction/receipt guarantees: reads before writes, immutable receipt, head seq +1, one target projection revision +1, exact before/after snapshots, server actor/time, zero cashEffect, receipt read confirmation, and same-ID unknown recovery. Normalization, receipt decode, fingerprint/replay, repository, and Rules must agree.

## Read DTOs

All DTOs are server-decoded; timestamp values in read DTOs are ISO strings.

```ts
interface CloudVendorRecord {
  vendorId: string; name: string; phone: string; note: string;
  status: 'active' | 'inactive'; deleted: boolean;
  createdAt: string; revision: number; lastCommandId: string; updatedAt: string;
}
interface CloudDayMenuRecord {
  businessDate: string; itemName: string; price: number; vendorId: string;
  vendorNameSnapshot: string; updatedAt: string; revision: number;
  inheritedFromDate: string | null;
}
interface CloudDayRecord {
  dayId: string; status: 'open' | 'closed' | 'reopened'; revision: number;
  menu: CloudDayMenuRecord | null; openingCash: number | null;
  openedBy: string | null; openedAt: string | null;
  totals: CloudDayTotalsRecord; lastSettlementRevision: number;
  lastCommandId: string; updatedAt: string;
}
// #686: one day of the previous calendar week with a usable menu (vendor exists, not removed, active).
// vendorName is the vendor's current name; the form fills the vendor by id and saves the current name.
interface CloudLastWeekMenuItem {
  dayId: string; itemName: string; price: number; vendorId: string; vendorName: string;
}
interface CloudDayVendorSnapshot {
  dayId: string;                         // requested target day
  selectionDate: string;                // Taipei date of server-stamped active lease.updatedAt
  day: CloudDayRecord | null;            // missing target is an empty-day candidate
  vendors: CloudVendorRecord[];           // nondeleted records; includes inactive for management
  seq: number; datasetId: string; goLiveDate: string;
}
interface CloudDayTotalsRecord {
  activeTransactionCount: number; bentoCount: number; otherMealCount: number;
  mealTotal: number; retainedReceipts: number; cashierIncome: number; cashierExpense: number;
}
```

`selectionDate` is derived from the server timestamp `updatedAt` of the active lease returned by the authoritative server read. It is not derived from `dataHead.updatedAt` or the client clock, and the repository does not claim the lease timestamp is always current. If that lease date is stale across Taipei midnight, reads may return its date, but a new SetDayMenu commit is rejected by Rules until the client obtains a lease stamped for the current Taipei date. The client must reload/wait for the server lease update; it must not silently change the frozen command's `selectionDate`.

## Repository factory and read policy

```ts
interface CloudDayVendorRepository {
  loadSnapshot(targetDayId?: string): Promise<CloudDayVendorSnapshot>;
  readLastWeekMenus(dayId: string, vendors: CloudVendorRecord[]): Promise<CloudLastWeekMenuItem[]>;
  ensureDay(input: EnsureDayInput): Promise<CommandResult>;
  saveVendor(input: SaveVendorInput): Promise<CommandResult>;
  removeVendor(input: RemoveVendorInput): Promise<CommandResult>;
  setDayMenu(input: SetDayMenuInput): Promise<CommandResult>;
  setOpeningCash(input: SetOpeningCashInput): Promise<CommandResult>;
  readCommand(commandId: string): Promise<CommandReceipt | null>;
}
function createCloudDayVendorRepository(
  db: Firestore,
  options?: CloudDayVendorRepositoryOptions,
): CloudDayVendorRepository;
```

`loadSnapshot(targetDayId)` uses the requested canonical YYYY-MM-DD or defaults to the trusted `selectionDate` from the server-read active lease. It returns that resolved `dayId` in the snapshot; UI must not choose a default using its own clock. Reads use server-only Firestore APIs. Strictly decode every physical vendor document, including tombstones, before filtering deleted records from `vendors`. Page the entire vendor collection, including tombstones, with cap 500 physical documents; probe beyond the cap to distinguish exactly 500 and exhausted from overflow. Overflow, malformed rows, query errors, or unstable head return explicit incomplete/stale errors, never a partial list.

`loadSnapshot` reads only the target day document, the vendors and the lease/head fences. It does not scan earlier days (#686 removed the former latest-earlier lookup).

Last-week menus (#686, F3 「複製上週菜單」): `readLastWeekMenus(dayId, vendors)` runs only when the operator presses the button, never while a snapshot loads. "Last week" is the calendar week (Monday to Sunday) before the one `dayId` belongs to; the list covers its Monday to Friday. The week is computed on the canonical `YYYY-MM-DD` string (UTC calendar arithmetic on the string, no browser clock or time zone), so a Sunday belongs to the week that started on the Monday before it. One server query reads `days` with `documentId() >= Monday`, `documentId() <= Friday`, ascending `orderBy(documentId())` and `limit(5)` (`getDocsFromServer`; within Rules' `list` limit of 500 and `currentHolder`; a built-in single-field index serves it). Every returned row is strictly decoded; a malformed row is `UNSUPPORTED_SCHEMA`. Rows without a menu are skipped, and so are rows whose vendor is missing from `vendors`, removed, or not active. Each remaining day is listed separately (no merging of identical menus) with its date. There is no head-seq fence: the list is only a suggestion for the form, and the save goes through `SetDayMenu`, which Rules validate; a read error is shown and can be retried. Last week empty means an empty list ("上週沒有菜單"); it never looks further back. Other meals (`otherMealCount` rows) are not copied.

## Command input signatures and canonical fields

```ts
interface EnsureDayInput {
  commandId: string; leaseEpoch: number; dayId: string;
}
interface SaveVendorInput {
  commandId: string; leaseEpoch: number; vendorId: string;
  expectedRevision: number; name: string; phone: string; note: string;
  status: 'active' | 'inactive';
}
interface RemoveVendorInput {
  commandId: string; leaseEpoch: number; vendorId: string;
  expectedRevision: number; reason: string; // 1..500 literal characters
}
interface SetDayMenuInput {
  commandId: string; leaseEpoch: number; dayId: string;
  selectionDate: string; expectedRevision: number; expectedHeadSeq: number;
  itemName: string; price: number; vendorId: string;
  vendorNameSnapshot: string; inheritedFromDate: string | null;
}
interface SetOpeningCashInput {
  commandId: string; leaseEpoch: number; dayId: string;
  expectedRevision: number; openingCash: number;
}
```

The stored command envelope `reason` is null for SaveVendor, SetDayMenu, and SetOpeningCash. RemoveVendor stores the nonempty payload reason (1..500) both in payload and the top-level envelope; SetStudentStatus retains its existing nonempty top-level reason.

Canonical command identity fields:

- EnsureDay: targets `{dayId}`, expectedRevisions `{day: 0}`, payload exactly `{businessDate: dayId}`.
- All vendorId values use validId: 1..64 literal characters with no `/`; do not reserve the student-only `__cashier__` ID.
- SaveVendor: targets `{vendorId}`, expectedRevisions `{vendor: 0}` for create or exact current revision for edit; payload exactly `{vendorId,name,phone,note,status}`. Create only active and never reuse a tombstone ID. Edit preserves createdAt, requires not deleted, increments revision. Empty phone/note are valid for clearing. Name 1..100 literal characters, phone 0..100, note 0..500.
- RemoveVendor: targets `{vendorId}`, expectedRevisions `{vendor: exact current revision}`, payload exactly `{reason}` with reason 1..500 literal characters; stored receipt `reason` must equal that payload reason. Only inactive and not deleted may transition to deleted=true tombstone. Preserve identity/createdAt, increment revision, never physically delete or reuse ID.
- SetDayMenu: targets `{dayId}`, expectedRevisions exactly `{day: exact current revision, headSeq: seq from the strict read snapshot}`, payload exactly `{selectionDate,itemName,price,vendorId,vendorNameSnapshot,inheritedFromDate}`. `selectionDate` is canonical YYYY-MM-DD from the active server lease timestamp. It participates in input fingerprint, stored receipt, and semantic replay. The selected vendor must currently be active and not deleted; its current name must equal `vendorNameSnapshot`. Item name 1..100 literal characters; price integer 1..1,000,000. Direct assignment has `inheritedFromDate:null`; **the F3 UI only ever sends direct assignments** (#686: 「複製上週菜單」 fills the editable form, it does not inherit). The inheritance path below stays in the command schema, Rules, receipts and backup replay for old data. Inheritance copies the immediate newest source menu's frozen business fields and source date; source date must be `< target dayId` and `<= selectionDate`. It must not be future relative to selectionDate. Source vendor must still be active, not deleted, and have unchanged name; otherwise block inheritance and require direct confirmation. Future target day menu preplanning is allowed. Target must be open/reopened, not closed. Menu revision null->1 or otherwise +1; updatedAt=request.time. Only menu plus day revision/lastCommandId/updatedAt changes; no totals/opening changes.
- SetOpeningCash: targets `{dayId}`, expectedRevisions exactly `{day: exact current revision}`, payload exactly `{openingCash}`. P07 only permits current Taipei date, with goLiveDate<=today, and day status not closed. Amount is an explicit safe integer 0..20,000; reject -0. Null means unconfirmed; explicit 0 is confirmed. First confirmation sets openedBy=request.auth.uid and openedAt=request.time. Later amount edits preserve the first actor/time. No clear-to-null operation in P07. No headSeq precondition is used by this command.

## Receipt, concurrency, and date rules

SetDayMenu's `expectedRevisions.headSeq` and payload `selectionDate` are both part of the canonical input fingerprint and stored receipt. A new SetDayMenu write checks headSeq against the transaction head and Rules checks it against `command.before.head.seq`. Rules also require `selectionDate == request.time` converted to Taipei calendar date, and require inheritedFromDate (when nonnull) `< dayId` and `<= selectionDate`. This binds query eligibility to the date used at commit; a Taipei-midnight crossing denies the write even if headSeq is unchanged.

For an existing command ID, exact semantic receipt recovery runs before current-date/headSeq new-write preconditions. Receipt decoding validates SetDayMenu `selectionDate` against the Taipei date of `committedAt`, not today's date. A new-write precondition failure must not invalidate an exact historical receipt. Reusing an ID with different payload, expected headSeq, or selectionDate is INVALID_INPUT. UNKNOWN_RESULT retries the same ID and exact frozen input; no automatic source requery, source substitution, or selectionDate rewrite. If the lease's selectionDate has become stale, reload/wait for a freshly server-stamped lease before creating a new command.

## Acceptance focus

- Positive raw Rules paths for all four new kinds; 12 disabled kinds still deny. Missing/extra writes, malformed before/after, forged actor/time/seq/revisions/source/vendor, closed day, wrong selection date, direct delete, and tombstone reuse deny atomically.
- Future EnsureDay empty-day and SetDayMenu preplan succeed; future opening/order/payment/close remain denied.
- Source lookup crosses null-menu pages, finds immediate newest source, and distinguishes true exhaustion from caps/errors. A nearer source/head/vendor change between query and write produces stale/head conflict, never an older fallback or silently changed payload.
- Strict vendor scan rejects malformed/missing-deleted rows; list excludes tombstones only after full validation. Cover active menu assignment, status changes, inactive removal, old snapshots, rename-source block, and no ID reuse.
- Opening null vs 0, 20,000/20,001, invalid number/-0, first openedBy/openedAt preserved after later changes, and closed/other-date denials.
- Derive no-cache Rules budget from exact SDK transaction reads and Rules paths, including VerifyMutation for SDK-read/unwritten source/vendor. Count repeated get/exists/getAfter without cache discounts; <=10 per write, <=20 per atomic request. Show the static no-cache closure calculation and verify that exact positive Emulator paths pass; Emulator provides no access counter, so do not claim a measured runtime budget.
- UI is isolated under AuthGate/lease, server reads only, no legacy AppContent/POS/store or menu fallback. Existing P06 page remains operational; access loss clears and invalidates reads/commands/receipts. UI success requires validated receipt; after confirmed receipt plus refresh failure, retry only the read/list.
