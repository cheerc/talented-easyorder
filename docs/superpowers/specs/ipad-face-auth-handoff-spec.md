# iPad Face Auth Handoff Spec

## 功能描述

iPad Face Auth Handoff 定義 Phase 2：iPad 以相機做人臉辨識，辨識成功後把學員身份事件推送到 PC POS 搜尋/選取流程，由 PC 操作員完成訂餐、繳費、雜支與帳務確認。

**目前實作狀態**：handoff message 的 domain 層已定義（`domain/ipadHandoff.ts`），包含 message validation、sessionStorage 讀寫、以及 scanner input 轉換。實際的 camera 整合、face recognition、enrollment UI、profile index 均為 Phase 2 planned。

Handoff message 透過 `sessionStorage` 傳遞（`writeHandoffIntent` / `readHandoffIntent`）。Message 包含 version、timestamp、action（order/payment）、studentId、sourceDevice（必須為 `ipad_handoff`）、可選 note。Message 有效期 30 秒（`MAX_HANDOFF_AGE_MS`）。

## 使用者故事

- [PLANNED] As a student, I want to stand in front of the iPad and be recognized quickly so that I do not need to recite my student id.
- [PLANNED] As a student, I want the iPad to show only my name and recognition status so that my balance or debt is not exposed to others.
- As a counter operator, I want a successful iPad recognition to select or queue the student on the PC so that I can finish the normal POS confirmation flow.
- As a counter operator, I want iPad failures to fall back to PC text search so that service can continue.
- [PLANNED] As an admin, I want to enroll, disable, and re-enroll face profiles so that recognition quality can be maintained.
- [PLANNED] As an admin, I want ambiguous or low-confidence matches to require manual resolution so that the wrong account is not selected.

## 驗收標準

### Handoff Message Validation（已實作）

Given a valid handoff message with version=1, non-empty studentId, valid action (order/payment), valid source (`ipad_handoff`), valid timestamp (within 30s)
When `validateIpadHandoffMessage` runs
Then it returns `{ ok: true }`.

Given version != 1
When validated
Then returns `{ ok: false, code: 'unsupported_version' }`.

Given empty or whitespace-only studentId
When validated
Then returns `{ ok: false, code: 'missing_student_id' }`.

Given action not in `['order', 'payment']`
When validated
Then returns `{ ok: false, code: 'invalid_action' }`.

Given timestamp is 0, negative, or missing
When validated
Then returns `{ ok: false, code: 'invalid_timestamp' }`.

Given timestamp is more than 30 seconds from now
When validated
Then returns `{ ok: false, code: 'expired' }`.

Given sourceDevice != `'ipad_handoff'`
When validated
Then returns `{ ok: false, code: 'invalid_source' }`.

### PC Handoff（已實作）

Given a valid `IpadHandoffMessage` passes validation
When `toHandoffScannerInput` converts it
Then it returns a `ScannerInput` with `rawCode = trimmed studentId` and `terminator = 'Enter'`. This feeds into the standard `resolveScannedStudent` flow.

Handoff events are passed between iPad and PC via `sessionStorage`:
- `writeHandoffIntent(channel, msg)` serializes the message to sessionStorage
- `readHandoffIntent(channel)` deserializes, validates shape, removes the key, and returns the message (or null if invalid/missing)

### Recognition Privacy [PLANNED]

Given the iPad recognizes a student successfully
When the success screen is shown
Then it displays only success state and student display name, and does not display balance, debt, transaction history, meal price, or payment amount.

### Confidence And Ambiguity [PLANNED]

Face recognition, confidence thresholds, multi-candidate handling, and camera integration are Phase 2 planned features. The domain layer provides the handoff message schema and validation that these features will use.

### Enrollment [PLANNED]

Face profile enrollment, camera capture, and profile linking are Phase 2 planned. The `StudentAccount` type already includes `faceProfileId` and `faceEnrollmentStatus` fields for future use.

### Offline Operation [PLANNED]

Local profile index, offline recognition, and network-independent handoff are Phase 2 planned.

## 技術約束

- Current app is pure frontend. Phase 2 must choose a camera/recognition architecture before code work.
- Browser camera access on iPad requires HTTPS or trusted local deployment.
- Raw biometric images/vectors must not be stored in the student record.
- PC remains the accounting authority. iPad handoff selects/preselects a student only; transaction confirmation stays in `pc-pos-order-flow-spec`.
- Handoff events use `sessionStorage` for local cross-tab communication.
- Message idempotency: `readHandoffIntent` removes the key after reading, preventing double-processing.
- Test chain: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build`.

## 實際型別（對齊 `domain/ipadHandoff.ts`）

```ts
export type HandoffAction = 'order' | 'payment';

export interface IpadHandoffMessage {
  version: number;
  timestamp: number;
  action: HandoffAction;
  studentId: string;
  sourceDevice: 'ipad_handoff';
  note?: string;
}

export type ValidateHandoffResult =
  | { ok: true }
  | { ok: false; code: 'missing_student_id' | 'invalid_action' | 'unsupported_version' | 'invalid_timestamp' | 'invalid_source' | 'expired' };
```

## 與其他模組的介面

### 輸入

- Active student identity from `student-account-management-spec` (`domain/student.ts`).
- [PLANNED] Sync health/profile-index availability from Firebase.

### 輸出

- `IpadHandoffMessage` → `toHandoffScannerInput` → `ScannerInput` for `pc-pos-order-flow-spec` (`domain/posSearch.ts`).
- [PLANNED] Face profile link/unlink/status updates to `student-account-management-spec`.

### 依賴關係

- Depends on `student-account-management-spec` for student identity.
- Feeds `pc-pos-order-flow-spec` with student preselection via the standard scanner input pipeline.
- Does not depend on menu/vendor or cash close directly.

## 不在本模組範圍

- Autonomous iPad checkout or payment.
- Showing balance/debt on iPad.
- Parent/student mobile app.
- Final biometric storage provider selection.
- Camera integration and face matching model selection (Phase 2 planned).
