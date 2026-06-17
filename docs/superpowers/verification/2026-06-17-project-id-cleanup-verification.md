# Project ID Cleanup Verification Checklist

> Generated: 2026-06-17
> PR: #373
> HEAD: 37c53ff806b179861173c04f0955518a6d0dde1d
> Plan: none (Simple task)

## How to test

```bash
cd /Users/cheerc/.agend/worktrees/eo-team-impl/feat/cleanup-project-id-373
grep -rn "gen-lang-client-0613258198" . --exclude-dir=.git
```

---

## §1: Project ID Cleanup

### 驗證步驟
1. 確保在 `feat/cleanup-project-id-373` 工作區。
2. 執行 `grep -rn "gen-lang-client-0613258198" . --exclude-dir=.git`。
3. 檢查是否有 any 結果輸出。

### 預期行為
- `grep` 應回傳結束狀態 `1` (或無任何匹配結果)。
- 全專案已無硬編碼的 `gen-lang-client-0613258198`。
- 本地測試 `t1`, `t2`, `t3`, `t4` 全數通過。

| # | 測試項目 | Pass? |
|---|---------|-------|
| 1 | 全域搜尋 `gen-lang-client-0613258198` 回傳 0 筆結果 | [ ] |
| 2 | `workflow-lib.sh` 與 `deploy.sh` 已更換為動態變數 | [ ] |
| 3 | `docs/` 下的說明文件已替換為 `<firebase-project-id>` 預留符號 | [ ] |
| 4 | `./workflow.sh t1` 成功通過 (Vite build) | [ ] |
| 5 | `./workflow.sh t2` 成功通過 (Typecheck) | [ ] |
| 6 | `./workflow.sh t3` 成功通過 (Lint) | [ ] |
| 7 | `./workflow.sh t4` 成功通過 (Unit tests) | [ ] |

---

## Summary

| Section | 測試項目數 |
|---------|----------|
| §1 | 7 |
| **合計** | **7** |
