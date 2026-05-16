# Firebase Sync Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Apps Script + Google Sheets sync plan with a Firebase Firestore + Vercel architecture that supports Google Workspace sign-in, realtime multi-device POS sync, offline lunch-service continuity, auditable accounting rows, and Firebase/Vercel operations aligned with talented-payroll.

**Architecture:** Use an independent Firebase project for EasyOrder, Firebase Auth with Google Workspace identities, Firestore as the realtime source of truth, and Vercel as the static SPA host. Firestore `transactions` and `daily_settlements` remain append/idempotency-centered accounting records; mutable `students.currentBalance` is a transaction-linked projection, and Security Rules reject independent balance edits. Because Firestore web transactions fail offline, this plan explicitly separates the online `runTransaction` path from the offline write-queue path and keeps operator-visible sync status in the UI.

**Tech Stack:** Vite 8, React 19, TypeScript 6, Zustand 5, Firebase JS SDK, Firebase Auth, Firestore, Firestore Security Rules, Firebase Emulator Suite, Vitest 4, Testing Library, Vercel SPA hosting.

---

## Required Reads Completed

- `docs/superpowers/plans/2026-05-15-apps-script-sheets-sync-migration.md`
- `docs/superpowers/plans/2026-05-15-user-decision-checklist.md`
- `docs/superpowers/plans/2026-05-15-counter-cash-exception-normalization.md`
- `docs/superpowers/plans/2026-05-15-pwa-offline-first-strategy(DONE).md`
- `docs/superpowers/plans/2026-05-15-frontend-security-considerations.md`
- `docs/superpowers/specs/2026-05-14-google-sheets-sync-offline-spec.md`
- `docs/superpowers/specs/2026-05-14-pc-pos-order-flow-spec.md`
- `docs/superpowers/specs/2026-05-14-order-ledger-cash-close-spec.md`
- `frontend/package.json`
- `frontend/src/domain/ledger.ts`
- `frontend/src/domain/cashClose.ts`
- `frontend/src/domain/student.ts`
- `frontend/src/domain/ledgerSyncBoundary.ts`
- `frontend/src/store/posStore.ts`

## Official Sources Checked On 2026-05-16

- Firebase Firestore offline persistence: https://firebase.google.com/docs/firestore/manage-data/enable-offline
- Firebase Firestore realtime listeners and `hasPendingWrites`: https://firebase.google.com/docs/firestore/query-data/listen
- Firebase Firestore transactions and batched writes: https://firebase.google.com/docs/firestore/manage-data/transactions
- Firebase Firestore transaction contention: https://firebase.google.com/docs/firestore/transaction-data-contention
- Firebase Auth Google sign-in for web: https://firebase.google.com/docs/auth/web/google-signin
- Firestore Security Rules conditions: https://firebase.google.com/docs/firestore/security/rules-conditions
- Firestore Security Rules and queries: https://firebase.google.com/docs/firestore/security/rules-query
- Vercel Vite deployment and `VITE_` environment variables: https://vercel.com/docs/frameworks/frontend/vite

## Locked Product Decisions

- Platform: Firebase Firestore + Vercel, with an independent Firebase project for EasyOrder.
- Firebase owner/admin: company Google Workspace; production admin account is `cheerc@talented.com.tw`.
- Authentication: Firebase Auth with Google provider; only active `@talented.com.tw` Workspace users in the Firestore `operators` whitelist may use the app.
- Frontend host: Vercel static SPA. Phase 1 does not require Vercel Serverless Functions, Firebase Functions, Cloud Run, Apps Script, or Google Sheets.
- Sync: Firestore realtime listeners with offline persistence; normal reads/writes continue from cache while offline and synchronize when the browser reconnects.
- Multi-device: online balance-sensitive commits use Firestore `runTransaction`; offline commits are locally accepted as pending writes and reconciled through idempotent document IDs plus visible sync status.
- Closeout: offline closeout is allowed as a pending close attempt. If a conflicting closeout appears after reconnection, the UI surfaces a conflict instead of silently overwriting.
- Students: add/disable in POS. Deletion is a status transition and never removes historical references.
- Accounting visibility: counter operators have full read access in the app. No separate admin dashboard is part of Phase 1.
- Backup owner: counter operator owns export/backup drill; director/admin owns restore decisions.
- Operator identity: each write records Firebase `uid`, Google Workspace email, and display name.

## Firestore Offline Constraint

Firestore offline persistence supports cached reads, local writes, listeners, and synchronization after reconnection, but Firestore web transactions fail while the client is offline. This plan therefore does not promise offline `runTransaction`.

Implementation rule:

- **Online path:** use `runTransaction` for order/payment/refund commits that read `students/{studentId}` and atomically write `transactions/{transactionId}` plus update the student projection.
- **Offline path:** write an idempotent `transactions/{transactionId}` document and a local projected balance using a queued batched write or local Zustand projection. The row is visibly marked pending until Firestore confirms it. Repeated UI retries must reuse the same `transactionId`; creating a second document is a bug.
- **Reconciliation path:** `onSnapshot(..., { includeMetadataChanges: true })` drives `hasPendingWrites` and `fromCache` status. When the server acknowledges pending rows, the store marks them synced. If a security-rule or conflict error rejects a write, the row is marked `conflict` and closeout blocks until the operator resolves it.

## Existing Plan Disposition

| Existing file | Disposition |
|---|---|
| `docs/superpowers/plans/2026-05-15-apps-script-sheets-sync-migration.md` | Superseded. Do not implement Apps Script or Google Sheets for Phase 1. |
| `docs/superpowers/plans/2026-05-14-phase-1-3-google-sheets-sync-offline.md` | Conceptual offline/idempotency reference only; transport changes to Firestore. |
| `docs/superpowers/plans/2026-05-15-free-backend-architecture-exploration.md` | Backend choice superseded by Firebase + Vercel. |
| `docs/superpowers/plans/2026-05-15-deployment-hosting-strategy.md` | Must be updated separately to choose Vercel for EasyOrder. |
| `docs/superpowers/plans/2026-05-15-user-decision-checklist.md` | Plan A and C framework remain useful, but B-series backend decisions must be rewritten for Firebase. |
| `docs/superpowers/plans/2026-05-15-frontend-security-considerations.md` | Still applies. Browser caches remain sensitive local storage. |

## Collection Design

Use camelCase field names in Firestore to match the current TypeScript domain models and avoid the Apps Script plan's camelCase/snake_case mapping failure. The conceptual fields from the user brief map as follows: `opening_balance -> openingBalance`, `current_balance -> currentBalance`, `student_id -> studentId`, `business_date -> businessDate`, and `balance_after -> balanceAfter`.

### `operators/{uid}`

Purpose: server-enforced whitelist and role metadata.

```ts
export interface OperatorDoc {
  uid: string;
  email: string;
  displayName: string;
  role: 'counter' | 'admin';
  active: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Bootstrap requirement:

- In Firebase Console, create `operators/{cheercUid}` after the first `cheerc@talented.com.tw` login.
- Set `role: 'admin'` and `active: true`.
- After bootstrap, only an active admin can add/disable operators.

### `students/{studentId}`

Purpose: active roster and mutable balance projection.

```ts
export interface StudentDoc {
  id: string;
  displayName: string;
  aliases: string[];
  className: string | null;
  groupName: string | null;
  openingBalance: number;
  currentBalance: number;
  status: 'active' | 'inactive';
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  updatedBy: string;
  revision: number;
  lastTransactionId: string | null;
}
```

Rules:

- `id` equals document ID.
- `status: 'inactive'` hides the student from normal POS search but keeps historical transactions readable.
- `openingBalance` is the initial imported balance. `currentBalance` is a projection and must match acknowledged transactions after reconciliation.
- Client writes may not change `currentBalance`, `revision`, or `lastTransactionId` unless the same Firestore transaction/batch also creates the matching `transactions/{lastTransactionId}` document. Firestore Security Rules enforce this with `getAfter()`.
- Direct hard delete is forbidden in the app and in Firestore rules.

### `transactions/{transactionId}`

Purpose: immutable accounting ledger row. The document ID is the idempotency key.

```ts
export interface TransactionDoc {
  id: string;
  studentId: string;
  studentNameSnapshot: string;
  type: 'order' | 'payment' | 'refund' | 'cancel' | 'correction' | 'void';
  amount: number;
  balanceBefore: number | null;
  balanceAfter: number | null;
  clientBalanceAfterPreview: number;
  menuNameSnapshot: string;
  price: number;
  paidAmount: number;
  operatorId: string;
  operatorEmail: string;
  deviceId: string;
  businessDate: string;
  sourceDevice: 'pc' | 'barcode_scanner' | 'ipad_handoff';
  note: string;
  status: 'pending' | 'synced' | 'conflict' | 'voided';
  createdAt: Timestamp;
  committedAt: Timestamp | null;
  voidedAt?: Timestamp;
  voidedBy?: string;
  voidReason?: string;
  correctsTransactionId?: string;
}
```

Rules:

- `id` equals document ID.
- `operatorId` equals `request.auth.uid` on create.
- Transaction docs are append-only. Corrections and voids create new transaction docs; they do not mutate historical money fields on the original row.
- `balanceAfter` can be `null` for offline-pending rows. Once the row is acknowledged online, the repository or reconciliation path fills it from the authoritative student projection.
- Client retries must reuse the same `transactionId`; a second ID for the same confirmed POS action is a duplicate accounting bug.

### `daily_settlements/{businessDate}`

Purpose: accepted daily closeout summary for one business date.

```ts
export interface DailySettlementDoc {
  businessDate: string;
  status: 'open' | 'pending_close' | 'closed' | 'conflict' | 'reopened';
  openingCash: number;
  netCash: number;
  expectedDrawer: number;
  actualDrawer: number;
  difference: number;
  transactionCount: number;
  orderCount: number;
  closedBy: string;
  closedByEmail: string;
  closedAt: Timestamp;
  syncedAt: Timestamp | null;
  closeAttemptId: string;
  note: string;
  revision: number;
}
```

Rules:

- Document ID is the `businessDate` string, for example `2026-05-16`.
- Offline closeout first writes a close attempt subdocument. The parent summary is promoted online when there is no competing close attempt.
- The parent summary must not silently last-write-win over a different accepted close attempt.

### `daily_settlements/{businessDate}/close_attempts/{closeAttemptId}`

Purpose: append-only closeout attempts, including offline attempts.

```ts
export interface CloseAttemptDoc {
  id: string;
  businessDate: string;
  openingCash: number;
  netCash: number;
  expectedDrawer: number;
  actualDrawer: number;
  difference: number;
  transactionIds: string[];
  cashAdjustmentIds: string[];
  operatorId: string;
  operatorEmail: string;
  deviceId: string;
  note: string;
  status: 'pending' | 'accepted' | 'conflict';
  createdAt: Timestamp;
}
```

Rules:

- Close attempts are immutable after creation except for `status` transition by the same operator or admin.
- If exactly one pending attempt exists for the date and no accepted parent summary exists, the app can promote it to `daily_settlements/{businessDate}` with an online Firestore transaction.
- If multiple attempts exist with different cash totals, the app marks them conflict and requires operator choice.

### `daily_settlements/{businessDate}/cash_adjustments/{adjustmentId}`

Purpose: drawer deposit/withdrawal records for petty cash adjustments.

```ts
export interface CashAdjustmentDoc {
  id: string;
  businessDate: string;
  type: 'deposit' | 'withdraw';
  amount: number;
  reason: string;
  operatorId: string;
  operatorEmail: string;
  deviceId: string;
  createdAt: Timestamp;
  status: 'pending' | 'synced' | 'conflict';
}
```

Rules:

- `amount` is positive. `type` determines sign in drawer math.
- The adjustment doc ID is a client-generated idempotency key.
- Adjustments remain visible even if the daily settlement is reopened.

## Sync Status Model

| UI State | Firestore Signals | Operator Meaning |
|---|---|---|
| `green_synced` | Latest listeners are not from cache, no watched docs have `metadata.hasPendingWrites`, no local commit log rows are pending. | Remote Firestore has acknowledged local work. |
| `yellow_syncing` | At least one watched doc has `metadata.hasPendingWrites`, or a local commit is running. | Continue lunch service; closeout shows pending warning. |
| `red_offline_pending` | Browser is offline, listeners are from cache, or Firestore write promise is unresolved after offline detection. | Work is local/pending. Use backup/export discipline. |
| `red_conflict` | A write fails permanently, security rules reject, or closeout attempts conflict. | Stop closeout until resolved. POS can continue only if conflict does not touch the selected student/business date. |

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `frontend/package.json` | Modify | Add `firebase` dependency and test tooling for rules if emulator tests are included in this PR series. |
| `frontend/.env.example` | Create | Document `VITE_FIREBASE_*`, `VITE_FIREBASE_AUTH_DOMAIN`, and emulator toggles. |
| `vercel.json` | Create | Production security headers and SPA routing for Firebase Auth/Firestore on Vercel. |
| `firebase.json` | Create | Configure Firestore rules and emulator ports. |
| `firestore.rules` | Create | Enforce Google Workspace auth, operator whitelist, transaction-linked student balance projection updates, append-only ledger writes, and no student hard delete. |
| `firestore.indexes.json` | Create | Indexes for business date, student, status, and created time queries. |
| `frontend/src/firebase/firebaseApp.ts` | Create | Singleton Firebase app/Auth/Firestore initialization, config guard, persistent local cache, and emulator connection. |
| `frontend/src/firebase/firestorePaths.ts` | Create | Central path builders for every collection/doc/subcollection. |
| `frontend/src/firebase/firestoreSchema.ts` | Create | TypeScript Firestore document interfaces and converters. |
| `frontend/src/firebase/authService.ts` | Create | Google sign-in/out, forced authorization verification, Workspace-domain check, operator whitelist listener. |
| `frontend/src/firebase/syncStatus.ts` | Create | Convert Firestore metadata and local commit state into `green/yellow/red` UI state. |
| `frontend/src/firebase/ledgerRepository.ts` | Create | Commit order/payment/refund/correction/void rows through online transaction or offline-safe batch path. |
| `frontend/src/firebase/studentRepository.ts` | Create | Add/disable students and import initial roster into Firestore. |
| `frontend/src/firebase/settlementRepository.ts` | Create | Cash adjustments, close attempts, online promotion, and conflict detection. |
| `frontend/src/firebase/realtimeSubscriptions.ts` | Create | `onSnapshot` listeners for students, current-day transactions, settlements, and cash adjustments. |
| `frontend/src/auth/AuthGate.tsx` | Create | Login/logout UI and unauthorized/not-whitelisted states. |
| `frontend/src/components/SyncStatusBadge.tsx` | Create | Operator status indicator: synced/syncing/offline/conflict. |
| `frontend/src/store/posStore.ts` | Modify | Hydrate from Firestore subscriptions, store operator/device/sync state, and route commits through repositories. |
| `frontend/src/components/pos-components.tsx` | Modify | Show operator identity and pending/conflict state around transaction confirmation. |
| `frontend/src/components/report/CashClosePanel.tsx` | Modify | Allow offline close attempts and surface closeout conflict status. |
| `docs/ops/firebase-vercel-setup.md` | Create | Firebase project setup, Vercel env vars, backup/export drill, and restore ownership. |
| `docs/ops/firebase-backup-runbook.md` | Create | Counter-owned export procedure and director/admin restore procedure. |

## Implementation Plan

### Task 1: Add Firebase dependency and project config

**Files:**

- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Create: `frontend/.env.example`
- Create: `firebase.json`
- Create: `firestore.indexes.json`

- [ ] **Step 1: Install Firebase SDK**

```bash
cd frontend
npm install firebase
npm install --save-dev @firebase/rules-unit-testing
```

Expected: `frontend/package.json` contains `"firebase"` in `dependencies`, `@firebase/rules-unit-testing` in `devDependencies`, and `frontend/package-lock.json` is updated.

- [ ] **Step 2: Add env example**

Create `frontend/.env.example`:

```env
VITE_FIREBASE_API_KEY=replace-with-firebase-web-api-key
VITE_FIREBASE_AUTH_DOMAIN=replace-with-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=replace-with-project-id
VITE_FIREBASE_APP_ID=replace-with-web-app-id
VITE_FIREBASE_MESSAGING_SENDER_ID=replace-with-sender-id
VITE_FIREBASE_STORAGE_BUCKET=replace-with-project.appspot.com
VITE_FIREBASE_USE_EMULATOR=false
VITE_FIRESTORE_EMULATOR_HOST=127.0.0.1
VITE_FIRESTORE_EMULATOR_PORT=8080
VITE_FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099
```

- [ ] **Step 3: Add Firebase emulator config**

Create `firebase.json`:

```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "ui": { "enabled": true, "port": 4000 },
    "singleProjectMode": true
  }
}
```

Create `firestore.indexes.json`:

```json
{
  "indexes": [
    {
      "collectionGroup": "transactions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "businessDate", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "transactions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "studentId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "cash_adjustments",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "businessDate", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "ASCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

- [ ] **Step 4: Run dependency verification**

```bash
cd frontend
npm install
npm run lint
```

Expected: `npm install` completes and `npm run lint` has no new Firebase import errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/.env.example firebase.json firestore.indexes.json
git commit -m "chore: add Firebase project configuration"
```

### Task 2: Initialize Firebase app, Auth, and Firestore offline cache

**Files:**

- Create: `frontend/src/firebase/firebaseApp.ts`
- Create: `frontend/src/firebase/__tests__/firebaseApp.test.ts`

- [ ] **Step 1: Write the failing env parsing test**

Create `frontend/src/firebase/__tests__/firebaseApp.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getFirebaseConfigState, isFirebaseConfigured, readFirebaseConfig } from '../firebaseApp';

describe('readFirebaseConfig', () => {
  it('reads Vite Firebase env vars into a Firebase app config', () => {
    const config = readFirebaseConfig({
      VITE_FIREBASE_API_KEY: 'api-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'easyorder.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'talented-easyorder-prod',
      VITE_FIREBASE_APP_ID: 'app-id',
      VITE_FIREBASE_MESSAGING_SENDER_ID: 'sender',
      VITE_FIREBASE_STORAGE_BUCKET: 'talented-easyorder-prod.appspot.com',
    });

    expect(config).toEqual({
      apiKey: 'api-key',
      authDomain: 'easyorder.firebaseapp.com',
      projectId: 'talented-easyorder-prod',
      appId: 'app-id',
      messagingSenderId: 'sender',
      storageBucket: 'talented-easyorder-prod.appspot.com',
    });
  });

  it('fails fast when a required env var is missing', () => {
    expect(() => readFirebaseConfig({})).toThrow('Missing Firebase env var: VITE_FIREBASE_API_KEY');
  });

  it('exposes config state without initializing Firebase at module load', () => {
    expect(isFirebaseConfigured({})).toBe(false);
    expect(getFirebaseConfigState({})).toEqual({
      configured: false,
      error: 'Missing Firebase env var: VITE_FIREBASE_API_KEY',
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd frontend
npx vitest run src/firebase/__tests__/firebaseApp.test.ts
```

Expected: FAIL because `frontend/src/firebase/firebaseApp.ts` does not exist.

- [ ] **Step 3: Implement Firebase app initialization**

Create `frontend/src/firebase/firebaseApp.ts`:

```ts
import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';

export interface FirebaseEnv {
  VITE_FIREBASE_API_KEY?: string;
  VITE_FIREBASE_AUTH_DOMAIN?: string;
  VITE_FIREBASE_PROJECT_ID?: string;
  VITE_FIREBASE_APP_ID?: string;
  VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  VITE_FIREBASE_STORAGE_BUCKET?: string;
  VITE_FIREBASE_USE_EMULATOR?: string;
  VITE_FIRESTORE_EMULATOR_HOST?: string;
  VITE_FIRESTORE_EMULATOR_PORT?: string;
  VITE_FIREBASE_AUTH_EMULATOR_URL?: string;
}

function required(env: FirebaseEnv, key: keyof FirebaseEnv): string {
  const value = env[key];
  if (!value) throw new Error(`Missing Firebase env var: ${key}`);
  return value;
}

export type FirebaseConfigState =
  | { configured: true; config: FirebaseOptions }
  | { configured: false; error: string };

export function readFirebaseConfig(env: FirebaseEnv): FirebaseOptions {
  return {
    apiKey: required(env, 'VITE_FIREBASE_API_KEY'),
    authDomain: required(env, 'VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: required(env, 'VITE_FIREBASE_PROJECT_ID'),
    appId: required(env, 'VITE_FIREBASE_APP_ID'),
    messagingSenderId: required(env, 'VITE_FIREBASE_MESSAGING_SENDER_ID'),
    storageBucket: required(env, 'VITE_FIREBASE_STORAGE_BUCKET'),
  };
}

export function getFirebaseConfigState(env: FirebaseEnv): FirebaseConfigState {
  try {
    return { configured: true, config: readFirebaseConfig(env) };
  } catch (error) {
    return {
      configured: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function isFirebaseConfigured(env: FirebaseEnv = import.meta.env as FirebaseEnv): boolean {
  return getFirebaseConfigState(env).configured;
}

export interface FirebaseServices {
  app: FirebaseApp;
  auth: ReturnType<typeof getAuth>;
  db: Firestore;
}

let cachedServices: FirebaseServices | null = null;
let emulatorConnected = false;

function initializeFirestoreOnce(app: FirebaseApp): Firestore {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return getFirestore(app);
  }
}

export function ensureFirebaseInitialized(env: FirebaseEnv = import.meta.env as FirebaseEnv): FirebaseServices {
  if (cachedServices) return cachedServices;

  const state = getFirebaseConfigState(env);
  if (!state.configured) {
    throw new Error(state.error);
  }

  const app = getApps().length > 0 ? getApp() : initializeApp(state.config);
  const auth = getAuth(app);
  const db = initializeFirestoreOnce(app);

  if (env.VITE_FIREBASE_USE_EMULATOR === 'true' && !emulatorConnected) {
    const host = env.VITE_FIRESTORE_EMULATOR_HOST ?? '127.0.0.1';
    const port = Number(env.VITE_FIRESTORE_EMULATOR_PORT ?? '8080');
    connectFirestoreEmulator(db, host, port);
    connectAuthEmulator(
      auth,
      env.VITE_FIREBASE_AUTH_EMULATOR_URL ?? 'http://127.0.0.1:9099',
      { disableWarnings: true },
    );
    emulatorConnected = true;
  }

  cachedServices = { app, auth, db };
  return cachedServices;
}

export const firebaseConfigState = getFirebaseConfigState(import.meta.env as FirebaseEnv);
export const isConfigured = firebaseConfigState.configured;
```

- [ ] **Step 4: Run the test and build**

```bash
cd frontend
npx vitest run src/firebase/__tests__/firebaseApp.test.ts
npm run build
```

Expected: test PASS. Build PASS after Firebase env vars are provided in the test/build environment or build config stubs are added for CI.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/firebase/firebaseApp.ts frontend/src/firebase/__tests__/firebaseApp.test.ts
git commit -m "feat: initialize Firebase client"
```

### Task 3: Add Auth and operator whitelist

**Files:**

- Create: `frontend/src/firebase/authService.ts`
- Create: `frontend/src/firebase/__tests__/authService.test.ts`
- Create: `frontend/src/auth/AuthGate.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Write auth service tests**

Create `frontend/src/firebase/__tests__/authService.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isAllowedWorkspaceEmail, shouldForceSignOut, toOperatorProfile } from '../authService';

describe('authService', () => {
  it('allows talented.com.tw Workspace email only', () => {
    expect(isAllowedWorkspaceEmail('cheerc@talented.com.tw')).toBe(true);
    expect(isAllowedWorkspaceEmail('staff@talented.com.tw')).toBe(true);
    expect(isAllowedWorkspaceEmail('staff@gmail.com')).toBe(false);
    expect(isAllowedWorkspaceEmail(null)).toBe(false);
  });

  it('maps Firebase user to operator profile', () => {
    expect(toOperatorProfile({
      uid: 'uid-1',
      email: 'counter@talented.com.tw',
      displayName: 'Counter One',
    })).toEqual({
      uid: 'uid-1',
      email: 'counter@talented.com.tw',
      displayName: 'Counter One',
    });
  });

  it('forces sign-out for domain and whitelist failures', () => {
    expect(shouldForceSignOut({ ok: false, reason: 'wrong_domain' })).toBe(true);
    expect(shouldForceSignOut({ ok: false, reason: 'not_whitelisted' })).toBe(true);
    expect(shouldForceSignOut({ ok: false, reason: 'inactive' })).toBe(true);
    expect(shouldForceSignOut({ ok: false, reason: 'signed_out' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd frontend
npx vitest run src/firebase/__tests__/authService.test.ts
```

Expected: FAIL because `authService.ts` does not exist.

- [ ] **Step 3: Implement auth helpers**

Create `frontend/src/firebase/authService.ts`:

```ts
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type Auth, type User } from 'firebase/auth';
import { doc, getDoc, onSnapshot, type Firestore } from 'firebase/firestore';
import { operatorPath } from './firestorePaths';

export interface OperatorProfile {
  uid: string;
  email: string;
  displayName: string;
}

export interface OperatorAccess {
  ok: true;
  profile: OperatorProfile;
  role: 'counter' | 'admin';
} | {
  ok: false;
  reason: 'signed_out' | 'wrong_domain' | 'not_whitelisted' | 'inactive';
  profile?: OperatorProfile;
}

export function isAllowedWorkspaceEmail(email: string | null): boolean {
  return Boolean(email && email.toLowerCase().endsWith('@talented.com.tw'));
}

export function toOperatorProfile(user: Pick<User, 'uid' | 'email' | 'displayName'>): OperatorProfile {
  return {
    uid: user.uid,
    email: user.email ?? '',
    displayName: user.displayName ?? user.email ?? user.uid,
  };
}

export function shouldForceSignOut(access: OperatorAccess): boolean {
  return !access.ok && access.reason !== 'signed_out';
}

export async function getOperatorAccess(db: Firestore, user: User): Promise<OperatorAccess> {
  const profile = toOperatorProfile(user);
  if (!isAllowedWorkspaceEmail(profile.email)) {
    return { ok: false, reason: 'wrong_domain', profile };
  }

  const snapshot = await getDoc(doc(db, operatorPath(profile.uid)));
  const data = snapshot.data() as { active?: boolean; role?: 'counter' | 'admin' } | undefined;
  if (!data) return { ok: false, reason: 'not_whitelisted', profile };
  if (!data.active) return { ok: false, reason: 'inactive', profile };
  return { ok: true, profile, role: data.role ?? 'counter' };
}

export async function verifyUserAuthorization(auth: Auth, db: Firestore, user: User): Promise<OperatorAccess> {
  const access = await getOperatorAccess(db, user);
  if (shouldForceSignOut(access)) {
    await signOut(auth);
  }
  return access;
}

export async function signInWithGoogle(auth: Auth, db: Firestore): Promise<OperatorAccess> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ hd: 'talented.com.tw', prompt: 'select_account' });
  const credential = await signInWithPopup(auth, provider);
  return verifyUserAuthorization(auth, db, credential.user);
}

export function signOutOperator(auth: Auth): Promise<void> {
  return signOut(auth);
}

export function subscribeOperatorAccess(
  auth: Auth,
  db: Firestore,
  onAccess: (access: OperatorAccess) => void,
): () => void {
  let unsubscribeOperator: (() => void) | null = null;
  const unsubscribeAuth = onAuthStateChanged(auth, async user => {
    unsubscribeOperator?.();
    unsubscribeOperator = null;

    if (!user) {
      onAccess({ ok: false, reason: 'signed_out' });
      return;
    }

    const profile = toOperatorProfile(user);
    if (!isAllowedWorkspaceEmail(profile.email)) {
      onAccess({ ok: false, reason: 'wrong_domain', profile });
      await signOut(auth);
      return;
    }

    unsubscribeOperator = onSnapshot(doc(db, operatorPath(profile.uid)), snapshot => {
      const data = snapshot.data() as { active?: boolean; role?: 'counter' | 'admin' } | undefined;
      if (!data) {
        onAccess({ ok: false, reason: 'not_whitelisted', profile });
        void signOut(auth);
        return;
      }
      if (!data.active) {
        onAccess({ ok: false, reason: 'inactive', profile });
        void signOut(auth);
        return;
      }
      onAccess({ ok: true, profile, role: data.role ?? 'counter' });
    });
  });

  return () => {
    unsubscribeOperator?.();
    unsubscribeAuth();
  };
}
```

- [ ] **Step 4: Add AuthGate component**

Create `frontend/src/auth/AuthGate.tsx`:

```tsx
import type { ReactNode } from 'react';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { signInWithGoogle, signOutOperator, type OperatorAccess } from '../firebase/authService';

export function AuthGate({ auth, db, access, children }: {
  auth: Auth;
  db: Firestore;
  access: OperatorAccess;
  children: ReactNode;
}) {
  if (!access.ok) {
    return (
      <main className="auth-gate" aria-label="登入 EasyOrder">
        <h1>Talented EasyOrder</h1>
        {access.reason === 'signed_out' && <p>請使用公司 Google Workspace 帳號登入。</p>}
        {access.reason === 'wrong_domain' && <p>此帳號不是 @talented.com.tw，請切換公司帳號。</p>}
        {access.reason === 'not_whitelisted' && <p>此帳號尚未加入 EasyOrder 操作員名單。</p>}
        {access.reason === 'inactive' && <p>此帳號已停用，請聯絡管理員。</p>}
        <button type="button" onClick={() => void signInWithGoogle(auth, db)}>使用 Google 登入</button>
      </main>
    );
  }

  return (
    <>
      <div className="operator-strip">
        <span>{access.profile.displayName}</span>
        <button type="button" onClick={() => void signOutOperator(auth)}>登出</button>
      </div>
      {children}
    </>
  );
}
```

- [ ] **Step 5: Run auth tests**

```bash
cd frontend
npx vitest run src/firebase/__tests__/authService.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/firebase/authService.ts frontend/src/firebase/__tests__/authService.test.ts frontend/src/auth/AuthGate.tsx frontend/src/App.tsx
git commit -m "feat: add Firebase Auth operator gate"
```

### Task 4: Add Firestore schema, paths, and converters

**Files:**

- Create: `frontend/src/firebase/firestorePaths.ts`
- Create: `frontend/src/firebase/firestoreSchema.ts`
- Create: `frontend/src/firebase/__tests__/firestoreSchema.test.ts`

- [ ] **Step 1: Write schema tests**

Create `frontend/src/firebase/__tests__/firestoreSchema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildTransactionDoc, validateStudentDoc } from '../firestoreSchema';

describe('firestoreSchema', () => {
  it('keeps Firestore field names camelCase to match domain types', () => {
    const tx = buildTransactionDoc({
      id: 'tx-1',
      studentId: '015',
      studentNameSnapshot: '王小明',
      type: 'payment',
      amount: 100,
      balanceBefore: 0,
      balanceAfter: 100,
      clientBalanceAfterPreview: 100,
      menuNameSnapshot: '',
      price: 0,
      paidAmount: 100,
      operatorId: 'uid-1',
      operatorEmail: 'counter@talented.com.tw',
      deviceId: 'pc-1',
      businessDate: '2026-05-16',
      sourceDevice: 'pc',
      note: '補錢',
      status: 'pending',
    });

    expect(tx).toHaveProperty('studentId', '015');
    expect(tx).not.toHaveProperty('student_id');
    expect(tx.id).toBe('tx-1');
  });

  it('requires positive revision and a known student status', () => {
    expect(validateStudentDoc({ id: '015', displayName: '王小明', status: 'active', revision: 1 })).toEqual({ ok: true });
    expect(validateStudentDoc({ id: '015', displayName: '王小明', status: 'deleted', revision: 1 })).toEqual({ ok: false, reason: 'invalid status' });
  });
});
```

- [ ] **Step 2: Implement path builders**

Create `frontend/src/firebase/firestorePaths.ts`:

```ts
export const operatorPath = (uid: string) => `operators/${uid}`;
export const studentPath = (studentId: string) => `students/${studentId}`;
export const transactionPath = (transactionId: string) => `transactions/${transactionId}`;
export const settlementPath = (businessDate: string) => `daily_settlements/${businessDate}`;
export const closeAttemptPath = (businessDate: string, closeAttemptId: string) =>
  `daily_settlements/${businessDate}/close_attempts/${closeAttemptId}`;
export const cashAdjustmentPath = (businessDate: string, adjustmentId: string) =>
  `daily_settlements/${businessDate}/cash_adjustments/${adjustmentId}`;
```

- [ ] **Step 3: Implement schema helpers**

Create `frontend/src/firebase/firestoreSchema.ts` with the interfaces from the Collection Design section and these helpers:

```ts
import { serverTimestamp, type FieldValue, type Timestamp } from 'firebase/firestore';

export type FirestoreTimestamp = Timestamp | FieldValue;
export type FirestoreTransactionType = 'order' | 'payment' | 'refund' | 'cancel' | 'correction' | 'void';
export type FirestoreSyncStatus = 'pending' | 'synced' | 'conflict' | 'voided';

export interface TransactionDocInput {
  id: string;
  studentId: string;
  studentNameSnapshot: string;
  type: FirestoreTransactionType;
  amount: number;
  balanceBefore: number | null;
  balanceAfter: number | null;
  clientBalanceAfterPreview: number;
  menuNameSnapshot: string;
  price: number;
  paidAmount: number;
  operatorId: string;
  operatorEmail: string;
  deviceId: string;
  businessDate: string;
  sourceDevice: 'pc' | 'barcode_scanner' | 'ipad_handoff';
  note: string;
  status: FirestoreSyncStatus;
}

export interface TransactionDoc extends TransactionDocInput {
  createdAt: FirestoreTimestamp;
  committedAt: FirestoreTimestamp | null;
}

export function buildTransactionDoc(input: TransactionDocInput): TransactionDoc {
  return {
    ...input,
    createdAt: serverTimestamp(),
    committedAt: input.status === 'synced' ? serverTimestamp() : null,
  };
}

export function validateStudentDoc(input: Record<string, unknown>): { ok: true } | { ok: false; reason: string } {
  if (input.status !== 'active' && input.status !== 'inactive') return { ok: false, reason: 'invalid status' };
  if (typeof input.revision !== 'number' || input.revision < 1) return { ok: false, reason: 'invalid revision' };
  return { ok: true };
}
```

- [ ] **Step 4: Run schema tests**

```bash
cd frontend
npx vitest run src/firebase/__tests__/firestoreSchema.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/firebase/firestorePaths.ts frontend/src/firebase/firestoreSchema.ts frontend/src/firebase/__tests__/firestoreSchema.test.ts
git commit -m "feat: define Firestore schema contracts"
```

### Task 5: Add Firestore Security Rules

**Files:**

- Create: `firestore.rules`
- Create: `frontend/src/firebase/__tests__/firestoreRules.spec.ts`

- [ ] **Step 1: Add rules file**

Create `firestore.rules`:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function talentedEmail() {
      return signedIn()
        && request.auth.token.email is string
        && request.auth.token.email.matches('.*@talented\\.com\\.tw$');
    }

    function operatorDoc() {
      return get(/databases/$(database)/documents/operators/$(request.auth.uid));
    }

    function activeOperator() {
      return talentedEmail()
        && exists(/databases/$(database)/documents/operators/$(request.auth.uid))
        && operatorDoc().data.active == true;
    }

    function adminOperator() {
      return activeOperator() && operatorDoc().data.role == 'admin';
    }

    function sameOperator() {
      return request.resource.data.operatorId == request.auth.uid;
    }

    function affectedKeys() {
      return request.resource.data.diff(resource.data).affectedKeys();
    }

    function createsMatchingTransaction(studentId) {
      let txId = request.resource.data.lastTransactionId;
      let tx = getAfter(/databases/$(database)/documents/transactions/$(txId));
      return txId is string
        && tx.data.id == txId
        && tx.data.studentId == studentId
        && tx.data.operatorId == request.auth.uid
        && tx.data.amount is number;
    }

    function transactionProjectionUpdate(studentId) {
      let txId = request.resource.data.lastTransactionId;
      let tx = getAfter(/databases/$(database)/documents/transactions/$(txId));
      return affectedKeys().hasOnly(['currentBalance', 'revision', 'updatedAt', 'updatedBy', 'lastTransactionId'])
        && createsMatchingTransaction(studentId)
        && request.resource.data.currentBalance == resource.data.currentBalance + tx.data.amount
        && request.resource.data.revision == resource.data.revision + 1
        && request.resource.data.updatedBy == request.auth.uid;
    }

    function rosterOnlyStudentUpdate() {
      return affectedKeys().hasOnly([
        'displayName',
        'aliases',
        'className',
        'groupName',
        'status',
        'updatedAt',
        'updatedBy'
      ])
      && request.resource.data.updatedBy == request.auth.uid
      && request.resource.data.status in ['active', 'inactive'];
    }

    match /operators/{uid} {
      allow get: if activeOperator() && (uid == request.auth.uid || adminOperator());
      allow list: if adminOperator();
      allow create, update: if adminOperator()
        && request.resource.data.uid == uid
        && request.resource.data.email.matches('.*@talented\\.com\\.tw$')
        && request.resource.data.active is bool;
      allow delete: if false;
    }

    match /students/{studentId} {
      allow read: if activeOperator();
      allow create: if activeOperator()
        && request.resource.data.id == studentId
        && request.resource.data.updatedBy == request.auth.uid
        && request.resource.data.status in ['active', 'inactive']
        && request.resource.data.currentBalance == request.resource.data.openingBalance
        && request.resource.data.revision == 1
        && request.resource.data.lastTransactionId == null;
      allow update: if activeOperator()
        && request.resource.data.id == resource.data.id
        && (
          rosterOnlyStudentUpdate()
          || transactionProjectionUpdate(studentId)
        );
      allow delete: if false;
    }

    match /transactions/{transactionId} {
      allow read: if activeOperator();
      allow create: if activeOperator()
        && request.resource.data.id == transactionId
        && sameOperator()
        && request.resource.data.businessDate is string
        && request.resource.data.studentId is string
        && request.resource.data.amount is number
        && request.resource.data.type in ['order', 'payment', 'refund', 'cancel', 'correction', 'void'];
      allow update: if activeOperator()
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'committedAt', 'balanceAfter', 'voidedAt', 'voidedBy', 'voidReason']);
      allow delete: if false;
    }

    match /daily_settlements/{businessDate} {
      allow read: if activeOperator();
      allow create, update: if activeOperator()
        && request.resource.data.businessDate == businessDate
        && request.resource.data.closedBy == request.auth.uid;
      allow delete: if false;

      match /close_attempts/{closeAttemptId} {
        allow read: if activeOperator();
        allow create: if activeOperator()
          && request.resource.data.id == closeAttemptId
          && request.resource.data.businessDate == businessDate
          && request.resource.data.operatorId == request.auth.uid;
        allow update: if activeOperator()
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status']);
        allow delete: if false;
      }

      match /cash_adjustments/{adjustmentId} {
        allow read: if activeOperator();
        allow create: if activeOperator()
          && request.resource.data.id == adjustmentId
          && request.resource.data.businessDate == businessDate
          && request.resource.data.operatorId == request.auth.uid
          && request.resource.data.amount > 0
          && request.resource.data.type in ['deposit', 'withdraw'];
        allow update: if activeOperator()
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status']);
        allow delete: if false;
      }
    }
  }
}
```

- [ ] **Step 2: Add emulator rules tests**

Create `frontend/src/firebase/__tests__/firestoreRules.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { deleteDoc, doc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

let env: RulesTestEnvironment;

const rulesPath = fileURLToPath(new URL('../../../../firestore.rules', import.meta.url));

async function seedOperator(uid: string, email: string, role: 'counter' | 'admin' = 'counter', active = true) {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), `operators/${uid}`), {
      uid,
      email,
      displayName: email,
      role,
      active,
      createdAt: new Date('2026-05-16T08:00:00.000Z'),
      updatedAt: new Date('2026-05-16T08:00:00.000Z'),
    });
  });
}

async function seedStudent(studentId: string, balance = 500) {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), `students/${studentId}`), {
      id: studentId,
      displayName: '王小明',
      aliases: [],
      className: null,
      groupName: null,
      openingBalance: balance,
      currentBalance: balance,
      status: 'active',
      createdAt: new Date('2026-05-16T08:00:00.000Z'),
      createdBy: 'seed',
      updatedAt: new Date('2026-05-16T08:00:00.000Z'),
      updatedBy: 'seed',
      revision: 1,
      lastTransactionId: null,
    });
  });
}

function authedDb(uid: string, email: string) {
  return env.authenticatedContext(uid, { email }).firestore();
}

describe('firestore.rules required cases', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'easyorder-rules-test',
      firestore: { rules: readFileSync(rulesPath, 'utf8') },
    });
  });

  beforeEach(async () => {
    await env.clearFirestore();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it('allows active @talented.com.tw operator to create a transaction with matching operatorId', async () => {
    await seedOperator('uid-counter', 'counter@talented.com.tw');
    const db = authedDb('uid-counter', 'counter@talented.com.tw');

    await assertSucceeds(setDoc(doc(db, 'transactions/tx-1'), {
      id: 'tx-1',
      studentId: '015',
      studentNameSnapshot: '王小明',
      type: 'payment',
      amount: 100,
      balanceBefore: 0,
      balanceAfter: 100,
      clientBalanceAfterPreview: 100,
      menuNameSnapshot: '',
      price: 0,
      paidAmount: 100,
      operatorId: 'uid-counter',
      operatorEmail: 'counter@talented.com.tw',
      deviceId: 'pc-1',
      businessDate: '2026-05-16',
      sourceDevice: 'pc',
      note: '補錢',
      status: 'pending',
      createdAt: new Date('2026-05-16T08:00:00.000Z'),
      committedAt: null,
    }));
  });

  it('rejects non-talented email even if signed in', async () => {
    await seedOperator('uid-outsider', 'outsider@gmail.com');
    const db = authedDb('uid-outsider', 'outsider@gmail.com');

    await assertFails(setDoc(doc(db, 'transactions/tx-outsider'), {
      id: 'tx-outsider',
      studentId: '015',
      type: 'payment',
      amount: 100,
      operatorId: 'uid-outsider',
      businessDate: '2026-05-16',
    }));
  });

  it('rejects hard deletion of students and transactions', async () => {
    await seedOperator('uid-counter', 'counter@talented.com.tw');
    const db = authedDb('uid-counter', 'counter@talented.com.tw');

    await assertFails(deleteDoc(doc(db, 'students/015')));
    await assertFails(deleteDoc(doc(db, 'transactions/tx-1')));
  });

  it('rejects direct student balance changes without a matching transaction in the same write', async () => {
    await seedOperator('uid-counter', 'counter@talented.com.tw');
    await seedStudent('015', 500);
    const db = authedDb('uid-counter', 'counter@talented.com.tw');

    await assertFails(updateDoc(doc(db, 'students/015'), {
      currentBalance: 999,
      revision: 2,
      updatedAt: new Date('2026-05-16T08:01:00.000Z'),
      updatedBy: 'uid-counter',
      lastTransactionId: 'tx-missing',
    }));
  });

  it('allows student balance projection only when the same batch creates the matching transaction', async () => {
    await seedOperator('uid-counter', 'counter@talented.com.tw');
    await seedStudent('015', 500);
    const db = authedDb('uid-counter', 'counter@talented.com.tw');
    const batch = writeBatch(db);

    batch.set(doc(db, 'transactions/tx-2'), {
      id: 'tx-2',
      studentId: '015',
      studentNameSnapshot: '王小明',
      type: 'payment',
      amount: 100,
      balanceBefore: 500,
      balanceAfter: 600,
      clientBalanceAfterPreview: 600,
      menuNameSnapshot: '',
      price: 0,
      paidAmount: 100,
      operatorId: 'uid-counter',
      operatorEmail: 'counter@talented.com.tw',
      deviceId: 'pc-1',
      businessDate: '2026-05-16',
      sourceDevice: 'pc',
      note: '補錢',
      status: 'pending',
      createdAt: new Date('2026-05-16T08:01:00.000Z'),
      committedAt: null,
    });
    batch.update(doc(db, 'students/015'), {
      currentBalance: 600,
      revision: 2,
      updatedAt: new Date('2026-05-16T08:01:00.000Z'),
      updatedBy: 'uid-counter',
      lastTransactionId: 'tx-2',
    });

    await assertSucceeds(batch.commit());
  });

  it('rejects transaction create when operatorId does not match auth uid', async () => {
    await seedOperator('uid-counter', 'counter@talented.com.tw');
    const db = authedDb('uid-counter', 'counter@talented.com.tw');

    await assertFails(setDoc(doc(db, 'transactions/tx-mismatch'), {
      id: 'tx-mismatch',
      studentId: '015',
      type: 'payment',
      amount: 100,
      operatorId: 'different-uid',
      businessDate: '2026-05-16',
    }));
  });
});
```

- [ ] **Step 3: Run rules validation**

```bash
firebase emulators:exec --only firestore,auth "cd frontend && npx vitest run src/firebase/__tests__/firestoreRules.spec.ts"
```

Expected: PASS after emulator-backed assertions replace the temporary spec scaffold.

- [ ] **Step 4: Commit**

```bash
git add firestore.rules frontend/src/firebase/__tests__/firestoreRules.spec.ts
git commit -m "feat: add Firestore security rules"
```

### Task 6: Implement realtime subscriptions and sync indicator

**Files:**

- Create: `frontend/src/firebase/syncStatus.ts`
- Create: `frontend/src/firebase/realtimeSubscriptions.ts`
- Create: `frontend/src/firebase/__tests__/syncStatus.test.ts`
- Create: `frontend/src/components/SyncStatusBadge.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Write sync status tests**

Create `frontend/src/firebase/__tests__/syncStatus.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deriveSyncIndicator } from '../syncStatus';

describe('deriveSyncIndicator', () => {
  it('is green when online and there are no pending writes', () => {
    expect(deriveSyncIndicator({ online: true, fromCache: false, pendingWrites: 0, conflicts: 0 })).toEqual({
      kind: 'green_synced',
      label: '已同步',
    });
  });

  it('is yellow when Firestore has pending writes', () => {
    expect(deriveSyncIndicator({ online: true, fromCache: false, pendingWrites: 2, conflicts: 0 }).kind).toBe('yellow_syncing');
  });

  it('is red when offline with pending writes', () => {
    expect(deriveSyncIndicator({ online: false, fromCache: true, pendingWrites: 1, conflicts: 0 }).kind).toBe('red_offline_pending');
  });

  it('is red conflict when any accounting conflict exists', () => {
    expect(deriveSyncIndicator({ online: true, fromCache: false, pendingWrites: 0, conflicts: 1 }).kind).toBe('red_conflict');
  });
});
```

- [ ] **Step 2: Implement sync status helper**

Create `frontend/src/firebase/syncStatus.ts`:

```ts
export type SyncIndicatorKind = 'green_synced' | 'yellow_syncing' | 'red_offline_pending' | 'red_conflict';

export interface SyncIndicatorInput {
  online: boolean;
  fromCache: boolean;
  pendingWrites: number;
  conflicts: number;
}

export function deriveSyncIndicator(input: SyncIndicatorInput): { kind: SyncIndicatorKind; label: string } {
  if (input.conflicts > 0) return { kind: 'red_conflict', label: '衝突需處理' };
  if (!input.online || input.fromCache) return { kind: 'red_offline_pending', label: '離線待同步' };
  if (input.pendingWrites > 0) return { kind: 'yellow_syncing', label: '同步中' };
  return { kind: 'green_synced', label: '已同步' };
}
```

- [ ] **Step 3: Implement realtime listener module**

Create `frontend/src/firebase/realtimeSubscriptions.ts`:

```ts
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';

export interface RealtimeHandlers {
  onStudents: (docs: unknown[], pendingWrites: number, fromCache: boolean) => void;
  onTransactions: (docs: unknown[], pendingWrites: number, fromCache: boolean) => void;
  onSettlements: (docs: unknown[], pendingWrites: number, fromCache: boolean) => void;
  onError: (error: Error) => void;
}

function pendingCount(snapshot: { docs: Array<{ metadata: { hasPendingWrites: boolean } }> }): number {
  return snapshot.docs.filter(doc => doc.metadata.hasPendingWrites).length;
}

export function subscribeBusinessDate(db: Firestore, businessDate: string, handlers: RealtimeHandlers): Unsubscribe {
  const unsubscribers: Unsubscribe[] = [];

  unsubscribers.push(onSnapshot(
    query(collection(db, 'students'), orderBy('displayName')),
    { includeMetadataChanges: true },
    snapshot => handlers.onStudents(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })), pendingCount(snapshot), snapshot.metadata.fromCache),
    error => handlers.onError(error),
  ));

  unsubscribers.push(onSnapshot(
    query(collection(db, 'transactions'), where('businessDate', '==', businessDate), orderBy('createdAt', 'desc')),
    { includeMetadataChanges: true },
    snapshot => handlers.onTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })), pendingCount(snapshot), snapshot.metadata.fromCache),
    error => handlers.onError(error),
  ));

  unsubscribers.push(onSnapshot(
    query(collection(db, 'daily_settlements'), where('businessDate', '==', businessDate)),
    { includeMetadataChanges: true },
    snapshot => handlers.onSettlements(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })), pendingCount(snapshot), snapshot.metadata.fromCache),
    error => handlers.onError(error),
  ));

  return () => unsubscribers.forEach(unsubscribe => unsubscribe());
}
```

- [ ] **Step 4: Add SyncStatusBadge**

Create `frontend/src/components/SyncStatusBadge.tsx`:

```tsx
import type { SyncIndicatorKind } from '../firebase/syncStatus';

const iconByKind: Record<SyncIndicatorKind, string> = {
  green_synced: '🟢',
  yellow_syncing: '🟡',
  red_offline_pending: '🔴',
  red_conflict: '🔴',
};

export function SyncStatusBadge({ kind, label }: { kind: SyncIndicatorKind; label: string }) {
  return (
    <div className={`sync-badge ${kind}`} role="status" aria-live="polite">
      <span aria-hidden="true">{iconByKind[kind]}</span>
      <span>{label}</span>
    </div>
  );
}
```

- [ ] **Step 5: Run tests**

```bash
cd frontend
npx vitest run src/firebase/__tests__/syncStatus.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/firebase/syncStatus.ts frontend/src/firebase/realtimeSubscriptions.ts frontend/src/firebase/__tests__/syncStatus.test.ts frontend/src/components/SyncStatusBadge.tsx frontend/src/App.tsx
git commit -m "feat: add Firestore realtime sync status"
```

### Task 7: Implement ledger commit repository

**Files:**

- Create: `frontend/src/firebase/ledgerRepository.ts`
- Create: `frontend/src/firebase/__tests__/ledgerRepository.test.ts`
- Modify: `frontend/src/store/posStore.ts`

- [ ] **Step 1: Write repository behavior tests**

Create `frontend/src/firebase/__tests__/ledgerRepository.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createTransactionId, shouldUseOfflineCommitPath } from '../ledgerRepository';

describe('ledgerRepository', () => {
  it('creates stable idempotency keys from device id and local sequence', () => {
    expect(createTransactionId('pc-1', 42)).toBe('pc-1:tx:42');
  });

  it('uses offline commit path when browser is offline', () => {
    expect(shouldUseOfflineCommitPath({ online: false, forceOffline: false })).toBe(true);
  });

  it('uses online transaction path when online', () => {
    expect(shouldUseOfflineCommitPath({ online: true, forceOffline: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Implement repository skeleton**

Create `frontend/src/firebase/ledgerRepository.ts`:

```ts
import {
  doc,
  getDoc,
  increment,
  runTransaction,
  serverTimestamp,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { studentPath, transactionPath } from './firestorePaths';
import { buildTransactionDoc, type TransactionDocInput } from './firestoreSchema';

export function createTransactionId(deviceId: string, sequence: number): string {
  return `${deviceId}:tx:${sequence}`;
}

export function shouldUseOfflineCommitPath(input: { online: boolean; forceOffline: boolean }): boolean {
  return input.forceOffline || !input.online;
}

export interface CommitLedgerInput extends TransactionDocInput {
  expectedStudentRevision: number;
}

export async function commitLedgerOnline(db: Firestore, input: CommitLedgerInput): Promise<'accepted' | 'duplicate'> {
  const txRef = doc(db, transactionPath(input.id));
  const studentRef = doc(db, studentPath(input.studentId));

  return runTransaction(db, async transaction => {
    const existing = await transaction.get(txRef);
    if (existing.exists()) return 'duplicate';

    const student = await transaction.get(studentRef);
    if (!student.exists()) throw new Error(`Unknown student: ${input.studentId}`);

    const studentData = student.data() as { currentBalance: number; revision: number; displayName: string };
    if (studentData.revision !== input.expectedStudentRevision) {
      throw new Error(`Student revision conflict: expected ${input.expectedStudentRevision}, actual ${studentData.revision}`);
    }

    const balanceBefore = studentData.currentBalance;
    const balanceAfter = balanceBefore + input.amount;
    transaction.set(txRef, buildTransactionDoc({
      ...input,
      balanceBefore,
      balanceAfter,
      clientBalanceAfterPreview: balanceAfter,
      status: 'synced',
    }));
    transaction.update(studentRef, {
      currentBalance: balanceAfter,
      revision: increment(1),
      updatedAt: serverTimestamp(),
      updatedBy: input.operatorId,
      lastTransactionId: input.id,
    });
    return 'accepted';
  });
}

export async function commitLedgerOfflineBatch(db: Firestore, input: CommitLedgerInput): Promise<'queued'> {
  const txRef = doc(db, transactionPath(input.id));
  const studentRef = doc(db, studentPath(input.studentId));
  const existing = await getDoc(txRef);
  if (existing.exists()) return 'queued';

  const batch = writeBatch(db);
  batch.set(txRef, buildTransactionDoc({
    ...input,
    balanceBefore: null,
    balanceAfter: null,
    status: 'pending',
  }));
  batch.update(studentRef, {
    currentBalance: increment(input.amount),
    revision: increment(1),
    updatedAt: serverTimestamp(),
    updatedBy: input.operatorId,
    lastTransactionId: input.id,
  });
  await batch.commit();
  return 'queued';
}
```

Review note: the offline batch path intentionally avoids `runTransaction`, because Firestore transactions fail offline. It depends on a stable `transactionId`, disabled duplicate UI retry after local commit, and the Firestore Rules `getAfter()` check that links the student projection update to the matching transaction document in the same batch.

- [ ] **Step 3: Wire POS store commit path**

Modify `frontend/src/store/posStore.ts` so `processTransaction` and `commitPosTransactionDraft` call a repository adapter injected into the store. The first implementation can keep local Zustand projection as the immediate UI response, but it must assign the final transaction ID before showing success and must set `syncStatus` from Firestore metadata.

Required store state additions:

```ts
deviceId: string;
operatorId: string | null;
operatorEmail: string | null;
nextDeviceSeq: number;
syncIndicator: { kind: string; label: string };
```

Required invariant:

```ts
// Once a POS confirmation receives a transactionId, retry must reuse that id.
// A second randomUUID for the same confirmation is forbidden.
```

- [ ] **Step 4: Run tests**

```bash
cd frontend
npx vitest run src/firebase/__tests__/ledgerRepository.test.ts src/store/__tests__/posStore.test.ts
```

Expected: PASS. Existing store tests may need fixture updates for injected repository defaults.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/firebase/ledgerRepository.ts frontend/src/firebase/__tests__/ledgerRepository.test.ts frontend/src/store/posStore.ts
git commit -m "feat: commit ledger rows through Firestore"
```

### Task 8: Implement student management repository

**Files:**

- Create: `frontend/src/firebase/studentRepository.ts`
- Create: `frontend/src/firebase/__tests__/studentRepository.test.ts`
- Modify: `frontend/src/components/screens.tsx`
- Modify: `frontend/src/domain/student.ts`

- [ ] **Step 1: Write student repository tests**

Create `frontend/src/firebase/__tests__/studentRepository.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildStudentDoc } from '../studentRepository';

describe('studentRepository', () => {
  it('builds a Firestore student doc from import row data', () => {
    const doc = buildStudentDoc({
      studentId: '015',
      displayName: '王小明',
      openingBalance: 500,
      operatorId: 'uid-1',
    });

    expect(doc).toMatchObject({
      id: '015',
      displayName: '王小明',
      openingBalance: 500,
      currentBalance: 500,
      status: 'active',
      revision: 1,
      lastTransactionId: null,
      updatedBy: 'uid-1',
    });
  });
});
```

- [ ] **Step 2: Implement student repository**

Create `frontend/src/firebase/studentRepository.ts`:

```ts
import { doc, serverTimestamp, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { studentPath } from './firestorePaths';

export function buildStudentDoc(input: {
  studentId: string;
  displayName: string;
  openingBalance: number;
  operatorId: string;
}) {
  return {
    id: input.studentId,
    displayName: input.displayName,
    aliases: [],
    className: null,
    groupName: null,
    openingBalance: input.openingBalance,
    currentBalance: input.openingBalance,
    status: 'active' as const,
    createdAt: serverTimestamp(),
    createdBy: input.operatorId,
    updatedAt: serverTimestamp(),
    updatedBy: input.operatorId,
    revision: 1,
    lastTransactionId: null,
  };
}

export async function addStudent(db: Firestore, input: Parameters<typeof buildStudentDoc>[0]): Promise<void> {
  await setDoc(doc(db, studentPath(input.studentId)), buildStudentDoc(input));
}

export async function disableStudent(db: Firestore, input: { studentId: string; operatorId: string }): Promise<void> {
  await updateDoc(doc(db, studentPath(input.studentId)), {
    status: 'inactive',
    updatedAt: serverTimestamp(),
    updatedBy: input.operatorId,
  });
}
```

- [ ] **Step 3: Update Admin UI wiring**

Modify `frontend/src/components/screens.tsx` so student add/disable actions call `addStudent` and `disableStudent`. Keep local UI optimistic through Firestore snapshot updates; do not hard-delete a student.

- [ ] **Step 4: Run tests**

```bash
cd frontend
npx vitest run src/firebase/__tests__/studentRepository.test.ts src/domain/__tests__/student.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/firebase/studentRepository.ts frontend/src/firebase/__tests__/studentRepository.test.ts frontend/src/components/screens.tsx frontend/src/domain/student.ts
git commit -m "feat: sync student roster through Firestore"
```

### Task 9: Implement closeout and cash adjustment repositories

**Files:**

- Create: `frontend/src/firebase/settlementRepository.ts`
- Create: `frontend/src/firebase/__tests__/settlementRepository.test.ts`
- Modify: `frontend/src/domain/cashClose.ts`
- Modify: `frontend/src/components/report/CashClosePanel.tsx`

- [ ] **Step 1: Write settlement tests**

Create `frontend/src/firebase/__tests__/settlementRepository.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createCloseAttemptId, summarizeCloseAttemptConflict } from '../settlementRepository';

describe('settlementRepository', () => {
  it('creates stable close attempt ids', () => {
    expect(createCloseAttemptId('pc-1', '2026-05-16', 7)).toBe('pc-1:close:2026-05-16:7');
  });

  it('marks multiple different attempts as conflict', () => {
    expect(summarizeCloseAttemptConflict([
      { id: 'a', actualDrawer: 5260, difference: 0 },
      { id: 'b', actualDrawer: 5250, difference: -10 },
    ])).toEqual({ conflict: true, attemptIds: ['a', 'b'] });
  });
});
```

- [ ] **Step 2: Implement settlement repository**

Create `frontend/src/firebase/settlementRepository.ts`:

```ts
import { doc, runTransaction, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
import { closeAttemptPath, settlementPath, cashAdjustmentPath } from './firestorePaths';

export function createCloseAttemptId(deviceId: string, businessDate: string, sequence: number): string {
  return `${deviceId}:close:${businessDate}:${sequence}`;
}

export function summarizeCloseAttemptConflict(attempts: Array<{ id: string; actualDrawer: number; difference: number }>) {
  const signatures = new Set(attempts.map(a => `${a.actualDrawer}:${a.difference}`));
  return { conflict: signatures.size > 1, attemptIds: attempts.map(a => a.id) };
}

export async function writeOfflineCloseAttempt(db: Firestore, input: {
  id: string;
  businessDate: string;
  openingCash: number;
  netCash: number;
  expectedDrawer: number;
  actualDrawer: number;
  difference: number;
  transactionIds: string[];
  cashAdjustmentIds: string[];
  operatorId: string;
  operatorEmail: string;
  deviceId: string;
  note: string;
}) {
  await setDoc(doc(db, closeAttemptPath(input.businessDate, input.id)), {
    ...input,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
}

export async function promoteCloseAttemptOnline(db: Firestore, input: {
  businessDate: string;
  closeAttemptId: string;
  summary: Record<string, unknown>;
}) {
  const summaryRef = doc(db, settlementPath(input.businessDate));
  const attemptRef = doc(db, closeAttemptPath(input.businessDate, input.closeAttemptId));
  await runTransaction(db, async transaction => {
    const existing = await transaction.get(summaryRef);
    if (existing.exists() && existing.data().status === 'closed') {
      throw new Error(`Business date already closed: ${input.businessDate}`);
    }
    transaction.set(summaryRef, input.summary);
    transaction.update(attemptRef, { status: 'accepted' });
  });
}

export async function addCashAdjustment(db: Firestore, input: {
  id: string;
  businessDate: string;
  type: 'deposit' | 'withdraw';
  amount: number;
  reason: string;
  operatorId: string;
  operatorEmail: string;
  deviceId: string;
}) {
  await setDoc(doc(db, cashAdjustmentPath(input.businessDate, input.id)), {
    ...input,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
}
```

- [ ] **Step 3: Update closeout UI semantics**

Modify `frontend/src/components/report/CashClosePanel.tsx`:

- Allow closeout while offline by writing a close attempt.
- Show red conflict copy when two close attempts disagree.
- Show yellow copy while close attempt has pending writes.
- Keep note requirement when `difference !== 0`.

Required copy:

```tsx
同步狀態：離線關帳已先保存，本機上線後會同步。若其他裝置也關帳，系統會要求選擇正確版本。
```

- [ ] **Step 4: Run tests**

```bash
cd frontend
npx vitest run src/firebase/__tests__/settlementRepository.test.ts src/domain/__tests__/cashClose.test.ts src/__tests__/reportScreen.integration.test.tsx
```

Expected: PASS after expected closeout copy updates.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/firebase/settlementRepository.ts frontend/src/firebase/__tests__/settlementRepository.test.ts frontend/src/domain/cashClose.ts frontend/src/components/report/CashClosePanel.tsx
git commit -m "feat: support Firestore offline closeout"
```

### Task 10: Add Vercel deployment and Firebase operations docs

**Files:**

- Create: `vercel.json`
- Create: `docs/ops/firebase-vercel-setup.md`
- Create: `docs/ops/firebase-backup-runbook.md`
- Modify: `docs/superpowers/plans/2026-05-15-user-decision-checklist.md`
- Modify: `docs/superpowers/plans/2026-05-15-deployment-hosting-strategy.md`

- [ ] **Step 1: Add Vercel security headers and SPA routing**

Create `vercel.json`:

```json
{
  "rewrites": [
    { "source": "/((?!assets/|pwa/|manifest.webmanifest|favicon.svg|icons.svg).*)", "destination": "/" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self'; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://firebaseinstallations.googleapis.com https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com; img-src 'self' data: https://www.gstatic.com https://lh3.googleusercontent.com; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-src https://accounts.google.com https://*.firebaseapp.com; object-src 'none'; base-uri 'self'; form-action 'self' https://accounts.google.com; frame-ancestors 'none'; upgrade-insecure-requests"
        },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), payment=()" }
      ]
    }
  ]
}
```

Review note: keep `style-src 'unsafe-inline'` only while the current React/CSS stack needs inline styles. Do not add `script-src 'unsafe-eval'` for production. If Firebase Auth or Firestore adds a blocked origin during browser verification, update `connect-src` or `frame-src` with the exact origin and document the console error in the PR.

- [ ] **Step 2: Create Firebase + Vercel setup doc**

Create `docs/ops/firebase-vercel-setup.md`:

```md
# EasyOrder Firebase + Vercel Setup

## Firebase Project

1. Create an independent Firebase project for EasyOrder.
2. Add a Web app and copy config values into Vercel environment variables.
3. Enable Firebase Auth Google provider.
4. Add `talented.com.tw` Workspace users only.
5. Enable Firestore in production mode.
6. Deploy `firestore.rules` and `firestore.indexes.json`.
7. Sign in once as `cheerc@talented.com.tw` and create `operators/{uid}` with `role=admin` and `active=true`.

## Vercel

Set these environment variables for Production and Preview:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_USE_EMULATOR=false`

Build command: `cd frontend && npm run build`

Output directory: `frontend/dist`

Phase 1 does not use Vercel Serverless Functions.
```

- [ ] **Step 3: Create backup runbook**

Create `docs/ops/firebase-backup-runbook.md`:

```md
# EasyOrder Firebase Backup Runbook

## Daily Counter Export

1. Confirm sync badge is green before export when possible.
2. Export transaction CSV for the business date.
3. Export settlement CSV for the business date.
4. Save files to the school-approved backup location.
5. If sync badge is yellow or red, export local visible data and mark the filename with `pending-sync`.

## Restore Ownership

- Counter operator owns daily export.
- Director/admin owns restore approval.
- Developer/support may assist only after director/admin approval.

## Restore Drill

1. Create a Firebase project backup through Google Cloud export or Firestore managed export if available to the account.
2. Verify transaction count, settlement count, and student count against exported CSV.
3. Do not delete production Firestore data during a drill.
```

- [ ] **Step 4: Update decision and deployment docs**

Modify `docs/superpowers/plans/2026-05-15-user-decision-checklist.md` B-series items to reflect Firebase + Vercel instead of Apps Script. Modify `docs/superpowers/plans/2026-05-15-deployment-hosting-strategy.md` so EasyOrder Phase 1 deploys as Vercel static SPA with Firebase env vars.

- [ ] **Step 5: Commit**

```bash
git add vercel.json docs/ops/firebase-vercel-setup.md docs/ops/firebase-backup-runbook.md docs/superpowers/plans/2026-05-15-user-decision-checklist.md docs/superpowers/plans/2026-05-15-deployment-hosting-strategy.md
git commit -m "docs: add Firebase Vercel operations runbooks"
```

### Task 11: End-to-end verification matrix

**Files:**

- Create: `docs/ops/firebase-sync-verification.md`
- Modify: `frontend/src/__tests__/pcPosFlow.integration.test.tsx`
- Modify: `frontend/src/__tests__/reportScreen.integration.test.tsx`

- [ ] **Step 1: Create verification matrix**

Create `docs/ops/firebase-sync-verification.md`:

```md
# Firebase Sync Verification Matrix

| Scenario | Expected Result |
|---|---|
| Google sign-in with `cheerc@talented.com.tw` and active operator doc | App opens POS. |
| Google sign-in with non-talented email | App blocks before reading Firestore data. |
| Active operator creates online order | Transaction doc created once, student balance updates once, sync badge returns green. |
| Same transaction ID retried | Existing transaction doc is treated as duplicate, no second balance update occurs. |
| Two online devices update same student | Firestore transaction retries or one client receives revision conflict; no partial write. |
| Offline payment while app is already loaded | Transaction appears locally as pending and sync badge is red/yellow until ack. |
| Offline closeout | Close attempt is saved, parent summary is promoted after reconnect if no competing attempt exists. |
| Two close attempts for same business date disagree | Closeout conflict UI blocks final close until operator resolves. |
| Student disabled after historical transaction | Historical transaction still displays student snapshot. |
| Direct student balance update without matching transaction | Firestore emulator rules reject the write. |
| Non-whitelisted or wrong-domain login | App signs the user out and displays the authorization failure. |
| Vercel production response | Includes CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, and Permissions-Policy headers. |
| Vercel production env missing Firebase key | Build or runtime config fails fast with explicit missing env var message. |
```

- [ ] **Step 2: Add integration tests for status copy**

Update `frontend/src/__tests__/pcPosFlow.integration.test.tsx` and `frontend/src/__tests__/reportScreen.integration.test.tsx` with user-visible assertions for:

```tsx
expect(screen.getByRole('status')).toHaveTextContent(/已同步|同步中|離線待同步|衝突需處理/);
```

- [ ] **Step 3: Run verification chain**

```bash
cd frontend
npm run lint
npm run build
npx vitest run
```

Expected: lint PASS, build PASS, Vitest PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/ops/firebase-sync-verification.md frontend/src/__tests__/pcPosFlow.integration.test.tsx frontend/src/__tests__/reportScreen.integration.test.tsx
git commit -m "test: document Firebase sync verification matrix"
```

## Security Rules Notes

1. The frontend whitelist is not authoritative. Firestore rules must also check `operators/{uid}.active == true` and `@talented.com.tw` email.
2. Google provider `hd=talented.com.tw` is a sign-in hint. The app and rules still verify the actual email domain.
3. Firebase web config values are not secrets. They can be stored in Vercel `VITE_FIREBASE_*` variables and bundled into the app. Firestore rules and Auth enforce access.
4. Do not store Google OAuth tokens in Zustand, localStorage, IndexedDB, or logs.
5. Student balance fields are not free-form client state. Rules must require a matching `transactions/{transactionId}` document in the same batch/transaction before accepting a projection update.
6. If App Check is added after launch, write a separate plan. It is not required for Phase 1 because Firestore Security Rules and Auth are the enforcement layer.

## Offline And Conflict Policy

| Operation | Online Behavior | Offline Behavior | Conflict Handling |
|---|---|---|---|
| Order/payment/refund | `runTransaction` reads student, writes transaction, updates balance. | Write idempotent transaction doc and queued student projection update; show pending status. | Duplicate transaction ID is accepted as duplicate. Student revision mismatch becomes conflict. |
| Student add/disable | `setDoc` / `updateDoc`. | Queued by Firestore persistence. | Last writer can update mutable roster fields; historical transactions keep snapshots. |
| Cash adjustment | `setDoc` adjustment doc. | Queued by Firestore persistence. | Duplicate adjustment ID is ignored by UI; conflicting same cash reason remains separate audit row. |
| Closeout | Online transaction promotes one close attempt to parent settlement. | Write close attempt only; parent promotion waits for online transaction. | Multiple different close attempts mark settlement conflict. |
| Backup export | Export currently visible local snapshot with sync status. | Allowed, filename includes `pending-sync`. | Director/admin decides restore source if local and remote diverge. |

## Definition Of Done

- New Firebase project config is documented and Vercel env vars are listed.
- Firebase Auth Google sign-in gates the app and rejects non-`@talented.com.tw` accounts.
- Firestore Security Rules enforce active operator whitelist and prevent hard deletion of students/transactions.
- Firestore Security Rules reject direct `students.currentBalance` or `students.revision` updates unless the same write creates the matching transaction document.
- Unauthorized, wrong-domain, inactive, or non-whitelisted Firebase users are forcibly signed out after verification.
- Firestore persistent local cache is enabled with multi-tab handling.
- Realtime `onSnapshot` listeners hydrate students, transactions, daily settlements, and cash adjustments.
- Sync badge displays `已同步`, `同步中`, `離線待同步`, or `衝突需處理` from Firestore metadata and local conflict state.
- Online order/payment/refund commits use Firestore `runTransaction` and client-generated transaction document IDs.
- Offline order/payment/refund commits visibly remain pending and reuse the same transaction ID on retry.
- Closeout can be saved offline as a close attempt and promoted online without silent last-write-wins.
- Student add/disable is implemented through Firestore, with historical transaction snapshots preserved.
- Vercel deploy uses static SPA output, `VITE_FIREBASE_*` env vars, SPA rewrites, and security headers; Phase 1 has no serverless functions.
- Backup/export runbook identifies counter operator as daily backup owner and director/admin as restore owner.
- The implementation PRs pass lint, build, unit tests, integration tests, and Firestore emulator rules tests.
