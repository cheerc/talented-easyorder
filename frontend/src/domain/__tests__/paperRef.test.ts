import { describe, expect, it } from 'vitest';
import { PAPER_NOTE_MAX_LENGTH, formatPaperRefNote, isPaperRef, parsePaperRefNote } from '../paperRef';

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
});
