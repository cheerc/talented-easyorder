/** 目前登入的操作員：uid 用來辨識「是不是自己」，name 是畫面上顯示的名稱。 */
export interface OperatorSelf {
  uid: string;
  name: string;
}

const OTHER_OPERATOR_LABEL = '其他操作員';
const CURRENT_OPERATOR_LABEL = '目前操作員';

/**
 * 沒有 email 的紀錄（開帳人、關帳後補記）在一般畫面只顯示人名，不顯示原始 UID。
 * 自己 → 操作員名稱（名稱本身就是 UID 或空白時改用中性文字）；其他人、空值 → 「其他操作員」。
 * 純函式，不讀 Firestore；辨識是哪一位其他操作員不在範圍內。
 */
export function operatorDisplayLabel(uid: string | null | undefined, self: OperatorSelf | null | undefined): string {
  if (!uid || !self || uid !== self.uid) return OTHER_OPERATOR_LABEL;
  const name = self.name.trim();
  return name === '' || name === self.uid ? CURRENT_OPERATOR_LABEL : name;
}
