import type { UnclosedDayKind } from '../firebase/cloudDayCloseRepository';

export interface DayStateInput {
  status: 'open' | 'reopened' | 'closed';
  /** The day is being backfilled (contract §12). */
  backfill: boolean;
  /** How the day is classified in the unclosed list; `null` when it is not (or not known to be) unclosed. */
  kind: UnclosedDayKind | null;
  dayId: string;
  /** The server's selection date (today). */
  today: string;
}

export interface DayStateLabel {
  text: string;
  variant: 'ok' | 'warn';
}

/**
 * The single source of the state words for a business day (#688): the date row and the banner chips of the day-close
 * page both use it, so the same day always reads the same.
 *
 * 畫面用語「補登」＝程式／資料中的 backfill（`StartBackfill`、`backfillDays`、`backfilled`）；對照見後端 spec 與日結契約。
 */
export function dayStateLabel({ status, backfill, kind, dayId, today }: DayStateInput): DayStateLabel {
  if (status === 'closed') return { text: '已關帳', variant: 'ok' };
  if (backfill) return { text: status === 'reopened' ? '補登中（已重開）' : '補登中', variant: 'warn' };
  if (status === 'reopened') return { text: '已重開', variant: 'warn' };
  // Only today and past days wait for their opening; a future day is just scheduled, so it keeps the plain wording.
  if (kind === 'missing-opening' && dayId <= today) return { text: '待確認開帳', variant: 'warn' };
  // A day with neither opening cash nor transactions has nothing to close, so it keeps the plain wording.
  if (kind !== 'no-business' && dayId < today) return { text: '尚未關帳', variant: 'warn' };
  return { text: '開啟中', variant: 'warn' };
}
