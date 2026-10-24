/**
 * operators 白名單文件的標準形狀。
 * 規格來源：docs/superpowers/specs/2026-10-13-free-production-backend-spec.md §4.1
 * 計畫來源：docs/superpowers/plans/2026-10-13-free-production-backend-plan.md §P03
 *
 * 這個模組不寫 Firestore：Rules 讓 operators 的 create／update 一律 false，client 寫不進去。
 * operators 由維護者以 P15 還原 CLI 的 `finalize --operators` 建立（見 docs/ops/firebase-restore-runbook.md）。
 */

import type { CloudOperatorDoc } from './firestoreSchema';

export interface BootstrapOperatorInput {
  uid: string;
  email: string;
  displayName?: string;
  active?: boolean;
}

/**
 * 建立標準的 CloudOperatorDoc 物件（無 role，等權白名單）。
 */
export function buildOperatorDoc(input: BootstrapOperatorInput): CloudOperatorDoc {
  if (!input.uid || !input.uid.trim()) {
    throw new Error('Operator uid 必須為非空字串');
  }
  if (!input.email || !input.email.trim()) {
    throw new Error('Operator email 必須為非空字串');
  }

  return {
    uid: input.uid.trim(),
    email: input.email.trim().toLowerCase(),
    displayName: (input.displayName && input.displayName.trim()) || input.email.trim(),
    active: input.active !== false,
  };
}
