# Frontend Performance Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 Talented EasyOrder 前端在 200+ 筆交易日、iPad Safari、校園低階 PC 上仍能維持 POS 快速確認、報表可捲動、PWA 可穩定載入，且不改變帳務語義。

**Architecture:** 先建立可重複的效能量測與 200+ 交易 fixture，再把「會讓全 App 重繪」的 Zustand 訂閱切成 selector，並把交易日報表投影、學生搜尋、今日交易統計改成 memoized domain projection。報表與近期交易列表使用虛擬化，非 POS 工作區用 React route/component lazy loading，bundle 透過 Vite/Rollup 分析後才拆 chunk。

**Tech Stack:** Vite 8, React 19, TypeScript 6, Zustand 5, Vitest 4, Testing Library, TanStack Virtual, React.lazy/Suspense, Rollup manual chunks, Web Performance APIs, iPad Safari/WebKit verification.

---

## Required Reads Completed

- `docs/superpowers/plans/ROADMAP.md`
- `docs/superpowers/plans/2026-05-15-free-backend-architecture-exploration.md`
- `docs/superpowers/plans/2026-05-15-deployment-hosting-strategy.md`
- `docs/superpowers/plans/2026-05-15-pwa-offline-first-strategy.md`
- `docs/superpowers/plans/2026-05-15-user-operation-sop-ux-analysis.md`
- `docs/superpowers/specs/2026-05-14-pc-pos-order-flow-spec.md`
- `docs/superpowers/specs/2026-05-14-order-ledger-cash-close-spec.md`
- `docs/superpowers/specs/2026-05-14-google-sheets-sync-offline-spec.md`
- `docs/superpowers/specs/2026-05-14-ipad-face-auth-handoff-spec.md`
- `frontend/package.json`
- `frontend/vite.config.ts`
- `frontend/src/App.tsx`
- `frontend/src/store/posStore.ts`
- `frontend/src/components/pos-components.tsx`
- `frontend/src/components/screens.tsx`
- `frontend/src/components/tweaks-panel.tsx`
- `frontend/src/index.css`

Requested but unavailable on 2026-05-15:

- `/Users/cheerc/talented-easyorder/docs/superpowers/specs/talented-easyorder-spec.pdf`
- `docs/superpowers/specs/talented-easyorder-spec.pdf`

Replacement source of truth used for this plan: the markdown specs above, current frontend code, and earlier approved plans.

## Official Sources Checked On 2026-05-15

- React `memo`: https://react.dev/reference/react/memo
- React `useMemo`: https://react.dev/reference/react/useMemo
- React `lazy`: https://react.dev/reference/react/lazy
- React `Suspense`: https://react.dev/reference/react/Suspense
- Zustand `useShallow`: https://zustand.docs.pmnd.rs/guides/prevent-rerenders-with-use-shallow
- Zustand `useStore`: https://zustand.docs.pmnd.rs/hooks/use-store
- TanStack Virtual React adapter: https://tanstack.com/virtual/latest/docs/framework/react/react-virtual
- Vite production build guide: https://vite.dev/guide/build
- Vite build options: https://vite.dev/config/build-options
- Rollup `output.manualChunks`: https://rollupjs.org/configuration-options/#output-manualchunks
- MDN lazy loading: https://developer.mozilla.org/en-US/docs/Web/Performance/Lazy_loading
- MDN responsive images: https://developer.mozilla.org/en-US/docs/Learn/HTML/Multimedia_and_embedding/Responsive_images
- WebKit iOS/iPadOS Home Screen web apps: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/

## Current Performance Risk Inventory

| Area | Current State | Performance Risk | Plan Response |
|---|---|---|---|
| Store subscription | `App.tsx` destructures nearly the full Zustand state and actions from `usePosStore()` in one call. | Any transaction/menu/vendor/student update can re-render the whole shell and all active screen props. | Add selector hooks and shallow action selectors. Split POS, report, admin, and vendor subscriptions. |
| Day transaction projection | `App.tsx` filters `allTx` by `businessDate` and reverses on every `allTx/viewDate` change. `ReportScreen` groups again. | 200+ rows are still small, but repeated filter/group/reverse creates avoidable work during POS confirmation and tab switches. | Add domain projection functions with tests: `selectTransactionsByDate`, `buildLedgerDayProjection`, `countCancelableOrdersForStudent`. |
| Duplicate order count | `orderedTodayCount` runs two filters plus reduce for the picked student. | Recomputes from full day rows after each transaction and can grow with the ledger. | Use a projection indexed by `studentId`, then read `orderCount/cancelCount/netCancelableOrders`. |
| Report table | `ReportScreen` renders every grouped row and all expanded detail rows directly. | Large days and expanded students create layout/reconciliation spikes and scroll jank on iPad Safari. | Virtualize grouped rows first; detail rows are rendered inside the virtual row only when expanded. |
| Recent strip | `RecentStrip` receives `tx.slice().reverse().map(...)` from `App.tsx`. | Allocates new objects each render and can grow without a visible bound. | Cap recent rows and derive stable `uid` from `transactionId`; virtualize if the UI becomes vertical history. |
| Route loading | POS, report, admin, vendors, tweaks panel are all imported eagerly. | Initial bundle includes code that is not needed for lunch rush first paint. | Keep POS eager; lazy-load report/admin/vendors/tweaks. |
| CSS | `frontend/src/index.css` is about 1,925 LOC with all screen styles together. | All CSS ships up front; heavy effects can cost paint on iPad Safari. | Defer CSS split until design-system work, but reduce heavy paint and prefer contained layouts now. |
| Images/assets | `hero.png`, `react.svg`, and `vite.svg` exist in assets. | Large or unused assets increase app-shell precache and initial transfer. | Audit actual imports; remove unused starter assets; compress and size visible images. |
| Bundle visibility | No bundle analyzer, chunk budget, or CI guard. | Performance regressions are invisible until a device feels slow. | Add `analyze` script and bundle budget notes. |

## Target Performance Budgets

Use these as first budgets; update after measuring real campus hardware.

| Scenario | Budget | Measurement Method |
|---|---:|---|
| Cold production load on school PC after cache clear | Initial JS gzip under 250 KB before PWA service worker; total app-shell transfer under 600 KB excluding screenshots. | `npm run build`, Vite output, optional visualizer. |
| POS search keystroke with 500 students | p95 render/update under 50 ms. | Vitest render benchmark plus manual Chrome Performance profile. |
| Confirm transaction on 200-row business day | p95 UI update under 100 ms; no perceptible input lock. | Perf harness around `processTransaction` plus React Profiler/manual timing. |
| Open report on 200-row business day | p95 under 300 ms before first usable table. | Production build, browser Performance mark. |
| Report scroll | Sustained 50+ fps on target iPad Safari. | Web Inspector timeline or manual scroll recording. |
| PWA app-shell cache size | Under 5 MB first release; no unused starter assets. | Cache Storage inspection after PWA plan implementation. |

## Data Shape And Rendering Strategy

### Domain Projection Boundary

Performance-sensitive UI should not repeatedly derive ledger groups inside React render bodies. Introduce pure functions in `frontend/src/domain/ledgerProjection.ts` and test them independently.

```ts
import type { LedgerTransaction } from './ledger';

export interface StudentDayProjection {
  studentId: string;
  studentNameSnapshot: string;
  mealPrice: number;
  paidAmount: number;
  afterBalance: number;
  lastCreatedAt: string;
  transactions: LedgerTransaction[];
  orderCount: number;
  cancelCount: number;
  netCancelableOrders: number;
}

export interface LedgerDayProjection {
  businessDate: string;
  transactionsNewestFirst: LedgerTransaction[];
  totals: {
    orderAmount: number;
    paidAmount: number;
    newDebtAmount: number;
    orderCount: number;
  };
  studentsNewestFirst: StudentDayProjection[];
  byStudentId: Map<string, StudentDayProjection>;
}

export function buildLedgerDayProjection(
  transactions: LedgerTransaction[],
  businessDate: string,
  currentMenuPrice: number
): LedgerDayProjection {
  const rows = transactions
    .filter((transaction) => transaction.businessDate === businessDate)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const byStudentId = new Map<string, StudentDayProjection>();
  const totals = { orderAmount: 0, paidAmount: 0, newDebtAmount: 0, orderCount: 0 };

  for (const transaction of rows) {
    if (transaction.type === 'order') {
      totals.orderAmount += transaction.mealPrice || 0;
      totals.orderCount += 1;
      if ((transaction.mealPrice || 0) > (transaction.paidAmount || 0)) {
        totals.newDebtAmount += (transaction.mealPrice || 0) - (transaction.paidAmount || 0);
      }
    }
    if ((transaction.paidAmount || 0) > 0) totals.paidAmount += transaction.paidAmount || 0;

    const existing = byStudentId.get(transaction.studentId);
    const projection = existing ?? {
      studentId: transaction.studentId,
      studentNameSnapshot: transaction.studentNameSnapshot,
      mealPrice: 0,
      paidAmount: 0,
      afterBalance: transaction.afterBalance,
      lastCreatedAt: transaction.createdAt,
      transactions: [],
      orderCount: 0,
      cancelCount: 0,
      netCancelableOrders: 0,
    };

    projection.mealPrice += transaction.mealPrice || 0;
    projection.paidAmount += transaction.paidAmount || 0;
    projection.afterBalance = projection.transactions.length === 0 ? transaction.afterBalance : projection.afterBalance;
    projection.lastCreatedAt = projection.transactions.length === 0 ? transaction.createdAt : projection.lastCreatedAt;
    projection.transactions.push(transaction);
    if (transaction.type === 'order') projection.orderCount += 1;
    if (transaction.type === 'cancel') projection.cancelCount += countCancelQuantity(transaction, currentMenuPrice);
    projection.netCancelableOrders = Math.max(0, projection.orderCount - projection.cancelCount);

    byStudentId.set(transaction.studentId, projection);
  }

  return {
    businessDate,
    transactionsNewestFirst: rows,
    totals,
    studentsNewestFirst: Array.from(byStudentId.values()),
    byStudentId,
  };
}

export function countCancelQuantity(transaction: LedgerTransaction, menuPrice: number): number {
  if (transaction.type !== 'cancel') return 0;
  if (menuPrice <= 0) return 0;
  return Math.abs((transaction.mealPrice || 0) / menuPrice);
}
```

Cancel quantity must stay explicit through `currentMenuPrice`; do not infer quantity from display strings.

### Zustand Selector Boundary

Create `frontend/src/store/posSelectors.ts` so screens subscribe only to the data they render.

```ts
import { useShallow } from 'zustand/react/shallow';
import { usePosStore } from './posStore';

export const useStudents = () => usePosStore((state) => state.students);
export const useTransactions = () => usePosStore((state) => state.transactions);
export const useTodayMenu = () => usePosStore((state) => state.todayMenu);
export const useVendors = () => usePosStore((state) => state.vendors);

export const usePosActions = () => usePosStore(useShallow((state) => ({
  processTransaction: state.processTransaction,
  updateTransaction: state.updateTransaction,
  deleteTransaction: state.deleteTransaction,
  setTodayMenu: state.setTodayMenu,
  setVendors: state.setVendors,
  resetData: state.resetData,
})));
```

Implementation note: selectors reduce React re-render fan-out; they do not reduce persistence write cost. Moving durable ledger storage from `localStorage` to IndexedDB remains part of Phase 1.3/PWA architecture and should not be duplicated here.

### Virtualization Boundary

Use TanStack Virtual only where row count can grow enough to matter. Do not virtualize the core POS mode buttons or small admin forms.

Recommended first virtualized areas:

1. Report grouped student rows in `ReportScreen`.
2. Expanded report detail rows if a single student has many same-day transactions.
3. Future full-history ledger view.

Keep the confirmation flow and search suggestion list non-virtualized because they should stay visually stable and small.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `frontend/src/performance/ledgerFixtures.ts` | Create | Generate deterministic student and transaction datasets for 200/500/1000-row tests and manual demos. |
| `frontend/src/performance/renderBudget.ts` | Create | Small browser-safe helper for named `performance.mark` and budget assertions in dev/test. |
| `frontend/src/domain/ledgerProjection.ts` | Create | Pure, tested ledger-day projections for report totals, grouped rows, and per-student order counts. |
| `frontend/src/domain/ledgerProjection.test.ts` | Create | Verify projections preserve current accounting semantics and are stable under 200+ rows. |
| `frontend/src/store/posSelectors.ts` | Create | Export selector hooks and shallow action selectors. |
| `frontend/src/components/virtual/VirtualLedgerList.tsx` | Create | Render virtualized report rows with expandable detail regions. |
| `frontend/src/components/virtual/VirtualLedgerList.test.tsx` | Create | Verify visible rows, expansion, keyboard activation, and no full-list DOM explosion. |
| `frontend/src/components/screens.tsx` | Modify | Use `LedgerDayProjection` and `VirtualLedgerList`; remove duplicate grouping and `confirm()` in later design-system plan if not done here. |
| `frontend/src/components/pos-components.tsx` | Modify | Stabilize `RecentStrip`, avoid allocating derived row IDs from array index. |
| `frontend/src/App.tsx` | Modify | Use selectors, day projection, capped recent list, and lazy-loaded non-POS screens. |
| `frontend/src/App.test.tsx` | Create or modify | Verify POS flow still renders after lazy boundary and report tab loads. |
| `frontend/vite.config.ts` | Modify | Add explicit `manualChunks` only after analyzer confirms need. |
| `frontend/package.json` | Modify | Add `@tanstack/react-virtual`, optional `rollup-plugin-visualizer`, and scripts for bundle analysis. |
| `frontend/src/index.css` | Modify | Add containment and reduce expensive paint only where measured. |
| `frontend/src/assets/*` | Modify | Remove unused starter SVGs if no import references remain; compress/replace large images only with before/after size evidence. |

## Implementation Plan

### Task 1: Add deterministic performance fixtures and budgets

**Files:**

- Create: `frontend/src/performance/ledgerFixtures.ts`
- Create: `frontend/src/performance/renderBudget.ts`
- Create: `frontend/src/performance/renderBudget.test.ts`
- Modify: `frontend/package.json`

- [ ] **Step 1: Add deterministic ledger fixture generator**

```ts
import type { LedgerTransaction } from '../domain/ledger';
import type { StudentAccount } from '../domain/student';

const baseDate = '2026-05-15';

export function createStudentFixture(count: number): StudentAccount[] {
  return Array.from({ length: count }, (_, index) => ({
    studentId: String(index + 1).padStart(3, '0'),
    displayName: `測試學生 ${index + 1}`,
    status: 'active',
    currentBalance: (index % 7) * -10,
    aliases: [],
    faceEnrollmentStatus: 'none',
    createdAt: '2026-01-10T08:00:00.000Z',
    updatedAt: '2026-01-10T08:00:00.000Z',
    revision: 1,
  }));
}

export function createLedgerFixture(rowCount: number, studentCount = 80): LedgerTransaction[] {
  const students = createStudentFixture(studentCount);

  return Array.from({ length: rowCount }, (_, index) => {
    const student = students[index % students.length];
    const minute = String(index % 60).padStart(2, '0');
    const second = String((index * 7) % 60).padStart(2, '0');
    const mealPrice = index % 5 === 0 ? 0 : 85;
    const paidAmount = index % 3 === 0 ? 85 : 0;
    const amount = paidAmount - mealPrice;
    const afterBalance = student.currentBalance + amount;

    return {
      transactionId: `fixture-tx-${index + 1}`,
      businessDate: baseDate,
      createdAt: `${baseDate}T12:${minute}:${second}.000Z`,
      studentId: student.studentId,
      studentNameSnapshot: student.displayName,
      type: mealPrice === 0 ? 'topup' : 'order',
      mealPrice,
      paidAmount,
      amount,
      afterBalance,
      menuNameSnapshot: '雞腿便當',
      vendorNameSnapshot: '測試供應商',
      sourceDevice: 'pc',
      syncStatus: 'local',
      revision: 1,
      note: mealPrice === 0 ? '現金儲值' : '雞腿便當',
    } satisfies LedgerTransaction;
  });
}
```

- [ ] **Step 2: Add a small render budget helper**

```ts
export interface BudgetResult {
  name: string;
  durationMs: number;
  budgetMs: number;
  pass: boolean;
}

export function measureBudget<T>(name: string, budgetMs: number, run: () => T): { value: T; result: BudgetResult } {
  const startedAt = performance.now();
  const value = run();
  const durationMs = performance.now() - startedAt;

  return {
    value,
    result: {
      name,
      durationMs,
      budgetMs,
      pass: durationMs <= budgetMs,
    },
  };
}
```

- [ ] **Step 3: Add a deterministic helper test**

```ts
import { describe, expect, it } from 'vitest';
import { measureBudget } from './renderBudget';

it('reports a named budget result', () => {
  const { value, result } = measureBudget('unit-fast-path', 25, () => 42);

  expect(value).toBe(42);
  expect(result.name).toBe('unit-fast-path');
  expect(result.budgetMs).toBe(25);
  expect(result.pass).toBe(true);
});
```

- [ ] **Step 4: Run the focused tests**

```bash
cd frontend
npx vitest run src/performance/renderBudget.test.ts
```

Expected: the test file passes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/performance frontend/package.json package-lock.json
git commit -m "test: add frontend performance fixtures"
```

### Task 2: Move ledger projection out of React render bodies

**Files:**

- Create: `frontend/src/domain/ledgerProjection.ts`
- Create: `frontend/src/domain/ledgerProjection.test.ts`
- Modify: `frontend/src/components/screens.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Write projection tests for current semantics**

```ts
import { describe, expect, it } from 'vitest';
import { createLedgerFixture } from '../performance/ledgerFixtures';
import { buildLedgerDayProjection } from './ledgerProjection';

it('groups a 200-row business day by student without losing transaction rows', () => {
  const tx = createLedgerFixture(200, 50);
  const projection = buildLedgerDayProjection(tx, '2026-05-15', 85);

  expect(projection.transactionsNewestFirst).toHaveLength(200);
  expect(projection.studentsNewestFirst.length).toBeLessThanOrEqual(50);
  expect(Array.from(projection.byStudentId.values()).reduce((sum, row) => sum + row.transactions.length, 0)).toBe(200);
});

it('calculates report totals from ledger rows', () => {
  const tx = createLedgerFixture(12, 4);
  const projection = buildLedgerDayProjection(tx, '2026-05-15', 85);

  expect(projection.totals.orderCount).toBe(tx.filter((row) => row.type === 'order').length);
  expect(projection.totals.orderAmount).toBe(tx.reduce((sum, row) => sum + (row.type === 'order' ? row.mealPrice : 0), 0));
  expect(projection.totals.paidAmount).toBe(tx.reduce((sum, row) => sum + Math.max(0, row.paidAmount || 0), 0));
});
```

- [ ] **Step 2: Implement `buildLedgerDayProjection`**

Use the domain projection boundary shown earlier in this plan. Keep cancel quantity explicit through the current menu price:

```ts
export function countCancelQuantity(transaction: LedgerTransaction, menuPrice: number): number {
  if (transaction.type !== 'cancel') return 0;
  if (menuPrice <= 0) return 0;
  return Math.abs((transaction.mealPrice || 0) / menuPrice);
}
```

- [ ] **Step 3: Replace `ReportScreen` totals and grouping props**

Change `ReportScreen` props from raw `tx` grouping ownership to projection ownership:

```ts
interface ReportScreenProps {
  projection: LedgerDayProjection;
  onUpdate: (id: string, data: Partial<LedgerTransaction>) => void;
  onDelete: (id: string) => void;
  todayMenu: TodayMenu;
  viewDate: string;
}
```

Inside the component:

```ts
const tx = projection.transactionsNewestFirst;
const totals = projection.totals;
const grouped = projection.studentsNewestFirst;
const orderCount = projection.totals.orderCount;
```

- [ ] **Step 4: Build the projection once in `App.tsx`**

```ts
const dayProjection = useMemo(() => {
  return buildLedgerDayProjection(allTx, viewDate, todayMenu.price);
}, [allTx, viewDate, todayMenu.price]);

const orderedTodayCount = useMemo(() => {
  if (!picked) return 0;
  return dayProjection.byStudentId.get(picked.studentId)?.netCancelableOrders ?? 0;
}, [dayProjection, picked]);
```

- [ ] **Step 5: Run focused projection and screen tests**

```bash
cd frontend
npx vitest run src/domain/ledgerProjection.test.ts src/components/screens.test.tsx
```

Expected: projection tests pass; if `screens.test.tsx` does not exist yet, add the first render test in Task 4 instead of skipping verification.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/domain/ledgerProjection.ts frontend/src/domain/ledgerProjection.test.ts frontend/src/components/screens.tsx frontend/src/App.tsx
git commit -m "perf: add ledger day projection"
```

### Task 3: Split Zustand subscriptions with selectors

**Files:**

- Create: `frontend/src/store/posSelectors.ts`
- Create: `frontend/src/store/posSelectors.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/screens.tsx` only if screens start reading store directly

- [ ] **Step 1: Add selector hooks**

Use the `useStudents`, `useTransactions`, `useTodayMenu`, `useVendors`, and `usePosActions` implementation shown earlier.

- [ ] **Step 2: Replace broad `usePosStore()` in `App.tsx`**

```ts
const students = useStudents();
const allTx = useTransactions();
const todayMenu = useTodayMenu();
const vendors = useVendors();
const {
  processTransaction,
  updateTransaction,
  deleteTransaction,
  setTodayMenu,
  setVendors,
  resetData,
} = usePosActions();
```

- [ ] **Step 3: Add selector stability test**

```tsx
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePosActions } from './posSelectors';

it('keeps action selector identity stable across rerenders', () => {
  const { result, rerender } = renderHook(() => usePosActions());
  const first = result.current;

  rerender();

  expect(result.current).toBe(first);
});
```

- [ ] **Step 4: Run focused tests**

```bash
cd frontend
npx vitest run src/store/posSelectors.test.tsx
```

Expected: selector identity test passes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/posSelectors.ts frontend/src/store/posSelectors.test.tsx frontend/src/App.tsx
git commit -m "perf: split pos store selectors"
```

### Task 4: Virtualize report rows

**Files:**

- Modify: `frontend/package.json`
- Modify: `package-lock.json`
- Create: `frontend/src/components/virtual/VirtualLedgerList.tsx`
- Create: `frontend/src/components/virtual/VirtualLedgerList.test.tsx`
- Modify: `frontend/src/components/screens.tsx`
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Add dependency**

```bash
cd frontend
npm install @tanstack/react-virtual
```

- [ ] **Step 2: Create virtualized ledger list**

```tsx
import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { StudentDayProjection } from '../../domain/ledgerProjection';

interface VirtualLedgerListProps {
  rows: StudentDayProjection[];
  expandedIds: Set<string>;
  onToggle: (studentId: string) => void;
  renderRow: (row: StudentDayProjection, isExpanded: boolean) => React.ReactNode;
}

export function VirtualLedgerList({ rows, expandedIds, onToggle, renderRow }: VirtualLedgerListProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  // React 19: explicitly disable useFlushSync to avoid console warnings
  // and unnecessary synchronous layout flushes on iPad Safari scroll.
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => expandedIds.has(rows[index].studentId) ? 220 : 52,
    overscan: 8,
    useFlushSync: false,
  });

  return (
    <div ref={parentRef} className="virtual-ledger" data-testid="virtual-ledger">
      <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          const isExpanded = expandedIds.has(row.studentId);

          return (
            <div
              key={row.studentId}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
              className="virtual-ledger-row"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onToggle(row.studentId);
                }
              }}
            >
              {renderRow(row, isExpanded)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add virtual list CSS**

```css
.virtual-ledger {
  max-height: min(68vh, 720px);
  overflow: auto;
  contain: layout paint;
}

.virtual-ledger-row {
  left: 0;
  position: absolute;
  top: 0;
  width: 100%;
  will-change: transform;
}
```

- [ ] **Step 4: Add DOM-size test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createLedgerFixture } from '../../performance/ledgerFixtures';
import { buildLedgerDayProjection } from '../../domain/ledgerProjection';
import { VirtualLedgerList } from './VirtualLedgerList';

it('renders only a window of ledger rows for a large day', () => {
  const projection = buildLedgerDayProjection(createLedgerFixture(500, 200), '2026-05-15', 85);

  render(
    <VirtualLedgerList
      rows={projection.studentsNewestFirst}
      expandedIds={new Set()}
      onToggle={vi.fn()}
      renderRow={(row) => <div data-testid="ledger-row">{row.studentNameSnapshot}</div>}
    />
  );

  expect(screen.getByTestId('virtual-ledger')).toBeInTheDocument();
  expect(screen.getAllByTestId('ledger-row').length).toBeLessThan(projection.studentsNewestFirst.length);
});
```

- [ ] **Step 5: Integrate in `ReportScreen`**

Replace the direct `{grouped.map(...)}` block with `VirtualLedgerList`. Keep the existing row markup by moving it into a local `renderLedgerRow` function, then pass `expandedSids`, `toggleExpand`, and the render function to the virtual list.

- [ ] **Step 6: Run focused tests and typecheck**

```bash
cd frontend
npx vitest run src/components/virtual/VirtualLedgerList.test.tsx src/domain/ledgerProjection.test.ts
npx tsc --noEmit
```

Expected: tests and TypeScript pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json package-lock.json frontend/src/components/virtual frontend/src/components/screens.tsx frontend/src/index.css
git commit -m "perf: virtualize ledger report rows"
```

### Task 5: Lazy-load non-POS workspaces and keep POS eager

**Files:**

- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/components/lazyScreens.tsx`
- Create: `frontend/src/App.lazy.test.tsx`
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Extract lazy screen imports**

```tsx
import { lazy } from 'react';

export const ReportScreenLazy = lazy(() => import('./screens').then((module) => ({ default: module.ReportScreen })));
export const AdminScreenLazy = lazy(() => import('./screens').then((module) => ({ default: module.AdminScreen })));
export const VendorsScreenLazy = lazy(() => import('./screens').then((module) => ({ default: module.VendorsScreen })));

// Lazy-load the entire tweaks workspace (TweaksPanel + TweakSection + TweakRadio)
// so all tweaks code is excluded from the initial POS route bundle.
export const TweaksWorkspaceLazy = lazy(() => import('./tweaks-panel').then((module) => ({
  default: module.TweaksPanel,
  // TweakSection and TweakRadio are used inside TweaksPanel's children in App.tsx,
  // so they must also be part of this lazy chunk. Since they are in the same module,
  // the dynamic import already captures them. App.tsx must move the TweakSection/TweakRadio
  // usage into a wrapper component inside this lazy boundary.
})));
```

- [ ] **Step 2: Wrap non-POS workspaces in Suspense**

Note: `App.tsx` currently imports `TweaksPanel`, `TweakSection`, and `TweakRadio` eagerly (line 15) and uses them inline (lines 349-365). To properly lazy-load tweaks, extract the entire tweaks usage block into a new `TweaksWorkspace` component in `tweaks-panel.tsx` that owns its own `TweakSection`/`TweakRadio` children, then lazy-load that single component. This ensures no tweaks code remains in the eager bundle.

```tsx
import { Suspense } from 'react';
import { ReportScreenLazy, AdminScreenLazy, VendorsScreenLazy, TweaksWorkspaceLazy } from './components/lazyScreens';

function WorkspaceFallback() {
  return <div className="workspace-fallback" role="status">載入工作區中…</div>;
}

// Inside App render:
<Suspense fallback={<WorkspaceFallback />}>
  {tab === 'report' && <ReportScreenLazy projection={dayProjection} onUpdate={updateTransaction} onDelete={deleteTransaction} todayMenu={todayMenu} viewDate={viewDate} />}
  {tab === 'admin' && <AdminScreenLazy todayMenu={todayMenu} setTodayMenu={setTodayMenu} vendors={vendors} students={students} resetData={resetData} />}
  {tab === 'vendors' && <VendorsScreenLazy vendors={vendors} setVendors={setVendors} />}
</Suspense>
```

Keep the POS search, customer card, action bar, and confirmation banner imported eagerly.

- [ ] **Step 3: Add fallback CSS**

```css
.workspace-fallback {
  align-items: center;
  border: 1px dashed var(--line);
  border-radius: 24px;
  color: var(--ink-2);
  display: flex;
  min-height: 240px;
  justify-content: center;
}
```

- [ ] **Step 4: Add lazy boundary test**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

it('keeps POS visible and loads report workspace through the lazy boundary', async () => {
  render(<App />);

  expect(screen.getByRole('textbox')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /報表|F2/ }));

  expect(await screen.findByText(/訂餐金額|今日/)).toBeInTheDocument();
});
```

- [ ] **Step 5: Run tests and production build**

```bash
cd frontend
npx vitest run src/App.lazy.test.tsx
npm run build
```

Expected: test passes; production build emits separate chunks for lazy screens.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.lazy.test.tsx frontend/src/components/lazyScreens.tsx frontend/src/index.css
git commit -m "perf: lazy load non-pos workspaces"
```

### Task 6: Add bundle analysis and chunk budget

**Files:**

- Modify: `frontend/package.json`
- Modify: `package-lock.json`
- Modify: `frontend/vite.config.ts`
- Create: `docs/performance/frontend-bundle-budget.md`

- [ ] **Step 1: Add analyzer dependency and script**

```bash
cd frontend
npm install -D rollup-plugin-visualizer
npm pkg set scripts.analyze="ANALYZE=true vite build"
```

- [ ] **Step 2: Gate visualizer by env var**

```ts
import { visualizer } from 'rollup-plugin-visualizer';

const analyze = process.env.ANALYZE === 'true';

export default defineConfig({
  plugins: [
    react(),
    analyze && visualizer({ filename: 'dist/stats.html', gzipSize: true, brotliSize: true, template: 'treemap' }),
  ].filter(Boolean),
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@tanstack/react-virtual')) return 'vendor-virtual';
            if (id.includes('zustand')) return 'vendor-state';
            return 'vendor';
          }
        },
      },
    },
  },
});
```

Only keep `manualChunks` if the analyzer shows stable benefit. If chunks become too fragmented, remove the function and keep only route-level lazy loading.

- [ ] **Step 3: Document budgets**

```md
# Frontend Bundle Budget

- Initial POS route JS gzip target: under 250 KB.
- Full app-shell gzip target: under 600 KB before future face-recognition assets.
- PWA precache target: under 5 MB in Phase 1.3.
- Any dependency adding over 30 KB gzip requires a plan note and review.
```

- [ ] **Step 4: Run analyze build**

```bash
cd frontend
npm run analyze
```

Expected: `frontend/dist/stats.html` is generated locally. Do not commit `dist/` or `stats.html` unless the repo already tracks build artifacts.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json package-lock.json frontend/vite.config.ts docs/performance/frontend-bundle-budget.md
git commit -m "chore: add frontend bundle analysis"
```

### Task 7: Optimize images, assets, and iPad Safari paint cost

**Files:**

- Modify: `frontend/src/assets/*`
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/components/pos-components.tsx`
- Modify: `frontend/src/components/tweaks-panel.tsx` only if measured to affect initial route
- Create: `docs/performance/ipad-safari-checklist.md`

- [ ] **Step 1: Audit asset references**

```bash
cd frontend
rg -n "hero\.png|react\.svg|vite\.svg|url\(" src public index.html
find src/assets -type f -maxdepth 1 -print -exec wc -c {} \;
```

Expected: every committed asset has an import/reference. Remove starter assets that are not referenced.

- [ ] **Step 2: Add image loading discipline where images remain**

Visible decorative or hero image component should use explicit size and async decoding:

```tsx
<img
  src={heroUrl}
  alt=""
  width={480}
  height={320}
  loading="lazy"
  decoding="async"
/>
```

If the image is above the fold and essential to first paint, use `loading="eager"` and keep it compressed under the documented budget.

- [ ] **Step 3: Reduce expensive paint effects after measurement**

Prefer containment on scroll-heavy panes:

```css
.report,
.virtual-ledger,
.rpt-table {
  contain: layout paint;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
```

Do not blanket-add `will-change` to many elements; use it only on virtualized rows and measured transforms.

- [ ] **Step 4: Add iPad Safari manual checklist**

```md
# iPad Safari Performance Checklist

- Test target device: record iPad model, iPadOS version, browser mode, and whether launched from Safari or Home Screen.
- Open POS route after production build preview; confirm first interactive state under 3 seconds on campus Wi-Fi.
- Enter 10 search keystrokes against 500 students; confirm no visible keyboard lag.
- Confirm 10 transactions on a 200-row fixture day; confirm flash animation does not block input.
- Open report and scroll from top to bottom; confirm no blank rows and no sticky header overlap.
- Switch dark/warm theme and font scale; confirm no layout thrash that breaks tap targets.
- Kill Safari tab, reopen, and confirm PWA plan storage/cache behavior separately from this performance plan.
```

- [ ] **Step 5: Run build and manual asset checks**

```bash
cd frontend
npm run build
find dist/assets -type f -maxdepth 1 -print -exec wc -c {} \;
```

Expected: no unused starter assets in source, build succeeds, and asset sizes are recorded in the commit or PR notes.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/assets frontend/src/index.css frontend/src/components/pos-components.tsx frontend/src/components/tweaks-panel.tsx docs/performance/ipad-safari-checklist.md
git commit -m "perf: reduce frontend asset and paint cost"
```

### Task 8: Final verification gate

**Files:**

- Modify: none unless verification exposes a regression.

- [ ] **Step 1: Run full frontend gate**

```bash
cd frontend
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```

Expected: all commands pass.

- [ ] **Step 2: Capture performance evidence**

```bash
cd frontend
npm run analyze
```

Record:

```text
initial JS gzip:
full app-shell gzip:
largest lazy chunk gzip:
PWA precache estimate:
200-row report open p95:
iPad Safari scroll result:
```

- [ ] **Step 3: Commit verification notes**

```bash
git add docs/performance/frontend-bundle-budget.md docs/performance/ipad-safari-checklist.md
git commit -m "docs: record frontend performance verification"
```

## DISCUSS WITH USER

1. **Virtualization dependency:** approve adding `@tanstack/react-virtual`, or require a tiny in-house virtual list to avoid another runtime dependency.
2. **Analyzer dependency:** approve `rollup-plugin-visualizer` as a dev dependency, or keep bundle analysis manual through Vite output only.
3. **Bundle budgets:** confirm initial JS gzip target of 250 KB and full app-shell target of 600 KB before enforcing them in review.
4. **Target iPad:** choose the lowest supported iPad model/iPadOS version; this determines whether Safari scroll budget is realistic.
5. **Fixture scope:** confirm whether the first performance gate should simulate 200 transactions, 500 students, or the worst known school day.
6. **Route split policy:** keep POS eager and lazy-load report/admin/vendors/tweaks, unless lunch service requires report to be instant on first tab switch.

## Acceptance Criteria

- POS confirmation remains local-first and uses the same ledger transaction semantics as before.
- Report totals and student grouping are produced by tested pure domain projection functions.
- App no longer subscribes to the entire Zustand state in one broad selector.
- 200+ transaction report day does not render every row into the DOM at once.
- POS route stays eager; non-POS workspaces are lazy-loaded behind a small Suspense fallback.
- Bundle analysis is available through a script and documented budgets.
- Unused starter assets are removed or documented as intentionally retained.
- iPad Safari checklist exists and is used before claiming performance success.

## Non-Goals

- Do not rewrite persistence from `localStorage` to IndexedDB here; that belongs to the PWA/offline-first and sync plans.
- Do not introduce server pagination for day report rows; the app remains local-first.
- Do not optimize face-recognition model loading in this plan; Phase 2 needs a separate privacy and storage review.
- Do not move the whole CSS system into component modules here; Plan 6 owns design-system extraction.
- Do not add Background Sync or service-worker caching changes in this plan; Plan 3 owns PWA strategy.
