# Order Payment Amount Verification Checklist

> Generated: 2026-06-17
> PR: #375
> HEAD: 2ce2601d6b95c1c8adb4f4bbde404a61034accca
> Plan: docs/superpowers/plans/375-order-payment-amount.md

## How to test

```bash
cd /Users/cheerc/.agend/worktrees/eo-team-impl/feat/order-payment-amount-375
./workflow.sh t4-file src/domain/__tests__/posTransaction.test.ts
```

---

## §1: Order Payment Amount Implementation

### 驗證步驟
1. 確保在 `feat/order-payment-amount-375` 工作區。
2. 執行 `./workflow.sh t4`，確認所有 unit tests 皆通過。

### 預期行為
- 新增的 `deriveTransactionAttributes` 測試成功通過。
- 專案的所有測試皆維持通過（無 regression）。

| # | 測試項目 | Pass? |
|---|---------|-------|
| 1 | `deriveTransactionAttributes` 於 order 模式下正確衍生 `paidAmount` | [ ] |
| 2 | `useTransactionCommit.ts` 中的 crash draft `amount` 在 order 模式下正確計入 `paidAmount` | [ ] |
| 3 | `./workflow.sh t4` 所有 907 個單元測試全數通過 | [ ] |

---

## Summary

| Section | 測試項目數 |
|---------|----------|
| §1 | 3 |
| **合計** | **3** |
