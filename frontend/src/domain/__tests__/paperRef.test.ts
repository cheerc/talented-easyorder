import { describe, expect, it } from 'vitest';
import {
  PAPER_NOTE_MAX_LENGTH, composePaperRefNote, formatPaperRefNote, isPaperRef, paperRefsIn, parsePaperRefNote, splitPaperNote,
} from '../paperRef';

describe('P13d1 paper number prefix', () => {
  it('accepts 1 to 20 letters, digits and hyphens as a paper number', () => {
    for (const ref of ['A-0123', '7', 'a'.repeat(20), 'AB-12-cd']) expect(isPaperRef(ref)).toBe(true);
    for (const ref of ['', ' A1', 'A 1', 'A_1', 'A:1', '紙本1', 'a'.repeat(21), 'A1\n']) expect(isPaperRef(ref)).toBe(false);
  });

  it('writes the number as a fixed prefix, with the fullwidth colon the Rules look for', () => {
    expect(formatPaperRefNote('A-0123', '前天斷線補登')).toBe('紙本A-0123：前天斷線補登');
    expect(formatPaperRefNote('A-0123', '')).toBe('紙本A-0123：');
  });

  it('refuses a malformed number and a note that would pass the 500-character limit', () => {
    expect(() => formatPaperRefNote('A 1', '備註')).toThrow(/紙本號/);
    expect(() => formatPaperRefNote('', '備註')).toThrow(/紙本號/);
    const prefix = '紙本A1：';
    expect(formatPaperRefNote('A1', 'x'.repeat(PAPER_NOTE_MAX_LENGTH - prefix.length))).toHaveLength(PAPER_NOTE_MAX_LENGTH);
    expect(() => formatPaperRefNote('A1', 'x'.repeat(PAPER_NOTE_MAX_LENGTH - prefix.length + 1))).toThrow(/500/);
  });

  it('reads the number and the remaining text back, and returns null for a note without the prefix', () => {
    expect(parsePaperRefNote('紙本A-0123：前天斷線補登')).toEqual({ paperRef: 'A-0123', text: '前天斷線補登' });
    expect(parsePaperRefNote('紙本A-0123：')).toEqual({ paperRef: 'A-0123', text: '' });
    expect(parsePaperRefNote('紙本A-0123：第一行\n第二行')).toEqual({ paperRef: 'A-0123', text: '第一行\n第二行' });
    for (const note of ['', '前天斷線補登', '紙本：備註', '紙本A 1：備註', '紙本A1:備註', ' 紙本A1：備註', '紙本' + 'a'.repeat(21) + '：x']) {
      expect(parsePaperRefNote(note)).toBeNull();
    }
  });

  it('round-trips through format and parse', () => {
    expect(parsePaperRefNote(formatPaperRefNote('B-9', '零錢補充'))).toEqual({ paperRef: 'B-9', text: '零錢補充' });
  });

  describe('composePaperRefNote (the entry forms)', () => {
    it('writes the prefix when a number is given, trimming both inputs', () => {
      expect(composePaperRefNote({ paperRef: ' A-0123 ', text: ' 前天斷線 ', required: true }))
        .toEqual({ ok: true, note: '紙本A-0123：前天斷線' });
      expect(composePaperRefNote({ paperRef: 'A-1', text: '', required: false })).toEqual({ ok: true, note: '紙本A-1：' });
    });

    it('leaves the text alone when no number is given and none is required', () => {
      expect(composePaperRefNote({ paperRef: '', text: ' 備註 ', required: false })).toEqual({ ok: true, note: '備註' });
      expect(composePaperRefNote({ paperRef: '  ', text: '', required: false })).toEqual({ ok: true, note: '' });
    });

    it('names the problem: a missing number on a backfill day, a malformed number, a note that is too long', () => {
      expect(composePaperRefNote({ paperRef: '', text: '備註', required: true }))
        .toEqual({ ok: false, error: '補登日必須填紙本號（1 至 20 字的英數與 -，例如 A-0123）' });
      for (const paperRef of ['A 1', 'A_1', '紙本1', 'a'.repeat(21), '紙本A1：']) {
        expect(composePaperRefNote({ paperRef, text: '', required: false }), paperRef)
          .toEqual({ ok: false, error: '紙本號只能是 1 至 20 字的英數與 -（例如 A-0123）' });
      }
      expect(composePaperRefNote({ paperRef: 'A1', text: 'x'.repeat(PAPER_NOTE_MAX_LENGTH), required: true }))
        .toEqual({ ok: false, error: '紙本號加備註不能超過 500 字' });
    });
  });

  it('splits a stored note for display, and lists the distinct numbers of several notes in order', () => {
    expect(splitPaperNote('紙本A-1：零錢補充')).toEqual({ paperRef: 'A-1', text: '零錢補充' });
    expect(splitPaperNote('一般備註')).toEqual({ paperRef: null, text: '一般備註' });
    expect(paperRefsIn(['紙本A-1：x', '', '備註', '紙本B-2：', '紙本A-1：y'])).toEqual(['A-1', 'B-2']);
    expect(paperRefsIn([])).toEqual([]);
  });
});
