# EasyOrder Firebase Backup Runbook

> **2026-10-13 適用範圍：** 本文保留既有設計／實作參考；新正式後端以[零費用 spec](../superpowers/specs/2026-10-13-free-production-backend-spec.md)及[階段計畫](../superpowers/plans/2026-10-13-free-production-backend-plan.md)為準，尚未實作。不得依舊文將 EasyOrder 部署到 payroll 計費專案；正式部署、備份與安全操作須等計畫中對應階段更新並驗證。

## Daily Counter Export

1. Confirm sync badge is green before export when possible.
2. Export transaction CSV for the business date.
3. Export settlement CSV for the business date.
4. Save files to the school-approved backup location.
5. If sync badge is yellow or red, export local visible data and mark the filename with `pending-sync`.

## Restore Ownership

- Counter operator owns daily export.
- Director/admin owns restore approval.
- Developer/support may assist only after director/admin approval.

## Restore Drill

1. Create a Firebase project backup through Google Cloud export or Firestore managed export if available to the account.
2. Verify transaction count, settlement count, and student count against exported CSV.
3. Do not delete production Firestore data during a drill.
