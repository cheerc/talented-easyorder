/**
 * The operator allow-list document, built exactly as `buildOperatorDoc` in `firebase/operatorAdmin.ts` builds it. It is
 * a separate copy because importing that module drags the app's Firestore schema (and its type diagnostics) into the
 * zero-diagnostic maintenance build; `operatorDocParity.test.ts` keeps the two equal.
 */
export interface OperatorDocInput { uid: string; email: string; displayName?: string; active?: boolean }
export interface OperatorDoc { uid: string; email: string; displayName: string; active: boolean }

export function buildOperatorDocForRestore(input: OperatorDocInput): OperatorDoc {
  if (!input.uid || !input.uid.trim()) throw new Error('Operator uid 必須為非空字串');
  if (!input.email || !input.email.trim()) throw new Error('Operator email 必須為非空字串');
  return {
    uid: input.uid.trim(),
    email: input.email.trim().toLowerCase(),
    displayName: (input.displayName && input.displayName.trim()) || input.email.trim(),
    active: input.active !== false,
  };
}
