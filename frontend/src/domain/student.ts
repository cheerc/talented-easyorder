export type StudentStatus = 'active' | 'inactive';
export type FaceEnrollmentStatus = 'none' | 'enrolled' | 'disabled' | 'needs_review';

export interface StudentAccount {
  studentId: string;
  studentCode?: string;
  displayName: string;
  status: StudentStatus;
  currentBalance: number;
  aliases: string[];
  className?: string;
  groupName?: string;
  faceProfileId?: string;
  faceEnrollmentStatus: FaceEnrollmentStatus;
  /** 平板上這個帳戶註冊了幾張臉（共用帳戶的兄弟姊妹各一張）；平板回報才有。 */
  faceCount?: number;
  /** M0：開帳前的期初餘額。獨立於交易，重算餘額時作為起點。 */
  openingBalance?: OpeningBalance;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export const STUDENT_CODE_REGEX = /^(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,5})$/;

/**
 * P06b 學生編號唯一正規化：
 * 去頭尾空白 -> 全形數字轉半形 -> 轉整數 (1..999999) -> 補零到至少 3 位。
 * 例：5 / 05 / 0005 / ５ 都正規化為 "005"；1000 維持 "1000"。
 * 若格式不合法或超出範圍，拋出 Error。
 */
export function normalizeStudentCode(input: string): string {
  if (typeof input !== 'string') {
    throw new Error('學生編號必須為字串');
  }
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('學生編號不能為空');
  }
  const halfWidth = trimmed.replace(/[０-９]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  );
  if (!/^\d+$/.test(halfWidth)) {
    throw new Error('學生編號只能包含數字');
  }
  const num = parseInt(halfWidth, 10);
  if (!Number.isSafeInteger(num) || num < 1 || num > 999999) {
    throw new Error('學生編號範圍必須在 001 到 999999 之間');
  }
  const result = num < 1000 ? String(num).padStart(3, '0') : String(num);
  if (!STUDENT_CODE_REGEX.test(result)) {
    throw new Error('學生編號正規化後格式不符');
  }
  return result;
}

/** 期初餘額：有自己的日期、備註與建立時間，不偽裝成收款交易。 */
export interface OpeningBalance {
  amount: number;
  asOfDate: string;
  note: string;
  createdAt: string;
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

// ─── M0：本機手動建帳戶 ───

export interface NewAccountInput {
  studentId: string;
  displayName: string;
  /** 文字輸入；空白不等於 0，必須明確輸入（可為 0 或負數）。 */
  openingBalanceText: string;
  openingNote: string;
}

export type NewAccountError = 'missing_id' | 'duplicate_id' | 'missing_name' | 'missing_opening' | 'invalid_opening';

export type NewAccountValidation =
  | { ok: true; studentId: string; displayName: string; openingBalance: number; sameNameIds: string[] }
  | { ok: false; errors: NewAccountError[] };

export const NEW_ACCOUNT_ERROR_MESSAGES: Record<NewAccountError, string> = {
  missing_id: '請輸入帳戶編號',
  duplicate_id: '這個帳戶編號已經存在',
  missing_name: '請輸入姓名',
  missing_opening: '請輸入期初餘額（沒有就填 0）',
  invalid_opening: '期初餘額必須是整數，可為 0 或負數',
};

/**
 * 驗證新帳戶。編號保留原字串（例如前導 0 的 `001`），重複編號阻擋；
 * 同名不阻擋，只回傳同名帳戶的編號供畫面提示。
 */
export function validateNewAccount(input: NewAccountInput, existing: StudentAccount[]): NewAccountValidation {
  const errors: NewAccountError[] = [];
  const studentId = input.studentId.trim();
  const displayName = input.displayName.trim();
  const openingText = input.openingBalanceText.trim();

  if (!studentId) errors.push('missing_id');
  else if (existing.some(s => s.studentId === studentId)) errors.push('duplicate_id');
  if (!displayName) errors.push('missing_name');

  const openingBalance = Number(openingText);
  if (!openingText) errors.push('missing_opening');
  else if (!/^-?\d+$/.test(openingText) || !Number.isSafeInteger(openingBalance)) errors.push('invalid_opening');

  if (errors.length > 0) return { ok: false, errors };
  const sameNameIds = existing.filter(s => s.displayName === displayName).map(s => s.studentId);
  return { ok: true, studentId, displayName, openingBalance, sameNameIds };
}

export function createLocalAccount(
  input: { studentId: string; displayName: string; openingBalance: number; openingNote: string; asOfDate: string },
  now: string,
): StudentAccount {
  return {
    studentId: input.studentId,
    displayName: input.displayName,
    status: 'active',
    currentBalance: input.openingBalance,
    aliases: [],
    faceEnrollmentStatus: 'none',
    openingBalance: {
      amount: input.openingBalance,
      asOfDate: input.asOfDate,
      note: input.openingNote.trim(),
      createdAt: now,
    },
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
}

/** M0：別名以逗號（全形、半形）或頓號分隔；去空白、去重、移除與姓名相同者。 */
export function parseAliases(text: string, displayName: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[,，、]/)) {
    const alias = part.trim();
    if (alias && alias !== displayName.trim()) seen.add(alias);
  }
  return [...seen];
}
