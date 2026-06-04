# Student Account Management Spec

## 功能描述

Student Account Management 定義學員主檔、帳戶餘額、搜尋、匯入驗證流程，以及 Phase 2 人臉辨識 enrollment 所需的學員端資料邊界。

已實作完整的學員領域層（`domain/student.ts`）：`StudentAccount` 型別含 studentId、displayName、status、currentBalance、aliases、className、groupName、faceProfileId、faceEnrollmentStatus。搜尋支援學號/姓名/別名（`searchActiveStudents`）。匯入驗證（`validateStudentImportRows`）檢查重複 studentId、空白姓名、非數字餘額。Firebase 整合層（`firebase/studentRepository.ts`）處理 CRUD。

核心原則：學員基本資料可以修正，但歷史交易保留當下快照（`StudentSnapshot`）；餘額只能透過可稽核交易改變，不能被一般表單直接覆寫。

## 使用者故事

- As an admin, I want to import a student roster with ids, names, and opening balances so that the POS can start from a controlled source of truth.
- As an admin, I want to edit a student's display name and aliases so that operators can find the right student when names change or nicknames are used.
- As an admin, I want to deactivate a student instead of deleting them so that historical ledgers and settlements remain auditable.
- As a counter operator, I want search results to show id, name, and balance status so that I can confidently pick the correct account during a queue.
- As a counter operator, I want inactive students hidden from normal POS search so that old accounts do not get accidental new transactions.
- [PLANNED] As an enrollment admin, I want to link one face profile to one active student so that Phase 2 recognition can hand off a stable student id to the PC.
- As an accounting user, I want every balance correction to create an auditable record so that unexplained balance drift is impossible.

## 驗收標準

### Roster Import

Given an admin imports a roster file with unique student ids, non-empty names, and numeric opening balances
When `validateStudentImportRows` processes the rows
Then it returns `valid` rows and `errors` array. Valid rows have no blocking errors.

Given an imported roster contains duplicate `studentId` values
When validation runs
Then each duplicate row is listed with row number and `Duplicate studentId` message. Duplicate rows are excluded from `valid`.

Given an imported roster contains an empty display name
When validation runs
Then the row has a `displayName` field error: "Display name is required". Row excluded from `valid`.

Given an imported roster contains a non-numeric opening balance
When validation runs
Then the row has an `openingBalance` field error: "Opening balance must be numeric". Row excluded from `valid`.

### Student Maintenance

Given a student has existing transactions
When an admin edits the student's `displayName`
Then future search and admin screens show the new name, and existing transactions keep their original `studentNameSnapshot` (captured via `createStudentSnapshot`).

Given a student has existing ledger history
When an admin tries to delete the student
Then hard delete is unavailable; the UI offers deactivate instead (`status = 'inactive'`).

Given a student is deactivated
When a counter operator searches via `searchActiveStudents` or `filterActiveStudents`
Then the inactive student is filtered out (only `status === 'active'` returned).

Given a student is deactivated
When an admin searches from the student management screen with "include inactive" enabled
Then the inactive student is visible and can be reactivated.

### Balance Integrity

Given an order, payment, or expense transaction is committed
When `recalculateStudentBalances` runs
Then the student's `currentBalance` equals the prior balance plus all transaction amounts, deterministically computed.

Balance is derived from ledger transactions. Direct UI mutation of `currentBalance` is forbidden outside audited migration/correction flows.

### Face Profile Linkage [PLANNED]

The `StudentAccount` type includes `faceProfileId` (optional string) and `faceEnrollmentStatus` (`'none' | 'enrolled' | 'disabled' | 'needs_review'`). These fields are defined but the enrollment UI and face profile management are Phase 2 planned features.

## 技術約束

- Vite 8 + React 19 + TypeScript 6 + Zustand 5.
- Domain model is plain serializable TypeScript data.
- Student ids are stable business identifiers. UI list keys must not depend on array index.
- Historical transactions store `studentNameSnapshot` via `createStudentSnapshot`.
- `currentBalance` is derived/current-state cache updated by ledger operations.
- Import validation is deterministic and testable as pure functions (`validateStudentImportRows`).
- Face metadata stores profile references and enrollment status only. Raw biometric data is not stored.
- Test chain: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build`.

## 實際型別（對齊 `domain/student.ts`）

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

export interface StudentImportRow {
  studentId: string;
  displayName: string;
  openingBalance: string;
}

export interface ImportFieldError {
  row: number;
  field: 'studentId' | 'displayName' | 'openingBalance';
  message: string;
}

export interface StudentImportResult {
  valid: StudentImportRow[];
  errors: ImportFieldError[];
}
```

## 與其他模組的介面

### 輸入

- Roster import rows from manual upload/paste or Firebase migration.
- Balance-changing events from `pc-pos-order-flow-spec` and `order-ledger-cash-close-spec`.
- Sync status updates from Firebase (`firebase/studentRepository.ts`).
- [PLANNED] Face enrollment link/unlink events from `ipad-face-auth-handoff-spec`.

### 輸出

- `StudentAccount` records for POS search, admin list/detail, ledger joins, and sync serialization.
- `StudentSnapshot` for transactions: `studentId` and `studentNameSnapshot`.
- Search results via `searchActiveStudents` (text) and `resolveScannedStudent` (barcode).

### 依賴關係

- `pc-pos-order-flow-spec` depends on active-student search and current balance display.
- `order-ledger-cash-close-spec` depends on stable ids and name snapshots for historical reporting.
- Firebase layer depends on flat serializable student rows and stable revision/update fields.
- [PLANNED] `ipad-face-auth-handoff-spec` depends on one-to-one active student/profile linkage.

## 不在本模組範圍

- Transaction creation UI and keyboard flow; covered by `pc-pos-order-flow-spec`.
- Settlement and closeout approval; covered by `order-ledger-cash-close-spec`.
- Firebase transport, retry, and conflict handling.
- Camera capture and face matching implementation; covered by `ipad-face-auth-handoff-spec`.
