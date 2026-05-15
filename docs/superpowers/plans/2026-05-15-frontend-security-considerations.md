# Frontend Security Considerations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 Talented EasyOrder 前端的資料分級、瀏覽器儲存、XSS/CSP、PWA service worker、未來後端 auth token 的安全邊界，避免本地優先 POS 因「可離線」而誤存或誤曝敏感學生/帳務資料。

**Architecture:** 前端不把 localStorage、IndexedDB、Cache Storage 視為安全儲存；防線以資料最小化、明確 storage policy、React 安全輸出、CSV/URL/input guard、嚴格 CSP/security headers、service worker cache allowlist、未來 cookie-based auth 為主。Phase 1 保留本地帳務操作，但把敏感資料欄位、可同步資料、可清除資料、不可儲存資料寫成可測 contract。

**Tech Stack:** Vite 8, React 19, TypeScript 6, Zustand 5, Vitest 4, IndexedDB, localStorage, Cache Storage, Service Worker API, Cloudflare Workers Static Assets / Worker headers, Content Security Policy, OWASP XSS/HTML5 guidance.

---

## Required Reads Completed

- `docs/superpowers/plans/ROADMAP.md`
- `docs/superpowers/plans/2026-05-15-free-backend-architecture-exploration.md`
- `docs/superpowers/plans/2026-05-15-deployment-hosting-strategy.md`
- `docs/superpowers/plans/2026-05-15-pwa-offline-first-strategy.md`
- `docs/superpowers/plans/2026-05-15-design-system-component-library.md`
- `docs/superpowers/plans/2026-05-15-user-operation-sop-ux-analysis.md`
- `docs/superpowers/specs/2026-05-14-pc-pos-order-flow-spec.md`
- `docs/superpowers/specs/2026-05-14-order-ledger-cash-close-spec.md`
- `docs/superpowers/specs/2026-05-14-google-sheets-sync-offline-spec.md`
- `docs/superpowers/specs/2026-05-14-ipad-face-auth-handoff-spec.md`
- `docs/superpowers/specs/2026-05-14-student-account-management-spec.md`
- `frontend/src/store/posStore.ts`
- `frontend/src/components/pos-components.tsx`
- `frontend/src/components/screens.tsx`
- `frontend/src/components/tweaks-panel.tsx`
- `frontend/src/domain/student.ts`
- `frontend/src/domain/ledger.ts`
- `frontend/src/test/setup.ts`

Requested but unavailable on 2026-05-15:

- `/Users/cheerc/talented-easyorder/docs/superpowers/specs/talented-easyorder-spec.pdf`
- `docs/superpowers/specs/talented-easyorder-spec.pdf`

Replacement source of truth used for this plan: the markdown specs above, current frontend code, and earlier approved plans.

## Official Sources Checked On 2026-05-15

- OWASP XSS Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- OWASP HTML5 Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html
- MDN Content Security Policy: https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
- MDN IndexedDB API: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- MDN Web Storage API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API
- MDN Service Worker API: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
- MDN Cache API: https://developer.mozilla.org/en-US/docs/Web/API/Cache
- MDN Set-Cookie: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie
- MDN Clear-Site-Data: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Clear-Site-Data
- Cloudflare Workers headers API: https://developers.cloudflare.com/workers/runtime-apis/headers/

## Current Security Observations

| Area | Current State | Risk | Plan Response |
|---|---|---|---|
| Accounting persistence | Zustand `persist` stores `students`, `transactions`, `vendors`, `todayMenu` in localStorage key `pos-storage`. | localStorage is readable by any same-origin script and persists sensitive student balances/ledger on shared devices. | Move authoritative data to IndexedDB in Phase 1.3, but treat both localStorage and IndexedDB as sensitive local caches; add storage policy and clear/export runbook. |
| UI preferences | Tweaks panel reads `deck-stage.railVisible` from localStorage; Plan 6 adds `easyorder-theme-preference`. | Preferences can share origin with accounting data and become hard to clear selectively. | Separate preference keys from accounting keys and document allowed storage buckets. |
| XSS sinks | No current `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or `new Function` found in app code. | Future report notes/vendor names/imported CSV values can become unsafe if inserted into HTML or URLs. | Add security lint/test guard, URL allowlist helper, CSV formula escape for exported text cells, and code-review checklist. |
| Inline style/data URLs | Current app uses inline React style objects and TweaksPanel has a CSS `data:image/svg+xml` background. | Strict CSP may need temporary `style-src 'unsafe-inline'` or data image allowance until styles are moved. | Plan strict target CSP and a temporary compatibility CSP; remove data SVG or allow `img-src data:` deliberately. |
| Browser dialogs | `confirm()` and `alert()` exist in report/admin/vendor flows. | Not a direct security bug, but weak confirmation context increases accidental destructive actions. | Plan 6 `ConfirmDialog` should also support security-relevant wording for delete/reset. |
| PWA service worker | No service worker yet. | Future cache rules could store API responses, mutation bodies, or stale private ledger snapshots. | Service worker cache allowlist: static app shell only; no mutation/API accounting cache. |
| Sensitive display | POS shows student balance, debt, student ID/name, recent transactions. iPad handoff spec says iPad must not display balance/payment/history. | Device shoulder-surfing and future role confusion. | Add display-context policy and privacy guard tests for iPad-facing views. |
| Future auth | No backend auth yet. Plan 2 points to Workers API + D1. | Storing bearer tokens in localStorage/IndexedDB would turn any XSS into account/session takeover. | Prefer httpOnly Secure SameSite cookie sessions; bearer tokens only in memory if unavoidable. |

## Data Classification

| Data | Examples | Classification | Allowed Frontend Storage | Display Rules |
|---|---|---|---|---|
| Public app shell | JS/CSS/assets/manifest/icons | Public | Cache Storage / service worker precache | Safe to cache. |
| UI preference | theme, font scale, rail visibility | Low sensitivity | localStorage under documented preference keys | No student/accounting data mixed in. |
| Student identity | student ID, display name, aliases | Sensitive personal data | IndexedDB local dataset; legacy localStorage only during migration | PC POS/admin may show; iPad handoff shows only minimal confirmation name after match if approved. |
| Student financial state | current balance, debt/low balance, paid amount, meal price, after balance | Sensitive financial data | IndexedDB ledger/accounting store; never Cache Storage API responses | PC POS/report only; not iPad recognition screen. |
| Ledger transactions | transaction ID, business date, type, amount, note, source device, sync status | Sensitive accounting data | IndexedDB local ledger and sync queue | PC/admin/report only; export requires operator action. |
| Vendor data | vendor name, phone, note | Business-sensitive | IndexedDB local dataset | Admin/vendor screens only. |
| Sync metadata | idempotency key, queue status, retry count, last error, remote revision | Operationally sensitive | IndexedDB sync queue | PC sync/repair screens only. |
| Face metadata | enrollment status, face profile ID | Highly sensitive pointer data | IndexedDB only after Phase 2 approval; no raw image/vector in general POS store | iPad/PC enrollment views only; never in reports. |
| Raw biometric data | face image, embedding/vector, camera frame | Prohibited in this plan | Do not store | If future requirement appears, require separate privacy/security decision. |
| Auth secret | session cookie, bearer token, refresh token, API key | Secret | httpOnly cookie preferred; bearer access token in memory only if unavoidable | Never render, log, export, persist, or cache. |

## Security Design Decisions

### localStorage And IndexedDB Are Not Secret Stores

Both Web Storage and IndexedDB are same-origin browser storage. They protect against unrelated origins, not against XSS, malicious same-origin scripts, compromised browser profiles, shared-device access, or an operator with local filesystem/browser access.

Rules:

- `localStorage` is allowed only for non-accounting preferences and migration read from legacy `pos-storage`.
- IndexedDB is allowed for local-first ledger, student data, vendor data, durable sync queue, and migration snapshots because the app requires offline operation.
- Neither localStorage nor IndexedDB may store auth bearer tokens, refresh tokens, API keys, raw face images, or face vectors.
- Device retirement must include an app-owned clear-local-data flow and a browser runbook using site data removal.
- PWA uninstall must not be considered a guaranteed data wipe; browser site data can survive app-icon removal.

### XSS Strategy

React escapes text by default. Keep that property by banning HTML injection instead of adding a broad sanitizer dependency.

Rules:

- Do not use `dangerouslySetInnerHTML` for vendor notes, student names, menu names, transaction notes, import preview, or sync errors.
- Do not assign to `innerHTML` or `outerHTML` in app code.
- URL-like fields must be parsed through a helper and restricted to `http:`/`https:` or same-origin paths where needed.
- CSV export must protect user-controlled text cells from spreadsheet formula injection.
- Error messages from backend/sync should be mapped to known user-facing text, not rendered as trusted HTML.

### CSP Strategy

Target strict CSP after Plan 6 removes most inline style/data URL pressure:

```text
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self';
  img-src 'self' data:;
  font-src 'self';
  connect-src 'self' https://api.easyorder.example;
  worker-src 'self';
  manifest-src 'self';
  base-uri 'self';
  frame-ancestors 'none';
  form-action 'self';
  object-src 'none';
  upgrade-insecure-requests
```

Temporary compatibility CSP for current app may require `style-src 'self' 'unsafe-inline'` while inline style attributes and dynamic style injection are still present. That loosening must be documented and removed after Design System migration.

### PWA Service Worker Security

Service worker scope is powerful because it can intercept same-origin requests. Keep it small and allowlisted.

Rules:

- Cache only Vite hashed app-shell assets, manifest, icons, and same-origin static images.
- Do not cache `POST`, `PUT`, `PATCH`, or `DELETE` requests.
- Do not cache sync write endpoints, closeout endpoints, settlement endpoints, auth endpoints, or mutation responses.
- Do not cache API responses containing student balances, ledger transactions, vendor phone numbers, sync queue rows, or auth state.
- Service worker must not own accounting retry semantics; Phase 1.3 foreground sync queue remains authoritative.
- Service worker updates must not silently swap code during active lunch transactions.

### Future Backend Auth Strategy

When Workers API and D1 are introduced, default to cookie-based session auth:

- `Set-Cookie: __Host-easyorder-session=<opaque>; HttpOnly; Secure; SameSite=Lax; Path=/`
- Add CSRF defense for state-changing requests if cookie auth is used.
- Keep session ID opaque and server-side revocable.
- Store role/permission display state as non-authoritative UI state only.
- On logout or device retirement, call server revoke and clear local sensitive data after export/backup policy is satisfied.

If bearer access tokens are unavoidable for a specific API client:

- Keep access token in memory only.
- Use short TTL.
- Do not persist token in localStorage, IndexedDB, Cache Storage, Zustand persist, URL params, logs, or exported diagnostics.
- Refresh through httpOnly cookie or explicit re-login.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `docs/security/frontend-data-classification.md` | Create | Data classes, allowed storage, display contexts, owner decisions. |
| `docs/security/frontend-security-runbook.md` | Create | Device retirement, clear local data, incident response, manual browser site-data cleanup. |
| `docs/security/csp-policy.md` | Create | Target and temporary CSP, required cleanup to reach strict mode. |
| `frontend/src/security/dataClassification.ts` | Create | Typed constants for data classes and display contexts. |
| `frontend/src/security/storagePolicy.ts` | Create | Allowed storage buckets and assertions against secret persistence. |
| `frontend/src/security/storagePolicy.test.ts` | Create | Tests that auth secrets/raw biometric data are rejected from browser storage. |
| `frontend/src/security/outputSafety.ts` | Create | URL guard and CSV text-cell escape helpers. |
| `frontend/src/security/outputSafety.test.ts` | Create | XSS-adjacent URL and CSV formula injection tests. |
| `frontend/src/security/displayPolicy.ts` | Create | Display-context rules for PC POS, PC admin/report, iPad handoff. |
| `frontend/src/security/displayPolicy.test.ts` | Create | Tests that iPad context cannot show balance/payment/history fields. |
| `frontend/src/security/cspPolicy.ts` | Create | Header string builder shared by Workers or tests. |
| `frontend/src/security/cspPolicy.test.ts` | Create | Tests that CSP contains required directives. |
| `frontend/src/store/posStore.ts` | Modify | Mark legacy `pos-storage` as migration source and avoid adding secrets to persisted slice. |
| `frontend/src/components/pos-components.tsx` | Modify | Use display policy for sensitive fields if contexts split. |
| `frontend/src/components/screens.tsx` | Modify | Use CSV/output helpers for export and safe confirmation text. |
| `frontend/src/components/tweaks-panel.tsx` | Modify | Move data SVG/dynamic style pressure into static CSS if strict CSP is adopted. |
| `frontend/public/_headers` or Worker header module | Create later under Plan 2 deployment choice | Apply CSP and security headers at hosting layer. |
| `frontend/src/security/noDangerousHtml.test.ts` | Create | Repository guard against `dangerouslySetInnerHTML`, `innerHTML`, `eval`, and token storage patterns. |

## Implementation Plan

### Task 1: Document frontend data classification and runbook

**Files:**

- Create: `docs/security/frontend-data-classification.md`
- Create: `docs/security/frontend-security-runbook.md`
- Create: `docs/security/csp-policy.md`

- [ ] **Step 1: Add data classification document**

```md
# Frontend Data Classification

| Classification | Examples | Storage | Display |
|---|---|---|---|
| Public app shell | JS/CSS/icons/manifest | Service worker Cache Storage | Any user. |
| Preference | theme/font scale/rail visibility | localStorage preference keys | Current device only. |
| Sensitive personal | student ID/name/alias | IndexedDB local data | PC POS/admin; minimal iPad confirmation only after approval. |
| Sensitive financial | balance/debt/paid/meal/ledger | IndexedDB local ledger and sync queue | PC POS/report/admin only. |
| Highly sensitive biometric pointer | face profile ID/enrollment status | IndexedDB only after Phase 2 approval | Enrollment or handoff admin only. |
| Prohibited frontend secret | bearer token/API key/refresh token/raw face vector/raw image | No browser storage | Never render/export/log. |
```

- [ ] **Step 2: Add security runbook**

```md
# Frontend Security Runbook

## Device Retirement

1. Export/backup local accounting data if the day is not fully synced.
2. In the app, run admin clear-local-data action after operator confirmation.
3. In the browser, remove site data for the EasyOrder origin.
4. If PWA is installed, remove the Home Screen app icon after site data cleanup.
5. Revoke the device/session from the backend once auth exists.

## Suspected XSS Or Device Compromise

1. Stop using the affected device for lunch service.
2. Export local ledger only if operator confirms the file is needed for reconciliation.
3. Revoke backend session once auth exists.
4. Clear local browser site data.
5. Compare remote ledger against paper/admin records before resuming.
```

- [ ] **Step 3: Add CSP policy document**

````md
# Frontend CSP Policy

Target:

```text
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.easyorder.example; worker-src 'self'; manifest-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; upgrade-insecure-requests
```

Temporary compatibility:

```text
style-src 'self' 'unsafe-inline'
```

Temporary `unsafe-inline` is allowed only while current inline style attributes and dynamic style injection remain. Remove it after Plan 6 component migration moves those styles into CSS classes.
````

- [ ] **Step 4: Commit**

```bash
git add docs/security/frontend-data-classification.md docs/security/frontend-security-runbook.md docs/security/csp-policy.md
git commit -m "docs: add frontend security classification"
```

### Task 2: Add storage policy guardrails

**Files:**

- Create: `frontend/src/security/dataClassification.ts`
- Create: `frontend/src/security/storagePolicy.ts`
- Create: `frontend/src/security/storagePolicy.test.ts`
- Modify: `frontend/src/store/posStore.ts`

- [ ] **Step 1: Define data classes and storage buckets**

```ts
export type FrontendDataClass =
  | 'public-app-shell'
  | 'preference'
  | 'sensitive-personal'
  | 'sensitive-financial'
  | 'sensitive-operational'
  | 'highly-sensitive-biometric-pointer'
  | 'prohibited-secret'
  | 'prohibited-raw-biometric';

export type StorageBucket =
  | 'cache-storage'
  | 'local-storage-preference'
  | 'legacy-local-storage-migration'
  | 'indexeddb-local-data'
  | 'indexeddb-sync-queue'
  | 'memory-only'
  | 'not-allowed';
```

- [ ] **Step 2: Add storage policy assertions**

```ts
import type { FrontendDataClass, StorageBucket } from './dataClassification';

const allowedBucketsByClass: Record<FrontendDataClass, StorageBucket[]> = {
  'public-app-shell': ['cache-storage'],
  preference: ['local-storage-preference'],
  'sensitive-personal': ['indexeddb-local-data', 'legacy-local-storage-migration'],
  'sensitive-financial': ['indexeddb-local-data', 'indexeddb-sync-queue', 'legacy-local-storage-migration'],
  'sensitive-operational': ['indexeddb-sync-queue'],
  'highly-sensitive-biometric-pointer': ['indexeddb-local-data'],
  'prohibited-secret': ['memory-only'],
  'prohibited-raw-biometric': ['not-allowed'],
};

export function canStoreDataClass(dataClass: FrontendDataClass, bucket: StorageBucket): boolean {
  return allowedBucketsByClass[dataClass].includes(bucket);
}

export function assertCanStoreDataClass(dataClass: FrontendDataClass, bucket: StorageBucket) {
  if (!canStoreDataClass(dataClass, bucket)) {
    throw new Error(`Storage policy rejected ${dataClass} in ${bucket}`);
  }
}
```

- [ ] **Step 3: Add storage policy tests**

```ts
import { describe, expect, it } from 'vitest';
import { assertCanStoreDataClass, canStoreDataClass } from './storagePolicy';

it('rejects auth secrets from persistent browser storage', () => {
  expect(canStoreDataClass('prohibited-secret', 'local-storage-preference')).toBe(false);
  expect(canStoreDataClass('prohibited-secret', 'indexeddb-local-data')).toBe(false);
  expect(canStoreDataClass('prohibited-secret', 'indexeddb-sync-queue')).toBe(false);
  expect(canStoreDataClass('prohibited-secret', 'memory-only')).toBe(true);
});

it('rejects raw biometric data from frontend storage', () => {
  expect(() => assertCanStoreDataClass('prohibited-raw-biometric', 'indexeddb-local-data')).toThrow(/Storage policy rejected/);
});

it('allows legacy localStorage only as accounting migration source', () => {
  expect(canStoreDataClass('sensitive-financial', 'legacy-local-storage-migration')).toBe(true);
  expect(canStoreDataClass('sensitive-financial', 'local-storage-preference')).toBe(false);
});
```

- [ ] **Step 4: Mark legacy Zustand persist explicitly**

Add a comment near `name: 'pos-storage'` in `posStore.ts`:

```ts
// Security boundary: this legacy localStorage key contains sensitive demo/accounting data.
// Keep it only as a migration source until Phase 1.3 IndexedDB storage lands.
// Never add auth secrets, raw biometric data, API keys, or backend tokens to this persisted slice.
name: 'pos-storage',
```

- [ ] **Step 5: Run tests**

```bash
cd frontend
npx vitest run src/security/storagePolicy.test.ts src/store/__tests__/posStore.test.ts
```

Expected: security policy tests and existing store tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/security/dataClassification.ts frontend/src/security/storagePolicy.ts frontend/src/security/storagePolicy.test.ts frontend/src/store/posStore.ts
git commit -m "feat: add frontend storage policy guardrails"
```

### Task 3: Add XSS-adjacent output safety helpers

**Files:**

- Create: `frontend/src/security/outputSafety.ts`
- Create: `frontend/src/security/outputSafety.test.ts`
- Modify: `frontend/src/components/screens.tsx` when export/link features exist

- [ ] **Step 1: Add safe internal path and CSV text-cell helpers**

```ts
export function isSafeInternalPath(value: string): boolean {
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//')) return false;

  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin;
  } catch {
    return false;
  }
}

export function toCsvTextCell(value: unknown): string {
  const text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) return `'${text}`;
  return text;
}
```

Use `toCsvTextCell` for user-controlled text columns such as student name, vendor note, transaction note, and menu name. Do not use it for numeric amount columns that must remain numbers.

- [ ] **Step 2: Add tests**

```ts
import { describe, expect, it } from 'vitest';
import { isSafeInternalPath, toCsvTextCell } from './outputSafety';

it('allows same-origin absolute paths only', () => {
  expect(isSafeInternalPath('/reports/today')).toBe(true);
  expect(isSafeInternalPath('//evil.example/path')).toBe(false);
  expect(isSafeInternalPath('https://evil.example/path')).toBe(false);
  expect(isSafeInternalPath('javascript:alert(1)')).toBe(false);
});

it('escapes spreadsheet formulas in text cells', () => {
  expect(toCsvTextCell('=IMPORTXML("https://evil.example")')).toBe("'=IMPORTXML(\"https://evil.example\")");
  expect(toCsvTextCell('+SUM(1,2)')).toBe("'+SUM(1,2)");
  expect(toCsvTextCell('-cmd')).toBe("'-cmd");
  expect(toCsvTextCell('@cmd')).toBe("'@cmd");
  expect(toCsvTextCell('王柏翰')).toBe('王柏翰');
});
```

- [ ] **Step 3: Apply helper to CSV export when export is implemented**

```ts
const row = [
  toCsvTextCell(transaction.studentId),
  toCsvTextCell(transaction.studentNameSnapshot),
  transaction.mealPrice,
  transaction.paidAmount,
  toCsvTextCell(transaction.note),
];
```

- [ ] **Step 4: Run focused tests**

```bash
cd frontend
npx vitest run src/security/outputSafety.test.ts
```

Expected: helper tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/security/outputSafety.ts frontend/src/security/outputSafety.test.ts frontend/src/components/screens.tsx
git commit -m "feat: add frontend output safety helpers"
```

### Task 4: Add display policy for sensitive fields

**Files:**

- Create: `frontend/src/security/displayPolicy.ts`
- Create: `frontend/src/security/displayPolicy.test.ts`
- Modify: future iPad-facing components when Phase 2 starts

- [ ] **Step 1: Define display contexts and fields**

```ts
export type DisplayContext = 'pc-pos' | 'pc-report' | 'pc-admin' | 'ipad-handoff' | 'public-shell';

export type SensitiveField =
  | 'student-id'
  | 'student-name'
  | 'current-balance'
  | 'debt-status'
  | 'paid-amount'
  | 'meal-price'
  | 'transaction-history'
  | 'vendor-phone'
  | 'face-profile-id';

const allowedFields: Record<DisplayContext, SensitiveField[]> = {
  'pc-pos': ['student-id', 'student-name', 'current-balance', 'debt-status', 'paid-amount', 'meal-price'],
  'pc-report': ['student-id', 'student-name', 'current-balance', 'debt-status', 'paid-amount', 'meal-price', 'transaction-history', 'vendor-phone'],
  'pc-admin': ['student-id', 'student-name', 'current-balance', 'debt-status', 'vendor-phone', 'face-profile-id'],
  'ipad-handoff': ['student-name'],
  'public-shell': [],
};

export function canDisplayField(context: DisplayContext, field: SensitiveField): boolean {
  return allowedFields[context].includes(field);
}
```

- [ ] **Step 2: Add iPad privacy tests**

```ts
import { describe, expect, it } from 'vitest';
import { canDisplayField } from './displayPolicy';

it('prevents iPad handoff from displaying account and payment details', () => {
  expect(canDisplayField('ipad-handoff', 'student-name')).toBe(true);
  expect(canDisplayField('ipad-handoff', 'student-id')).toBe(false);
  expect(canDisplayField('ipad-handoff', 'current-balance')).toBe(false);
  expect(canDisplayField('ipad-handoff', 'paid-amount')).toBe(false);
  expect(canDisplayField('ipad-handoff', 'transaction-history')).toBe(false);
});
```

- [ ] **Step 3: Run tests**

```bash
cd frontend
npx vitest run src/security/displayPolicy.test.ts
```

Expected: display policy tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/security/displayPolicy.ts frontend/src/security/displayPolicy.test.ts
git commit -m "feat: add sensitive display policy"
```

### Task 5: Add CSP and security header policy

**Files:**

- Create: `frontend/src/security/cspPolicy.ts`
- Create: `frontend/src/security/cspPolicy.test.ts`
- Create later: `frontend/public/_headers` or Worker header module, depending on Plan 2 implementation
- Modify: `docs/security/csp-policy.md`

- [ ] **Step 1: Add CSP builder**

```ts
export interface CspOptions {
  apiOrigin: string;
  allowInlineStyleForMigration?: boolean;
}

export function buildFrontendCsp({ apiOrigin, allowInlineStyleForMigration = false }: CspOptions): string {
  const styleSrc = allowInlineStyleForMigration ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'";

  return [
    "default-src 'self'",
    "script-src 'self'",
    styleSrc,
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${apiOrigin}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}
```

- [ ] **Step 2: Add CSP tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildFrontendCsp } from './cspPolicy';

it('builds strict frontend CSP by default', () => {
  const csp = buildFrontendCsp({ apiOrigin: 'https://api.easyorder.example' });

  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("style-src 'self'");
  expect(csp).toContain('connect-src \'self\' https://api.easyorder.example');
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain("'unsafe-inline'");
});

it('allows temporary inline style migration mode', () => {
  const csp = buildFrontendCsp({ apiOrigin: 'https://api.easyorder.example', allowInlineStyleForMigration: true });

  expect(csp).toContain("style-src 'self' 'unsafe-inline'");
});
```

- [ ] **Step 3: Add deployment header example after Plan 2 target is implemented**

For Cloudflare Workers Static Assets, add the header in the Worker response path:

```ts
const response = await env.ASSETS.fetch(request);
const headers = new Headers(response.headers);
headers.set('Content-Security-Policy', buildFrontendCsp({ apiOrigin: env.API_ORIGIN, allowInlineStyleForMigration: true }));
headers.set('Referrer-Policy', 'no-referrer');
headers.set('X-Content-Type-Options', 'nosniff');
headers.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
```

Use `camera=(self)` only for the future iPad face flow origin and only after user approval. For PC-only deployment before Phase 2, use `camera=()`.

- [ ] **Step 4: Run tests**

```bash
cd frontend
npx vitest run src/security/cspPolicy.test.ts
```

Expected: CSP tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/security/cspPolicy.ts frontend/src/security/cspPolicy.test.ts docs/security/csp-policy.md
git commit -m "feat: add frontend csp policy builder"
```

### Task 6: Add repository guard against dangerous frontend patterns

**Files:**

- Create: `frontend/src/security/noDangerousHtml.test.ts`
- Modify: `frontend/package.json` only if a script is needed

- [ ] **Step 1: Add static source scan test**

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const sourceRoot = join(process.cwd(), 'src');
const blockedPatterns = [
  /dangerouslySetInnerHTML/,
  /\.innerHTML\s*=/,
  /\.outerHTML\s*=/,
  /eval\s*\(/,
  /new Function\s*\(/,
  /localStorage\.setItem\([^)]*(token|secret|apiKey|refresh)/i,
  /indexedDB\.[\s\S]{0,120}(token|secret|apiKey|refresh)/i,
];

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return listSourceFiles(path);
    if (path.endsWith('noDangerousHtml.test.ts')) return [];
    if (/\.(ts|tsx)$/.test(path)) return [path];
    return [];
  });
}

describe('dangerous frontend pattern guard', () => {
  it('does not introduce HTML injection or persistent token storage patterns', () => {
    const offenders = listSourceFiles(sourceRoot).flatMap((path) => {
      const content = readFileSync(path, 'utf8');
      return blockedPatterns.some((pattern) => pattern.test(content)) ? [path] : [];
    });

    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the guard**

```bash
cd frontend
npx vitest run src/security/noDangerousHtml.test.ts
```

Expected: test passes on current code. The test file excludes itself so the blocked regex literals do not create false positives.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/security/noDangerousHtml.test.ts
git commit -m "test: guard frontend dangerous html patterns"
```

### Task 7: Define PWA service worker security rules before implementation

**Files:**

- Create: `frontend/src/security/serviceWorkerPolicy.ts`
- Create: `frontend/src/security/serviceWorkerPolicy.test.ts`
- Modify later: PWA service worker config from Plan 3

- [ ] **Step 1: Add request cache classification helper**

```ts
export type ServiceWorkerCacheDecision = 'cache-static' | 'network-only' | 'reject-cache';

export function classifyServiceWorkerRequest(request: Request, sameOrigin = self.location.origin): ServiceWorkerCacheDecision {
  const url = new URL(request.url);

  if (request.method !== 'GET') return 'network-only';
  if (url.origin !== sameOrigin) return 'network-only';
  if (url.pathname.startsWith('/api/')) return 'network-only';
  if (url.pathname.startsWith('/sync/')) return 'network-only';
  if (url.pathname.includes('ledger') || url.pathname.includes('student')) return 'network-only';
  if (/\.(js|css|png|svg|webmanifest|ico|woff2?)$/.test(url.pathname)) return 'cache-static';
  return 'network-only';
}
```

If this helper is imported outside a service worker test environment, inject the origin rather than using `self.location.origin` directly.

- [ ] **Step 2: Add tests**

```ts
import { describe, expect, it } from 'vitest';
import { classifyServiceWorkerRequest } from './serviceWorkerPolicy';

it('does not cache mutation or accounting API requests', () => {
  expect(classifyServiceWorkerRequest(new Request('https://easyorder.example/api/transactions'), 'https://easyorder.example')).toBe('network-only');
  expect(classifyServiceWorkerRequest(new Request('https://easyorder.example/sync/batch-write', { method: 'POST' }), 'https://easyorder.example')).toBe('network-only');
});

it('allows same-origin static assets', () => {
  expect(classifyServiceWorkerRequest(new Request('https://easyorder.example/assets/index.js'), 'https://easyorder.example')).toBe('cache-static');
  expect(classifyServiceWorkerRequest(new Request('https://easyorder.example/manifest.webmanifest'), 'https://easyorder.example')).toBe('cache-static');
});
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/security/serviceWorkerPolicy.ts frontend/src/security/serviceWorkerPolicy.test.ts
git commit -m "feat: add service worker cache policy"
```

### Task 8: Final security verification gate

**Files:**

- Modify: none unless verification exposes a regression.

- [ ] **Step 1: Run focused security tests**

```bash
cd frontend
npx vitest run src/security
```

Expected: all security tests pass.

- [ ] **Step 2: Run full frontend gate**

```bash
cd frontend
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```

Expected: all commands pass.

- [ ] **Step 3: Run source scans**

```bash
cd frontend
rg -n "dangerouslySetInnerHTML|innerHTML|outerHTML|eval\(|new Function|localStorage\.setItem\([^)]*(token|secret|apiKey|refresh)|indexedDB.*(token|secret|apiKey|refresh)" src || true
rg -n "pos-storage|localStorage|indexedDB|caches\.open|CacheStorage|Authorization|Bearer|Set-Cookie" src docs || true
```

Expected: dangerous pattern scan has no app-code offenders; storage/auth scan has only documented policy, migration, or test references.

- [ ] **Step 4: Commit verification docs if updated**

```bash
git add docs/security frontend/src/security
git commit -m "docs: record frontend security verification"
```

## DISCUSS WITH USER

1. **Local data risk acceptance:** confirm that offline POS requires sensitive student/accounting data on the device, and the mitigation is minimization/runbook/clear-data rather than claiming browser storage is encrypted.
2. **Legacy `pos-storage`:** decide whether to keep legacy localStorage until Phase 1.3 migration, or force a one-time IndexedDB migration before any real campus pilot.
3. **CSP migration mode:** approve temporary `style-src 'unsafe-inline'` while Plan 6 removes inline style pressure, or require strict CSP cleanup before deployment.
4. **Auth strategy:** approve httpOnly Secure SameSite cookie sessions as the default for Workers API, with CSRF protection for state-changing requests.
5. **iPad privacy:** confirm iPad handoff may show only minimal student confirmation and must not show balance/debt/payment/history.
6. **Raw biometric data:** confirm raw face images/vectors are prohibited from frontend persistent storage unless a separate privacy/security decision is approved.
7. **Device retirement flow:** decide whether clear-local-data is operator-only, admin-only, or requires a typed confirmation phrase.

## Acceptance Criteria

- Frontend data classes and allowed storage buckets are documented and represented in typed policy code.
- Tests reject persistent storage for auth secrets and raw biometric data.
- Current XSS sink scan remains clean for `dangerouslySetInnerHTML`, direct `innerHTML`, `eval`, and `new Function`.
- CSV export helper protects user-controlled text cells from spreadsheet formula injection before export ships.
- Display policy blocks iPad handoff from showing balance, debt, payment amount, and transaction history.
- CSP policy exists with both strict target and temporary compatibility mode, and deployment header path is explicit.
- PWA service worker cache policy forbids caching accounting APIs and mutation responses.
- Future auth plan avoids localStorage/IndexedDB bearer token persistence.
- Device retirement and suspected compromise runbooks exist before campus pilot.

## Non-Goals

- Do not implement encryption-at-rest in the browser in this plan; browser-managed keys would not solve XSS or shared-device access.
- Do not implement backend auth here; this plan defines frontend constraints for the future Workers API.
- Do not implement biometric enrollment or face model storage here; Phase 2 requires a separate security/privacy plan.
- Do not remove offline-first local ledger capability; the app's lunch-service requirement depends on local operation.
- Do not rely on CSP as the only XSS defense; code-level output safety and no-HTML policy remain required.
