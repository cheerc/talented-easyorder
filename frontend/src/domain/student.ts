export type StudentStatus = 'active' | 'inactive';
export type FaceEnrollmentStatus = 'none' | 'enrolled' | 'disabled' | 'needs_review';

export interface StudentAccount {
  studentId: string;
  displayName: string;
  status: StudentStatus;
  currentBalance: number;
  aliases: string[];
  className?: string;
  groupName?: string;
  faceProfileId?: string;
  faceEnrollmentStatus: FaceEnrollmentStatus;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface StudentSnapshot {
  studentId: string;
  studentNameSnapshot: string;
}

export interface StudentImportRow {
  studentId: string;
  displayName: string;
  openingBalance: string;
}

export interface ImportFieldError {
  row: number;
  field: 'studentId' | 'displayName' | 'openingBalance';
  message: string;
}

export interface StudentImportResult {
  valid: StudentImportRow[];
  errors: ImportFieldError[];
}

export function createStudentSnapshot(student: StudentAccount): StudentSnapshot {
  return {
    studentId: student.studentId,
    studentNameSnapshot: student.displayName,
  };
}

export function filterActiveStudents(students: StudentAccount[]): StudentAccount[] {
  return students.filter(s => s.status === 'active');
}

export function searchActiveStudents(students: StudentAccount[], query: string): StudentAccount[] {
  const active = filterActiveStudents(students);
  const trimmed = query.trim();
  if (!trimmed) return active;

  return active.filter(s =>
    s.studentId.includes(trimmed) ||
    s.displayName.includes(trimmed) ||
    s.aliases.some(a => a.includes(trimmed))
  );
}

export function validateStudentImportRows(rows: StudentImportRow[]): StudentImportResult {
  const errors: ImportFieldError[] = [];
  const valid: StudentImportRow[] = [];

  const idCounts = new Map<string, number[]>();
  rows.forEach((row, i) => {
    const existing = idCounts.get(row.studentId);
    if (existing) {
      existing.push(i);
    } else {
      idCounts.set(row.studentId, [i]);
    }
  });

  const duplicateIds = new Set<string>();
  for (const [id, indices] of idCounts) {
    if (indices.length > 1) duplicateIds.add(id);
  }

  rows.forEach((row, i) => {
    let rowHasError = false;

    if (duplicateIds.has(row.studentId)) {
      errors.push({ row: i, field: 'studentId', message: `Duplicate studentId: ${row.studentId}` });
      rowHasError = true;
    }

    if (!row.displayName.trim()) {
      errors.push({ row: i, field: 'displayName', message: 'Display name is required' });
      rowHasError = true;
    }

    if (isNaN(Number(row.openingBalance)) || row.openingBalance.trim() === '') {
      errors.push({ row: i, field: 'openingBalance', message: 'Opening balance must be numeric' });
      rowHasError = true;
    }

    if (!rowHasError) {
      valid.push(row);
    }
  });

  return { valid, errors };
}
