/**
 * The paper number of a backfilled entry (P13d1, spec §7). It is a fixed prefix of the entry's `note`
 * (the `reason` of a cash movement), `紙本<編號>：<備註>`, so no field is added to commands, transactions or
 * backups. Rules own the check: on a marked past day the note must match this shape, today is free.
 */

/** Letters, digits and hyphens, 1 to 20 characters (for example `A-0123`). */
const PAPER_REF = /^[A-Za-z0-9-]{1,20}$/;
const PAPER_NOTE = /^紙本([A-Za-z0-9-]{1,20})：([\s\S]*)$/;

/** The Rules cap note and reason at 500 characters. */
export const PAPER_NOTE_MAX_LENGTH = 500;

export function isPaperRef(value: string): boolean {
  return PAPER_REF.test(value);
}

export function formatPaperRefNote(paperRef: string, text: string): string {
  if (!isPaperRef(paperRef)) throw new Error('紙本號必須為 1 至 20 字的英數與 -');
  const note = `紙本${paperRef}：${text}`;
  if (note.length > PAPER_NOTE_MAX_LENGTH) throw new Error(`紙本號加備註不能超過 ${PAPER_NOTE_MAX_LENGTH} 字`);
  return note;
}

/** Splits a stored note into its paper number and the text after it; null when the note carries no number. */
export function parsePaperRefNote(note: string): { paperRef: string; text: string } | null {
  const match = PAPER_NOTE.exec(note);
  return match ? { paperRef: match[1]!, text: match[2]! } : null;
}
