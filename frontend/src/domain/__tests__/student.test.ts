import { describe, it, expect } from 'vitest';
import {
  createStudentSnapshot,
  filterActiveStudents,
  searchActiveStudents,
  validateStudentImportRows,
  normalizeStudentCode,
  normalizeStudentCodeOrThrow,
  STUDENT_CODE_REGEX,
  buildStudentListWithGaps,
  validateNewAccount,
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

describe('normalizeStudentCode (U3 #1 / P06b 跨模式統一)', () => {
  it('去除前後空白、全形數字轉半形、補零至至少 3 位', () => {
    expect(normalizeStudentCode(' 5 ')).toEqual({ ok: true, code: '005', numericValue: 5 });
    expect(normalizeStudentCode('05')).toEqual({ ok: true, code: '005', numericValue: 5 });
    expect(normalizeStudentCode('005')).toEqual({ ok: true, code: '005', numericValue: 5 });
    expect(normalizeStudentCode('0005')).toEqual({ ok: true, code: '005', numericValue: 5 });
    expect(normalizeStudentCode(' ５ ')).toEqual({ ok: true, code: '005', numericValue: 5 });
    expect(normalizeStudentCode('001')).toEqual({ ok: true, code: '001', numericValue: 1 });
    expect(normalizeStudentCode('1000')).toEqual({ ok: true, code: '1000', numericValue: 1000 });
    expect(normalizeStudentCode('001000')).toEqual({ ok: true, code: '1000', numericValue: 1000 });
    expect(normalizeStudentCode('999999')).toEqual({ ok: true, code: '999999', numericValue: 999999 });
  });

  it('拒絕 0、000、負數、包含非數字字元、超出 6 位數或空字串', () => {
    expect(normalizeStudentCode('0').ok).toBe(false);
    expect(normalizeStudentCode('000').ok).toBe(false);
    expect(normalizeStudentCode('-5').ok).toBe(false);
    expect(normalizeStudentCode('abc').ok).toBe(false);
    expect(normalizeStudentCode('001a').ok).toBe(false);
    expect(normalizeStudentCode('1000000').ok).toBe(false);
    expect(normalizeStudentCode('').ok).toBe(false);
    expect(normalizeStudentCode('   ').ok).toBe(false);
  });

  it('超長輸入明確有界防護（防範 JS Number 溢位 / 科學記號 / Infinity 變別號）', () => {
    // 超長純數字（100 位）
    expect(normalizeStudentCode('1'.repeat(100)).ok).toBe(false);
    expect(() => normalizeStudentCodeOrThrow('1'.repeat(100))).toThrow('學員編號上限為 6 位數');

    // 冗餘大量前導零加上合法編號
    expect(normalizeStudentCode('0'.repeat(100) + '5')).toEqual({ ok: true, code: '005', numericValue: 5 });
    expect(normalizeStudentCodeOrThrow('0'.repeat(100) + '5')).toBe('005');

    // 冗餘大量前導零加上 1000
    expect(normalizeStudentCode('0'.repeat(100) + '1000')).toEqual({ ok: true, code: '1000', numericValue: 1000 });
    expect(normalizeStudentCodeOrThrow('0'.repeat(100) + '1000')).toBe('1000');

    // 冗餘大量前導零但純零（0）
    expect(normalizeStudentCode('0'.repeat(100)).ok).toBe(false);
    expect(() => normalizeStudentCodeOrThrow('0'.repeat(100))).toThrow('學員編號必須大於 0');

    // 冗餘大量前導零但數值超出 6 位（1000000）
    expect(normalizeStudentCode('0'.repeat(100) + '1000000').ok).toBe(false);
    expect(() => normalizeStudentCodeOrThrow('0'.repeat(100) + '1000000')).toThrow('學員編號上限為 6 位數');
  });

  it('Cloud Adapter (normalizeStudentCodeOrThrow) 與 Prototype Adapter (normalizeStudentCode) 契約對齊', () => {
    const validCases = [
      [' 5 ', '005'],
      ['05', '005'],
      ['0005', '005'],
      [' ５ ', '005'],
      ['001', '001'],
      ['1000', '1000'],
      ['001000', '1000'],
      ['999999', '999999'],
    ] as const;

    for (const [raw, expected] of validCases) {
      const protoRes = normalizeStudentCode(raw);
      expect(protoRes.ok).toBe(true);
      if (protoRes.ok) {
        expect(protoRes.code).toBe(expected);
        expect(STUDENT_CODE_REGEX.test(protoRes.code)).toBe(true);
      }
      expect(normalizeStudentCodeOrThrow(raw)).toBe(expected);
      expect(STUDENT_CODE_REGEX.test(normalizeStudentCodeOrThrow(raw))).toBe(true);
    }

    const invalidCases = [
      '0', '00', '000', '-5', 'abc', '001a', '1000000', '', '   ', '1'.repeat(100),
    ];

    for (const raw of invalidCases) {
      expect(normalizeStudentCode(raw).ok).toBe(false);
      expect(() => normalizeStudentCodeOrThrow(raw)).toThrow();
    }
  });
});

describe('buildStudentListWithGaps (U3 #2)', () => {
  const mk = (id: string, name: string, status: StudentAccount['status'] = 'active'): StudentAccount => ({
    studentId: id,
    displayName: name,
    status,
    currentBalance: 0,
    aliases: [],
    faceEnrollmentStatus: 'none',
    createdAt: '',
    updatedAt: '',
    revision: 1,
  });

  it('依編號數值由小到大排序，並從 001 列出至最大使用號碼的空號', () => {
    const list = [
      mk('005', '五號'),
      mk('002', '二號'),
    ];
    const result = buildStudentListWithGaps(list);
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({
      type: 'gap',
      startCode: '001',
      endCode: '001',
      count: 1,
      label: '001 尚無人使用',
    });
    expect(result[1]).toMatchObject({
      type: 'student',
      student: expect.objectContaining({ studentId: '002', displayName: '二號' }),
      sortKey: 2,
    });
    expect(result[2]).toEqual({
      type: 'gap',
      startCode: '003',
      endCode: '004',
      count: 2,
      label: '003–004 尚無人使用（2 個號碼）',
    });
    expect(result[3]).toMatchObject({
      type: 'student',
      student: expect.objectContaining({ studentId: '005', displayName: '五號' }),
      sortKey: 5,
    });
  });

  it('停用帳戶占用自身號碼（Q3 定案），不視為空號', () => {
    const list = [
      mk('001', '一號'),
      mk('002', '停用二號', 'inactive'),
      mk('003', '三號'),
    ];
    const result = buildStudentListWithGaps(list);
    expect(result).toHaveLength(3);
    expect(result.every(r => r.type === 'student')).toBe(true);
    expect(result[1]).toMatchObject({
      type: 'student',
      student: expect.objectContaining({ studentId: '002', status: 'inactive' }),
    });
  });

  it('搜尋框有文字時不顯示空號列，只回傳符合之帳戶（仍按數值排序）', () => {
    const list = [
      mk('001', '王一'),
      mk('010', '王十'),
      mk('020', '李二十'),
    ];
    const result = buildStudentListWithGaps(list, '王');
    expect(result).toHaveLength(2);
    expect(result.every(r => r.type === 'student')).toBe(true);
    expect(result.map(r => r.type === 'student' ? r.student.studentId : null)).toEqual(['001', '010']);
  });

  it('全系統無學員時回傳空陣列', () => {
    expect(buildStudentListWithGaps([])).toEqual([]);
  });

  it('舊測試資料若有非數字編號安全排於數值編號之後', () => {
    const list = [
      mk('guest-1', '訪客'),
      mk('002', '二號'),
      mk('001', '一號'),
    ];
    const result = buildStudentListWithGaps(list);
    expect(result.map(r => r.type === 'student' ? r.student.studentId : null)).toEqual([
      '001', '002', 'guest-1',
    ]);
  });

  it('U3 Review Finding 2: 舊資料若已有未正規化碰撞（如既有 5 與 005），完整列出不隱藏並標記 isCollision', () => {
    const list = [
      mk('5', '五號舊資料'),
      mk('005', '五號新格式'),
      mk('002', '二號'),
    ];
    const result = buildStudentListWithGaps(list);
    // 應有缺號 001、學員 002、缺號 003–004、以及兩名五號學員
    expect(result).toHaveLength(5);
    const students5 = result.filter(r => r.type === 'student' && (r.student.studentId === '5' || r.student.studentId === '005'));
    expect(students5).toHaveLength(2);
    expect(students5.every(s => s.type === 'student' && s.isCollision === true)).toBe(true);
  });
});

describe('validateNewAccount (U3 #1)', () => {
  const mk = (id: string, name: string, status: StudentAccount['status'] = 'active'): StudentAccount => ({
    studentId: id, displayName: name, status, currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none',
    createdAt: '', updatedAt: '', revision: 1,
  });

  it('新編號自動正規化（例如輸入 5 存為 005）', () => {
    const result = validateNewAccount({
      studentId: '5',
      displayName: '五號學生',
      openingBalanceText: '0',
      openingNote: '',
    }, []);
    expect(result).toMatchObject({
      ok: true,
      studentId: '005',
    });
  });

  it('非合法純數字編號報 invalid_id 錯誤', () => {
    const result = validateNewAccount({
      studentId: 'abc',
      displayName: '小明',
      openingBalanceText: '0',
      openingNote: '',
    }, []);
    expect(result).toEqual({
      ok: false,
      errors: ['invalid_id'],
    });
  });

  it('重複編號（含格式不同正規化後相同者，及停用帳戶）阻擋', () => {
    const existing = [mk('005', '五號'), mk('010', '十號停用', 'inactive')];
    // 輸入 ' 05 ' 與 005 重複
    expect(validateNewAccount({
      studentId: ' 05 ',
      displayName: '新人',
      openingBalanceText: '0',
      openingNote: '',
    }, existing)).toEqual({
      ok: false,
      errors: ['duplicate_id'],
    });

    // 輸入 '10' 與停用帳戶 010 重複
    expect(validateNewAccount({
      studentId: '10',
      displayName: '新人',
      openingBalanceText: '0',
      openingNote: '',
    }, existing)).toEqual({
      ok: false,
      errors: ['duplicate_id'],
    });

    // U3 Review Finding 2: 既有資料有未正規化 '5'，新增 '05' 或 '005' 仍能正確判定重複阻擋
    const unnormalizedExisting = [mk('5', '舊五號')];
    expect(validateNewAccount({
      studentId: '05',
      displayName: '新帳戶',
      openingBalanceText: '0',
      openingNote: '',
    }, unnormalizedExisting)).toEqual({
      ok: false,
      errors: ['duplicate_id'],
    });
    expect(validateNewAccount({
      studentId: '005',
      displayName: '新帳戶',
      openingBalanceText: '0',
      openingNote: '',
    }, unnormalizedExisting)).toEqual({
      ok: false,
      errors: ['duplicate_id'],
    });
  });
});
