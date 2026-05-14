import { describe, it, expect } from 'vitest';
import {
  createStudentSnapshot,
  filterActiveStudents,
  searchActiveStudents,
  validateStudentImportRows,
} from '../student';
import type { StudentAccount } from '../student';
import { STUDENT_001, STUDENT_004 } from './fixtures';

const INACTIVE_STUDENT: StudentAccount = {
  ...STUDENT_001,
  studentId: '099',
  displayName: '已畢業學生',
  status: 'inactive',
};

describe('createStudentSnapshot', () => {
  it('captures current display name into snapshot', () => {
    const snapshot = createStudentSnapshot(STUDENT_001);
    expect(snapshot).toEqual({
      studentId: '001',
      studentNameSnapshot: '王柏翰',
    });
  });
});

describe('filterActiveStudents', () => {
  it('excludes inactive students', () => {
    const students = [STUDENT_001, INACTIVE_STUDENT, STUDENT_004];
    const result = filterActiveStudents(students);
    expect(result).toHaveLength(2);
    expect(result.every(s => s.status === 'active')).toBe(true);
  });

  it('returns empty array when all inactive', () => {
    const result = filterActiveStudents([INACTIVE_STUDENT]);
    expect(result).toEqual([]);
  });
});

describe('searchActiveStudents', () => {
  const students: StudentAccount[] = [
    STUDENT_001,
    STUDENT_004,
    INACTIVE_STUDENT,
    { ...STUDENT_001, studentId: '050', displayName: '王小明', aliases: ['小王'] },
  ];

  it('matches by studentId prefix', () => {
    const result = searchActiveStudents(students, '001');
    expect(result).toHaveLength(1);
    expect(result[0].studentId).toBe('001');
  });

  it('matches by display name (Traditional Chinese)', () => {
    const result = searchActiveStudents(students, '柏翰');
    expect(result).toHaveLength(1);
    expect(result[0].studentId).toBe('001');
  });

  it('matches by alias', () => {
    const result = searchActiveStudents(students, '小王');
    expect(result).toHaveLength(1);
    expect(result[0].studentId).toBe('050');
  });

  it('excludes inactive students from search results', () => {
    const result = searchActiveStudents(students, '畢業');
    expect(result).toHaveLength(0);
  });

  it('returns all active students for empty query', () => {
    const result = searchActiveStudents(students, '');
    expect(result).toHaveLength(3);
  });
});

describe('validateStudentImportRows', () => {
  it('accepts valid rows', () => {
    const rows = [
      { studentId: '100', displayName: '新生甲', openingBalance: '500' },
      { studentId: '101', displayName: '新生乙', openingBalance: '0' },
    ];
    const result = validateStudentImportRows(rows);
    expect(result.valid).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it('reports duplicate studentId on every duplicate row', () => {
    const rows = [
      { studentId: '100', displayName: '甲', openingBalance: '500' },
      { studentId: '100', displayName: '乙', openingBalance: '300' },
      { studentId: '100', displayName: '丙', openingBalance: '200' },
    ];
    const result = validateStudentImportRows(rows);
    expect(result.valid).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
    expect(result.errors.every(e => e.field === 'studentId')).toBe(true);
  });

  it('reports empty display name', () => {
    const rows = [
      { studentId: '100', displayName: '', openingBalance: '500' },
    ];
    const result = validateStudentImportRows(rows);
    expect(result.valid).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('displayName');
  });

  it('reports non-numeric opening balance', () => {
    const rows = [
      { studentId: '100', displayName: '甲', openingBalance: 'abc' },
    ];
    const result = validateStudentImportRows(rows);
    expect(result.valid).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('openingBalance');
  });

  it('reports multiple errors for one row', () => {
    const rows = [
      { studentId: '100', displayName: '', openingBalance: 'abc' },
    ];
    const result = validateStudentImportRows(rows);
    expect(result.valid).toHaveLength(0);
    expect(result.errors).toHaveLength(2);
  });
});
