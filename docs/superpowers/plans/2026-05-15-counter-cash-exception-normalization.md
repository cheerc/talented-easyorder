# Counter Cash And Exception Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the counter POS match the real lunch-service workflow by adding daily opening cash, drawer-based settlement, context-aware quick amounts, per-order price override, and simpler operator language without adding unnecessary exception screens.

**Architecture:** Keep student balances and cash-drawer accounting separate. Student ledger transactions remain the source for orders, top-ups, cancels, corrections, and voids; a new daily cash session records the drawer opening cash and closeout snapshot. Exception handling stays inside the normal POS flow: late payment is still W/top-up, cancellation only changes effective order count, and wrong-number mistakes use the existing audit/correction path.

**Tech Stack:** React 19, TypeScript 6, Zustand 5, Vitest, Testing Library, existing EasyOrder POS domain modules.

---

## Product Decisions Locked By This Plan

- No vendor payout in Phase 1. The vendor is monthly billed and not paid from the drawer, so `vendorPayout` is intentionally excluded.
- No new "late payment backfill" screen. If a payment was missed, the operator returns to POS, selects the student, and uses W mode. The UI label becomes `補錢 / 儲值`.
- No before/after vendor-count cancellation semantics. The app shows the current effective order count; the operator handles any vendor phone update outside the system.
- Keep Q/W/E as speed shortcuts, but make the touch buttons self-explanatory first. Keyboard labels are secondary hints.
- Per-order price override affects only one transaction and must snapshot the item label, price, and reason.

## Supersedes / Uses

- Uses `docs/superpowers/plans/2026-05-15-edge-case-scenario-analysis.md` as scenario input.
- Uses `docs/superpowers/plans/2026-05-15-user-operation-sop-ux-analysis.md` as SOP input.
- Does not replace the completed design-system/PWA/accessibility plans; implementation must keep 44px+ touch targets and existing modal/focus behavior.

## File Structure

- Create `frontend/src/domain/cashSession.ts` for daily drawer session types and calculations.
- Create `frontend/src/domain/__tests__/cashSession.test.ts` for opening cash and closeout math.
- Modify `frontend/src/domain/cashClose.ts` so settlement uses drawer expected cash instead of only `totals.netCash`.
- Modify `frontend/src/domain/__tests__/cashClose.test.ts` for settlement payload changes.
- Modify `frontend/src/store/posStore.ts` to persist cash sessions and closeout snapshots.
- Modify `frontend/src/components/report/CashClosePanel.tsx` to collect/opening cash and display drawer reconciliation.
- Modify `frontend/src/components/pos-components.tsx` for dynamic quick amounts, wording, price override UI, and visible confirmation context.
- Modify `frontend/src/App.tsx` to pass override state into draft construction.
- Modify existing integration tests under `frontend/src/__tests__/` for POS, cash close, and safety flows.

---

### Task 1: Add Daily Cash Session Domain

**Files:**
- Create: `frontend/src/domain/cashSession.ts`
- Create: `frontend/src/domain/__tests__/cashSession.test.ts`

- [ ] **Step 1: Write failing tests for opening cash and drawer math**

Create `frontend/src/domain/__tests__/cashSession.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  calculateExpectedDrawerCash,
  createDailyCashSession,
  createDrawerCloseout,
} from '../cashSession';

describe('cashSession', () => {
  it('creates an open daily drawer session with opening cash only', () => {
    const session = createDailyCashSession({
      businessDate: '2026-05-15',
      openingCash: 4000,
      openedBy: 'counter',
      openedAt: '2026-05-15T08:00:00.000Z',
    });

    expect(session).toEqual({
      cashSessionId: 'cash-2026-05-15',
      businessDate: '2026-05-15',
      openingCash: 4000,
      openedBy: 'counter',
      openedAt: '2026-05-15T08:00:00.000Z',
      status: 'open',
      revision: 1,
    });
  });

  it('adds net cash to opening cash when calculating expected drawer cash', () => {
    expect(calculateExpectedDrawerCash({ openingCash: 4000, netCash: 1260 })).toBe(5260);
  });

  it('creates a closeout snapshot against expected drawer cash', () => {
    const closeout = createDrawerCloseout({
      businessDate: '2026-05-15',
      openingCash: 4000,
      netCash: 1260,
      countedCash: 5250,
      note: '少 10 元，櫃台已註記',
    });

    expect(closeout).toEqual({
      businessDate: '2026-05-15',
      openingCash: 4000,
      netCash: 1260,
      expectedDrawerCash: 5260,
      countedCash: 5250,
      difference: -10,
      note: '少 10 元，櫃台已註記',
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd frontend
npx vitest run src/domain/__tests__/cashSession.test.ts
```

Expected: FAIL because `../cashSession` does not exist.

- [ ] **Step 3: Add the domain implementation**

Create `frontend/src/domain/cashSession.ts`:

```ts
export type DailyCashSessionStatus = 'open' | 'closed';

export interface DailyCashSession {
  cashSessionId: string;
  businessDate: string;
  openingCash: number;
  openedBy: string;
  openedAt: string;
  closedAt?: string;
  closedBy?: string;
  status: DailyCashSessionStatus;
  revision: number;
}

export interface CreateDailyCashSessionInput {
  businessDate: string;
  openingCash: number;
  openedBy: string;
  openedAt: string;
}

export interface DrawerCashInput {
  openingCash: number;
  netCash: number;
}

export interface DrawerCloseout {
  businessDate: string;
  openingCash: number;
  netCash: number;
  expectedDrawerCash: number;
  countedCash: number;
  difference: number;
  note: string;
}

export function createDailyCashSession(input: CreateDailyCashSessionInput): DailyCashSession {
  return {
    cashSessionId: `cash-${input.businessDate}`,
    businessDate: input.businessDate,
    openingCash: input.openingCash,
    openedBy: input.openedBy,
    openedAt: input.openedAt,
    status: 'open',
    revision: 1,
  };
}

export function calculateExpectedDrawerCash(input: DrawerCashInput): number {
  return input.openingCash + input.netCash;
}

export function createDrawerCloseout(input: {
  businessDate: string;
  openingCash: number;
  netCash: number;
  countedCash: number;
  note: string;
}): DrawerCloseout {
  const expectedDrawerCash = calculateExpectedDrawerCash({
    openingCash: input.openingCash,
    netCash: input.netCash,
  });

  return {
    businessDate: input.businessDate,
    openingCash: input.openingCash,
    netCash: input.netCash,
    expectedDrawerCash,
    countedCash: input.countedCash,
    difference: input.countedCash - expectedDrawerCash,
    note: input.note,
  };
}

export function validateOpeningCash(value: number): { ok: true } | { ok: false; message: string } {
  if (!Number.isInteger(value) || value < 0) {
    return { ok: false, message: '開帳金額必須是 0 或正整數' };
  }
  if (value > 20000) {
    return { ok: false, message: '開帳金額異常，請確認是否輸入錯誤' };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run the domain test**

Run:

```bash
cd frontend
npx vitest run src/domain/__tests__/cashSession.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/domain/cashSession.ts frontend/src/domain/__tests__/cashSession.test.ts
git commit -m "feat: add daily cash session domain"
```

---

### Task 2: Store Daily Cash Sessions In Zustand

**Files:**
- Modify: `frontend/src/store/posStore.ts`
- Modify: `frontend/src/store/__tests__/posStore.test.ts`

- [ ] **Step 1: Add failing store tests**

Add these tests to `frontend/src/store/__tests__/posStore.test.ts`:

```ts
it('opens a cash session for the current business date', () => {
  const store = usePosStore.getState();

  store.openCashSession({
    businessDate: '2026-05-15',
    openingCash: 4000,
    operatorId: 'counter',
    openedAt: '2026-05-15T08:00:00.000Z',
  });

  const next = usePosStore.getState();
  expect(next.cashSessions['2026-05-15']).toMatchObject({
    businessDate: '2026-05-15',
    openingCash: 4000,
    status: 'open',
  });
});

it('does not overwrite an existing open cash session', () => {
  const store = usePosStore.getState();

  store.openCashSession({
    businessDate: '2026-05-15',
    openingCash: 4000,
    operatorId: 'counter',
    openedAt: '2026-05-15T08:00:00.000Z',
  });
  store.openCashSession({
    businessDate: '2026-05-15',
    openingCash: 3000,
    operatorId: 'counter',
    openedAt: '2026-05-15T08:05:00.000Z',
  });

  expect(usePosStore.getState().cashSessions['2026-05-15'].openingCash).toBe(4000);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
cd frontend
npx vitest run src/store/__tests__/posStore.test.ts
```

Expected: FAIL because `cashSessions` and `openCashSession` are not defined.

- [ ] **Step 3: Add state and action**

Modify `frontend/src/store/posStore.ts`:

```ts
import type { DailyCashSession } from '../domain/cashSession';
import { createDailyCashSession } from '../domain/cashSession';
```

Add input type near the other store input interfaces:

```ts
interface OpenCashSessionInput {
  businessDate: string;
  openingCash: number;
  operatorId: string;
  openedAt: string;
}
```

Add fields to `PosState`:

```ts
cashSessions: Record<string, DailyCashSession>;
openCashSession: (input: OpenCashSessionInput) => void;
```

Add to `defaultState`:

```ts
cashSessions: {} as Record<string, DailyCashSession>,
```

Add the action near `setVendors`:

```ts
openCashSession: (input) => {
  set((state) => {
    if (state.cashSessions[input.businessDate]) return state;

    return {
      cashSessions: {
        ...state.cashSessions,
        [input.businessDate]: createDailyCashSession({
          businessDate: input.businessDate,
          openingCash: input.openingCash,
          openedBy: input.operatorId,
          openedAt: input.openedAt,
        }),
      },
    };
  });
},
```

- [ ] **Step 4: Run store tests**

Run:

```bash
cd frontend
npx vitest run src/store/__tests__/posStore.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/posStore.ts frontend/src/store/__tests__/posStore.test.ts
git commit -m "feat: persist daily cash sessions"
```

---

### Task 3: Make Settlement Drawer-Based

**Files:**
- Modify: `frontend/src/domain/cashClose.ts`
- Modify: `frontend/src/domain/__tests__/cashClose.test.ts`
- Modify: `frontend/src/store/posStore.ts`

- [ ] **Step 1: Add failing cash close tests**

Add to `frontend/src/domain/__tests__/cashClose.test.ts`:

```ts
it('creates settlement using expected drawer cash including opening cash', () => {
  const settlement = createDailySettlement(
    '2026-05-15',
    {
      orderCount: 10,
      orderSalesAmount: 900,
      cashCollected: 1260,
      refundAmount: 0,
      netCash: 1260,
      newDebt: 0,
      topUpAmount: 360,
      cancellationCount: 0,
      transactionCount: 10,
    },
    4000,
    5260,
    '平帳',
    'counter',
    '2026-05-15T09:30:00.000Z',
    false,
  );

  expect(settlement.openingCash).toBe(4000);
  expect(settlement.expectedCash).toBe(5260);
  expect(settlement.countedCash).toBe(5260);
  expect(settlement.difference).toBe(0);
});
```

- [ ] **Step 2: Run the cash close test and verify it fails**

Run:

```bash
cd frontend
npx vitest run src/domain/__tests__/cashClose.test.ts
```

Expected: FAIL because `createDailySettlement` still expects counted cash as the third argument and has no `openingCash`.

- [ ] **Step 3: Extend settlement fields and calculation**

Modify `frontend/src/domain/cashClose.ts`.

Add `openingCash` and `netCash` to `DailySettlement`:

```ts
openingCash: number;
netCash: number;
```

Change `CashCloseDraft` to include drawer math:

```ts
export interface CashCloseDraft {
  businessDate: string;
  openingCash: number;
  netCash: number;
  expectedCash: number;
  countedCash: number;
  difference: number;
  note: string;
  queuedSettlementAccepted: boolean;
}
```

Change `createCashCloseDraft` signature and body:

```ts
export function createCashCloseDraft(
  totals: LedgerTotals,
  businessDate: string,
  openingCash: number,
  countedCash: number,
  note: string,
  queuedSettlementAccepted: boolean,
): CashCloseDraft {
  const expectedCash = openingCash + totals.netCash;
  return {
    businessDate,
    openingCash,
    netCash: totals.netCash,
    expectedCash,
    countedCash,
    difference: countedCash - expectedCash,
    note,
    queuedSettlementAccepted,
  };
}
```

Change `createDailySettlement` signature and body:

```ts
export function createDailySettlement(
  businessDate: string,
  totals: LedgerTotals,
  openingCash: number,
  countedCash: number,
  note: string,
  closedBy: string,
  closedAt: string,
  hasQueuedRows: boolean,
): DailySettlement {
  const expectedCash = openingCash + totals.netCash;
  const difference = countedCash - expectedCash;
  return {
    settlementId: `settle-${businessDate}-${closedAt}`,
    businessDate,
    status: 'closed',
    settlementRevision: 1,
    orderCount: totals.orderCount,
    transactionCount: totals.transactionCount,
    openingCash,
    netCash: totals.netCash,
    expectedCash,
    countedCash,
    difference,
    note,
    closedBy,
    closedAt,
    syncStatus: hasQueuedRows ? 'queued' : 'local',
    revision: 1,
  };
}
```

- [ ] **Step 4: Update store closeout call**

Modify `CloseBusinessDateInput` in `frontend/src/store/posStore.ts`:

```ts
interface CloseBusinessDateInput {
  businessDate: string;
  countedCash: number;
  note: string;
  queuedSettlementAccepted: boolean;
  operatorId: string;
}
```

Inside `closeBusinessDate`, derive opening cash from the session:

```ts
const cashSession = state.cashSessions[input.businessDate];
const openingCash = cashSession?.openingCash ?? 0;
const settlement = createDailySettlement(
  input.businessDate,
  totals,
  openingCash,
  input.countedCash,
  input.note,
  input.operatorId,
  now,
  hasQueuedRows,
);
```

If there is no cash session, keep `openingCash = 0` as a migration-safe fallback, but the UI in Task 4 must encourage setting it.

- [ ] **Step 5: Run cash and store tests**

Run:

```bash
cd frontend
npx vitest run src/domain/__tests__/cashClose.test.ts src/store/__tests__/posStore.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/domain/cashClose.ts frontend/src/domain/__tests__/cashClose.test.ts frontend/src/store/posStore.ts
git commit -m "feat: include opening cash in settlement"
```

---

### Task 4: Add Opening Cash UI To Cash Close

**Files:**
- Modify: `frontend/src/components/report/CashClosePanel.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/__tests__/reportScreen.integration.test.tsx`

- [ ] **Step 1: Add failing integration coverage**

In `frontend/src/__tests__/reportScreen.integration.test.tsx`, add a test that opens the report screen, enters opening cash and counted drawer cash, and expects the displayed difference to use both values:

```tsx
it('calculates closeout difference from opening cash plus today net cash', async () => {
  render(<App />);

  await userEvent.click(screen.getByRole('button', { name: /今日帳/ }));

  await userEvent.clear(screen.getByLabelText('開帳金額'));
  await userEvent.type(screen.getByLabelText('開帳金額'), '4000');
  await userEvent.clear(screen.getByLabelText('實際點算金額'));
  await userEvent.type(screen.getByLabelText('實際點算金額'), '5260');

  expect(screen.getByText('開帳金額')).toBeInTheDocument();
  expect(screen.getByText('系統應有抽屜現金')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd frontend
npx vitest run src/__tests__/reportScreen.integration.test.tsx
```

Expected: FAIL because the panel has no opening cash input or drawer expected label.

- [ ] **Step 3: Update `CashClosePanel` props and UI**

Modify `CashClosePanelProps`:

```ts
openingCash: number;
onOpeningCashChange: (openingCash: number) => void;
```

Inside the component, replace `difference` with drawer math:

```ts
const expectedDrawerCash = openingCash + totals.netCash;
const difference = countedNum - expectedDrawerCash;
```

Add an opening-cash input before the system cash display:

```tsx
<div>
  <label className="dim" htmlFor="opening-cash" style={{ fontSize: '12px', marginBottom: '4px', display: 'block' }}>
    開帳金額
  </label>
  <input
    id="opening-cash"
    aria-label="開帳金額"
    type="number"
    className="adm-input mono"
    style={{ width: '140px', fontSize: '18px' }}
    value={openingCash}
    onChange={e => onOpeningCashChange(Number(e.target.value || 0))}
  />
</div>
<div>
  <div className="dim" style={{ fontSize: '12px', marginBottom: '4px' }}>今日實收</div>
  <div className="mono" style={{ fontSize: '20px', fontWeight: 600 }}>${fmt(totals.netCash)}</div>
</div>
<div>
  <div className="dim" style={{ fontSize: '12px', marginBottom: '4px' }}>系統應有抽屜現金</div>
  <div className="mono" style={{ fontSize: '20px', fontWeight: 600 }}>${fmt(expectedDrawerCash)}</div>
</div>
```

Change the counted-cash input label and aria label:

```tsx
<label className="dim" htmlFor="counted-cash" style={{ fontSize: '12px', marginBottom: '4px', display: 'block' }}>
  實際點算金額
</label>
<input
  id="counted-cash"
  aria-label="實際點算金額"
  type="number"
  className="adm-input mono"
  style={{ width: '140px', fontSize: '18px' }}
  value={countedCash}
  placeholder="抽屜總現金"
  onChange={e => {
    const v = e.target.value;
    setCountedCash(v === '' ? '' : Number(v));
  }}
/>
```

Update the confirmation dialog rows to show:

```tsx
<div className="dialog-row"><label>開帳金額</label><span className="mono">${fmt(openingCash)}</span></div>
<div className="dialog-row"><label>今日實收</label><span className="mono">${fmt(totals.netCash)}</span></div>
<div className="dialog-row"><label>系統應有抽屜現金</label><span className="mono">${fmt(expectedDrawerCash)}</span></div>
<div className="dialog-row"><label>實際點算</label><span className="mono">${fmt(countedNum)}</span></div>
```

- [ ] **Step 4: Wire opening cash from `App.tsx`**

In `App.tsx`, select `cashSessions` and `openCashSession` from the store. Add:

```tsx
const cashSessions = usePosStore((s) => s.cashSessions);
const openCashSession = usePosStore((s) => s.openCashSession);
const currentCashSession = cashSessions[viewDate];
const openingCash = currentCashSession?.openingCash ?? 4000;

const setOpeningCash = useCallback((amount: number) => {
  openCashSession({
    businessDate: viewDate,
    openingCash: amount,
    operatorId: 'counter',
    openedAt: new Date().toISOString(),
  });
}, [openCashSession, viewDate]);
```

Pass these props to `CashClosePanel`:

```tsx
openingCash={openingCash}
onOpeningCashChange={setOpeningCash}
```

- [ ] **Step 5: Run report integration test**

Run:

```bash
cd frontend
npx vitest run src/__tests__/reportScreen.integration.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/report/CashClosePanel.tsx frontend/src/App.tsx frontend/src/__tests__/reportScreen.integration.test.tsx
git commit -m "feat: add drawer cash closeout UI"
```

---

### Task 5: Make Quick Amounts Context-Derived

**Files:**
- Modify: `frontend/src/components/pos-components.tsx`
- Modify: `frontend/src/__tests__/pcPosFlow.integration.test.tsx`

- [ ] **Step 1: Add failing test for today's price quick amount**

Add to `frontend/src/__tests__/pcPosFlow.integration.test.tsx`:

```tsx
it('uses today menu price as the first order quick amount', async () => {
  render(<App />);

  await userEvent.type(screen.getByLabelText('輸入學員編號或姓名'), '015');
  await userEvent.keyboard('{Enter}');

  const quickButtons = screen.getAllByRole('button').filter((button) => button.textContent === '90');
  expect(quickButtons.length).toBeGreaterThan(0);
});
```

If the fixture menu price changes during implementation, update the expected text to the fixture `todayMenu.price`; do not hard-code a different value in production code.

- [ ] **Step 2: Run the test**

Run:

```bash
cd frontend
npx vitest run src/__tests__/pcPosFlow.integration.test.tsx
```

Expected before implementation: existing behavior may pass when price is 90. To prove this is not accidental, change the fixture menu price in the test setup if the test harness supports store setup; otherwise add a unit-level test for the helper in Step 3.

- [ ] **Step 3: Extract quick amount helper**

In `frontend/src/components/pos-components.tsx`, add:

```ts
export function getQuickAmounts(input: {
  mode: string;
  todayPrice: number;
  currentDebt: number;
}): number[] {
  if (input.mode === 'cancel') return [input.todayPrice];
  if (input.mode === 'topup') return [100, 500, 1000, 2000, 3000];

  const amounts = [input.todayPrice, 100, 200, 500, 1000];
  if (input.currentDebt > 0) {
    amounts.splice(1, 0, input.todayPrice + input.currentDebt);
  }
  return [...new Set(amounts)].filter(amount => Number.isInteger(amount) && amount > 0);
}
```

Update the quick button render:

```tsx
{getQuickAmounts({
  mode,
  todayPrice: todayMenu.price,
  currentDebt: Math.max(0, -student.currentBalance),
}).map(v => (
  <button key={v} className="btn-quick" onClick={() => setPayAmount(String(v))}>
    {mode === 'topup' ? '+' : mode === 'cancel' ? '-' : ''}{v}
  </button>
))}
```

- [ ] **Step 4: Add helper unit coverage**

Create or update `frontend/src/components/__tests__/pos-components.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { getQuickAmounts } from '../pos-components';

describe('getQuickAmounts', () => {
  it('places today price first for order mode', () => {
    expect(getQuickAmounts({ mode: 'order', todayPrice: 85, currentDebt: 0 })[0]).toBe(85);
  });

  it('adds price plus debt as the second order quick amount when the student owes money', () => {
    expect(getQuickAmounts({ mode: 'order', todayPrice: 85, currentDebt: 170 }).slice(0, 2)).toEqual([85, 255]);
  });

  it('keeps top-up amounts independent from today price', () => {
    expect(getQuickAmounts({ mode: 'topup', todayPrice: 85, currentDebt: 0 })).toEqual([100, 500, 1000, 2000, 3000]);
  });
});
```

- [ ] **Step 5: Run tests**

Run:

```bash
cd frontend
npx vitest run src/components/__tests__/pos-components.test.tsx src/__tests__/pcPosFlow.integration.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/pos-components.tsx frontend/src/components/__tests__/pos-components.test.tsx frontend/src/__tests__/pcPosFlow.integration.test.tsx
git commit -m "feat: derive POS quick amounts from context"
```

---

### Task 6: Add Per-Order Price Override

**Files:**
- Modify: `frontend/src/components/pos-components.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/domain/posTransaction.ts`
- Modify: `frontend/src/domain/__tests__/posTransaction.test.ts`
- Modify: `frontend/src/__tests__/pcPosFlow.integration.test.tsx`

- [ ] **Step 1: Add failing domain test for override snapshot**

In `frontend/src/domain/__tests__/posTransaction.test.ts`, add:

```ts
it('uses per-order price override without changing today menu', () => {
  const draft = buildPosTransactionDraft({
    intent: {
      businessDate: '2026-05-15',
      studentId: STUDENT_001.studentId,
      type: 'order',
      mealPrice: 110,
      paidAmount: 110,
      note: '單筆改價：雞腿便當',
      sourceDevice: 'pc',
    },
    student: STUDENT_001,
    menu: TODAY_MENU_KARAAGE,
  });

  expect(draft.intent.mealPrice).toBe(110);
  expect(draft.snapshots.menu.menuNameSnapshot).toBe(TODAY_MENU_KARAAGE.itemName);
  expect(draft.amount).toBe(0);
});
```

- [ ] **Step 2: Run domain test**

Run:

```bash
cd frontend
npx vitest run src/domain/__tests__/posTransaction.test.ts
```

Expected: PASS if the domain already accepts `mealPrice` in intent; if it fails, adjust types so `mealPrice` remains an intent-level snapshot and does not mutate `TodayMenu`.

- [ ] **Step 3: Add price override UI props**

In `CustomerCardProps`, add:

```ts
priceOverride: number | null;
priceOverrideLabel: string;
setPriceOverride: (value: number | null) => void;
setPriceOverrideLabel: (value: string) => void;
```

Inside `CustomerCard`, derive:

```ts
const effectiveMealPrice = mode === 'order' ? (priceOverride ?? todayMenu.price) : 0;
```

Replace order math from `todayMenu.price` to `effectiveMealPrice`.

Add the UI inside order mode bill summary:

```tsx
{mode === 'order' && (
  <div className="price-override">
    <button
      type="button"
      className="ghost-btn"
      onClick={() => setPriceOverride(priceOverride ?? todayMenu.price)}
    >
      改本筆價格
    </button>
    {priceOverride !== null && (
      <div className="price-override-fields">
        <label>
          <span>本筆價格</span>
          <input
            className="adm-input mono"
            type="number"
            aria-label="本筆價格"
            value={priceOverride}
            onChange={e => setPriceOverride(Number(e.target.value || todayMenu.price))}
          />
        </label>
        <label>
          <span>品項/原因</span>
          <input
            className="adm-input"
            aria-label="品項或原因"
            value={priceOverrideLabel}
            onChange={e => setPriceOverrideLabel(e.target.value)}
            placeholder="例如：雞腿便當"
          />
        </label>
        <button type="button" className="ghost-btn" onClick={() => setPriceOverride(null)}>
          取消改價
        </button>
      </div>
    )}
  </div>
)}
```

Use existing button/input classes and adjust CSS only if spacing or 44px touch target breaks.

- [ ] **Step 4: Wire override state in `App.tsx`**

Add state:

```tsx
const [priceOverride, setPriceOverride] = useState<number | null>(null);
const [priceOverrideLabel, setPriceOverrideLabel] = useState('');
```

Reset override when selecting a different student or cancelling:

```tsx
setPriceOverride(null);
setPriceOverrideLabel('');
```

When building the draft, change:

```ts
const mealPrice = state.mode === 'order' ? (priceOverride ?? todayMenu.price) : 0;
const note =
  state.mode === 'order' && priceOverride !== null
    ? `單筆改價：${priceOverrideLabel.trim() || todayMenu.itemName}`
    : state.mode === 'order'
      ? todayMenu.itemName
      : state.mode;
```

Pass props into `CustomerCard`:

```tsx
priceOverride={priceOverride}
priceOverrideLabel={priceOverrideLabel}
setPriceOverride={setPriceOverride}
setPriceOverrideLabel={setPriceOverrideLabel}
```

- [ ] **Step 5: Add integration test**

In `frontend/src/__tests__/pcPosFlow.integration.test.tsx`, add:

```tsx
it('allows changing only the selected order price before commit', async () => {
  render(<App />);

  await userEvent.type(screen.getByLabelText('輸入學員編號或姓名'), '015');
  await userEvent.keyboard('{Enter}');
  await userEvent.click(screen.getByRole('button', { name: '改本筆價格' }));
  await userEvent.clear(screen.getByLabelText('本筆價格'));
  await userEvent.type(screen.getByLabelText('本筆價格'), '110');
  await userEvent.type(screen.getByLabelText('品項或原因'), '雞腿便當');

  expect(screen.getByText(/110/)).toBeInTheDocument();
});
```

- [ ] **Step 6: Run POS tests**

Run:

```bash
cd frontend
npx vitest run src/domain/__tests__/posTransaction.test.ts src/__tests__/pcPosFlow.integration.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/pos-components.tsx frontend/src/App.tsx frontend/src/domain/posTransaction.ts frontend/src/domain/__tests__/posTransaction.test.ts frontend/src/__tests__/pcPosFlow.integration.test.tsx
git commit -m "feat: support per-order price override"
```

---

### Task 7: Simplify Operator Language And Confirmations

**Files:**
- Modify: `frontend/src/components/pos-components.tsx`
- Modify: `frontend/src/__tests__/pcPosSafety.integration.test.tsx`

- [ ] **Step 1: Add failing language test**

Add to `frontend/src/__tests__/pcPosSafety.integration.test.tsx`:

```tsx
it('uses operator-friendly payment wording', async () => {
  render(<App />);

  await userEvent.type(screen.getByLabelText('輸入學員編號或姓名'), '015');
  await userEvent.keyboard('{Enter}');

  expect(screen.getByRole('button', { name: /補錢 \/ 儲值/ })).toBeInTheDocument();
  expect(screen.queryByText(/純繳費/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the safety test**

Run:

```bash
cd frontend
npx vitest run src/__tests__/pcPosSafety.integration.test.tsx
```

Expected: FAIL while `純繳費 / 儲值` is still rendered.

- [ ] **Step 3: Rename the visible W action label**

In `ActionBar`, change:

```ts
{ id: 'topup', label: '補錢 / 儲值', hint: 'W' },
```

In `CustomerCard`, change the top-up payment header:

```tsx
{mode === 'order' ? '本次繳費' : mode === 'topup' ? '補錢 / 儲值金額' : '退還現金'}
```

Do not rename the internal `topup` transaction type.

- [ ] **Step 4: Keep wrong-number mitigation simple**

In `CustomerCard`, ensure the selected student confirmation remains large and visible:

```tsx
<div className="cust-id mono">{student.studentId}</div>
<div className="cust-name">{student.displayName}</div>
```

Do not add a separate wrong-number workflow. Wrong-number repair uses the existing correction/void audit path.

- [ ] **Step 5: Run the safety test**

Run:

```bash
cd frontend
npx vitest run src/__tests__/pcPosSafety.integration.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/pos-components.tsx frontend/src/__tests__/pcPosSafety.integration.test.tsx
git commit -m "copy: simplify POS payment wording"
```

---

### Task 8: Final Verification

**Files:**
- All files touched in Tasks 1-7

- [ ] **Step 1: Run TypeScript**

```bash
cd frontend
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 2: Run lint**

```bash
cd frontend
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Run tests**

```bash
cd frontend
npx vitest run
```

Expected: PASS.

- [ ] **Step 4: Build**

```bash
cd frontend
npm run build
```

Expected: PASS.

- [ ] **Step 5: Run diff checks**

```bash
git diff --check
git status --short
```

Expected: `git diff --check` prints no errors. `git status --short` shows only intentional files.

- [ ] **Step 6: Commit final fixes if needed**

```bash
git add frontend/src docs/superpowers/plans
git commit -m "test: verify counter cash normalization"
```

Only create this commit if verification required code or test adjustments after the task commits.

## Definition Of Done

- Daily closeout compares counted drawer cash against opening cash plus the day's net cash.
- Opening cash defaults to the real current operating assumption but can be changed per day.
- POS order quick amounts derive from today's menu price.
- A single order can override price without changing the global menu.
- The W action says `補錢 / 儲值`.
- Late payment uses W mode; no extra backfill UI exists.
- Cancel flow shows current effective order count; no vendor-count lock is introduced.
- Tests cover domain math, store persistence, POS quick amounts, price override, wording, and closeout UI.
