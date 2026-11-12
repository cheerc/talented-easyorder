# Execution Plan — #707 營業日顯示加星期 `YYYY-MM-DD（五）`

- Source: Issue #707 + owner ruling (comment 6819784415: full-width parens, one-char weekday). Base `main` @ `3a8cb89ffd645d0f189bc200ce10b4c1d41cf40c`.
- Plan branch only; never merged. Sibling plan: `2026-11-12-issue-710-brand-reload.md` (same branch). Global ordering is in §6.
- Spec: none needed. No contract in `docs/superpowers/specs/**` defines date display format (checked: no "星期"/weekday rule in the backend spec, day-close contract or recovery contract).

## 1. Goals, Scope & Exclusions

Goal: cloud screens show a business date as `YYYY-MM-DD（一）` from one shared formatter; the weekday comes from the date string only (UTC parse), never the browser time zone or clock.

In scope (cloud only; 1 phase = 1 PR):
- New shared util `frontend/src/utils/businessDate.ts` + unit tests.
- `lastWeekDayLabel` (`frontend/src/components/cloud/CloudDayVendorForms.tsx:140-146`) reuses the shared weekday; its output format `11/03（二）` is unchanged.
- Display sites listed in §3 (headings/titles, table date cells, date chips, F1 select options, F1 static date, F1 backfill banner, anomaly headings).

Out of scope (keep plain `YYYY-MM-DD`):
- CSV content and export filenames (`CloudReportPage.tsx:737`), print-record metadata line (`CloudReportPage.tsx:1064` 「營業日標示…範圍…」), report range inputs.
- `aria-label` / form names (`CloudDayVendorForms.tsx:212` `${businessDate} 菜單`, `:339` `${businessDate} 開帳現金`), `data-testid`, `key`, React state values, command payloads.
- Command labels (`CloudDayClosePage.tsx:290-294` `commandLabel`, `CloudDayVendorsPage.tsx:264-265`) — they are command identity text in recovery panels/toasts and e2e matches them (e.g. `已確認 設定 ${today} 菜單 完成`).
- Dates embedded mid-sentence in errors/notices/helper text (e.g. `CloudDayClosePage.tsx:309-316`, `:1864`, `:1994-2003`, `:2075`; `CloudStudentsPage.tsx:393-417` 期初日; `CloudDayVendorForms.tsx:350`; `CloudDayVendorsPage.tsx:1372`; `CloudOrdersPage.tsx:934-935`, `:1820`).
- Native `<input type="date">` in `DateField` (F2 `CloudDayClosePage.tsx:1705`, F3 `CloudDayVendorsPage.tsx:1302`): cannot hold text.
- Timestamps (`formatTaipeiDateTime`/`formatTaipeiTime`).
- Brand `brand-sub` date (`frontend/src/App.tsx:506`): removed by #710-P1.
- Prototype (`frontend/src/components/pos/**`, `TopBar.tsx`): historical (#709). No prototype file is touched.

Rulings:
- Ruling: display rule = a business date that is the leading subject of a heading/title, a table date cell, a date chip, a select option, the F1 static date or the backfill banner gets the weekday; dates inside sentences, command labels and machine-facing values do not — keeps the change bounded and avoids changing command identity text that e2e and diagnostics rely on.
- Ruling: no weekday next to the F2/F3 native date inputs — the page heading right below (`<h2>{dayId} 日結</h2>`, `<h2>{dayId} 營業日</h2>`) already shows it (subtraction; issue wording "可放在…" is optional).
- Ruling: F1 option labels become `今天 2026-11-12（四）` and `補登中 2026-11-10（二）` (drop the outer `（…）` around today's date to avoid nested full-width parens).
- Ruling: invalid input (not `^\d{4}-\d{2}-\d{2}$`, or a non-existent date such as `2023-02-29`) returns the input unchanged (display-only helper; never throws, never invents a weekday).
- Ruling: e2e computes the expected weekday with its own small helper (not by importing the production formatter), so a formatter bug cannot make the oracle agree with itself.

## 2. Shared formatter (contract)

`frontend/src/utils/businessDate.ts` (new):
- `businessWeekday(dayId: string): string` → one of `日一二三四五六`, or `''` when invalid.
- `formatBusinessDate(dayId: string): string` → `` `${dayId}（${weekday}）` `` (U+FF08/U+FF09), or `dayId` unchanged when invalid.
- Implementation constraint: parse `` `${dayId}T00:00:00.000Z` `` and use `getUTCDay()`; validate by regex plus round-trip (`toISOString().slice(0, 10) === dayId`) so `2023-02-29` (rolls to 03-01) is rejected.
- Move `WEEKDAY_LABELS` out of `CloudDayVendorForms.tsx:140`; `lastWeekDayLabel` becomes `` `${MM}/${DD}（${businessWeekday(dayId)}）` ``. Callers of `lastWeekDayLabel`: only `CloudDayVendorForms.tsx:285` (`codegraph callers lastWeekDayLabel` → `CloudDayMenuForm` only).

## 3. Display sites (verified on base `3a8cb89`)

| File:line | Today | Change |
|---|---|---|
| `CloudDayClosePage.tsx:1747`, `:1787` | `<span class="cloud-day-close__mono">{item.dayId}</span>` (unclosed / no-business chips) | `formatBusinessDate(item.dayId)` (testids unchanged) |
| `CloudDayClosePage.tsx:1797` | `<h2>{snapshot.dayId} 日結</h2>` | `formatBusinessDate(...)` + ` 日結` |
| `CloudDayClosePage.tsx:1816` | `開始補登 {snapshot.dayId} 還沒完成。` (strong title) | weekday |
| `CloudDayClosePage.tsx:1619` | `到訂餐頁補登 {snapshot.dayId}` (button) | weekday |
| `CloudDayVendorsPage.tsx:1322` | `<h2>{snapshot.dayId} 營業日</h2>` | weekday |
| `CloudDayVendorForms.tsx:214` | `<h3>{businessDate} 菜單</h3>` | weekday (form `aria-label` at `:212` unchanged) |
| `CloudDayVendorForms.tsx:340` | `<h3>{businessDate} 開帳現金</h3>` | weekday (form `aria-label` at `:339` unchanged) |
| `CloudOrdersPage.tsx:1746-1747`, `:1930-1931` | EmptyState title/description `${businessDate} 尚未設定菜單／開帳`, `${businessDate}・…` | weekday |
| `CloudOrdersPage.tsx:1772-1773` | options `今天（${today}）`, `補登中 ${dayId}` | per Ruling |
| `CloudOrdersPage.tsx:1783` | static `value={businessDate \|\| '—'}` | `businessDate ? formatBusinessDate(businessDate) : '—'` |
| `CloudOrdersPage.tsx:1817` | `<strong>正在補登 {backfill.dayId}</strong>` | weekday (sentence at `:1820` unchanged) |
| `CloudLedgerAnomaliesPage.tsx:31`, `:58` | `<h3>{anomaly.dayId} 尚未關帳</h3>`, `<h3>{anomaly.dayId} 開帳現金與上次關帳不符</h3>` | weekday (buttons `:45`, `:48` and sentence `:61` unchanged) |
| `CloudReportPage.tsx:959`, `:1009`, `:1071` | table cells `{day.businessDate}`, `{row.businessDate}` | weekday (CSV builder untouched) |
| `CloudAccountHistoryPage.tsx:862`, `:898`, `:908`, `:918` | table cell / strong headings / audit `attributedDate`, `原營業日` | weekday on the date only (`row.businessDate ?? '無'` keeps `無`) |

The Implementer re-greps before GREEN (`grep -nE "\{(snapshot\.|item\.|day\.|row\.|anomaly\.|backfill\.|entry\.|settlement\.|transaction\.)?(dayId|businessDate|attributedDate|today)\}" frontend/src/components/cloud/*.tsx`) and classifies every hit against §1; anything not in the table above and not excluded by §1 is reported in the PR body, not silently changed.

## 4. TDD & Verification

RED commit (tests only, must fail for the stated reason):
1. `frontend/src/utils/__tests__/businessDate.test.ts` (new): fails on missing module.
   - `2026-11-09`…`2026-11-15` → `（一）`…`（日）`; `2026-11-13` → `2026-11-13（五）` (issue example).
   - Year boundary: `2026-12-31（四）`, `2027-01-01（五）`. Leap day: `2024-02-29（四）`, `2028-02-29（二）`. Invalid: `2023-02-29`, `2026-13-01`, `''`, `2026-1-5` → returned unchanged; `businessWeekday` → `''`.
   - Full-width parens: assert the exact characters `（` U+FF08 / `）` U+FF09.
2. Page tests through the real component entry (render page with mocked repository, as the existing tests do):
   - `CloudDayClosePage.test.tsx`: heading `` `${day}（X） 日結` `` visible.
   - `CloudDayVendorsPage.test.tsx`: heading `營業日` with weekday; menu/opening `<h3>` with weekday; form still found by `getByRole('form', { name: \`${today} 菜單\` })` (aria-label unchanged).
   - `CloudOrdersPage.test.tsx`: select options `今天 …（X）` / `補登中 …（X）`; banner `正在補登 …（X）`.
   - `CloudLedgerAnomaliesPage.test.tsx`: heading with weekday.
   - `CloudDayVendorForms` copy-last-week list still `MM/DD（X）` (regression; passes before and after).
   - Report/account-history: one assertion each that a table date cell shows the weekday and the CSV text (existing CSV test) is unchanged.
   Use fixed fixture dates whose weekday is written literally in the test (no computed oracle in unit tests).

GREEN commit: util + `lastWeekDayLabel` refactor + §3 sites + updates to existing tests/e2e whose locators include a now-changed heading.

Locator migration (part of GREEN):
- Add `frontend/e2e/helpers/businessDate.ts` exporting `withWeekday(dayId)` (own `['日','一',…]` table + `getUTCDay()`).
- Every e2e/unit heading locator built from a date + changed suffix must switch, positive **and negative**. Negative assertions such as `frontend/e2e/p13b2-pending-journal.spec.ts:1756`, `:1766` (`${today} 營業日` `toHaveCount(0)`) and `:1976`, `:1983` (`${today} 日結` `toHaveCount(0)`) would otherwise pass vacuously — they must use `withWeekday`.
- Known e2e sites (base): `cloud-day-vendors.spec.ts:201,234,304`; `cloud-production.spec.ts:834,1027,1148,1246,1468,1557,1573,1633,1701,1826,1956,1980`; `p13b2-pending-journal.spec.ts:1756,1766,1976,1983`; `scenarios.spec.ts:118,186`. `toContainText(\`正在補登 ${gap}\`)` (`cloud-production.spec.ts:1714,1853`, `scenarios.spec.ts:206`) still matches as substring — leave.
- Completion check (must print nothing):
  `grep -rnE "heading', \{ name: \`\\$\{[A-Za-z.]+\} (日結|營業日|菜單|開帳現金|尚未關帳)" frontend/e2e frontend/src`
- Unit test files with date-heading locators to re-check (base grep): `CloudDayVendorsPage.test.tsx`, `CloudDayClosePage.test.tsx`, `CloudOrdersPage.test.tsx`, `CloudLedgerAnomaliesPage.test.tsx`, `src/__tests__/refundRework2.review.test.tsx`, `components/ui/__tests__/DateField.test.tsx` (DateField itself is not changed; only re-check), `domain/__tests__/cloudDayState.test.ts` (domain, expected no change).

Commands (from `frontend/`):
- `npx vitest run src/utils/__tests__/businessDate.test.ts` and the same with `TZ=America/Los_Angeles` and `TZ=Pacific/Kiritimati` prefixes (time-zone independence; record all three).
- `npx vitest run src/components/cloud src/__tests__`
- `npx tsc --noEmit`, `npm run lint`, `npm run build`
- `npx firebase emulators:exec --project demo-easyorder --only auth,firestore "npx playwright test e2e/cloud-day-vendors.spec.ts e2e/cloud-production.spec.ts e2e/scenarios.spec.ts e2e/ui-closeout.spec.ts && npx playwright test --config playwright.p13b2.config.ts && npx playwright test --config playwright.p12c.config.ts"` (full suite runs in CI; record what ran locally vs CI only).

Acceptance:
- All §3 sites show `YYYY-MM-DD（X）`; `2026-11-13` → `（五）` in every time zone tested.
- `lastWeekDayLabel` output unchanged; it imports the shared weekday.
- CSV text, export filename, form aria-labels, command labels, timestamps unchanged (existing tests green).
- Completion grep prints nothing; CI `build-and-test` and `e2e` aggregate green.

## 5. Risks & Regression Safeguards

- Vacuous negative locators (see §4) — the main regression risk; the grep gate plus explicit list covers it.
- Layout: headings get ~4 characters longer; chips in day-close date lists may wrap. Implementer checks F2 date chips at 1440 and 1180 widths (`ui-closeout.spec.ts` covers overflow; no new screenshot committed — no real data/screens in repo).
- `#706` (in flight) edits F1 DateField select styling; this phase only changes option label strings in `CloudOrdersPage.tsx`. If #706 merges first, rebase; no semantic conflict expected.
- Not a REVIEW.md 🔴 area (display only: no command, Rules, ledger or recovery change). RED/GREEN still required (behavior change); missing evidence would be 🟡.
- docs-check: `docs/FRONTEND-UI-STYLE.md` — Implementer decides whether a one-line "營業日顯示 `YYYY-MM-DD（X）`, use `formatBusinessDate`" rule belongs there (area guidance); no spec/ADR.
