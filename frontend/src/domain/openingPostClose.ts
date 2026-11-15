import { effectiveCashOf } from './ledgerAnomalies';
import type { CloudOpeningContextLookup } from '../firebase/cloudDayCloseRepository';
import type { PostCloseDirection } from './postCloseEntries';

export interface OpeningPostCloseOffer {
  targetDayId: string;
  direction: PostCloseDirection;
  amount: number;
  previousEffectiveCash: number;
}

/** 只在首次開帳、可安全補記單筆差額的情況提供選項。 */
export function openingPostCloseOffer(
  context: CloudOpeningContextLookup, openingCash: number, currentOpeningCash: number | null,
): OpeningPostCloseOffer | null {
  const previous = context.previous;
  if (currentOpeningCash !== null || !previous || context.gapDayCount > 0 || context.unclosedDayIds.length > 0) return null;
  const previousEffectiveCash = effectiveCashOf(previous);
  const difference = openingCash - previousEffectiveCash;
  if (difference === 0 || Math.abs(difference) > 20_000) return null;
  return { targetDayId: previous.dayId, direction: difference > 0 ? 'income' : 'expense', amount: Math.abs(difference), previousEffectiveCash };
}

/** 補記不改版本；逐一比較計入的補記 ID 以辨識淨額相同的變動。 */
export function sameOpeningContext(a: CloudOpeningContextLookup, b: CloudOpeningContextLookup): boolean {
  const left = a.previous;
  const right = b.previous;
  if (a.gapDayCount !== b.gapDayCount || a.unclosedDayIds.length !== b.unclosedDayIds.length
    || a.unclosedDayIds.some((id, index) => id !== b.unclosedDayIds[index])) return false;
  if (!left || !right) return left === right;
  return left.dayId === right.dayId && left.countedCash === right.countedCash
    && left.dayRevision === right.dayRevision && left.settlementRevision === right.settlementRevision
    && left.postCloseNet === right.postCloseNet && left.countedEntryIds.length === right.countedEntryIds.length
    && left.countedEntryIds.every((id, index) => id === right.countedEntryIds[index]);
}
