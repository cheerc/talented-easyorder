# Student Account Management Spec

## 功能描述

Student Account Management 定義學員主檔、帳戶餘額、搜尋資料品質、匯入/修正流程，以及 Phase 2 人臉辨識 enrollment 所需的學員端資料邊界。

這個模組解決目前 prototype 只用 mock `Student { id, name, balance }` 的問題，讓 PC POS、報表結算、Google Sheets 同步、iPad 人臉辨識可以共用一套穩定的學員身份模型。核心原則是：學員基本資料可以修正，但歷史交易必須保留當下快照；餘額只能透過可稽核交易或初始化/修正紀錄改變，不能被一般表單直接覆寫。

## 使用者故事

- As an admin, I want to import a student roster with ids, names, and opening balances so that the POS can start from a controlled source of truth.
- As an admin, I want to edit a student's display name and aliases so that operators can find the right student when names change or nicknames are used.
- As an admin, I want to deactivate a student instead of deleting them so that historical ledgers and settlements remain auditable.
- As a counter operator, I want search results to show id, name, and balance status so that I can confidently pick the correct account during a queue.
- As a counter operator, I want inactive students hidden from normal POS search so that old accounts do not get accidental new transactions.
- As an enrollment admin, I want to link one face profile to one active student so that Phase 2 recognition can hand off a stable student id to the PC.
- As an accounting user, I want every balance correction to create an auditable record so that unexplained balance drift is impossible.

## 驗收標準

### Roster Import

Given an admin imports a roster file with unique student ids, non-empty names, and numeric opening balances
When the admin previews the import
Then the UI shows row counts, new records, changed records, unchanged records, and no blocking errors.

Given an imported roster contains duplicate `studentId` values
When the admin previews the import
Then the import is blocked and every duplicate row is listed with row number and duplicated id.

Given an imported roster contains an empty display name or non-numeric opening balance
When the admin previews the import
Then the invalid rows are blocked with field-level messages and valid rows are not committed until the admin confirms a clean import.

### Student Maintenance

Given a student has existing transactions
When an admin edits the student's `displayName`
Then future search and admin screens show the new name, and existing transactions keep their original `studentNameSnapshot`.

Given a student has existing ledger history
When an admin tries to delete the student
Then hard delete is unavailable and the UI offers deactivate instead.

Given a student is deactivated
When a counter operator searches in the normal POS flow
Then the inactive student is not shown by default.

Given a student is deactivated
When an admin searches from the student management screen with "include inactive" enabled
Then the inactive student is visible and can be reactivated.

### Balance Integrity

Given an admin opens a student edit form
When they attempt to change `currentBalance` directly
Then the save is blocked unless the action creates an audited opening-balance migration or balance-correction ledger record.

Given an order, top-up, cancel, or correction transaction is committed
When the transaction reducer recalculates student state
Then the student's current balance equals the prior balance plus the transaction net amount.

### Face Profile Linkage

Given an active student has no face profile
When an enrollment admin links a new `faceProfileId`
Then the student record stores the profile reference and records `faceEnrollmentStatus = enrolled`.

Given a `faceProfileId` is already linked to one active student
When an enrollment admin attempts to link it to a different active student
Then the save is blocked until the previous link is disabled or explicitly transferred with an audit reason.

Given a face profile is disabled
When the student uses PC id/name search
Then PC search still works and only iPad face recognition is disabled for that student.

## 技術約束

- Frontend remains pure Vite 8 + React 19 + TypeScript 6 + Zustand 5. No backend can be assumed for the first implementation pass.
- The domain model must be plain serializable TypeScript data so it can persist through Zustand/localStorage and map to Google Sheets rows.
- Student ids are stable business identifiers. UI list keys and sync ids must not depend on array index.
- Historical transactions must store `studentNameSnapshot`; reports cannot join live name only.
- `currentBalance` is a derived/current-state cache updated by ledger operations. Direct UI mutation is forbidden outside audited migration/correction flows.
- Face metadata must store profile references and enrollment status only. Raw biometric vectors, images, or model artifacts are not stored in the student sheet unless a later privacy/storage decision explicitly approves it.
- Import must be deterministic and testable as pure parsing/validation functions before wiring UI.
- Existing test chain applies from `frontend/`: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build`.

## UI/UX 要求

- Student management lives under the admin area, separate from the high-speed POS counter flow.
- Normal POS search defaults to active students only and displays id, name, and balance state with clear debt/low-balance treatment.
- Admin search supports filters for active, inactive, missing face profile, and validation issues.
- Roster import uses a preview-confirm flow: upload/paste, validate, preview counts/errors, then commit.
- Editing student identity fields uses inline validation and does not show a generic success state until persistence is complete or queued.
- Deactivate/reactivate actions use explicit confirmation copy that explains transaction history remains.
- Face enrollment status is visible in admin detail/list views but not in the student-facing iPad recognition success screen.
- Similar or duplicate display names must be disambiguated by student id and optional aliases/class/group fields once those fields are present.

## 與其他模組的介面

### 輸入

- Roster import rows from manual upload/paste or Google Sheets migration.
- Balance-changing events from `pc-pos-order-flow` and `order-ledger-and-cash-close`.
- Sync status updates from `google-sheets-sync-and-offline`.
- Face enrollment link/unlink events from `face-auth-ipad-handoff`.

### 輸出

- `StudentAccount` records for POS search, admin list/detail, ledger joins, and sync serialization.
- Search result view models containing `studentId`, `displayName`, `currentBalance`, `status`, and disambiguation fields.
- Student snapshots for transactions: at minimum `studentId` and `studentNameSnapshot`.
- Enrollment references for iPad recognition: `studentId`, `displayName`, `faceProfileId`, `faceEnrollmentStatus`.

### 依賴關係

- `pc-pos-order-flow` depends on active-student search and current balance display.
- `order-ledger-and-cash-close` depends on stable ids and name snapshots for historical reporting.
- `google-sheets-sync-and-offline` depends on flat serializable student rows and stable revision/update fields.
- `face-auth-ipad-handoff` depends on one-to-one active student/profile linkage and a privacy-safe display name.

## 建議資料型別

```ts
export type StudentStatus = 'active' | 'inactive';
export type FaceEnrollmentStatus = 'none' | 'enrolled' | 'disabled' | 'needs_review';

export interface StudentAccount {
  studentId: string;
  displayName: string;
  status: StudentStatus;
  currentBalance: number;
  aliases: string[];
  className?: string;
  groupName?: string;
  faceProfileId?: string;
  faceEnrollmentStatus: FaceEnrollmentStatus;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface StudentSnapshot {
  studentId: string;
  studentNameSnapshot: string;
}
```

## 現有實作對照

- Current model: `frontend/src/mocks/initialData.ts` defines `Student { id, name, balance }`.
- Current store: `frontend/src/store/posStore.ts` mutates student balances through transactions and persists with Zustand.
- Current admin UI: `AdminScreen` shows only the first 10 students and the "查看全部 / 新增學員" button is still a stub.
- Current tests: `posStore.test.ts` verifies basic order balance and update propagation, but not import validation, inactive filtering, name snapshots, or face profile linkage.

## 不在本模組範圍

- Transaction creation UI and keyboard flow; covered by `pc-pos-order-flow`.
- Settlement and closeout approval; covered by `order-ledger-and-cash-close`.
- Google Sheets transport, retry, and conflict handling; covered by `google-sheets-sync-and-offline`.
- Camera capture and face matching implementation; covered by `face-auth-ipad-handoff`.
