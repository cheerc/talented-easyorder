/**
 * 本地初始化與維護者管理工具：建立／維護 operators 白名單文件。
 * 規格來源：docs/superpowers/specs/2026-10-13-free-production-backend-spec.md §4.1
 * 計畫來源：docs/superpowers/plans/2026-10-13-free-production-backend-plan.md §P03
 */

import type { Firestore } from 'firebase/firestore';
import { getFirestoreMod } from './firebaseModules';
import { operatorPath } from './firestorePaths';
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

/**
 * 維護者寫入 operator 文件（由本機受保護腳本或維護工具呼叫）。
 */
export async function bootstrapOperator(
  db: Firestore,
  input: BootstrapOperatorInput,
): Promise<CloudOperatorDoc> {
  const opDoc = buildOperatorDoc(input);
  const { doc, setDoc, serverTimestamp } = getFirestoreMod();

  await setDoc(doc(db, operatorPath(opDoc.uid)), {
    ...opDoc,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return opDoc;
}

/**
 * 維護者設定操作員啟用／停用狀態。
 */
export async function setOperatorActiveStatus(
  db: Firestore,
  uid: string,
  active: boolean,
): Promise<void> {
  if (!uid || !uid.trim()) {
    throw new Error('Operator uid 必須為非空字串');
  }

  const { doc, updateDoc, serverTimestamp } = getFirestoreMod();
  await updateDoc(doc(db, operatorPath(uid.trim())), {
    active,
    updatedAt: serverTimestamp(),
  });
}
