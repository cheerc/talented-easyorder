import { expect } from 'vitest';

/** 一般畫面不得出現的工程用語（#684）；異常訊息要用白話說明「發生什麼、現在該做什麼」。 */
export const ENGINEERING_TERMS =
  /commandId|command ID|receipt|schema|Rules|dataHead|Firestore|Gregorian|fingerprint|semantic|UUID|日結版號|版號|投影|Timestamp|snapshot|\bEOF\b|accessEvents|transactions|activeTransactionCount|bentoCount|otherMealCount|mealTotal|retainedReceipts|cashierIncome|cashierExpense|accountRefunds/i;

/** 用在 `toMatchObject({ message })`：訊息不含任何工程用語。 */
export function plainMessage(): string {
  return expect.not.stringMatching(ENGINEERING_TERMS) as unknown as string;
}
