# Phase 2 iPad Face Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add privacy-safe iPad recognition that identifies a student and hands off a student-selection event to the PC POS without exposing financial data or making the iPad an accounting authority.

**Architecture:** Treat iPad recognition as a student lookup source, not checkout. Build a pure face-profile/handoff domain layer, a fake recognizer for deterministic tests, a browser camera feasibility gate for target iPad hardware, and a PC receiver that accepts or queues idempotent `FaceHandoffEvent` records through the Phase 1.1 POS state machine.

**Tech Stack:** Vite 8, React 19, TypeScript 6, Zustand 5, Vitest 4, Testing Library, browser `getUserMedia`, target iPad Safari/PWA feasibility checks, fake recognizer adapter, optional TensorFlow.js/MediaPipe pilot adapter after feasibility approval.

---

## Source Specs

- `docs/superpowers/specs/2026-05-14-ipad-face-auth-handoff-spec.md`
- `docs/superpowers/specs/2026-05-14-student-account-management-spec.md`
- `docs/superpowers/specs/2026-05-14-google-sheets-sync-offline-spec.md`
- `docs/superpowers/specs/2026-05-14-pc-pos-order-flow-spec.md`
- `docs/superpowers/plans/2026-05-14-phase-1-0-foundation-hardening.md`
- `docs/superpowers/plans/2026-05-14-phase-1-1-pc-pos-formalization.md`
- `docs/superpowers/plans/2026-05-14-phase-1-3-google-sheets-sync-offline.md`
- `docs/superpowers/plans/ROADMAP.md`

## Official Browser / Model References

Checked on 2026-05-14:

- MDN documents `MediaDevices.getUserMedia()` as secure-context only, permission-gated, and able to reject with permission/device errors: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- WebKit documents Safari/iOS media capture constraints, HTTPS requirement, user permission, capture indicators, and same-origin framing considerations: https://webkit.org/blog/7763/a-closer-look-into-webrtc/
- TensorFlow.js model documentation lists browser-capable face detection and face landmark models, but model choice and target-iPad performance still require hardware testing: https://www.tensorflow.org/js/models
- WICG Shape Detection `FaceDetector` is a draft API for face detection, not a portable production face-recognition solution: https://wicg.github.io/shape-detection-api/

## Phase Estimate

- Total estimate: 8-12 dev days.
- Complexity: high. The core risk is not UI wiring; it is privacy-safe biometric handling plus real iPad camera/model behavior.
- Recommended PR split:
  - PR 1: feasibility decision record, face profile domain, fake recognizer, privacy tests, and route skeleton.
  - PR 2: iPad recognition UI, enrollment/disable/re-enroll admin flow, local profile index, and PC handoff receiver integration.
  - PR 3: target iPad pilot adapter, offline/channel behavior, diagnostics, and production go/no-go checklist.

## Architecture Decision Matrix

| Option | How It Works | Strengths | Risks / Costs | Phase 2 Decision |
|---|---|---|---|---|
| Browser iPad web app with local model | iPad route uses `getUserMedia`, loads a browser-capable model/profile index, and emits a handoff event to the PC. | Matches current frontend architecture; no native app; can work offline when profile index and local handoff channel are available; keeps PC as checkout authority. | Requires HTTPS/trusted deployment and explicit camera permission; iPad performance and model accuracy are unknown until hardware test; biometric profile storage requires care. | **Choose for Phase 2 pilot after feasibility gate**. Fake recognizer is mandatory for automated tests; real model adapter lands only behind a feature flag and pilot checklist. |
| Native iPad app / WebView wrapper | Native app owns camera and local ML; web app receives handoff events. | Stronger device APIs, app-managed permissions, better packaging and kiosk options. | Adds native build, App Store/TestFlight or device management, and new operational ownership. | **Escalation path** if browser camera/model feasibility fails or kiosk reliability is required. |
| Server/cloud recognition | iPad uploads frames or embeddings to a backend service for recognition. | Centralized model management and easier hardware requirements on iPad. | Higher privacy risk, network dependency, latency, consent/legal burden, and backend scope. | **Rejected for Phase 2 initial implementation**. Reconsider only after explicit privacy/storage approval. |
| Manual QR/barcode fallback only | iPad is skipped; PC uses manual or scanner lookup. | Lowest privacy and model risk. | Does not satisfy Phase 2 face recognition goal. | **Fallback path**, not the Phase 2 target. |

## Task Board Breakdown

| Task ID | Title | Estimate | Primary Files | Depends On |
|---|---|---:|---|---|
| EO-P20-T01 | iPad camera/model feasibility decision record | 1 day / 3 SP | `docs/face-handoff/ipad-feasibility.md`, `frontend/src/domain/faceFeasibility.ts` | Phase 1.3 metadata path |
| EO-P20-T02 | Face profile domain and privacy boundary | 1 day / 3 SP | `frontend/src/domain/faceProfile.ts`, `frontend/src/domain/__tests__/faceProfile.test.ts` | EO-P20-T01 |
| EO-P20-T03 | Recognizer adapter contract and fake recognizer | 0.75 day / 2 SP | `frontend/src/domain/faceRecognition.ts`, `frontend/src/services/face/fakeFaceRecognizer.ts` | EO-P20-T02 |
| EO-P20-T04 | Student-facing iPad recognition route | 1.25 days / 5 SP | `frontend/src/components/ipad/IpadRecognitionScreen.tsx`, `frontend/src/__tests__/ipadRecognitionScreen.integration.test.tsx` | EO-P20-T03 |
| EO-P20-T05 | Admin enrollment, disable, and re-enroll workflow | 1.25 days / 5 SP | `frontend/src/components/admin/FaceEnrollmentPanel.tsx`, `frontend/src/store/posStore.ts` | EO-P20-T02, EO-P20-T03 |
| EO-P20-T06 | Local profile index and offline readiness | 1 day / 3 SP | `frontend/src/domain/faceProfileIndex.ts`, `frontend/src/domain/__tests__/faceProfileIndex.test.ts` | EO-P20-T05 |
| EO-P20-T07 | Face handoff event creation and PC receiver integration | 1 day / 3 SP | `frontend/src/domain/faceHandoff.ts`, `frontend/src/hooks/useFaceHandoffReceiver.ts`, `frontend/src/hooks/usePosFlow.ts` | EO-P20-T04, Phase 1.1 |
| EO-P20-T08 | Handoff channel, idempotency, and local reachability | 0.75 day / 2 SP | `frontend/src/services/face/localHandoffChannel.ts`, `frontend/src/domain/__tests__/faceHandoff.test.ts` | EO-P20-T07 |
| EO-P20-T09 | Diagnostics, audit events, and sync metadata | 0.75 day / 2 SP | `frontend/src/domain/faceDiagnostics.ts`, `frontend/src/components/admin/FaceDiagnosticsPanel.tsx` | EO-P20-T06, Phase 1.3 |
| EO-P20-T10 | Real iPad pilot adapter behind feature flag | 1 day / 3 SP | `frontend/src/services/face/browserFaceRecognizer.ts`, `docs/face-handoff/ipad-pilot-checklist.md` | EO-P20-T01, EO-P20-T03 |
| EO-P20-T11 | Phase verification and production go/no-go gate | 0.75 day / 2 SP | `frontend/src/__tests__/faceHandoff.integration.test.tsx`, `docs/face-handoff/production-readiness.md` | EO-P20-T10 |

## Key Technical Decisions

1. PC remains the accounting authority.
   - iPad creates only `FaceHandoffEvent`.
   - PC must never create a transaction from handoff alone.
   - PC operator still confirms order, top-up, cancel, and payment.

2. Privacy boundary is enforced by types and tests.
   - iPad student-facing screens may show display name and recognition state only.
   - They must not receive balance, debt, transaction history, meal price, paid amount, cash-close status, or report data as props.

3. Real recognition is gated by target hardware evidence.
   - Fake recognizer covers automated tests.
   - Real browser recognizer is feature-flagged and requires target iPad pilot results before production use.
   - `FaceDetector` may help detection in supporting browsers, but it is not a portable recognition strategy.

4. Raw biometric data does not go to Google Sheets.
   - Student rows store `faceProfileId` and `faceEnrollmentStatus`.
   - Profile index entries are local/private to the chosen recognition mechanism.
   - Any remote biometric storage provider requires a later explicit privacy/storage decision.

5. Offline behavior is bounded.
   - iPad may recognize locally if profile index exists.
   - If the PC handoff channel is unreachable, iPad tells the student to go to the counter and does not imply ordering is complete.

## Data Flow

```text
Admin enrollment
  -> face profile link/status metadata
  -> local profile index refresh

iPad recognition screen
  -> camera permission and recognizer adapter
  -> recognition result or failure state
  -> FaceHandoffEvent with stable event id
  -> local handoff channel
  -> PC receiver validates student and POS state
  -> PosFlowState selects / queues / rejects
  -> PC operator confirms transaction
```

## Component Tree Impact

```text
App
  PC POS route
    usePosFlow
    useFaceHandoffReceiver
    IpadHandoffIndicator
  iPad route
    IpadRecognitionScreen
  Admin route
    FaceEnrollmentPanel
    FaceDiagnosticsPanel
```

No report/cash-close UI is redesigned in Phase 2. Report screens may show audit metadata for face profile changes only if Phase 1.3 sync events are already present.

## EO-P20-T01: iPad Camera/Model Feasibility Decision Record

**Estimate:** 1 day / 3 SP

**Files:**

- Create: `docs/face-handoff/ipad-feasibility.md`
- Create: `frontend/src/domain/faceFeasibility.ts`
- Create: `frontend/src/domain/__tests__/faceFeasibility.test.ts`
- Modify: `frontend/src/domain/index.ts`

**Implementation Plan:**

- [ ] Create `docs/face-handoff/ipad-feasibility.md` with:
  - target iPad model and iPadOS version.
  - target browser mode: Safari tab, installed PWA, or managed kiosk browser.
  - deployment origin and HTTPS/trusted-local plan.
  - camera permission results.
  - startup time target.
  - frame processing target.
  - recognition latency target.
  - offline profile index behavior.
  - PC handoff channel reachability.
  - final go/no-go decision for real model pilot.
- [ ] Define feasibility types:

```ts
export type IpadRuntimeMode = 'safari_tab' | 'installed_pwa' | 'managed_kiosk';
export type FeasibilityStatus = 'untested' | 'pass' | 'fail' | 'needs_native_app';

export interface IpadFeasibilityResult {
  testedAt: string;
  deviceLabel: string;
  ipadosVersion: string;
  runtimeMode: IpadRuntimeMode;
  secureContext: boolean;
  cameraPermission: 'granted' | 'denied' | 'prompt_unresolved' | 'unavailable';
  cameraStartMs: number;
  averageFrameMs: number;
  recognitionP95Ms: number;
  offlineProfileIndexAvailable: boolean;
  localPcChannelReachable: boolean;
  status: FeasibilityStatus;
  notes: string;
}
```

- [ ] Implement `evaluateIpadFeasibility(result)`:
  - fails when `secureContext` is false.
  - fails when camera permission is denied or unavailable.
  - fails when `recognitionP95Ms > 1500`.
  - fails when offline profile index is missing.
  - returns `needs_native_app` when camera is usable only outside the selected runtime mode.
  - passes only when all gates pass.
- [ ] Export types/functions from `frontend/src/domain/index.ts`.

**Testing Strategy:**

- Unit:
  - insecure context fails.
  - denied camera fails.
  - slow recognition fails.
  - missing profile index fails.
  - runtime-specific camera failure returns `needs_native_app`.
  - all passing metrics return `pass`.

**Acceptance Criteria:**

- Real face-recognition implementation cannot be treated as production-ready until this document has a passing target-device result.
- Tests run with `npx vitest run src/domain/__tests__/faceFeasibility.test.ts`.

## EO-P20-T02: Face Profile Domain And Privacy Boundary

**Estimate:** 1 day / 3 SP

**Files:**

- Create: `frontend/src/domain/faceProfile.ts`
- Create: `frontend/src/domain/__tests__/faceProfile.test.ts`
- Modify: `frontend/src/domain/index.ts`

**Implementation Plan:**

- [ ] Define face profile types:

```ts
export type FaceProfileStatus = 'none' | 'enrolled' | 'disabled' | 'needs_review';

export interface FaceProfileLink {
  faceProfileId: string;
  studentId: string;
  status: FaceProfileStatus;
  enrolledAt: string;
  enrolledBy: string;
  disabledAt?: string;
  disabledBy?: string;
  disableReason?: string;
  supersededByProfileId?: string;
  revision: number;
}

export interface StudentFaceMetadata {
  studentId: string;
  displayName: string;
  faceProfileId?: string;
  faceEnrollmentStatus: FaceProfileStatus;
}
```

- [ ] Implement `createFaceProfileLink(args)`.
- [ ] Implement `disableFaceProfile(link, args)` requiring `disableReason`.
- [ ] Implement `reenrollFaceProfile(previousLink, args)`:
  - disables previous enabled profile.
  - creates a new enabled profile.
  - links the old profile to `supersededByProfileId`.
- [ ] Implement `validateOneActiveProfilePerStudent(links)`.
- [ ] Implement `validateOneStudentPerActiveProfile(links)`.
- [ ] Implement `toStudentFaceMetadata(student)`.
- [ ] Implement `assertIpadSafeStudentPayload(payload)`:
  - allows `studentId`, `displayName`, `faceProfileId`, `faceEnrollmentStatus`.
  - rejects `currentBalance`, `balance`, `debt`, `transactions`, `mealPrice`, `paidAmount`, `amount`, `afterBalance`, and `cashCloseStatus`.
- [ ] Export functions/types from `frontend/src/domain/index.ts`.

**Testing Strategy:**

- Unit:
  - one active profile per active student passes.
  - duplicate active profile for one student fails.
  - one active profile linked to two students fails.
  - disabled profile is excluded from recognition metadata.
  - re-enrollment disables previous profile and creates a new link.
  - privacy assertion rejects balances, debt, transaction rows, meal price, and payment amount.

**Acceptance Criteria:**

- Face profile metadata remains serializable and Sheets-safe.
- Raw biometric vectors/images are not represented by this domain type.
- Tests run with `npx vitest run src/domain/__tests__/faceProfile.test.ts`.

## EO-P20-T03: Recognizer Adapter Contract And Fake Recognizer

**Estimate:** 0.75 day / 2 SP

**Files:**

- Create: `frontend/src/domain/faceRecognition.ts`
- Create: `frontend/src/domain/__tests__/faceRecognition.test.ts`
- Create: `frontend/src/services/face/fakeFaceRecognizer.ts`
- Create: `frontend/src/services/face/__tests__/fakeFaceRecognizer.test.ts`
- Modify: `frontend/src/domain/index.ts`

**Implementation Plan:**

- [ ] Define recognizer contract:

```ts
export type ConfidenceBand = 'high' | 'medium' | 'low';
export type RecognitionStatus = 'matched' | 'no_match' | 'ambiguous' | 'camera_denied' | 'model_unavailable' | 'profile_index_stale';

export interface RecognitionCandidate {
  studentId: string;
  displayName: string;
  confidenceBand: ConfidenceBand;
  score: number;
}

export type RecognitionResult =
  | { status: 'matched'; candidate: RecognitionCandidate; recognizedAt: string }
  | { status: 'no_match' | 'camera_denied' | 'model_unavailable' | 'profile_index_stale'; message: string; recognizedAt: string }
  | { status: 'ambiguous'; candidates: RecognitionCandidate[]; message: string; recognizedAt: string };

export interface FaceRecognizer {
  name: 'fake' | 'browser_model';
  initialize(): Promise<{ ok: true } | { ok: false; message: string }>;
  recognizeFrame(frame: ImageBitmap | HTMLCanvasElement | null): Promise<RecognitionResult>;
  dispose(): void;
}
```

- [ ] Implement `classifyRecognitionCandidates(candidates, thresholds)`:
  - high confidence single candidate returns `matched`.
  - multiple candidates within the ambiguity margin returns `ambiguous`.
  - top score below accepted threshold returns `no_match`.
- [ ] Implement `fakeFaceRecognizer`:
  - deterministic sequence of recognition results.
  - configurable initialization failure.
  - no camera or model dependency.
- [ ] Export functions/types from `frontend/src/domain/index.ts`.

**Testing Strategy:**

- Unit:
  - high-confidence single candidate matches.
  - low-confidence candidate returns no match.
  - close candidates return ambiguous.
  - camera denied result is represented distinctly.
  - fake recognizer emits deterministic results and disposes cleanly.

**Acceptance Criteria:**

- All automated tests can run without camera access.
- Real recognizer implementation is behind the adapter and feature flag from EO-P20-T10.
- Tests run with `npx vitest run src/domain/__tests__/faceRecognition.test.ts src/services/face/__tests__/fakeFaceRecognizer.test.ts`.

## EO-P20-T04: Student-Facing iPad Recognition Route

**Estimate:** 1.25 days / 5 SP

**Files:**

- Create: `frontend/src/components/ipad/IpadRecognitionScreen.tsx`
- Create: `frontend/src/components/ipad/IpadStatusView.tsx`
- Create: `frontend/src/components/ipad/useIpadRecognitionSession.ts`
- Create: `frontend/src/__tests__/ipadRecognitionScreen.integration.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/index.css`

**Implementation Plan:**

- [ ] Add an iPad route or mode switch in `App.tsx`:
  - `/ipad` or `view=ipad` shows `IpadRecognitionScreen`.
  - existing POS remains default.
- [ ] Implement `useIpadRecognitionSession`:
  - initializes recognizer.
  - requests camera only after user/admin starts recognition.
  - maps recognizer result to UI state.
  - never exposes admin diagnostics in student mode.
- [ ] Implement iPad student-facing states:
  - `ready`: large start/scan state.
  - `scanning`: high-contrast scanning state.
  - `success`: green success state with display name only.
  - `no_match`: retry and ask-counter fallback.
  - `ambiguous`: retry and ask-counter fallback, no candidate list.
  - `camera_denied`: permission instructions and ask-counter fallback.
  - `offline`: fallback when profile index or PC channel is unavailable.
- [ ] Ensure `success` copy does not say ordering is complete.
- [ ] Ensure `IpadRecognitionScreen` props use `StudentFaceMetadata`, not full `StudentAccount`.
- [ ] Add CSS with full-screen touch-friendly layout and no report/admin styling dependencies.

**Testing Strategy:**

- Integration:
  - success screen shows student display name.
  - success screen does not render balance, debt, transaction history, meal price, payment amount, or after balance.
  - no-match screen shows retry and ask-counter fallback.
  - ambiguous screen does not show candidate balances or candidate list in student mode.
  - camera-denied state shows actionable permission copy.
  - admin enrollment controls are absent from `/ipad`.

**Acceptance Criteria:**

- Student-facing iPad UI is privacy-safe by prop type and tests.
- iPad success never implies PC transaction completion.
- Tests run with `npx vitest run src/__tests__/ipadRecognitionScreen.integration.test.tsx`.

## EO-P20-T05: Admin Enrollment, Disable, And Re-Enroll Workflow

**Estimate:** 1.25 days / 5 SP

**Files:**

- Create: `frontend/src/components/admin/FaceEnrollmentPanel.tsx`
- Create: `frontend/src/components/admin/__tests__/FaceEnrollmentPanel.test.tsx`
- Modify: `frontend/src/store/posStore.ts`
- Modify: `frontend/src/components/screens.tsx`

**Implementation Plan:**

- [ ] Add store state:

```ts
import type { FaceProfileLink } from '../domain/faceProfile';

interface PosState {
  faceProfileLinks: FaceProfileLink[];
  enrollFaceProfile: (input: { studentId: string; operatorId: string }) => void;
  disableFaceProfile: (input: { faceProfileId: string; reason: string; operatorId: string }) => void;
  reenrollFaceProfile: (input: { studentId: string; reason: string; operatorId: string }) => void;
}
```

- [ ] Add persistence migration:
  - missing `faceProfileLinks` hydrates as `[]`.
  - missing student `faceEnrollmentStatus` hydrates as `none`.
- [ ] Implement `FaceEnrollmentPanel` under admin student detail/list:
  - active student can enroll.
  - inactive student cannot enroll.
  - enrolled student can disable profile with required reason.
  - enrolled student can re-enroll with confirmation and required reason.
  - disabled profile is shown as disabled and excluded from recognition index.
- [ ] Emit audit/sync metadata events through Phase 1.3 sync event path:
  - `face_profile_enrolled`
  - `face_profile_disabled`
  - `face_profile_reenrolled`
- [ ] Do not store raw face images or vectors in Zustand or Sheets metadata.

**Testing Strategy:**

- Store:
  - enrollment creates profile link and updates student enrollment status.
  - disable requires reason and disables the profile.
  - re-enroll disables previous profile and creates a new one.
  - inactive student enrollment is blocked.
  - audit/sync metadata event is emitted.
- Component:
  - admin panel shows allowed actions by status.
  - student-facing iPad route cannot reach enrollment panel.

**Acceptance Criteria:**

- Enrollment lifecycle is admin-only.
- Raw biometric artifacts are outside store and Sheets metadata.
- Tests run with `npx vitest run src/components/admin/__tests__/FaceEnrollmentPanel.test.tsx`.

## EO-P20-T06: Local Profile Index And Offline Readiness

**Estimate:** 1 day / 3 SP

**Files:**

- Create: `frontend/src/domain/faceProfileIndex.ts`
- Create: `frontend/src/domain/__tests__/faceProfileIndex.test.ts`
- Modify: `frontend/src/domain/index.ts`

**Implementation Plan:**

- [ ] Define local profile index types:

```ts
export interface LocalFaceProfileIndexEntry {
  faceProfileId: string;
  studentId: string;
  displayName: string;
  status: 'active' | 'disabled' | 'stale';
  updatedAt: string;
  sourceRevision: number;
}

export interface LocalFaceProfileIndexSummary {
  activeProfileCount: number;
  disabledProfileCount: number;
  staleProfileCount: number;
  lastBuiltAt?: string;
  readyForOfflineRecognition: boolean;
}
```

- [ ] Implement `buildLocalFaceProfileIndex(students, faceProfileLinks)`:
  - includes active enrolled students only.
  - excludes inactive students.
  - excludes disabled profiles.
  - marks entries stale when link revision is older than synced student revision.
- [ ] Implement `summarizeLocalFaceProfileIndex(entries)`.
- [ ] Implement `validateOfflineRecognitionReadiness(summary)`:
  - ready when active profile count is greater than zero and stale count is zero.
  - unavailable when no profiles exist.
  - repair required when stale profiles exist.
- [ ] Keep this domain layer metadata-only; actual model embeddings remain behind the recognizer adapter chosen after feasibility.

**Testing Strategy:**

- Unit:
  - active enrolled student is included.
  - inactive student is excluded.
  - disabled profile is excluded.
  - stale profile blocks offline readiness.
  - no profiles produces unavailable state.
  - valid active index is ready offline.

**Acceptance Criteria:**

- Offline readiness can be decided without loading camera or model.
- Profile index never includes balance or accounting data.
- Tests run with `npx vitest run src/domain/__tests__/faceProfileIndex.test.ts`.

## EO-P20-T07: Face Handoff Event Creation And PC Receiver Integration

**Estimate:** 1 day / 3 SP

**Files:**

- Create: `frontend/src/domain/faceHandoff.ts`
- Create: `frontend/src/domain/__tests__/faceHandoff.test.ts`
- Create: `frontend/src/hooks/useFaceHandoffReceiver.ts`
- Modify: `frontend/src/hooks/usePosFlow.ts`
- Modify: `frontend/src/components/pos-components.tsx`
- Modify: `frontend/src/domain/index.ts`

**Implementation Plan:**

- [ ] Define handoff types:

```ts
export type FaceHandoffStatus = 'pending' | 'accepted' | 'queued' | 'rejected' | 'duplicate';

export interface FaceHandoffEvent {
  eventId: string;
  deviceId: string;
  studentId: string;
  studentDisplayName: string;
  confidenceBand: 'high' | 'medium' | 'low';
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

- [ ] Implement `createFaceHandoffEvent(args)`:
  - event id uses device id plus recognized timestamp plus student id plus nonce.
  - expires after a configured short window.
  - low confidence cannot create an event.
- [ ] Implement `validateFaceHandoffEvent(event, activeStudents, now)`:
  - rejects expired event.
  - rejects missing student.
  - rejects inactive student.
  - accepts active student.
- [ ] Implement `resolvePcFaceHandoff(args)`:
  - idle PC returns `accepted`.
  - active PC returns `queued` or `rejected` based on busy policy.
  - duplicate event id returns `duplicate`.
  - no path creates a transaction.
- [ ] Implement `useFaceHandoffReceiver`:
  - stores processed event ids in memory.
  - calls `usePosFlow.selectStudent(studentId, 'ipad')` only on accepted events.
  - exposes queued/rejected result for operator-visible indicator.
- [ ] Update PC POS indicator to show "iPad matched" source and queued/rejected handoff messages.

**Testing Strategy:**

- Unit:
  - high confidence creates event.
  - low confidence cannot create event.
  - expired event rejects.
  - inactive or missing student rejects.
  - duplicate event id returns duplicate.
  - idle PC accepts without creating transaction.
  - active PC queues or rejects without replacing selected student.
- Integration:
  - PC idle accepts event and selects student with source `ipad`.
  - PC active does not replace selected student.
  - duplicate event does not create duplicate queue item or order.

**Acceptance Criteria:**

- PC receiver behavior matches Phase 1.1 handoff boundary.
- Handoff event is idempotent.
- Tests run with `npx vitest run src/domain/__tests__/faceHandoff.test.ts`.

## EO-P20-T08: Handoff Channel, Idempotency, And Local Reachability

**Estimate:** 0.75 day / 2 SP

**Files:**

- Create: `frontend/src/services/face/localHandoffChannel.ts`
- Create: `frontend/src/services/face/__tests__/localHandoffChannel.test.ts`
- Modify: `frontend/src/components/ipad/useIpadRecognitionSession.ts`

**Implementation Plan:**

- [ ] Define channel contract:

```ts
import type { FaceHandoffEvent, FaceHandoffResult } from '../../domain/faceHandoff';

export interface FaceHandoffChannel {
  name: 'in_memory' | 'local_network';
  healthCheck(): Promise<{ ok: true } | { ok: false; message: string }>;
  send(event: FaceHandoffEvent): Promise<FaceHandoffResult>;
}
```

- [ ] Implement `inMemoryFaceHandoffChannel` for tests and same-browser demo.
- [ ] Define `localNetworkFaceHandoffChannel` interface boundary without production server implementation:
  - endpoint URL is runtime config.
  - network failure returns rejected result with fallback reason.
  - duplicate event id returns duplicate when receiver reports duplicate.
- [ ] Add iPad session behavior:
  - if channel health fails, show "go to counter" fallback.
  - if send fails, show fallback and do not show success-complete copy.
  - if send succeeds, show display name and "請至櫃台確認" style copy.
- [ ] Keep channel payload free of balances and transaction data.

**Testing Strategy:**

- Unit:
  - in-memory channel delivers event.
  - failed health check blocks send and produces fallback result.
  - duplicate result is surfaced.
  - channel payload contains no forbidden accounting keys.
- Integration:
  - iPad success with unreachable PC channel shows go-to-counter fallback.

**Acceptance Criteria:**

- Recognition success is not treated as order completion.
- Local channel failure has a safe student-facing fallback.
- Tests run with `npx vitest run src/services/face/__tests__/localHandoffChannel.test.ts`.

## EO-P20-T09: Diagnostics, Audit Events, And Sync Metadata

**Estimate:** 0.75 day / 2 SP

**Files:**

- Create: `frontend/src/domain/faceDiagnostics.ts`
- Create: `frontend/src/domain/__tests__/faceDiagnostics.test.ts`
- Create: `frontend/src/components/admin/FaceDiagnosticsPanel.tsx`
- Create: `frontend/src/components/admin/__tests__/FaceDiagnosticsPanel.test.tsx`

**Implementation Plan:**

- [ ] Define diagnostic event types:

```ts
export type FaceDiagnosticEventType =
  | 'camera_denied'
  | 'model_unavailable'
  | 'profile_index_stale'
  | 'no_match'
  | 'ambiguous'
  | 'handoff_rejected'
  | 'handoff_duplicate'
  | 'enrollment_quality_failed';

export interface FaceDiagnosticEvent {
  diagnosticId: string;
  type: FaceDiagnosticEventType;
  deviceId: string;
  studentId?: string;
  createdAt: string;
  message: string;
  adminDetail: string;
}
```

- [ ] Implement `createFaceDiagnosticEvent(args)`.
- [ ] Implement `toSyncEventPayload(event)` for Phase 1.3 `sync_events`.
- [ ] Implement `FaceDiagnosticsPanel`:
  - admin-only.
  - lists camera, model, profile index, ambiguity, and handoff failures.
  - shows admin detail without appearing in student-facing iPad mode.
- [ ] Add privacy filter so diagnostics sent to student UI include only user-safe message.

**Testing Strategy:**

- Unit:
  - each diagnostic type creates stable event.
  - sync event payload excludes raw images/vectors.
  - student-safe message excludes confidence scores and account data.
- Component:
  - diagnostics panel shows admin detail.
  - iPad student screen does not render admin diagnostics.

**Acceptance Criteria:**

- Recognition failures are repairable by admin without exposing diagnostics to students.
- Sync metadata excludes raw biometric data.
- Tests run with `npx vitest run src/domain/__tests__/faceDiagnostics.test.ts src/components/admin/__tests__/FaceDiagnosticsPanel.test.tsx`.

## EO-P20-T10: Real iPad Pilot Adapter Behind Feature Flag

**Estimate:** 1 day / 3 SP

**Files:**

- Create: `frontend/src/services/face/browserFaceRecognizer.ts`
- Create: `frontend/src/services/face/__tests__/browserFaceRecognizer.test.ts`
- Create: `frontend/src/config/faceConfig.ts`
- Create: `docs/face-handoff/ipad-pilot-checklist.md`

**Implementation Plan:**

- [ ] Define runtime config:

```ts
export interface FaceRecognitionRuntimeConfig {
  recognizerName: 'fake' | 'browser_model';
  enableBrowserModel: boolean;
  modelAssetBaseUrl: string;
  deviceId: string;
  acceptedThreshold: number;
  ambiguityMargin: number;
}
```

- [ ] Read non-secret config from Vite env:
  - `VITE_EASYORDER_FACE_RECOGNIZER`
  - `VITE_EASYORDER_FACE_MODEL_ASSET_BASE_URL`
  - `VITE_EASYORDER_FACE_DEVICE_ID`
- [ ] Implement `browserFaceRecognizer` as an adapter boundary:
  - initializes camera through `getUserMedia`.
  - loads model assets only when `enableBrowserModel` is true.
  - maps model output to `RecognitionResult`.
  - disposes camera tracks and model resources.
  - returns `model_unavailable` when assets or APIs are unavailable.
- [ ] Keep TensorFlow.js/MediaPipe package choice behind this adapter; implementation must choose one concrete package only after EO-P20-T01 feasibility passes.
- [ ] Unit-test by mocking camera/model dependencies; automated tests must not require real camera or model assets.
- [ ] Create `docs/face-handoff/ipad-pilot-checklist.md` with:
  - secure origin verified.
  - camera permission prompt verified.
  - camera start time recorded.
  - model load time recorded.
  - recognition p95 latency recorded.
  - low-light test recorded.
  - ambiguous/no-match test recorded.
  - offline profile index test recorded.
  - PC channel reachable/unreachable tests recorded.
  - student privacy screen inspected.
  - production go/no-go decision recorded.

**Testing Strategy:**

- Unit:
  - disabled feature flag uses fake recognizer path.
  - missing model assets returns model unavailable.
  - mocked camera denied returns camera denied.
  - dispose stops all tracks.
  - model output maps to matched/no-match/ambiguous states.
- Manual pilot:
  - run checklist on target iPad hardware and selected runtime mode.

**Acceptance Criteria:**

- Real model code is feature-flagged.
- No automated test requires camera or model assets.
- Pilot checklist exists and is required before production readiness.
- Tests run with `npx vitest run src/services/face/__tests__/browserFaceRecognizer.test.ts`.

## EO-P20-T11: Phase Verification And Production Go/No-Go Gate

**Estimate:** 0.75 day / 2 SP

**Files:**

- Create: `frontend/src/__tests__/faceHandoff.integration.test.tsx`
- Create: `docs/face-handoff/production-readiness.md`
- Modify: `docs/superpowers/plans/2026-05-14-phase-2-ipad-face-handoff.md` only if implementation discoveries require scope clarification before review.

**Implementation Plan:**

- [ ] Run focused domain/service tests from `frontend/`:

```bash
npx vitest run src/domain/__tests__/faceFeasibility.test.ts src/domain/__tests__/faceProfile.test.ts src/domain/__tests__/faceRecognition.test.ts src/domain/__tests__/faceProfileIndex.test.ts src/domain/__tests__/faceHandoff.test.ts src/domain/__tests__/faceDiagnostics.test.ts src/services/face/__tests__/fakeFaceRecognizer.test.ts src/services/face/__tests__/localHandoffChannel.test.ts src/services/face/__tests__/browserFaceRecognizer.test.ts
```

- [ ] Run focused component/integration tests from `frontend/`:

```bash
npx vitest run src/__tests__/ipadRecognitionScreen.integration.test.tsx src/__tests__/faceHandoff.integration.test.tsx src/components/admin/__tests__/FaceEnrollmentPanel.test.tsx src/components/admin/__tests__/FaceDiagnosticsPanel.test.tsx
```

- [ ] Run the global verification gate from `frontend/`:

```bash
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```

- [ ] Create `docs/face-handoff/production-readiness.md` with:
  - target iPad feasibility result.
  - browser model package chosen.
  - model asset source and version.
  - profile index storage boundary.
  - privacy boundary confirmation.
  - manual fallback confirmation.
  - PC transaction-authority confirmation.
  - unresolved legal/consent policy note.
  - go/no-go decision.
- [ ] Manually smoke-check:
  - iPad route loads.
  - camera denied state.
  - fake recognition success.
  - fake no-match state.
  - fake ambiguous state.
  - PC idle accepts handoff.
  - PC active queues/rejects handoff without replacing selected student.
  - duplicate handoff ignored.
  - iPad never shows balance/debt/meal price/payment amount.
  - no transaction is created until PC confirm.
- [ ] Commit Phase 2 implementation with a message that identifies iPad face handoff:

```bash
git add frontend/src/domain frontend/src/services/face frontend/src/hooks frontend/src/components frontend/src/store frontend/src/App.tsx frontend/src/index.css frontend/src/__tests__ docs/face-handoff
git commit -m "feat: add ipad face handoff"
```

**Acceptance Criteria:**

- Global verification gate passes from `frontend/`.
- Production readiness doc records go/no-go and unresolved privacy/legal items.
- Phase 2 can be demoed with fake recognizer even if real iPad model pilot is not yet approved.

## Testing Matrix

| Behavior | Unit Test | Integration Test | Manual Pilot |
|---|---|---|---|
| iPad feasibility gates | `faceFeasibility.test.ts` | no | target iPad checklist |
| Face profile lifecycle | `faceProfile.test.ts` | `FaceEnrollmentPanel.test.tsx` | admin enroll/disable/re-enroll |
| Privacy boundary | `faceProfile.test.ts` | `ipadRecognitionScreen.integration.test.tsx` | student screen inspection |
| Recognition classification | `faceRecognition.test.ts` | `ipadRecognitionScreen.integration.test.tsx` | target model run |
| Fake recognizer | `fakeFaceRecognizer.test.ts` | iPad route integration | demo mode |
| Profile index offline readiness | `faceProfileIndex.test.ts` | admin diagnostics integration | offline iPad startup |
| Handoff event validation | `faceHandoff.test.ts` | `faceHandoff.integration.test.tsx` | PC receiver smoke |
| Duplicate event idempotency | `faceHandoff.test.ts` | `faceHandoff.integration.test.tsx` | resend event |
| PC active queue/reject | `faceHandoff.test.ts` | `faceHandoff.integration.test.tsx` | active transaction smoke |
| Channel unreachable fallback | `localHandoffChannel.test.ts` | iPad route integration | disconnect PC channel |
| Browser model adapter | `browserFaceRecognizer.test.ts` | no real camera in CI | target iPad model pilot |
| Diagnostics | `faceDiagnostics.test.ts` | `FaceDiagnosticsPanel.test.tsx` | admin repair smoke |

## Phase Done Criteria

- Target iPad feasibility document exists with secure context, camera permission, model latency, offline profile index, and PC channel checks.
- Face profile metadata supports enroll, disable, and re-enroll with audit/sync metadata.
- Student-facing iPad route never receives or displays balances, debt, transaction history, meal price, payment amount, or report data.
- Recognition states cover scanning, success, no-match, ambiguous, camera-denied, profile-index-stale, model-unavailable, offline, and PC-channel-unreachable.
- Handoff event includes stable event id, device id, student id, display name, confidence band, recognized timestamp, and expiry.
- PC receiver accepts idle events, queues or rejects active-flow events, ignores duplicates, rejects missing/inactive students, and never creates a transaction by handoff alone.
- Offline local recognition readiness is based on a local profile index and clear stale/missing repair states.
- Real recognizer is feature-flagged and blocked from production until target-iPad pilot checklist passes.
- Raw biometric images/vectors are not written to Google Sheets or student-facing UI state.
- Full gate passes from `frontend/`: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build`.

## Out Of Scope For Phase 2

- Autonomous iPad checkout, payment, top-up, cancel, or order confirmation.
- Showing balance, debt, transaction history, meal price, paid amount, or cash-close status on iPad.
- Parent/student mobile app.
- Server/cloud face recognition.
- Final biometric legal/consent policy text beyond the technical privacy boundary and production-readiness note.
- Production biometric storage provider selection beyond the local/pilot profile index and metadata references.
