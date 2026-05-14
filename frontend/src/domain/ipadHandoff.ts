import type { PosMode, PosSourceDevice } from './posFlow';
import type { ScannerInput } from './posSearch';

export type HandoffAction = PosMode;

export interface IpadHandoffMessage {
  version: number;
  timestamp: number;
  action: HandoffAction;
  studentId: string;
  sourceDevice: PosSourceDevice;
  note?: string;
}

export type ValidateHandoffResult =
  | { ok: true }
  | { ok: false; code: 'missing_student_id' | 'invalid_action' | 'unsupported_version' | 'invalid_timestamp' | 'invalid_source' };

const VALID_ACTIONS: HandoffAction[] = ['order', 'topup', 'cancel'];
const VALID_SOURCES: PosSourceDevice[] = ['ipad_handoff'];
const SUPPORTED_VERSION = 1;

export function validateIpadHandoffMessage(msg: IpadHandoffMessage): ValidateHandoffResult {
  if (msg.version !== SUPPORTED_VERSION) return { ok: false, code: 'unsupported_version' };
  if (!msg.studentId.trim()) return { ok: false, code: 'missing_student_id' };
  if (!VALID_ACTIONS.includes(msg.action)) return { ok: false, code: 'invalid_action' };
  if (!msg.timestamp || msg.timestamp <= 0) return { ok: false, code: 'invalid_timestamp' };
  if (!VALID_SOURCES.includes(msg.sourceDevice)) return { ok: false, code: 'invalid_source' };
  return { ok: true };
}

export function toHandoffScannerInput(msg: IpadHandoffMessage): ScannerInput {
  return { rawCode: msg.studentId.trim(), terminator: 'Enter' };
}

export function writeHandoffIntent(channel: string, msg: IpadHandoffMessage): void {
  localStorage.setItem(channel, JSON.stringify(msg));
}

export function readHandoffIntent(channel: string): IpadHandoffMessage | null {
  const raw = localStorage.getItem(channel);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    localStorage.removeItem(channel);
    return parsed as IpadHandoffMessage;
  } catch {
    localStorage.removeItem(channel);
    return null;
  }
}
