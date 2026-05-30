---
required_reads:
  - frontend/src/hooks/usePosFlow.ts
  - frontend/src/hooks/__tests__/useKeyboardShortcuts.test.ts
  - frontend/src/hooks/__tests__/useServiceWorkerCleanup.test.ts
---

# Plan: usePosFlow Hook 拆分

## Objective
將 `usePosFlow` (345 lines) 按關注點拆分為 composition hook + 多個 sub-hooks。

## Files
| 檔案 | 語意 |
|------|------|
| `frontend/src/hooks/usePosFlow.ts` (modify) | 改為 composition hook，僅組合 sub-hooks + 暴露統一 interface |
| `frontend/src/hooks/useExpenseFlow.ts` (new) | 抽取費用輸入 multi-step flow (lines 89-115) |
| `frontend/src/hooks/useScannerInput.ts` (new) | 抽取掃描器輸入處理 (lines 117-122) |
| `frontend/src/hooks/useIpadHandoff.ts` (new) | 抽取 iPad handoff 訊息處理 (lines 124-140) |
| `frontend/src/hooks/useTransactionCommit.ts` (new) | 抽取 commit 邏輯 (lines 142-306) |

## Section 1: Extract `useExpenseFlow`

7 個 expense callback → 獨立 hook

- enterExpenseMode
- updateExpenseAmount
- confirmExpenseAmount
- selectExpenseDirection
- selectExpenseReason
- updateExpenseNote
- confirmExpenseNote

**Affected callers**: 無外部 caller — 全部由 usePosFlow 內部組合，return interface 保持不變。

**Verification**: `npx tsc --noEmit` + `npx vitest run`

## Section 2: Extract `useScannerInput`

- receiveScannerInput

**Parameters**: `dispatch`, `students`

**Verification**: same as Section 1

## Section 3: Extract `useIpadHandoff`

- receiveIpadHandoff

**Parameters**: `dispatch`, `students`

**Verification**: same as Section 1

## Section 4: Extract `useTransactionCommit`

- requestConfirm
- confirmDuplicate
- commitTransaction (最複雜的 callback)

**Parameters**: `dispatch`, `state`, `students`, `todayMenu`, `commitPosTransactionDraft`, `args` (businessDate, priceOverride, priceOverrideLabel)

**Affected callers**: `useEffect` at line 309-313 (auto-commit trigger) — 保留在 usePosFlow 主體但改用 sub-hook 回傳的 commitTransaction。

**Verification**: same as Section 1

## Section 5: Update `usePosFlow` to Composition Hook

usePosFlow 改為：
1. 保持 useReducer + store subscriptions
2. 呼叫 4 個 sub-hooks（傳入 `dispatch`, `state`, store data）
3. 組合所有回傳值至統一的 `UsePosFlowReturn` interface
4. `UsePosFlowReturn` interface 不變（向後相容）

## Affected Callers (graphify query required)
- 哪些檔案 import usePosFlow？
- 哪些檔案使用 UsePosFlowReturn 或 UsePosFlowArgs？

## Test Impact
- `usePosFlow` 本身無 unit test（issue #151）
- 現有 integration tests 間接測試 POS flow — 拆分後必須全 PASS
- 需確認 `pcPosFlow.integration.test.tsx` 通過

## ⚠️ Risk
- commitTransaction 依賴 store、ref、state — 提取時需小心 closure 和 dependency
- useEffect auto-commit trigger 依賴 state.kind — 不能改變行為
- 每個 section 完成後立刻跑 full test suite

## Success Criteria
1. usePosFlow.ts ≤ 100 lines（composition only）
2. 4 個 new sub-hook files 存在且各自獨立
3. UsePosFlowReturn interface 保持不變
4. t1~t4 全 PASS
5. 606 tests unchanged
