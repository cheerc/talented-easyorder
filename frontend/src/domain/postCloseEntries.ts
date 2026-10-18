/**
 * P11c4a 關帳後補記（契約 §15）：已關帳日上的一般櫃台收支，建立後不可改也不可刪。
 * 有效關帳現金 = 最新日結版本的實點 + Σ income − Σ expense，只計入 `settlementRevision` 等於
 * 目前日結版本的補記；日子重開再重新關帳後，舊補記只當歷史顯示，不再計入。
 */

export type PostCloseDirection = 'income' | 'expense';

export interface PostCloseEntry {
  /** 文件 ID，等於 command ID。 */
  entryId: string;
  dayId: string;
  /** 補記當時營業日的 `lastSettlementRevision`。 */
  settlementRevision: number;
  direction: PostCloseDirection;
  amount: number;
  reason: string;
  createdBy: string;
  createdAt: Date;
  commandId: string;
}

type EntryAmount = Pick<PostCloseEntry, 'settlementRevision' | 'direction' | 'amount'>;

/** 只計入 `settlementRevision` 吻合的補記：income 為正、expense 為負。 */
export function postCloseNet(entries: readonly EntryAmount[], settlementRevision: number): number {
  let net = 0;
  for (const entry of entries) {
    if (entry.settlementRevision !== settlementRevision) continue;
    net += entry.direction === 'income' ? entry.amount : -entry.amount;
  }
  return net;
}

/** 補記是否仍計入有效關帳現金。 */
export function isPostCloseEntryCounted(entry: Pick<PostCloseEntry, 'settlementRevision'>, lastSettlementRevision: number): boolean {
  return entry.settlementRevision === lastSettlementRevision;
}

export function effectiveClosingCash(countedCash: number, entries: readonly EntryAmount[], settlementRevision: number): number {
  return countedCash + postCloseNet(entries, settlementRevision);
}
