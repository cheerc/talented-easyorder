# 錯誤處理與復原策略實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 EasyOrder 在 React render crash、Zustand/localStorage 損壞、IndexedDB 失效、未完成交易、離線同步失敗與未來後端錯誤時，都能保住本地帳務、給操作者可執行的復原路徑，且不製造重複交易。

**Architecture:** 以「本地 commit 是否已成立」作為錯誤分界。render crash 由 Error Boundary 保護 UI；資料層錯誤由 storage health check、schema validation、repair snapshot 與 crash draft 復原處理；sync 失敗只改變 queue 狀態，不回滾已成立的本地 ledger。

**Tech Stack:** Vite 8, React 19, TypeScript 6, Zustand 5 persist middleware, localStorage, future IndexedDB repository, Vitest 4, React Testing Library, browser `error` / `unhandledrejection` events, Cloudflare Worker logging endpoint when backend exists.

---

## 已讀資料與現況

- 派發指定的 `/Users/cheerc/talented-easyorder/docs/superpowers/specs/talented-easyorder-spec.pdf` 目前不存在。
- 已改讀實際存在的 `docs/iPad人臉辨識訂餐系統設計方案_V3.pdf`。
- 已讀 `docs/superpowers/specs/2026-05-14-pc-pos-order-flow-spec.md`。
- 已讀 `docs/superpowers/specs/2026-05-14-google-sheets-sync-offline-spec.md`。
- 已讀 `docs/superpowers/specs/2026-05-14-order-ledger-cash-close-spec.md`。
- 已讀 `docs/superpowers/plans/2026-05-15-pwa-offline-first-strategy.md`。
- 已檢查 `frontend/src/main.tsx`、`frontend/src/App.tsx`、`frontend/src/store/posStore.ts`、`frontend/src/domain/posTransaction.ts`、`frontend/src/domain/ledger.ts`、`frontend/src/domain/syncStatus.ts`。

## 官方參考來源

- React `componentDidCatch` / Error Boundary: https://react.dev/reference/react/Component
- MDN IndexedDB: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB
- MDN Storage quotas and eviction: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- MDN `window.error`: https://developer.mozilla.org/en-US/docs/Web/API/Window/error_event
- MDN `window.unhandledrejection`: https://developer.mozilla.org/en-US/docs/Web/API/Window/unhandledrejection_event
- Zustand persist middleware: https://zustand.site/en/docs/persist/

## 目前錯誤處理缺口

1. `frontend/src/main.tsx` 直接 render `<App />`，沒有 Error Boundary。render crash 會讓整個 POS 空白。
2. React 官方仍需要 class component 或套件處理 Error Boundary；本 repo 目前沒有 `react-error-boundary` 依賴。
3. `usePosStore` 使用 Zustand `persist` 到 `localStorage` 的 `pos-storage`，但沒有 corrupt JSON、欄位缺失、版本不合、資料型別錯誤的隔離與備份。
4. `migrate` 只處理舊 shape 正規化，沒有 validate repaired state，也沒有 fallback 到 safe demo/empty state 的明確流程。
5. `App.tsx` 交易 confirm 只在 local state 中保存草稿；瀏覽器 crash 或 refresh 會丟失未完成操作，操作者可能重做並造成重複或漏記。
6. `processTransaction` 沒有回傳 commit result，也沒有把「local commit 前失敗」與「local commit 後 sync 失敗」分開。
7. 目前 sync 是 fake timeout；沒有 queued、failed、conflict 的 UI recovery。
8. `BackupScreen` 文案提到 SQLite 與 cloud restore，但目前沒有 route，也不符合現況 localStorage / future IndexedDB 架構。
9. `resetData` 可清空資料，錯誤復原不能依賴這種 destructive action。

## 錯誤分類

| 分類 | 範例 | 原則 | 使用者訊息 |
|---|---|---|---|
| Render crash | 元件 throw、資料欄位為 undefined | Error Boundary 顯示 fallback；不要清資料 | `畫面暫時無法顯示，資料仍保留在本機` |
| Validation error | 金額負數、缺學生、缺菜單 | 不建立 ledger；保留輸入 | `金額不可為負數，請修正後再確認` |
| Local commit failure | localStorage/IndexedDB 寫入失敗 | 不視為已完成；允許重試或取消 | `尚未完成記帳，請重試或改用備援流程` |
| Post-commit sync failure | 本地 ledger 已寫入但 remote 失敗 | 不重送人工交易；標示 queued/failed/conflict | `已本機記帳，雲端尚未同步` |
| Store corruption | `pos-storage` JSON 或 shape 損壞 | 備份 corrupt payload；啟動 repair flow | `偵測到本機資料異常，請先修復或匯出` |
| IndexedDB unavailable | private mode、quota、open blocked、version conflict | 降級到 read-only 或 emergency localStorage queue，視政策 | `本機資料庫無法開啟，午餐服務暫停或改用備援` |
| Crash recovery | 未確認草稿存在 | 啟動後提示恢復/放棄草稿 | `偵測到未完成交易，請恢復或放棄` |
| Unknown bug | unhandled rejection | 記錄 sanitized log；顯示可操作訊息 | `系統發生未預期錯誤，請保留錯誤代碼` |

## 建議檔案結構

- Create: `frontend/src/errors/ErrorBoundary.tsx` - React Error Boundary 與 fallback UI。
- Create: `frontend/src/errors/errorCatalog.ts` - 使用者友善錯誤訊息、嚴重度、復原建議。
- Create: `frontend/src/errors/errorLogger.ts` - 本地 ring buffer 與未來後端 transport。
- Create: `frontend/src/errors/__tests__/errorCatalog.test.ts`。
- Create: `frontend/src/storage/storageHealth.ts` - localStorage / IndexedDB availability check。
- Create: `frontend/src/storage/posStateValidator.ts` - persisted state validation 與 repair result。
- Create: `frontend/src/storage/crashDraft.ts` - 未完成交易草稿保存與恢復。
- Create: `frontend/src/storage/__tests__/storageHealth.test.ts`。
- Create: `frontend/src/storage/__tests__/posStateValidator.test.ts`。
- Create: `frontend/src/storage/__tests__/crashDraft.test.ts`。
- Modify: `frontend/src/main.tsx` - wrap ErrorBoundary。
- Modify: `frontend/src/App.tsx` - commit 前後錯誤分界、crash draft、sync failure messaging。
- Modify: `frontend/src/store/posStore.ts` - persist migrate/partialize/onRehydrateStorage、validate/repair integration。
- Modify: `frontend/src/components/pos-components.tsx` - error/status UI。
- Modify: `frontend/src/components/screens.tsx` - recovery admin panel、sync failure repair entry。
- Docs: `docs/ops/error-recovery-runbook.md`。

## Task 1: Error Catalog 與使用者友善訊息

**Files:**
- Create: `frontend/src/errors/errorCatalog.ts`
- Create: `frontend/src/errors/__tests__/errorCatalog.test.ts`

- [ ] **Step 1: 寫錯誤訊息測試**

```ts
import { describe, expect, it } from 'vitest';
import { getUserErrorMessage } from '../errorCatalog';

describe('error catalog', () => {
  it('maps local commit failures to actionable operator copy', () => {
    expect(getUserErrorMessage('LOCAL_COMMIT_FAILED')).toEqual({
      severity: 'blocking',
      title: '尚未完成本機記帳',
      body: '這筆交易還沒有寫入本機帳務，請重試一次；若仍失敗，改用備援流程並通知管理者。',
      recoveryAction: 'retry-or-cancel',
    });
  });

  it('maps post-commit sync failures without telling the operator to re-enter the transaction', () => {
    expect(getUserErrorMessage('SYNC_FAILED_AFTER_COMMIT').recoveryAction).toBe('repair-sync');
  });
});
```

- [ ] **Step 2: 新增錯誤 catalog**

```ts
export type AppErrorCode =
  | 'RENDER_CRASH'
  | 'VALIDATION_FAILED'
  | 'LOCAL_COMMIT_FAILED'
  | 'SYNC_FAILED_AFTER_COMMIT'
  | 'STORE_CORRUPTED'
  | 'INDEXEDDB_UNAVAILABLE'
  | 'CRASH_DRAFT_FOUND'
  | 'UNKNOWN_RUNTIME_ERROR';

export type ErrorSeverity = 'info' | 'recoverable' | 'blocking' | 'critical';
export type RecoveryAction = 'retry-or-cancel' | 'repair-sync' | 'repair-store' | 'export-log' | 'reload-safe' | 'none';

export interface UserErrorMessage {
  severity: ErrorSeverity;
  title: string;
  body: string;
  recoveryAction: RecoveryAction;
}

const messages: Record<AppErrorCode, UserErrorMessage> = {
  RENDER_CRASH: {
    severity: 'critical',
    title: '畫面暫時無法顯示',
    body: '資料仍保留在本機。請先匯出錯誤紀錄，再重新整理畫面。',
    recoveryAction: 'reload-safe',
  },
  VALIDATION_FAILED: {
    severity: 'recoverable',
    title: '資料需要修正',
    body: '請依畫面提示修正欄位，再重新確認。',
    recoveryAction: 'none',
  },
  LOCAL_COMMIT_FAILED: {
    severity: 'blocking',
    title: '尚未完成本機記帳',
    body: '這筆交易還沒有寫入本機帳務，請重試一次；若仍失敗，改用備援流程並通知管理者。',
    recoveryAction: 'retry-or-cancel',
  },
  SYNC_FAILED_AFTER_COMMIT: {
    severity: 'recoverable',
    title: '已本機記帳，雲端尚未同步',
    body: '不要重新輸入這筆交易。請稍後從同步修復畫面重試或處理失敗原因。',
    recoveryAction: 'repair-sync',
  },
  STORE_CORRUPTED: {
    severity: 'critical',
    title: '偵測到本機資料異常',
    body: '系統已保留異常資料副本。請先修復或匯出，不要直接重置。',
    recoveryAction: 'repair-store',
  },
  INDEXEDDB_UNAVAILABLE: {
    severity: 'blocking',
    title: '本機資料庫無法開啟',
    body: '目前無法保證交易可保存。請切換備援流程，或依管理者指示重試。',
    recoveryAction: 'reload-safe',
  },
  CRASH_DRAFT_FOUND: {
    severity: 'recoverable',
    title: '偵測到未完成交易',
    body: '請確認是否恢復上一筆未送出的操作，或放棄後重新搜尋學生。',
    recoveryAction: 'retry-or-cancel',
  },
  UNKNOWN_RUNTIME_ERROR: {
    severity: 'critical',
    title: '系統發生未預期錯誤',
    body: '請保留錯誤代碼與時間，通知管理者處理。',
    recoveryAction: 'export-log',
  },
};

export function getUserErrorMessage(code: AppErrorCode): UserErrorMessage {
  return messages[code];
}
```

- [ ] **Step 3: 跑測試並 commit**

Run: `cd frontend && npx vitest run src/errors/__tests__/errorCatalog.test.ts`

```bash
git add frontend/src/errors
git commit -m "test: add user-facing error catalog"
```

## Task 2: React Error Boundary

**Files:**
- Create: `frontend/src/errors/ErrorBoundary.tsx`
- Modify: `frontend/src/main.tsx`
- Test: `frontend/src/errors/__tests__/ErrorBoundary.test.tsx`

- [ ] **Step 1: 寫 Error Boundary 測試**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../ErrorBoundary';

function BrokenChild() {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  it('shows safe recovery copy when rendering crashes', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <BrokenChild />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('畫面暫時無法顯示');
    expect(screen.getByRole('button', { name: '重新整理畫面' })).toBeInTheDocument();
    expect(onError).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 新增 ErrorBoundary**

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { getUserErrorMessage } from './errorCatalog';

interface Props {
  children: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    const message = getUserErrorMessage('RENDER_CRASH');

    return (
      <main className="error-fallback" role="alert" aria-live="assertive">
        <h1>{message.title}</h1>
        <p>{message.body}</p>
        <button type="button" onClick={() => window.location.reload()}>
          重新整理畫面
        </button>
      </main>
    );
  }
}
```

- [ ] **Step 3: Wrap root**

`frontend/src/main.tsx`:

```tsx
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
```

- [ ] **Step 4: 跑測試並 commit**

Run: `cd frontend && npx vitest run src/errors/__tests__/ErrorBoundary.test.tsx`

```bash
git add frontend/src/main.tsx frontend/src/errors/ErrorBoundary.tsx frontend/src/errors/__tests__/ErrorBoundary.test.tsx
git commit -m "fix: add root error boundary"
```

## Task 3: Runtime Error Logger

**Files:**
- Create: `frontend/src/errors/errorLogger.ts`
- Modify: `frontend/src/main.tsx`
- Test: `frontend/src/errors/__tests__/errorLogger.test.ts`

- [ ] **Step 1: 建立本地 ring buffer**

```ts
export interface ErrorLogEntry {
  id: string;
  createdAt: string;
  source: 'react' | 'window-error' | 'unhandled-rejection' | 'storage' | 'sync';
  message: string;
  stack?: string;
  context?: Record<string, string | number | boolean | null>;
}

const LOG_KEY = 'easyorder-error-log';
const MAX_LOG_ENTRIES = 100;

export function appendErrorLog(entry: Omit<ErrorLogEntry, 'id' | 'createdAt'>): ErrorLogEntry {
  const next: ErrorLogEntry = {
    ...entry,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const current = readErrorLog();
  localStorage.setItem(LOG_KEY, JSON.stringify([next, ...current].slice(0, MAX_LOG_ENTRIES)));
  return next;
}

export function readErrorLog(): ErrorLogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? JSON.parse(raw) as ErrorLogEntry[] : [];
  } catch {
    return [];
  }
}

export function clearErrorLog() {
  localStorage.removeItem(LOG_KEY);
}
```

- [ ] **Step 2: 監聽 global errors**

`main.tsx` 加入 `window.addEventListener('error', ...)` 與 `window.addEventListener('unhandledrejection', ...)`。記錄前要做 sanitization，不存學生姓名、餘額、付款金額或 raw transaction payload。

- [ ] **Step 3: 後端 logging transport policy**

在 `errorLogger.ts` 保留 `sendErrorLogs(adapter)` 介面；初期不直接送網路。等 Cloudflare Worker backend 存在後，才接 `/api/client-errors`，並且只送 sanitized message、source、stack hash、app version、device info、business date。

- [ ] **Step 4: 跑測試並 commit**

Run: `cd frontend && npx vitest run src/errors/__tests__/errorLogger.test.ts`

```bash
git add frontend/src/errors/errorLogger.ts frontend/src/errors/__tests__/errorLogger.test.ts frontend/src/main.tsx
git commit -m "feat: add local runtime error logging"
```

## Task 4: Zustand Persist Corruption Detection

**Files:**
- Create: `frontend/src/storage/posStateValidator.ts`
- Modify: `frontend/src/store/posStore.ts`
- Test: `frontend/src/storage/__tests__/posStateValidator.test.ts`

- [ ] **Step 1: 寫 validator 測試**

```ts
import { describe, expect, it } from 'vitest';
import { validatePersistedPosState } from '../posStateValidator';

describe('validatePersistedPosState', () => {
  it('rejects missing students array', () => {
    const result = validatePersistedPosState({ transactions: [], vendors: [], todayMenu: null });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('students_not_array');
  });

  it('accepts the minimum persisted state shape', () => {
    const result = validatePersistedPosState({
      students: [],
      transactions: [],
      vendors: [],
      todayMenu: {
        businessDate: '2026-05-15',
        itemName: '雞腿便當',
        price: 90,
        vendorId: 'v1',
        vendorNameSnapshot: '供應商',
        updatedAt: '2026-05-15T00:00:00.000Z',
        revision: 1,
      },
    });
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: 新增 validator**

```ts
export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: 'not_object' | 'students_not_array' | 'transactions_not_array' | 'vendors_not_array' | 'today_menu_invalid' };

export function validatePersistedPosState(value: unknown): ValidationResult {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'not_object' };
  const state = value as Record<string, unknown>;
  if (!Array.isArray(state.students)) return { ok: false, reason: 'students_not_array' };
  if (!Array.isArray(state.transactions)) return { ok: false, reason: 'transactions_not_array' };
  if (!Array.isArray(state.vendors)) return { ok: false, reason: 'vendors_not_array' };
  const menu = state.todayMenu as Record<string, unknown> | undefined;
  if (!menu || typeof menu.businessDate !== 'string' || typeof menu.price !== 'number') {
    return { ok: false, reason: 'today_menu_invalid' };
  }
  return { ok: true };
}
```

- [ ] **Step 3: 接到 Zustand persist**

在 `migrate` 之後呼叫 validator。若失敗：

1. 將原始 payload 備份到 `easyorder-corrupt-pos-storage-<timestamp>`。
2. 記錄 `STORE_CORRUPTED` error log。
3. 回傳安全初始 state，但 UI 必須顯示 repair banner，不可假裝資料正常。

- [ ] **Step 4: 跑 store 測試**

Run: `cd frontend && npx vitest run src/storage/__tests__/posStateValidator.test.ts src/store/__tests__/posStore.test.ts`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/storage/posStateValidator.ts frontend/src/storage/__tests__/posStateValidator.test.ts frontend/src/store/posStore.ts
git commit -m "fix: validate persisted POS state"
```

## Task 5: IndexedDB Health Check And Fallback Policy

**Files:**
- Create: `frontend/src/storage/storageHealth.ts`
- Create: `frontend/src/storage/__tests__/storageHealth.test.ts`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: 寫 storage health 測試**

```ts
import { describe, expect, it, vi } from 'vitest';
import { checkLocalStorageHealth } from '../storageHealth';

describe('storage health', () => {
  it('reports localStorage as writable', () => {
    expect(checkLocalStorageHealth().localStorage).toBe('available');
  });

  it('reports localStorage write failure', () => {
    const spy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(checkLocalStorageHealth().localStorage).toBe('unavailable');
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: 實作 localStorage / IndexedDB check**

```ts
export interface StorageHealth {
  localStorage: 'available' | 'unavailable';
  indexedDB: 'available' | 'unavailable' | 'not-checked';
  storageEstimate?: { quota?: number; usage?: number };
}

export function checkLocalStorageHealth(): StorageHealth {
  try {
    const key = '__easyorder_storage_probe__';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return { localStorage: 'available', indexedDB: 'not-checked' };
  } catch {
    return { localStorage: 'unavailable', indexedDB: 'not-checked' };
  }
}
```

IndexedDB async probe 放入 `checkIndexedDBHealth()`，用 `indexedDB.open('__easyorder_probe__', 1)`，處理 `onsuccess`、`onerror`、`onblocked`、timeout。

- [ ] **Step 3: UI policy**

如果 local commit storage 不可用，POS confirm 必須進入 blocking 狀態，不可顯示交易完成。若只有 remote sync 不可用，仍可本地 commit 並顯示 queued。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/storage/storageHealth.ts frontend/src/storage/__tests__/storageHealth.test.ts frontend/src/App.tsx
git commit -m "feat: add storage health checks"
```

## Task 6: Crash Draft Recovery

**Files:**
- Create: `frontend/src/storage/crashDraft.ts`
- Create: `frontend/src/storage/__tests__/crashDraft.test.ts`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: 定義 crash draft**

```ts
export interface PosCrashDraft {
  draftId: string;
  savedAt: string;
  businessDate: string;
  studentId: string;
  mode: 'order' | 'topup' | 'cancel';
  payAmountText: string;
  sourceDevice: 'pc' | 'barcode_scanner' | 'ipad_handoff';
}
```

- [ ] **Step 2: 保存未確認草稿**

當 operator 已選學生並修改 mode 或 amount，但尚未 local commit，寫入 `easyorder-pos-crash-draft`。成功 local commit、取消、返回 idle 時清除。

- [ ] **Step 3: 啟動後恢復**

App 啟動若發現同 business date 的草稿，顯示 blocking recovery banner：

- `恢復上一筆`：重新選學生、模式、金額，不建立 ledger。
- `放棄`：清除草稿。

不同 business date 的草稿只可匯出或放棄，不可自動恢復到今日。

- [ ] **Step 4: 跑測試並 commit**

Run: `cd frontend && npx vitest run src/storage/__tests__/crashDraft.test.ts`

```bash
git add frontend/src/storage/crashDraft.ts frontend/src/storage/__tests__/crashDraft.test.ts frontend/src/App.tsx
git commit -m "feat: recover interrupted POS drafts"
```

## Task 7: Commit Boundary And Sync Failure UX

**Files:**
- Modify: `frontend/src/store/posStore.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/pos-components.tsx`
- Test: `frontend/src/store/__tests__/posStore.test.ts`

- [ ] **Step 1: store commit 回傳 result**

`processTransaction` 或替代的新 API 應回傳：

```ts
export type CommitResult =
  | { ok: true; transactionId: string; syncStatus: 'local' | 'queued' | 'synced' }
  | { ok: false; code: 'student_not_found' | 'storage_unavailable' | 'validation_failed'; message: string };
```

- [ ] **Step 2: local commit 前錯誤**

若 `ok: false`，App 顯示 `LOCAL_COMMIT_FAILED` 或 validation copy，不顯示完成 banner，不清除 crash draft，允許 retry/cancel。

- [ ] **Step 3: local commit 後 sync 錯誤**

若本地 commit 成功但 sync 失敗，完成 banner 必須顯示 `已本機記帳，雲端排隊中/失敗`，並禁止 operator 重新輸入同一筆。

- [ ] **Step 4: sync repair entry**

TopBar 或 report/admin 顯示 queued/failed/conflict counts。點擊後進入 repair panel，列出每筆失敗原因與重試按鈕。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/posStore.ts frontend/src/App.tsx frontend/src/components/pos-components.tsx frontend/src/store/__tests__/posStore.test.ts
git commit -m "fix: separate local commit and sync failure recovery"
```

## Task 8: IndexedDB Damage And Emergency Fallback Runbook

**Files:**
- Create: `docs/ops/error-recovery-runbook.md`
- Modify: `frontend/src/components/screens.tsx`

- [ ] **Step 1: 寫 runbook**

Runbook 必須包含：

1. 畫面 crash。
2. 本機資料異常。
3. localStorage 或 IndexedDB quota/full。
4. IndexedDB version blocked by another tab。
5. 離線後 queued rows 無法同步。
6. conflict rows before closeout。
7. 不可用 `resetData` 當 production recovery。

- [ ] **Step 2: Admin recovery panel**

Admin screen 增加 recovery summary：

- storage health。
- error log count。
- queued/failed/conflict count。
- export local data。
- export error log。
- repair sync。

破壞性 reset 只在 demo/dev mode 顯示。

- [ ] **Step 3: Commit**

```bash
git add docs/ops/error-recovery-runbook.md frontend/src/components/screens.tsx
git commit -m "docs: add error recovery runbook"
```

## Task 9: 未來後端錯誤日誌策略

**Files:**
- Create: `docs/ops/client-error-logging-policy.md`
- Modify: `frontend/src/errors/errorLogger.ts`

- [ ] **Step 1: 記錄政策**

政策必須明確排除：

- 學生姓名。
- 餘額。
- 付款金額。
- raw ledger transaction payload。
- raw face data 或 biometric template。

允許：

- error code。
- sanitized stack。
- app version。
- route/screen id。
- device/browser。
- business date。
- sync status counts。
- anonymous install id。

- [ ] **Step 2: transport interface**

```ts
export interface ErrorLogTransport {
  send(entries: ErrorLogEntry[]): Promise<{ ok: true } | { ok: false; message: string }>;
}

export async function flushErrorLogs(transport: ErrorLogTransport): Promise<{ sent: number; failed: number }> {
  const entries = readErrorLog();
  const result = await transport.send(entries);
  if (!result.ok) return { sent: 0, failed: entries.length };
  clearErrorLog();
  return { sent: entries.length, failed: 0 };
}
```

- [ ] **Step 3: Commit**

```bash
git add docs/ops/client-error-logging-policy.md frontend/src/errors/errorLogger.ts
git commit -m "docs: define client error logging policy"
```

## 驗證指令

每個實作 PR 完成前執行：

```bash
cd frontend
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```

針對錯誤復原功能額外執行：

```bash
cd frontend
npx vitest run src/errors src/storage src/store/__tests__/posStore.test.ts
```

人工 drill：

1. 在交易前 reload，確認 crash draft 可恢復或放棄。
2. 在交易後模擬 sync failure，確認不要求重輸入交易。
3. 手動破壞 `pos-storage` JSON，確認修復 banner 出現且 corrupt payload 被備份。
4. 模擬 IndexedDB open blocked/unavailable，確認 POS 不會假裝交易已保存。
5. 觸發 render crash，確認 Error Boundary 不清資料，且可匯出 error log。

## DISCUSS WITH USER

1. 若 IndexedDB/localStorage 不可用，午餐服務要完全暫停，還是允許紙本備援後再補登？
2. corrupted `pos-storage` 修復失敗時，誰有權決定匯出後清空本機資料？
3. Crash draft 應保留多久？同日、跨日、或直到操作者明確處理？
4. Error log 可否包含 business date 與 anonymous install id？
5. sync failed/conflict 是否應 block daily closeout，或允許 emergency closeout 並附註？

## Definition Of Done

- Root Error Boundary 已保護整個 App，render crash 不會直接空白。
- 本地錯誤訊息以 operator action 為中心，明確區分 local commit 前與 local commit 後。
- `pos-storage` 有 validate、repair、corrupt backup 與明確 UI。
- IndexedDB/localStorage health check 能阻擋不可靠的本地 commit。
- 未完成交易草稿可恢復或放棄，不會自動建立 ledger。
- sync failed/queued/conflict 有可見且可操作的 repair path。
- Error log sanitized，不包含學生姓名、餘額、付款金額、raw ledger 或生物辨識資料。
- Recovery runbook 覆蓋午餐尖峰、離線、資料損壞與 closeout 前失敗情境。
