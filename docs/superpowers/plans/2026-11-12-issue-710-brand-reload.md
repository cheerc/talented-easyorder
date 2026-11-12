# Execution Plan — #710 品牌區＝回到櫃台並整頁重新整理；移除各頁常駐「重新載入」按鈕

- Source: Issue #710; owner rulings https://github.com/cheerc/talented-easyorder/issues/710#issuecomment-6819633221 and https://github.com/cheerc/talented-easyorder/issues/710#issuecomment-6819784159. Base `main` @ `3a8cb89ffd645d0f189bc200ce10b4c1d41cf40c`.
- Plan branch only; never merged. Sibling plan: `2026-11-12-issue-707-business-date-weekday.md`. Global ordering: §6.
- Spec: none needed. Checked: backend spec `docs/superpowers/specs/2026-10-13-free-production-backend-spec.md:221` (DataUpdatedNotice 「其他裝置已更新資料。」＋「重新載入」 — kept), recovery contract `docs/superpowers/specs/2026-10-21-cloud-command-recovery-contract.md:61`, `:77` (lock until fresh heads or load error; journal re-checked after a reload — a full reload satisfies it). No spec names the header buttons or the brand.

## 1. Goals, Scope & Exclusions

Owner rulings (binding):
1. The whole brand block (Logo left + 「訂餐櫃台」 right) is one clickable element.
2. Click = go to F1 櫃台 **and** reload the whole App (not a page-only re-read).
3. Brand shows no date: remove `brand-sub` (營業日 / 營業日未確認 / 補登徽章).
4. Per-page standing header buttons 「重新載入伺服器資料」 (F2 日結, F3 菜單與開帳, F4 供應商) and 「重新載入名單」 (F3 學生) are removed.
5. F3 菜單與開帳 ↔ F4 供應商 switch re-reads, like other page switches.
6. Constraints: leave-confirm when a draft exists; brand disabled while `navigationLocked`; recovery keeps a receipt re-read entry; error/empty-state reload buttons stay; DataUpdatedNotice stays; real button, keyboard-focusable, accessible name states the action.

In scope: cloud only (`frontend/src/App.tsx` `CloudSections`, three cloud pages, cloud CSS, tests).

Out of scope:
- `frontend/src/components/AppShell.tsx` (shared with prototype `components/pos/TopBar.tsx:38`; also edited by #705) — not touched; the brand node is built in `App.tsx`.
- Prototype files: `components/pos/TopBar.tsx` (own `brand-sub` at `:42`), prototype rule `.brand-sub` in `src/styles/topbar.css:36-40` — left for #709.
- Error/empty-state reload buttons: `CloudDayClosePage.tsx:2258`, `CloudDayVendorsPage.tsx:1513`, `CloudStudentsPage.tsx:1682`, `CloudOrdersPage.tsx:1854`, `:1914`; `InitializationProblemPage` `App.tsx:626`.
- Recovery-panel re-read buttons (kept, become the receipt entry): `CloudDayClosePage.tsx:1688-1695`, `CloudDayVendorsPage.tsx:1284-1291`, `CloudStudentsPage.tsx:1457-1461`.
- `DataUpdatedNotice` on all pages (kept, still passes the receipt).
- `CloudDiagnosticsPage.tsx:178` 「重新載入紀錄」.

Rulings:
- Ruling: `CloudDiagnosticsPage` 「重新載入紀錄」 stays — it re-reads local diagnostic logs (not server data), sits in the page's action row with 匯出/清除, and `e2e/p13b1-diagnostics.spec.ts:61` depends on it; the owner ruling names only 「重新載入伺服器資料」／「重新載入名單」.
- Ruling: landing after the brand reload is carried by a one-shot URL hash `#counter`, not by changing the default landing. Today `CloudSections` starts on `'students'` (`App.tsx:403`), so a bare `location.reload()` would land on F3 學生, not F1. Changing the global default landing (login, Ctrl+R) is a product change outside #710 and would shift many e2e flows. The hash needs no storage (no new localStorage/sessionStorage key; REVIEW 🔴5 namespace concerns avoided). Flagged to the Coordinator as an open product question (§7).
- Ruling: F3↔F4 re-read keeps the viewed business date (page re-reads `snapshot.dayId` on `view` change) instead of remounting to today. The owner asked for 「重新讀取」; remounting would also reset the selected date and break the vendor-while-preparing-a-menu flow that `e2e/cloud-day-vendors.spec.ts` D02 encodes (`:201-217`, `:288-321`: pick a date on F3, add a vendor on F4, return to the same date's menu form). The App-level exception at `App.tsx:449-450` stays (instance kept; `App.mode.test.tsx:427-438` stays valid).
- Ruling: split into two phases — add the replacement (brand) first, remove the per-page buttons second, so `main` never has neither.

## 2. Phase / PR breakdown

### #710-P1 — Brand = 回到櫃台並整頁重新整理; remove brand date

Files:
- `frontend/src/utils/counterReload.ts` (new, tiny): `reloadToCounter()` → `history.replaceState(history.state, '', \`${location.pathname}${location.search}#counter\`)` then `location.reload()`; `isCounterStart()` → `location.hash === '#counter'` (pure); `clearCounterStart()` → `replaceState` without the hash. Separate module so unit tests `vi.mock` it (jsdom cannot reload); e2e proves the real reload.
- `frontend/src/App.tsx` (`CloudSections`):
  - `useState<CloudSection>(() => isCounterStart() ? 'orders' : 'students')`; `useEffect(() => { if (isCounterStart()) clearCounterStart(); }, [])` (initializer stays pure for StrictMode).
  - Brand node (`:506`) becomes `<button type="button" className="brand brand-button" aria-label="訂餐櫃台，回到櫃台並重新整理" disabled={navigationLocked} onClick={requestCounterReload}>` containing `brand-mark` (`aria-hidden`) and `brand-name` only. No `brand-sub`.
  - `requestCounterReload`: same guard as `selectSection` (`:465`: locked / `leaveTarget` / inert / modal dialog); if `dirtyRef.current` or a selected order form (same predicate as `:466`) → `setLeaveTarget({ section: 'orders', reload: true })`; else `reloadToCounter()`. Factor the guard and draft predicate into local helpers shared with `selectSection` (no behavior change for tabs).
  - `leaveTarget` type gains `reload?: true`; ConfirmDialog `onConfirm` (`:516`): when `leaveTarget.reload` and not locked → `reloadToCounter()`; otherwise unchanged.
  - Remove now-dead state: `viewDay`, `onViewDayChange` (`:418-419`), `setViewDay(null)` in `applySection` (`:455`), the `onViewDayChange` prop pass (`:518`). `ledger` stays (anomaly count at `:507` status).
- `frontend/src/components/cloud/CloudOrdersPage.tsx`: drop `onViewDayChange` prop (`:57`, `:496`) and its effect (`:847`). (`codegraph callers CloudOrdersPage` → `App.tsx`, `CloudOrdersPage.test.tsx` only.)
- CSS:
  - Cloud-only reset for the brand button (put next to the cloud shell rules in `src/styles/topbar.css:239+` or in `cloud-scale.css`, scoped `.cloud-app .brand-button`): no border/background/padding, `font: inherit`, `color: inherit`, `text-align: start`, `cursor: pointer`; `:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }` (same token as `topbar.css:275`); `:disabled` cursor default. Read `docs/FRONTEND-UI-STYLE.md` first.
  - Remove `html[data-app-mode="cloud"] .brand-sub` from `src/styles/cloud-scale.css:29` (keep `.brand-mark`), update the comment at `:21-24`.
  - Remove cloud-only `.backfill-badge` (`src/styles/topbar.css:290`; only user was `App.tsx:506`; prototype does not use it — verified by grep).
- Tests updated: `src/components/cloud/__tests__/cloudPagesCss.test.ts:244` (drop `.brand-sub` from `CLOUD_SHELL_SELECTORS`), `e2e/ui-closeout.spec.ts:222` (drop `.brand-sub` from `SCALE_PROBE`); `src/__tests__/App.mode.test.tsx:390-400` (brand date test obsolete → replaced by the RED tests below; mock `CloudOrdersPage` loses `onViewDayChange` / 「測試補登日」).

RED commit (tests only):
- `src/__tests__/App.mode.test.tsx` (`vi.mock('../utils/counterReload')`):
  1. Brand is `getByRole('button', { name: '訂餐櫃台，回到櫃台並重新整理' })`; header contains no `營業日未確認` and no date text.
  2. Click with no draft → `reloadToCounter` called once.
  3. Draft on F3 學生 mock (`測試草稿` input inside form) → click → dialog 「離開並捨棄草稿？」, `reloadToCounter` not called; 取消離開 → still not called; repeat and 捨棄草稿 → called once.
  4. Selected order on F1 mock (`選擇學生`) → click → dialog (same as tab F1).
  5. `保持待確認命令` (recovering) → brand `toBeDisabled()`; click does nothing; recovery gate inert (`appMocks.recoveryGate`) → no call.
  6. `isCounterStart` mocked true at render → F1 mock orders page shown first and `clearCounterStart` called; false → students mock page (unchanged default).
- `e2e/cloud-shell.spec.ts` (keyboard config): from F3 學生, `page.evaluate(() => (window as any).__beforeBrandReload = 1)`, click brand → after load `__beforeBrandReload` is undefined (proves full reload), `main` 「雲端櫃台點餐」 visible, `page.url()` has no `#counter`; brand focusable via keyboard (`focus()` + `Enter` path also reloads) ; `.brand-sub` count 0.
- `e2e/p13b2-pending-journal.spec.ts` (High-Risk evidence, extend the test at `:265-304`): after 「暫時略過」, click brand → after reload: journal key `${APP_NAMESPACE}:${commandId}` raw value unchanged (same `{commandId, datasetId, uid}`), heading 「待核對命令」 visible again, no new `commands` document. Before GREEN this fails at the brand locator.
- In the locked states of `p13b2-pending-journal.spec.ts`, add `expect(brand).toBeDisabled()` next to the existing 櫃台-disabled assertions (`:1757`, `:1978`).

GREEN commit: production + CSS + test updates listed above.

Commands (from `frontend/`):
- `npx vitest run src/__tests__/App.mode.test.tsx src/components/cloud/__tests__/cloudPagesCss.test.ts src/components/cloud/CloudOrdersPage.test.tsx`
- `npx tsc --noEmit`, `npm run lint`, `npm run build`
- `npx firebase emulators:exec --project demo-easyorder --only auth,firestore "npx playwright test --config playwright.keyboard.config.ts && npx playwright test --config playwright.p13b2.config.ts && npx playwright test e2e/ui-closeout.spec.ts"`

Acceptance:
- Brand is one `<button>`, accessible name 「訂餐櫃台，回到櫃台並重新整理」, keyboard-focusable with visible focus ring, no date.
- Click → full reload → F1 櫃台; URL ends without `#counter`; Ctrl+R / login still land on F3 學生 (unchanged).
- Draft / selected order → leave dialog first; cancel keeps everything; confirm reloads.
- Disabled while `navigationLocked`; inert under recovery gate / modal.
- Unresolved journal entry survives the brand reload and is shown again (e2e).
- `#667` scale (`ui-closeout.spec.ts`) and narrow-layout (`cloud-shell.spec.ts:60-85`) checks green.

### #710-P2 — Remove per-page header reload buttons; F3↔F4 re-read

High-Risk (REVIEW.md 🔴4 recovery, 🔴10 real entry): the removed buttons carried the recovery receipt (`page.recovery?.phase === 'receipt' ? page.recovery.receipt : undefined`).

Files:
- `CloudDayClosePage.tsx:1637-1644` — delete header button (keep `<h1>` + HelpTip).
- `CloudDayVendorsPage.tsx:1232-1239` — delete header button.
- `CloudStudentsPage.tsx:1486-1493` — delete 「重新載入名單」 (keep 「新增學生」 and `__header-actions`).
- Remove CSS only if a class becomes unused (`cloud-*__secondary` is shared — check with grep before deleting anything).
- `CloudDayVendorsPage.tsx`: re-read on `view` change. Add an effect keyed on `view` that skips the first run and then calls `loadSnapshot((page.snapshot?.dayId ?? page.dayIdDraft) || undefined)` only when idle: not latched (`revokedScopeRef.current !== authorizationScopeKey`), `!page.authorizationRevoked`, `page.recovery === null`, `!page.loading`, `!showingStale`. Navigation is locked during recovery anyway (`App.tsx:464`), so this is defense in depth.

Receipt-entry coverage (verified on base; Implementer re-verifies and records `file:line` in the PR):
- Receipt phase is always created with its command (`CloudDayClosePage.tsx:857`, `CloudDayVendorsPage.tsx:680`, `CloudStudentsPage.tsx:592`, `:638`, `:747`), so the panel's re-read button renders whenever the panel shows in `receipt` phase (day-close needs `recovery.command`, `:1688`).
- Panel hidden only for `quietReceipt` (`:1233`, `:1183`, `:1306`): receipt + `quiet` + no `loadError` + (`loading` or a snapshot). **Must verify** that each terminal outcome of the post-receipt re-read (`:884`, `:706`, `:770`/`:1208`) either clears `recovery` or sets `loadError` (which shows the panel). If any path leaves `quietReceipt` true with `loading === false` and no other entry, stop and report `[BLOCKER]` to the Coordinator with the path — do not add a new entry on your own.
- Error states set `snapshot: null, recovery: null` (e.g. `CloudDayClosePage.tsx:910-924`, `CloudDayVendorsPage.tsx:732-740`, `CloudStudentsPage.tsx:880-887`) → the kept unavailable-section reload button shows.
- Check: `CloudStudentsPage.tsx:1682` unavailable button is not disabled by `page.authorizationRevoked` (day-close/vendors are). Confirm the same-identity revoke latch inside `loadSnapshot` blocks it (test below); if not, report — do not widen scope silently.

RED commit (tests only, real page entries with mocked repository as existing tests do):
- Each of `CloudDayClosePage.test.tsx`, `CloudDayVendorsPage.test.tsx`, `CloudStudentsPage.test.tsx`:
  1. After the initial load: `queryByRole('button', { name: '重新載入伺服器資料' })` / `'重新載入名單'` is null in the page header (fails on base).
  2. Receipt + dataset-changed load error (mirror e2e `p13b2-pending-journal.spec.ts:1745-1766`): panel 「命令結果確認」 shows 「重新讀取伺服器資料／名單」; clicking it calls the repository load with the original receipt (`loadSnapshot(dayId, receipt)` / `list(receipt)` path) and the same `commandId` stays visible; no write method called. (May already pass — characterization; RED is carried by item 1.)
- `CloudDayVendorsPage.test.tsx`: rerender with `view` `'day'` → `'vendors'` → repository `loadSnapshot` called a second time with the currently viewed `dayId` (non-today fixture date) (fails on base); while a recovery is active, a `view` change triggers no load.
- e2e `p13b2-pending-journal.spec.ts:1763` and `:1980`: switch to `recovery.getByRole('button', { name: '重新讀取伺服器資料' })`; keep every following assertion (journal null, commands list unchanged, 櫃台 disabled). Also assert no `重新載入伺服器資料` button exists while the recovery panel is shown.

Existing tests that click the removed buttons (rewrite in GREEN, list each in the PR body):
- `CloudDayVendorsPage.test.tsx:767-795`, `:797-825` (concurrent header reload during an in-flight / checking command, then auth loss), `:827-845` (revoke latch vs manual reload).
- `CloudDayClosePage.test.tsx:990` (`getAllByRole(...)[0]` → use the kept unavailable-section button inside region 「雲端資料未載入」; the failed step sets `snapshot: null, recovery: null`).
- `CloudStudentsPage.test.tsx:569-573`, `:595-597`, `:618`, `:639`.
- Rule for these: first retarget the same race/latch to a remaining production entry (unavailable-section button, DataUpdatedNotice, recovery-panel re-read, date change). Only where no remaining entry can be reached in that state (e.g. in-flight command: notice hidden by `progressActive || busy`), replace the action with an assertion that no reload control is reachable in that state, and justify each such replacement in the PR body. Never delete a latch/authorization assertion without a replacement.

GREEN commit: delete the three buttons, add the `view` re-read effect, update tests above.

Commands (from `frontend/`):
- `npx vitest run src/components/cloud/CloudDayClosePage.test.tsx src/components/cloud/CloudDayVendorsPage.test.tsx src/components/cloud/CloudStudentsPage.test.tsx src/__tests__/App.mode.test.tsx`
- `npx tsc --noEmit`, `npm run lint`, `npm run build`
- `npx firebase emulators:exec --project demo-easyorder --only auth,firestore "npx playwright test --config playwright.p13b2.config.ts && npx playwright test e2e/cloud-day-vendors.spec.ts e2e/cloud-production.spec.ts"`
- Completion grep (must print only the kept error-state buttons and `CloudDiagnosticsPage`): `grep -rn "重新載入伺服器資料\|重新載入名單" frontend/src/components/cloud/*.tsx`

Acceptance:
- No standing header reload button on F2 日結, F3 菜單與開帳, F4 供應商, F3 學生.
- Receipt recovery: panel re-read passes the receipt; e2e `:1763`/`:1980` equivalents green with unchanged journal/commands assertions.
- Error/empty-state reload buttons and DataUpdatedNotice unchanged and working.
- F3↔F4 switch re-reads the same viewed date; D02 (`cloud-day-vendors.spec.ts`) green.

## 3. Callers / dependents (codegraph + grep, base)

- `AppShell` callers: `App.tsx`, `components/pos/TopBar.tsx` → not edited.
- `CloudOrdersPage`: `App.tsx:518`, `CloudOrdersPage.test.tsx`; `onViewDayChange` also in mock `App.mode.test.tsx:53-55`.
- `.brand-sub`: `App.tsx:506` (cloud, removed), `pos/TopBar.tsx:42` + `topbar.css:36` (prototype, kept), `cloud-scale.css:29`, `cloudPagesCss.test.ts:244`, `ui-closeout.spec.ts:222`.
- `.brand` layout: `topbar.css:12`, `:249` (`.topbar > .brand` — keep class `brand` on the button so grid placement still applies), `cloud-shell.spec.ts:72-83` (box of `.brand`).

## 4. Risks & Regression Safeguards

- Full reload discards in-memory drafts → guarded by the leave dialog (same predicate as tabs).
- Pending-command safety: brand disabled while locked; journal persists in localStorage and is re-checked on load (`CloudPendingRecoveryBoundary`), proven by the P1 e2e.
- Hash handling: hash cleared right after mount with `replaceState` (no history entry, no reload loop). `#counter` is not used anywhere else (grep: no `location.hash` / `history.replaceState` in `src` today). No Firebase redirect auth in use (`signInWithRedirect` not found).
- Landing default unchanged (open question §7).
- Button styling: brand must look the same as today minus the date; check 1440, 1180, 900 widths (`cloud-shell.spec.ts` narrow layout).
- Conflicts: P1 edits `App.tsx` near the operator menu (#704) and the shell (#705) and `App.mode.test.tsx`; #709 (prototype removal) may edit `App.tsx` (`isPrototypeMode` branch), `AppShell`, `topbar.css`. P1 must start after those merge, from latest `main`.
- docs-check: `docs/FRONTEND-PROTOTYPE-HANDOFF.md` / `docs/FRONTEND-UI-STYLE.md` — Implementer runs the repo docs-check; the operator menu help text (`App.tsx:511` 「重新整理請按 Ctrl+R／Cmd+R」) stays true; consider adding 「或點左上角品牌」 only if the owner wants it (not required).

## 5. TDD summary

| Phase | RED (fails for) | GREEN |
|---|---|---|
| #710-P1 | brand button absent; no leave dialog; no `#counter` landing; e2e brand reload + journal survival | brand button, hash landing, dead state removal, CSS |
| #710-P2 | header buttons still present; F3↔F4 no re-read | delete buttons, `view` re-read, test retargeting |

## 6. Ordering (with #707)

1. **#707-P1** — independent of in-flight #704/#705/#709 (does not touch `App.tsx`/`AppShell`); may start now. Only overlap with #706 is option-label strings in `CloudOrdersPage.tsx`.
2. **#710-P1** — after #704, #705 merge, and after #709 if #709 edits `App.tsx`, `AppShell.tsx`, `topbar.css` or `App.mode.test.tsx`. Can run in parallel with #707-P1 (shared file `CloudOrdersPage.tsx`, different hunks; second to merge rebases).
3. **#710-P2** — after #710-P1 merged (replacement exists before removal). Shares `p13b2-pending-journal.spec.ts:1756-1766`, `:1976-1983` and page headers with #707-P1; whichever merges second rebases and keeps both changes (weekday locators from #707 + panel re-read button from #710).

## 7. Open question for Coordinator (non-blocking; plan proceeds with the Ruling)

- Default landing after login / Ctrl+R is F3 學生 (`App.tsx:403`). Owner calls F1 「首頁」. Options: (a) keep default, brand uses one-shot `#counter` (planned); (b) make F1 the default landing for every load, then brand = plain `location.reload()` and the hash helper is dropped (simpler code, but changes login/Ctrl+R landing and needs e2e flow review). Recommendation: (a) now; (b) as a separate issue if the owner wants F1 as global home.
