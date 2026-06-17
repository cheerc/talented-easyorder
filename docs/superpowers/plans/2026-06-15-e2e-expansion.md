---
required_reads:
  - frontend/e2e/smoke.spec.ts
  - frontend/playwright.config.ts
  - frontend/package.json (e2e scripts section)
  - frontend/firebase.json
  - frontend/src/auth/AuthGate.tsx
  - frontend/src/firebase/firebaseApp.ts (emulator connection, L92-101)
  - frontend/src/firebase/authService.ts (signInWithGoogle, getOperatorAccess)
  - frontend/src/domain/posFlow.ts (POS state machine)
  - frontend/src/hooks/usePosFlow.ts
  - frontend/src/firebase/__tests__/firestoreRules.spec.ts (seedOperator/seedStudent patterns)
  - firestore.rules
audit_method: "full read of auth flow + POS state machine + existing e2e + emulator config"
---

# E2E Expansion — Implementation Plan

> **For agentic workers:** Use executing-plans skill to implement task-by-task.

**Goal:** Expand e2e from 1 smoke test (13 lines, unauthenticated only) to ≥3 core business scenarios, making the release e2e gate meaningful.

**Key Challenge:** Auth uses `signInWithPopup` (Google OAuth only) — no email/password fallback. E2e must use Firebase Auth Emulator's REST API to programmatically create users and sign in.

**Emulator infra:** Already fully configured (auth:9099, firestore:8080, `VITE_FIREBASE_USE_EMULATOR=true` in Playwright config). `firebase emulators:exec` in package.json `test:e2e` script.

**refs #269**

---

## Auth Strategy for E2E

Firebase Auth Emulator exposes REST endpoints for programmatic auth:

```
POST http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp
  { email, password, returnSecureToken: true }

POST http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword
  { email, password, returnSecureToken: true }
```

**Plan:** Create email/password users via Auth Emulator REST API in `globalSetup`, then use `signInWithEmailAndPassword` in tests (only available when connected to emulator). This bypasses Google popup entirely.

**⚠ Emulator fidelity gap (from #269 issue):** easyorder + payroll share Firebase project; emulator only loads easyorder rules. Note in tests but don't block.

---

## Task 1: Auth Helper + Global Setup

**Files:**
- Create: `frontend/e2e/helpers/auth.ts` — Emulator auth helper
- Create: `frontend/e2e/helpers/seed.ts` — Firestore data seeder
- Create: `frontend/e2e/global-setup.ts` — Global setup for Playwright
- Modify: `frontend/playwright.config.ts` — Add globalSetup

- [ ] **Step 1: Create auth helper**

```typescript
// frontend/e2e/helpers/auth.ts
const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const API_KEY = 'dummy-api-key';

export async function createEmulatorUser(email: string, password: string) {
  const res = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }) }
  );
  if (!res.ok) throw new Error(`Failed to create user: ${await res.text()}`);
  return res.json() as Promise<{ localId: string; idToken: string; email: string }>;
}

export async function clearEmulatorAuth() {
  await fetch(`${AUTH_EMULATOR}/emulator/v1/projects/<firebase-project-id>/accounts`,
    { method: 'DELETE' });
}
```

- [ ] **Step 2: Create Firestore data seeder**

```typescript
// frontend/e2e/helpers/seed.ts
// Uses Firestore REST API via emulator to seed test data
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT = '<firebase-project-id>';

export async function seedOperator(uid: string, email: string, role: string = 'admin') {
  // Create operator doc via Firestore REST API
}

export async function seedStudent(studentId: string, name: string, balance: number) {
  // Create student doc
}

export async function seedTodayMenu(itemName: string, price: number) {
  // Create today_menu doc
}

export async function clearFirestoreData() {
  await fetch(
    `${FIRESTORE_EMULATOR}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: 'DELETE' }
  );
}
```

- [ ] **Step 3: Create global setup**

```typescript
// frontend/e2e/global-setup.ts
import { clearEmulatorAuth, createEmulatorUser } from './helpers/auth';
import { clearFirestoreData, seedOperator, seedStudent, seedTodayMenu } from './helpers/seed';

export default async function globalSetup() {
  await clearEmulatorAuth();
  await clearFirestoreData();

  // Create test operator
  const user = await createEmulatorUser('test@talented.com.tw', 'test1234');
  await seedOperator(user.localId, 'test@talented.com.tw', 'admin');

  // Seed test data
  await seedStudent('S001', '王小明', 1000);
  await seedStudent('S002', '李小華', 500);
  await seedTodayMenu('雞腿便當', 80);
}
```

- [ ] **Step 4: Update playwright.config.ts**

Add `globalSetup: './e2e/global-setup.ts'`.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat: add e2e auth helper, Firestore seeder, and global setup (#269)"
```

---

## Task 2: Auth Fixture + Login Flow Test

**Files:**
- Create: `frontend/e2e/fixtures.ts` — Custom Playwright test fixture with auth
- Create: `frontend/e2e/auth.spec.ts` — Login flow test

- [ ] **Step 1: Create Playwright auth fixture**

```typescript
// frontend/e2e/fixtures.ts
import { test as base, type Page } from '@playwright/test';

export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use) => {
    await page.goto('/');
    // Sign in via emulator: inject auth token or use email/password form
    // The app checks VITE_FIREBASE_USE_EMULATOR — when true, we can use
    // signInWithEmailAndPassword (needs to be added to AuthGate for emulator mode)
    // OR: evaluate Firebase auth in browser context
    await page.evaluate(async () => {
      const { getAuth, signInWithEmailAndPassword } = await import('firebase/auth');
      const auth = getAuth();
      await signInWithEmailAndPassword(auth, 'test@talented.com.tw', 'test1234');
    });
    await page.waitForSelector('[data-testid="operator-strip"]', { timeout: 10000 });
    await use(page);
  },
});

export { expect } from '@playwright/test';
```

- [ ] **Step 2: Write login flow test**

```typescript
// frontend/e2e/auth.spec.ts
import { test, expect } from './fixtures';

test.describe('Authentication', () => {
  test('login shows operator strip and POS screen', async ({ authedPage: page }) => {
    await expect(page.getByTestId('operator-strip')).toBeVisible();
    await expect(page.locator('[data-tab="pos"]')).toBeVisible();
  });
});
```

⚠️ **Important:** `signInWithEmailAndPassword` is NOT currently imported in the app. For emulator-only mode, we may need to:
- Option A: Add `signInWithEmailAndPassword` import in AuthGate (guarded by emulator flag)
- Option B: Use `page.evaluate` to call Firebase auth directly in browser context
- Option C: Use Auth Emulator REST API to get `idToken`, then `signInWithCustomToken`

Impl should choose the least invasive option.

- [ ] **Step 3: Run smoke + auth tests**

```bash
cd frontend && npx playwright test
```

- [ ] **Step 4: Commit**

```bash
git commit -am "feat: add auth fixture and login flow e2e test (#269)"
```

---

## Task 3: Order Flow E2E Test

**Files:**
- Create: `frontend/e2e/order-flow.spec.ts`

- [ ] **Step 1: Write order flow test**

Test scenario: Login → Select student → Confirm order → Success flash

```typescript
import { test, expect } from './fixtures';

test.describe('Order Flow', () => {
  test('complete an order for a student', async ({ authedPage: page }) => {
    // 1. Should see POS screen with student list
    await expect(page.getByText('王小明')).toBeVisible();

    // 2. Select student
    await page.getByText('王小明').click();

    // 3. Should show order confirmation
    await expect(page.getByRole('button', { name: /確認/ })).toBeVisible();

    // 4. Confirm order
    await page.getByRole('button', { name: /確認/ }).click();

    // 5. Should show success flash
    await expect(page.getByText(/成功/)).toBeVisible({ timeout: 5000 });
  });
});
```

Adjust selectors based on actual UI after auth login.

- [ ] **Step 2: Run tests**

- [ ] **Step 3: Commit**

```bash
git commit -am "feat: add order flow e2e test (#269)"
```

---

## Task 4: Deposit Flow E2E Test

**Files:**
- Create: `frontend/e2e/deposit-flow.spec.ts`

- [ ] **Step 1: Write deposit flow test**

Test scenario: Login → Select student → Switch to payment mode → Enter amount → Confirm → Success

```typescript
import { test, expect } from './fixtures';

test.describe('Deposit Flow', () => {
  test('deposit payment for a student', async ({ authedPage: page }) => {
    // 1. Select student
    await page.getByText('王小明').click();

    // 2. Switch to payment mode
    await page.getByRole('button', { name: /儲值/ }).click();

    // 3. Enter payment amount
    await page.getByLabel(/金額/).fill('500');

    // 4. Confirm
    await page.getByRole('button', { name: /確認/ }).click();

    // 5. Success
    await expect(page.getByText(/成功/)).toBeVisible({ timeout: 5000 });
  });
});
```

- [ ] **Step 2: Run tests**

- [ ] **Step 3: Commit**

```bash
git commit -am "feat: add deposit flow e2e test (#269)"
```

---

## Task 5: Settlement / Cash Close Flow E2E Test + PR

**Files:**
- Create: `frontend/e2e/settlement-flow.spec.ts`

- [ ] **Step 1: Write settlement flow test**

Test scenario: Login → Navigate to Admin → Open cash session → Navigate to Report → Cash close

```typescript
import { test, expect } from './fixtures';

test.describe('Settlement Flow', () => {
  test('open cash session and view report', async ({ authedPage: page }) => {
    // 1. Navigate to Admin tab
    await page.getByRole('tab', { name: /設定/ }).click();

    // 2. Set opening cash
    // ... interact with AdminScreen

    // 3. Navigate to Report tab
    await page.getByRole('tab', { name: /報表/ }).click();

    // 4. Verify report shows today's data
    await expect(page.getByText(/今日/)).toBeVisible();
  });
});
```

- [ ] **Step 2: Run full e2e suite**

```bash
cd frontend && npm run test:e2e
```

- [ ] **Step 3: Create PR**

```bash
git push origin feat/269-e2e-expansion
gh pr create --base dev --title "feat: expand e2e tests to 3+ business scenarios (#269)" \
  --body "Closes #269

## Summary
Expand e2e from 1 smoke test to 4+ tests covering:
- Auth login flow
- Order flow (select student → confirm → success)
- Deposit flow (select student → payment mode → enter amount → confirm)
- Settlement flow (admin → open cash → report)

## Infrastructure
- Auth helper: Firebase Auth Emulator REST API for programmatic user creation
- Firestore seeder: emulator REST API for test data
- Global setup: seeds operator + students + menu before all tests
- Custom fixture: provides authenticated page

## Testing
All e2e tests pass with firebase emulators:exec"
```

---

## Verification Steps

| # | Check | Command | Expected |
|---|-------|---------|----------|
| 1 | Smoke test still passes | `npx playwright test smoke` | PASS |
| 2 | Auth test passes | `npx playwright test auth` | PASS |
| 3 | Order flow passes | `npx playwright test order` | PASS |
| 4 | Full e2e suite | `npm run test:e2e` | ALL PASS |
| 5 | ≥3 business scenarios | count test files | ≥3 new spec files |
| 6 | t1-t4 unaffected | `./workflow.sh t1 && ./workflow.sh t4` | PASS |
