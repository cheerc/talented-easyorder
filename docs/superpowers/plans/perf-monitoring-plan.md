---
required_reads:
  - frontend/src/main.tsx
  - frontend/src/store/posActions/transactionActions.ts
  - frontend/package.json
---

# Plan: Render Performance Monitoring Infrastructure (#158)

## Objective
建立最小可行的效能監控基礎設施：開發環境 render tracking + POS 關鍵路徑 latency measurement。

## Approach
1. 加入 `@welldone-software/why-did-you-render` 作為 devDependency
2. `main.tsx` 中 dev-only 初始化（避免 production bundle 膨脹）
3. `processTransaction` 前後加入 `performance.mark/measure`

## Files

| 檔案 | 語意 |
|------|------|
| `frontend/package.json` (modify) | 新增 devDependency |
| `frontend/src/main.tsx` (modify) | Dev-only why-did-you-render 初始化 |
| `frontend/src/store/posActions/transactionActions.ts` (modify) | performance.mark/measure around processTransaction |

## Section 1: Install Dev Dependency

```bash
cd frontend && npm install --save-dev @welldone-software/why-did-you-render
```

**Verification**: `grep why-did-you-render frontend/package.json` 確認安裝

## Section 2: Dev-Only Initialization (main.tsx)

在 `main.tsx` 頂部，React import 之後：

```typescript
// Dev-only render tracking
if (import.meta.env.DEV) {
  const { default: whyDidYouRender } = await import('@welldone-software/why-did-you-render');
  whyDidYouRender(React, {
    trackAllPureComponents: true,
    trackHooks: true,
    logOnDifferentValues: true,
  });
}
```

使用 `import.meta.env.DEV`（Vite 環境變數）確保 production build 完全排除此程式碼。`await import()` 使用 dynamic import 避免 dev dependency 被 tree-shaken 到 production bundle 中（Vite 會將 dynamic import 的 dev-only 模組在 production build 時移除）。

⚠️ `main.tsx` 頂層是 module scope（非 async function），需要將初始化包裝在 async IIFE 或使用 `.then()` pattern：

```typescript
if (import.meta.env.DEV) {
  import('@welldone-software/why-did-you-render').then(({ default: whyDidYouRender }) => {
    whyDidYouRender(React, {
      trackAllPureComponents: true,
      trackHooks: true,
      logOnDifferentValues: true,
    });
  });
}
```

**Verification**: 
- `npm run dev` → 檢查 dev console 有 why-did-you-render 輸出
- `npm run build` → production bundle 不含 why-did-you-render（`grep -r "why-did" dist/` 無結果）

## Section 3: POS Latency Marks (transactionActions.ts)

在 `processTransaction` 函式內新增 performance marks：

```typescript
export function processTransaction(...) {
  const markStart = `pos-tx-${tx.id}`; // 若無 tx.id，用 Date.now() 代替
  performance.mark(`${markStart}-start`);
  
  // ... existing transaction processing logic ...
  
  performance.mark(`${markStart}-end`);
  performance.measure(`pos-transaction`, `${markStart}-start`, `${markStart}-end`);
}
```

若 `processTransaction` 處理多筆 transactions（batch），marks 放在 batch 外層（量測整體處理時間）。

⚠️ `performance.mark/measure` 是標準 Web API，TypeScript 型別內建於 `lib.dom`，無需額外 type package。

⚠️ `processTransaction` 非 top-level function，實際定義散布在 `orderActions/paymentActions/editActions` 的 return closures 中。Impl 需 trace 實際位置後放置 marks。

長期 POS session 中 `performance.mark` 以 tx.id 累積可能導致記憶體增長。建議在 batch 結束後呼叫 `performance.clearMarks()` 清理。

**Verification**: `npx tsc --noEmit` + `npm run dev` → 開啟 Chrome DevTools Performance tab 確認 marks 出現

## Affected Callers
- `main.tsx` — 僅 import 初始化邏輯
- `transactionActions.ts` — `processTransaction` consumer（usePosFlow、undo、edit）不受影響

## Test Impact
- `posStore.test.ts` — 若測試環境無 `performance.mark`（jsdom 通常有），加入 mock：
  ```typescript
  beforeAll(() => {
    if (!globalThis.performance) {
      globalThis.performance = { mark: vi.fn(), measure: vi.fn() } as any;
    }
  });
  ```
- `npx vitest run` 全 PASS

## ⚠️ Risk
- **why-did-you-render v7+ API**: 確認安裝版本為 `@welldone-software/why-did-you-render@^8`（React 19 compatible）
- **performance API**: Node 19+ 和 jsdom 都有 `performance.mark`，CI 環境應相容
- **Dev-only import 安全性**: `import.meta.env.DEV` 在 Vite 是 compile-time constant，production build 時整個 block 被移除

## Success Criteria
1. `@welldone-software/why-did-you-render` 在 devDependencies 中
2. `npm run dev` 時 console 顯示 component re-render 資訊
3. Production build 不含 why-did-you-render（`grep -r "why-did" dist/` 無結果）
4. `performance.mark` 出現在 processTransaction 前後
5. t1-t4 全 PASS
6. `npm run build` 成功（不增加 bundle size）
