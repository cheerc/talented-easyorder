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
  /** 平板上這個帳戶註冊了幾張臉（共用帳戶的兄弟姊妹各一張）；平板回報才有。 */
  faceCount?: number;
  /** M0：開帳前的期初餘額。獨立於交易，重算餘額時作為起點。 */
  openingBalance?: OpeningBalance;
  createdAt: string;
  updatedAt: string;
  revision: number;
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

// ─── M0 / U3：學員編號正規化與缺號清單 ───

/**
 * Q2 已定案規則：學生編號唯一正規化
 * - 去頭尾空白
 * - 全形數字（０–９）轉半形（0–9）
 * - 必須全為純數字，範圍 1–999999（即 001–999999；0、000 不接受）
 * - 唯一正規形式：補零至至少 3 位（'5' -> '005', '1000' -> '1000'）
 */
export function normalizeStudentCode(raw: string):
  | { ok: true; code: string; numericValue: number }
  | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: '請輸入學員編號' };
  }
  // 全形數字轉半形
  const halfwidth = trimmed.replace(/[０-９]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  );
  if (!/^\d+$/.test(halfwidth)) {
    return { ok: false, reason: '學員編號必須為純數字' };
  }
  const numericValue = parseInt(halfwidth, 10);
  if (numericValue < 1) {
    return { ok: false, reason: '學員編號必須大於 0（從 001 開始）' };
  }
  if (numericValue > 999999) {
    return { ok: false, reason: '學員編號上限為 6 位數（999999）' };
  }
  const code = String(numericValue).padStart(3, '0');
  return { ok: true, code, numericValue };
}

export type StudentListItem =
  | { type: 'student'; student: StudentAccount; sortKey: number }
  | { type: 'gap'; startCode: string; endCode: string; count: number; label: string };

/**
 * 依編號數值由小到大排序學員清單，並列出從 001 到「目前最大使用號碼（含停用帳戶）」之間的空號（缺號列）。
 * - 停用帳戶仍然占用號碼，不算空號。
 * - 搜尋框有文字時，不列出空號列（只顯示符合搜尋的帳戶，仍按數值排序）。
 * - 非純數字 ID（如舊測試資料）安全排於數值編號之後。
 */
export function buildStudentListWithGaps(
  students: StudentAccount[],
  searchQuery?: string
): StudentListItem[] {
  const query = searchQuery?.trim().toLowerCase();

  // 1. 若有搜尋條件，不列空號，僅過濾並排序既有學員
  if (query) {
    const matched = students.filter(s => {
      const id = s.studentId.toLowerCase();
      const name = s.displayName.toLowerCase();
      const aliases = s.aliases.map(a => a.toLowerCase());
      return id.includes(query) || name.includes(query) || aliases.some(a => a.includes(query));
    });

    return matched
      .map(s => {
        const norm = normalizeStudentCode(s.studentId);
        return {
          type: 'student' as const,
          student: s,
          sortKey: norm.ok ? norm.numericValue : Infinity,
        };
      })
      .sort((a, b) => a.sortKey - b.sortKey || a.student.studentId.localeCompare(b.student.studentId));
  }

  // 2. 無搜尋條件：由 001 檢查至目前最大號碼
  if (students.length === 0) {
    return [];
  }

  // 找出所有有效數字編號的學員
  const studentByNum = new Map<number, StudentAccount>();
  const nonNumericStudents: StudentAccount[] = [];
  let maxNum = 0;

  for (const s of students) {
    const norm = normalizeStudentCode(s.studentId);
    if (norm.ok) {
      studentByNum.set(norm.numericValue, s);
      if (norm.numericValue > maxNum) {
        maxNum = norm.numericValue;
      }
    } else {
      nonNumericStudents.push(s);
    }
  }

  if (maxNum === 0) {
    // 全為非數字編號
    return nonNumericStudents
      .sort((a, b) => a.studentId.localeCompare(b.studentId))
      .map(s => ({ type: 'student' as const, student: s, sortKey: Infinity }));
  }

  const result: StudentListItem[] = [];
  let gapStart: number | null = null;

  for (let num = 1; num <= maxNum; num++) {
    const existing = studentByNum.get(num);
    if (existing) {
      // 若先前有累積缺號，先輸出缺號
      if (gapStart !== null) {
        const gapEnd = num - 1;
        const count = gapEnd - gapStart + 1;
        const startCode = String(gapStart).padStart(3, '0');
        const endCode = String(gapEnd).padStart(3, '0');
        const label = count === 1
          ? `${startCode} 尚無人使用`
          : `${startCode}–${endCode} 尚無人使用（${count} 個號碼）`;
        result.push({ type: 'gap', startCode, endCode, count, label });
        gapStart = null;
      }
      result.push({ type: 'student', student: existing, sortKey: num });
    } else {
      // 缺號累積
      if (gapStart === null) {
        gapStart = num;
      }
    }
  }

  // 非數字編號排在最後
  nonNumericStudents.sort((a, b) => a.studentId.localeCompare(b.studentId));
  for (const s of nonNumericStudents) {
    result.push({ type: 'student', student: s, sortKey: Infinity });
  }

  return result;
}

// ─── M0：本機手動建帳戶 ───

export interface NewAccountInput {
  studentId: string;
  displayName: string;
  /** 文字輸入；空白不等於 0，必須明確輸入（可為 0 或負數）。 */
  openingBalanceText: string;
  openingNote: string;
}

export type NewAccountError = 'missing_id' | 'invalid_id' | 'duplicate_id' | 'missing_name' | 'missing_opening' | 'invalid_opening';

export type NewAccountValidation =
  | { ok: true; studentId: string; displayName: string; openingBalance: number; sameNameIds: string[] }
  | { ok: false; errors: NewAccountError[] };

export const NEW_ACCOUNT_ERROR_MESSAGES: Record<NewAccountError, string> = {
  missing_id: '請輸入帳戶編號',
  invalid_id: '編號必須為純數字，範圍 001–999999',
  duplicate_id: '這個帳戶編號已經存在',
  missing_name: '請輸入姓名',
  missing_opening: '請輸入期初餘額（沒有就填 0）',
  invalid_opening: '期初餘額必須是整數，可為 0 或負數',
};

/**
 * 驗證新帳戶。編號唯一正規化（前導 0 補足至少 3 位，例如 `5` -> `005`），重複編號阻擋；
 * 同名不阻擋，只回傳同名帳戶的編號供畫面提示。
 */
export function validateNewAccount(input: NewAccountInput, existing: StudentAccount[]): NewAccountValidation {
  const errors: NewAccountError[] = [];
  const rawId = input.studentId.trim();
  const displayName = input.displayName.trim();
  const openingText = input.openingBalanceText.trim();

  let studentId = rawId;
  if (!rawId) {
    errors.push('missing_id');
  } else {
    const norm = normalizeStudentCode(rawId);
    if (!norm.ok) {
      errors.push('invalid_id');
    } else {
      studentId = norm.code;
      if (existing.some(s => s.studentId === norm.code)) {
        errors.push('duplicate_id');
      }
    }
  }

  if (!displayName) errors.push('missing_name');

  const openingBalance = Number(openingText);
  if (!openingText) errors.push('missing_opening');
  else if (!/^-?\d+$/.test(openingText) || !Number.isSafeInteger(openingBalance)) errors.push('invalid_opening');

  if (errors.length > 0) return { ok: false, errors };
  const sameNameIds = existing.filter(s => s.displayName === displayName && s.studentId !== studentId).map(s => s.studentId);
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
