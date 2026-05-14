import type { StudentAccount } from './student';

export type PosSearchMode = 'text' | 'scan';

export type PosSearchResult =
  | { ok: true; mode: PosSearchMode; students: StudentAccount[] }
  | { ok: false; mode: PosSearchMode; code: 'empty_query' | 'scan_not_found' | 'scan_ambiguous'; message: string };

export interface ScannerInput {
  rawCode: string;
  terminator: 'Enter' | 'Tab';
}

export function searchPosStudents(students: StudentAccount[], query: string): PosSearchResult {
  const trimmed = query.trim();
  const activeStudents = students.filter(s => s.status === 'active');

  if (!trimmed) {
    return { ok: true, mode: 'text', students: [...activeStudents] };
  }

  const results = activeStudents.filter(s =>
    s.studentId.includes(trimmed) ||
    s.displayName.includes(trimmed) ||
    s.aliases.some(a => a.includes(trimmed))
  );

  return { ok: true, mode: 'text', students: results };
}

export function resolveScannedStudent(students: StudentAccount[], input: ScannerInput): PosSearchResult {
  const code = input.rawCode.trim();

  if (!code) {
    return { ok: false, mode: 'scan', code: 'empty_query', message: 'empty scan code' };
  }

  const activeStudents = students.filter(s => s.status === 'active');

  const exactIdMatches = activeStudents.filter(s => s.studentId === code);
  if (exactIdMatches.length === 1) {
    return { ok: true, mode: 'scan', students: [exactIdMatches[0]] };
  }

  const aliasMatches = activeStudents.filter(s => s.aliases.includes(code));
  if (aliasMatches.length === 1) {
    return { ok: true, mode: 'scan', students: [aliasMatches[0]] };
  }
  if (aliasMatches.length > 1) {
    return { ok: false, mode: 'scan', code: 'scan_ambiguous', message: 'ambiguous scan code: multiple students matched' };
  }

  return { ok: false, mode: 'scan', code: 'scan_not_found', message: 'no active student found for scan code' };
}
