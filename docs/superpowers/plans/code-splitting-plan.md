---
required_reads:
  - frontend/vite.config.ts
  - frontend/src/components/AppRouter.tsx
  - frontend/src/components/screens/ReportScreen.tsx
  - frontend/src/components/screens/AdminScreen.tsx
  - frontend/src/components/screens/VendorsScreen.tsx
  - frontend/src/components/screens/HistoryScreen.tsx
  - frontend/src/main.tsx
---

# Plan: Monolithic JS Bundle — Code Splitting (#144)

## Objective
將 328KB monolithic JS chunk 拆分為 route-level lazy loading + vendor chunk splitting，目標減少 initial load JS ≥40%。

## Approach
1. `React.lazy()` + `<Suspense>` 包裝 5 個 screen components（AppRouter.tsx）
2. `vite.config.ts` 設定 `manualChunks` 拆分 vendor deps（firebase, react, zustand）
3. 動態 import heavy domain modules

## Files

| 檔案 | 語意 |
|------|------|
| `frontend/src/components/AppRouter.tsx` (modify) | 加入 lazy + Suspense，移除 static imports |
| `frontend/vite.config.ts` (modify) | 加入 build.rollupOptions.manualChunks |

## Section 1: Configure manualChunks (vite.config.ts)

在 `build.rollupOptions.output.manualChunks` 中設定 vendor splitting：

```typescript
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'vendor-react': ['react', 'react-dom'],
        'vendor-firebase': ['firebase/app', 'firebase/firestore'],
        'vendor-zustand': ['zustand'],
        // vendor-pwa omitted: PWA uses registerType: 'autoUpdate' (no virtual:pwa-register client import)
      },
    },
  },
},
```

PWA plugin 的 `virtual:pwa-register/react` 可能不在 node_modules 中——若 build 報錯則從 manualChunks 移除，讓 rollup 自動處理。

**Verification**: `npm run build` → 確認 dist 產出多個 chunk files，非單一 JS

## Section 2: Lazy-Load Screen Components (AppRouter.tsx)

將 4 個 static import 的 screen components 改為 `React.lazy()`：

**Before**:
```typescript
import { ReportScreen, AdminScreen, VendorsScreen, HistoryScreen } from './screens';
```

**After**:
```typescript
import React, { Suspense } from 'react';

const ReportScreen = React.lazy(() => import('./screens/ReportScreen').then(m => ({ default: m.ReportScreen })));
const AdminScreen = React.lazy(() => import('./screens/AdminScreen').then(m => ({ default: m.AdminScreen })));
const VendorsScreen = React.lazy(() => import('./screens/VendorsScreen').then(m => ({ default: m.VendorsScreen })));
const HistoryScreen = React.lazy(() => import('./screens/HistoryScreen').then(m => ({ default: m.HistoryScreen })));
```

因為 screen components 使用 named exports，需 `.then()` 轉換為 `{ default }`。

每個 screen 的 `<ErrorBoundary>` 內加入 `<Suspense fallback={...}>`：

```tsx
{tab === 'report' && (
  <ErrorBoundary fallback={<SectionError name="報表" />}>
  <Suspense fallback={<div className="p-4 text-secondary">載入中...</div>}>
    <ReportScreen ... />
  </Suspense>
  </ErrorBoundary>
)}
```

PosColumn 保持 static import（POS 是最常用的入口 screen，lazy load 反而增加延遲）。

**Verification**: `npx tsc --noEmit` + `npm run build` → 檢查 dist 中有獨立的 screen chunk files

## Section 3: Dynamic Import for Heavy Domain Modules

在 ReportScreen.tsx 中，heavy computation modules（ledgerReport, ledgerExport）已透過 derived hooks（useLedgerReport, useLedgerExport）封裝——無需額外改動。

若有其他 heavy domain imports 在 screen 層級，改為 dynamic `import()`。

## Section 4: Verify Build Output

Build 後預期 chunk 結構：

| Chunk | 內容 | 預估大小 |
|-------|------|---------|
| vendor-react | react, react-dom | ~45 KB gzip |
| vendor-firebase | firebase SDK | ~120 KB gzip |
| vendor-zustand | zustand | ~5 KB gzip |
| index | App.tsx + PosColumn + shared UI | ~80 KB gzip |
| ReportScreen | lazy chunk | ~20 KB gzip |
| AdminScreen | lazy chunk | ~15 KB gzip |
| VendorsScreen | lazy chunk | ~8 KB gzip |
| HistoryScreen | lazy chunk | ~5 KB gzip |

Initial load（POS only）: vendor-react + vendor-zustand + index ≈ 130 KB gzip（比原 95 KB 略增，但後續 navigation 不需重新下載 vendor chunks；pos column 本身不含其他 screen 邏輯）

**Verification**: same as Section 1

## Affected Callers
- `AppRouter.tsx` — import pattern 變更
- `main.tsx` — 不需變更（AppRouter 仍是 static import）

## Test Impact
- `pos-components.test.tsx` — 可能需要更新 mock（若測試 import screen components directly）
- `pcPosFlow.integration.test.tsx` — POS flow 不受影響（PosColumn static import）
- `npx vitest run` 全 PASS

## ⚠️ Risk
- **Named exports**: screen components 使用 named exports，lazy() 需要 `.then(m => ({ default: m.X }))` pattern
- **Suspense fallback**: 確保 fallback UI 不破壞 layout（使用簡單文字而非 spinner component）
- **Firebase chunk 大小**: firebase SDK 本身 ~120KB gzip，manualChunks 隔離後不影響 initial load（POS 不用 firebase 在 critical path）
- **Build 驗證**: Section 1 完成後先跑一次 build 確認 manualChunks 不會導致 chunk 爆炸

## Success Criteria
1. Build 產出 ≥5 個 JS chunks（vs 目前 1 個）
2. Initial load JS（POS screen）≤ 200 KB uncompressed
3. Lazy screen chunks 按需載入（切換 tab 時 network 可見）
4. t1-t4 全 PASS
5. PWA 功能不受影響（SW precache 自動包含新 chunks）
