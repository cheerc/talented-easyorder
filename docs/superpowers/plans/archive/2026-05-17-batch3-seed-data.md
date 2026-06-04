---
status: approved
date: 2026-05-17
complexity: trivial
batch: 3
review: gemini-7d0621 VERIFIED
---

# Batch 3 — 種子資料重設

## Background

使用者希望 emulator 測試環境中的 20 個學生帳戶餘額歸零，符合實際使用場景（學生很少儲值）。

## Current State

`frontend/src/mocks/initialData.ts` 已有 20 個學生（studentId 001-020），各有不同的 `currentBalance`（範圍 -180 ~ 2340）。

## Changes

### S1: 學生餘額全部歸零

**改動**：
- `frontend/src/mocks/initialData.ts`：所有 20 筆 `INITIAL_STUDENTS` 的 `currentBalance` 改為 `0`

### S2: 初始交易清空

**改動**：
- `frontend/src/mocks/initialData.ts`：`INITIAL_TODAY_TX` 改為空 array `[]`
- `INITIAL_ORDERED_TODAY` 改為空 object `{}`
- 因為餘額歸零 + 無初始交易，才不會出現矛盾（有交易但餘額是 0）

### S3: todayMenu 日期更新（optional）

**改動**：
- `INITIAL_TODAY_MENU.businessDate` 可改為動態產生（`new Date().toISOString().slice(0,10)`）或固定為近期日期，避免顯示過期菜單
- 若保持靜態日期，不影響功能（系統以 posStore 的 viewDate 為準）

## Success Criteria

- 所有現有 tests pass（部分 test 可能依賴 INITIAL_TODAY_TX 或 balance，需更新 mock）
- App 啟動後顯示 20 個學生，餘額皆為 0
- 無初始交易紀錄

## Required Tests

- 更新任何依賴 `INITIAL_STUDENTS[n].currentBalance !== 0` 或 `INITIAL_TODAY_TX.length > 0` 的既有 test assertions
- 確認 posStore 初始化後 students.length === 20 且 all balance === 0
