# EasyOrder Firebase Backup Runbook

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
