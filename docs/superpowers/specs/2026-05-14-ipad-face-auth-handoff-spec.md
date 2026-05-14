# iPad Face Auth Handoff Spec

## 功能描述

iPad Face Auth Handoff 定義 PDF Phase 2：iPad 以相機做人臉辨識，辨識成功後把學員身份事件推送到 PC POS 搜尋/選取流程，由 PC 操作員完成訂餐、儲值、取消與帳務確認。

這個模組的核心不是讓 iPad 自動結帳，而是把「找學員」自動化。PDF 明確要求 iPad 端保護隱私：只顯示辨識成功的綠色回饋與學生姓名，不顯示餘額、欠費、交易金額或帳務資訊。PC 仍是 Phase 2 的帳務主控端。

## 使用者故事

- As a student, I want to stand in front of the iPad and be recognized quickly so that I do not need to recite my student id.
- As a student, I want the iPad to show only my name and recognition status so that my balance or debt is not exposed to others.
- As a counter operator, I want a successful iPad recognition to select or queue the student on the PC so that I can finish the normal POS confirmation flow.
- As a counter operator, I want iPad failures to fall back to PC text search so that service can continue.
- As an admin, I want to enroll, disable, and re-enroll face profiles so that recognition quality can be maintained.
- As an admin, I want ambiguous or low-confidence matches to require manual resolution so that the wrong account is not selected.
- As an operator, I want iPad recognition to continue locally when network is unavailable if the device already has the needed profile index.

## 驗收標準

### Recognition Privacy

Given the iPad recognizes a student successfully
When the success screen is shown
Then it displays only success state and student display name, and does not display balance, debt, transaction history, meal price, or payment amount.

Given the iPad does not recognize a student
When the failure screen is shown
Then it displays retry and "ask counter staff" fallback instructions without exposing candidate balances or admin diagnostics.

Given the iPad is in student-facing recognition mode
When a non-admin user interacts with the screen
Then admin enrollment, debug confidence values, and account details are not accessible.

### PC Handoff

Given the PC POS is idle
When the iPad sends a valid recognition event for one active student
Then the PC selects that student with source `ipad` and does not create a transaction.

Given the PC POS has an active selected student or uncommitted transaction
When a new iPad recognition event arrives
Then the PC queues or visibly rejects the event and never replaces the active student silently.

Given the same iPad recognition event is delivered twice
When the PC receives the duplicate event id
Then the duplicate is ignored and no duplicate order or duplicate queue item is created.

Given a handoff event references an inactive or missing student
When the PC validates the event
Then the event is rejected with an operator-visible error and fallback to manual search.

### Confidence And Ambiguity

Given face recognition returns confidence above the accepted threshold for one active student
When the event is created
Then the handoff payload includes student id, display name, confidence band, device id, event id, and timestamp.

Given recognition returns multiple close candidates
When the iPad is in student-facing mode
Then no account is selected automatically and the iPad asks the student to retry or go to the counter.

Given recognition confidence is below threshold
When the iPad processes the frame
Then no handoff is sent and the UI shows retry/fallback state.

### Enrollment

Given an admin opens enrollment for an active student
When the camera permission is granted and capture quality passes
Then a face profile reference is linked to that student with enrollment status `enrolled`.

Given a student already has an enabled face profile
When an admin attempts re-enrollment
Then the UI requires confirmation and records the previous profile as disabled or superseded.

Given a face profile is disabled
When the student appears at the iPad
Then the disabled profile is not used for recognition, while PC manual search remains available.

### Offline Operation

Given the iPad has a local recognition profile index
When network connectivity is unavailable
Then local recognition can still produce a handoff event if the PC handoff channel is reachable locally.

Given the iPad cannot reach the PC handoff channel
When recognition succeeds locally
Then the iPad does not tell the student ordering is complete; it instructs them to go to the counter.

Given the profile index is stale or missing
When the iPad starts recognition mode
Then the UI shows unavailable/fallback state and admin sync repair is required.

## 技術約束

- The current app is pure frontend. Phase 2 implementation must choose a camera/recognition architecture in the plan before code work.
- Browser camera access on iPad requires HTTPS or trusted local deployment and explicit permission handling.
- Candidate face libraries/models must be tested on target iPad hardware for startup time, frame rate, recognition accuracy, and offline behavior before production use.
- Raw biometric images/vectors must not be written to Google Sheets by default. Student records store only profile references/status unless a later privacy/storage decision explicitly approves more.
- PC remains the accounting authority. iPad handoff selects/preselects a student only; transaction confirmation stays in `pc-pos-order-flow`.
- Handoff events require stable event ids and idempotency to avoid duplicate queue items.
- The iPad must not depend on showing PC-only financial data.
- Existing test chain applies from `frontend/`: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build`.

## UI/UX 要求

- iPad recognition view is full-screen, high contrast, touch-friendly, and readable at counter distance.
- Student-facing iPad copy is minimal: scanning, success with name, retry/failure, and go-to-counter fallback.
- Success state uses a positive visual treatment, but must not imply the order is complete until PC confirms.
- Admin enrollment mode is separate from student-facing recognition and protected by admin entry point.
- PC handoff indicator should make source clear, for example "iPad matched", while preserving the normal PC transaction controls.
- Ambiguous/no-match/camera-denied/offline states must each have distinct actionable UI.
- Manual PC search remains visible and usable regardless of iPad state.

## 與其他模組的介面

### 輸入

- Active student identity, display name, and face profile status from `student-account-management`.
- Sync health/profile-index availability from `google-sheets-sync-and-offline` or the selected profile distribution mechanism.
- PC POS availability/active-state response from `pc-pos-order-flow`.

### 輸出

- `FaceHandoffEvent` to `pc-pos-order-flow`.
- Face profile link/unlink/status updates to `student-account-management`.
- Profile sync or enrollment audit events to `google-sheets-sync-and-offline`, excluding raw biometric data unless explicitly approved.
- Admin diagnostics for recognition failures, low confidence, camera permissions, and stale profile index.

### 依賴關係

- Depends on `student-account-management` for one-to-one active student/profile linkage.
- Feeds `pc-pos-order-flow` with optional student preselection events.
- Depends on `google-sheets-sync-and-offline` only for metadata/status sync; local recognition should tolerate network loss when profile index exists.
- Does not depend on menu/vendor or cash close directly.

## 建議資料型別

```ts
export type FaceProfileStatus = 'none' | 'enrolled' | 'disabled' | 'needs_review';
export type FaceHandoffStatus = 'pending' | 'accepted' | 'queued' | 'rejected' | 'duplicate';
export type ConfidenceBand = 'high' | 'medium' | 'low';

export interface FaceProfileLink {
  faceProfileId: string;
  studentId: string;
  status: FaceProfileStatus;
  enrolledAt: string;
  enrolledBy: string;
  disabledAt?: string;
  disabledBy?: string;
  disableReason?: string;
  revision: number;
}

export interface FaceHandoffEvent {
  eventId: string;
  deviceId: string;
  studentId: string;
  studentDisplayName: string;
  confidenceBand: ConfidenceBand;
  recognizedAt: string;
  expiresAt: string;
}

export interface FaceHandoffResult {
  eventId: string;
  status: FaceHandoffStatus;
  reason?: string;
  handledAt: string;
}
```

## 現有實作對照

- Current implementation has no iPad route, camera flow, recognition model, enrollment UI, profile index, or handoff receiver.
- Existing PC search/selection flow can receive future `FaceHandoffEvent` by selecting the matched student with source `ipad`.
- Existing student model needs the `faceProfileId` / `faceEnrollmentStatus` fields defined in `student-account-management`.
- Current sync/offline behavior is fake and cannot distribute profile metadata yet.

## 不在本模組範圍

- Autonomous iPad checkout or payment.
- Showing balance/debt on iPad.
- Parent/student mobile app.
- Final biometric storage provider selection.
- Production consent/legal policy text beyond the technical privacy boundary in this spec.
