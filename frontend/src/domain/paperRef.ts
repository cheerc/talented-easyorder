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

const MISSING_ERROR = '補登日必須填紙本號（1 至 20 字的英數與 -，例如 A-0123）';
const FORMAT_ERROR = '紙本號只能是 1 至 20 字的英數與 -（例如 A-0123）';
const TOO_LONG_ERROR = `紙本號加備註不能超過 ${PAPER_NOTE_MAX_LENGTH} 字`;

export type ComposedPaperNote = { ok: true; note: string } | { ok: false; error: string };

/**
 * The note an entry form sends: the typed paper number in front of the typed remark. `required` is true on a
 * backfill day (Rules refuse it otherwise); today a blank number leaves the remark as typed. Both inputs are
 * trimmed. The messages are shown to the operator as they are.
 */
export function composePaperRefNote(input: { paperRef: string; text: string; required: boolean }): ComposedPaperNote {
  const paperRef = input.paperRef.trim();
  const text = input.text.trim();
  if (!paperRef) {
    if (input.required) return { ok: false, error: MISSING_ERROR };
    return text.length > PAPER_NOTE_MAX_LENGTH ? { ok: false, error: TOO_LONG_ERROR } : { ok: true, note: text };
  }
  if (!isPaperRef(paperRef)) return { ok: false, error: FORMAT_ERROR };
  const note = `紙本${paperRef}：${text}`;
  return note.length > PAPER_NOTE_MAX_LENGTH ? { ok: false, error: TOO_LONG_ERROR } : { ok: true, note };
}

/** A stored note split for display and correction: the paper number (null when the note has none) and the text after it. */
export function splitPaperNote(note: string): { paperRef: string | null; text: string } {
  return parsePaperRefNote(note) ?? { paperRef: null, text: note };
}

/** The distinct paper numbers found in these notes, in first-seen order. */
export function paperRefsIn(notes: readonly string[]): string[] {
  const found: string[] = [];
  for (const note of notes) {
    const paperRef = parsePaperRefNote(note)?.paperRef;
    if (paperRef && !found.includes(paperRef)) found.push(paperRef);
  }
  return found;
}
