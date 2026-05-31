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
  | { ok: false; code: 'missing_student_id' | 'invalid_action' | 'unsupported_version' | 'invalid_timestamp' | 'invalid_source' | 'expired' };

const VALID_ACTIONS: HandoffAction[] = ['order', 'payment'];
const VALID_SOURCES: PosSourceDevice[] = ['ipad_handoff'];
const SUPPORTED_VERSION = 1;

export function validateIpadHandoffMessage(msg: IpadHandoffMessage): ValidateHandoffResult {
  if (msg.version !== SUPPORTED_VERSION) return { ok: false, code: 'unsupported_version' };
  if (!msg.studentId.trim()) return { ok: false, code: 'missing_student_id' };
  if (!VALID_ACTIONS.includes(msg.action)) return { ok: false, code: 'invalid_action' };
  if (!msg.timestamp || msg.timestamp <= 0) return { ok: false, code: 'invalid_timestamp' };
  
  const MAX_HANDOFF_AGE_MS = 30_000; // 30 seconds
  if (Math.abs(Date.now() - msg.timestamp) > MAX_HANDOFF_AGE_MS) {
    return { ok: false, code: 'expired' };
  }

  if (!VALID_SOURCES.includes(msg.sourceDevice)) return { ok: false, code: 'invalid_source' };
  return { ok: true };
}

export function toHandoffScannerInput(msg: IpadHandoffMessage): ScannerInput {
  return { rawCode: msg.studentId.trim(), terminator: 'Enter' };
}

export function writeHandoffIntent(channel: string, msg: IpadHandoffMessage): void {
  sessionStorage.setItem(channel, JSON.stringify(msg));
}

function isIpadHandoffMessage(obj: unknown): obj is IpadHandoffMessage {
  if (typeof obj !== 'object' || obj === null) return false;
  const r = obj as Record<string, unknown>;
  return typeof r.version === 'number'
    && typeof r.timestamp === 'number'
    && typeof r.action === 'string'
    && typeof r.studentId === 'string'
    && typeof r.sourceDevice === 'string';
}

export function readHandoffIntent(channel: string): IpadHandoffMessage | null {
  const raw = sessionStorage.getItem(channel);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!isIpadHandoffMessage(parsed)) return null;
    sessionStorage.removeItem(channel);
    return parsed;
  } catch {
    sessionStorage.removeItem(channel);
    return null;
  }
}
