import { describe, it, expect } from 'vitest';
import { searchPosStudents, resolveScannedStudent, filterSearchSuggestions } from '../posSearch';
import type { ScannerInput } from '../posSearch';
import { STUDENT_001, STUDENT_004 } from './fixtures';
import type { StudentAccount } from '../student';

function makeStudent(overrides: Partial<StudentAccount> & { studentId: string }): StudentAccount {
  return {
    studentId: overrides.studentId,
    displayName: overrides.displayName ?? '測試學生',
    status: overrides.status ?? 'active',
    currentBalance: overrides.currentBalance ?? 0,
    aliases: overrides.aliases ?? [],
    faceEnrollmentStatus: overrides.faceEnrollmentStatus ?? 'none',
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00Z',
    revision: overrides.revision ?? 1,
  };
}

describe('searchPosStudents', () => {
  const students = [
    STUDENT_001,
    makeStudent({ studentId: '002', displayName: '陳奕辰', aliases: ['eric'] }),
    STUDENT_004,
    makeStudent({ studentId: '005', displayName: '林小明', status: 'inactive' }),
  ];

  it('exact studentId match finds one active student', () => {
    const result = searchPosStudents(students, '001');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.students).toHaveLength(1);
      expect(result.students[0].studentId).toBe('001');
    }
  });

  it('partial Traditional Chinese name finds matching students', () => {
    const result = searchPosStudents(students, '柏');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.students.length).toBeGreaterThanOrEqual(1);
      expect(result.students.every(s => s.displayName.includes('柏'))).toBe(true);
    }
  });

  it('alias match finds the student', () => {
    const result = searchPosStudents(students, 'eric');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.students).toHaveLength(1);
      expect(result.students[0].studentId).toBe('002');
    }
  });

  it('empty query returns all active students', () => {
    const result = searchPosStudents(students, '');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.students.every(s => s.status === 'active')).toBe(true);
    }
  });

  it('inactive student is hidden from results', () => {
    const result = searchPosStudents(students, '林');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.students.find(s => s.studentId === '005')).toBeUndefined();
    }
  });

  it('no match returns empty array', () => {
    const result = searchPosStudents(students, 'zzz-not-exists');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.students).toHaveLength(0);
    }
  });
});

describe('resolveScannedStudent', () => {
  const students = [
    STUDENT_001,
    makeStudent({ studentId: '002', displayName: '陳奕辰', aliases: ['eric', 'common-alias'] }),
    makeStudent({ studentId: '003', displayName: '張三', aliases: ['common-alias'] }),
    makeStudent({ studentId: '005', displayName: '林小明', status: 'inactive' }),
  ];

  function scan(code: string): ScannerInput {
    return { rawCode: code, terminator: 'Enter' };
  }

  it('scan exact studentId selects one student', () => {
    const result = resolveScannedStudent(students, scan('001'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.students[0].studentId).toBe('001');
  });

  it('scan exact alias selects one student', () => {
    const result = resolveScannedStudent(students, scan('eric'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.students[0].studentId).toBe('002');
  });

  it('scan zero-match returns scan_not_found', () => {
    const result = resolveScannedStudent(students, scan('not-a-code'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('scan_not_found');
  });

  it('scan ambiguous alias returns scan_ambiguous', () => {
    const result = resolveScannedStudent(students, scan('common-alias'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('scan_ambiguous');
  });

  it('scan inactive student returns scan_not_found', () => {
    const result = resolveScannedStudent(students, scan('005'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('scan_not_found');
  });

  it('scan empty string returns empty_query', () => {
    const result = resolveScannedStudent(students, scan(''));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('empty_query');
  });
});

describe('filterSearchSuggestions (F1 search rule, M1 F01)', () => {
  const acc = (studentId: string, displayName: string, extra: Partial<StudentAccount> = {}): StudentAccount => ({
    studentId, displayName, aliases: [], status: 'active', currentBalance: 0, faceEnrollmentStatus: 'none',
    createdAt: '', updatedAt: '', revision: 1, ...extra,
  } as StudentAccount);
  const roster = [
    acc('015', '周映彤'), acc('101', '林一'), acc('001', '王一'), acc('1', '陳一'),
    acc('002', '李二', { aliases: ['Amy'] }), acc('003', '停用者', { status: 'inactive', aliases: ['amy2'] }),
  ];

  it('puts an exact ID first, then ID prefix, then other matches, keeping roster order inside a group', () => {
    expect(filterSearchSuggestions(roster, '1').map(s => s.studentId)).toEqual(['1', '101', '015', '001']);
    expect(filterSearchSuggestions(roster, '001').map(s => s.studentId)).toEqual(['001']);
  });

  it('matches aliases case-insensitively, exact alias before partial, and never inactive accounts', () => {
    expect(filterSearchSuggestions(roster, 'amy').map(s => s.studentId)).toEqual(['002']);
    expect(filterSearchSuggestions(roster, '停用')).toEqual([]);
  });

  it('ignores surrounding spaces and returns nothing for a blank query', () => {
    expect(filterSearchSuggestions(roster, ' 015 ').map(s => s.studentId)).toEqual(['015']);
    expect(filterSearchSuggestions(roster, '   ')).toEqual([]);
  });
});
