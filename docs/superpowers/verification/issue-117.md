# Issue #117 Verification Checklist

## Change
App.tsx L530-531: inline arrow functions → useCallback wrappers

## Verification

- [x] useCallback deps array 正確（viewDate, openCashSession / updateOpeningCash）
- [x] t1 tsc --noEmit PASS
- [x] t2 ESLint PASS
- [x] t3 vitest 476 tests PASS
- [x] t4 build PASS
- [x] graphify-out/ 已 commit
- [x] useCallback 不依賴 render 內建立的變數（openCashSession/updateOpeningCash 來自 Zustand selector，reference stable）
