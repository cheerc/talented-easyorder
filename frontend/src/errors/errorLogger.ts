import { onError } from './errorBus';
import {
  ALL_COMMAND_KINDS,
  COMMAND_ERROR_CODES,
  type BusinessCommandKind,
  type CommandErrorCode,
} from '../domain/cloudCommands';

export interface ErrorLogEntry {
  id: string;
  createdAt: string;
  source: 'react' | 'window-error' | 'unhandled-rejection' | 'storage' | 'sync' | 'auth' | 'firebase' | 'settlement' | 'runtime';
  message: string;
  stack?: string;
  context?: Record<string, string | number | boolean | null>;
}

// Keep this logger importable by repository probes that execute outside Vite
// (for example, the P12c browser contract imports repositories in Node).
const runtimeEnv = import.meta.env;
const isPrototypeMode = runtimeEnv?.MODE === 'prototype';
const isCloudMode = !isPrototypeMode && Boolean(
  runtimeEnv?.VITE_FIREBASE_API_KEY
  && runtimeEnv.VITE_FIREBASE_AUTH_DOMAIN
  && runtimeEnv.VITE_FIREBASE_PROJECT_ID
  && runtimeEnv.VITE_FIREBASE_APP_ID
  && runtimeEnv.VITE_FIREBASE_MESSAGING_SENDER_ID
  && runtimeEnv.VITE_FIREBASE_STORAGE_BUCKET,
);
const LOG_KEY = isPrototypeMode ? 'easyorder-error-log-prototype' : 'easyorder-error-log';
export const SAFE_DIAGNOSTICS_STORAGE_KEY = isCloudMode
  ? 'easyorder-diagnostics-cloud'
  : 'easyorder-diagnostics-nonprototype';
export const MAX_LOG_ENTRIES = 100;
export const LOG_TTL_MS = 24 * 60 * 60 * 1000;
const LEGACY_NON_PROTOTYPE_LOG_KEY = 'easyorder-error-log';

export type SafeDiagnosticSource = ErrorLogEntry['source'];
export type SafeSystemDiagnosticCode =
  | 'RENDER_CRASH'
  | 'UNKNOWN_RUNTIME_ERROR'
  | 'LOCAL_STORAGE_ERROR'
  | 'SYNC_ERROR'
  | 'AUTH_ERROR'
  | 'FIREBASE_ERROR'
  | 'SETTLEMENT_ERROR';

export interface SafeCommandDiagnostic {
  type: 'command-failure';
  commandId: string | null;
  kind: BusinessCommandKind | null;
  errorCode: CommandErrorCode;
  occurredAt: string;
}

export interface SafeSystemDiagnostic {
  type: 'system-error';
  source: SafeDiagnosticSource;
  systemCode: SafeSystemDiagnosticCode;
  occurredAt: string;
}

export type SafeDiagnosticEntry = SafeCommandDiagnostic | SafeSystemDiagnostic;

interface SafeDiagnosticEnvelope {
  schemaVersion: 1;
  entries: SafeDiagnosticEntry[];
}

const SAFE_SOURCES: readonly SafeDiagnosticSource[] = [
  'react', 'window-error', 'unhandled-rejection', 'storage', 'sync', 'auth', 'firebase', 'settlement', 'runtime',
];
const SYSTEM_CODE_BY_SOURCE: Record<SafeDiagnosticSource, SafeSystemDiagnosticCode> = {
  react: 'RENDER_CRASH',
  'window-error': 'UNKNOWN_RUNTIME_ERROR',
  'unhandled-rejection': 'UNKNOWN_RUNTIME_ERROR',
  storage: 'LOCAL_STORAGE_ERROR',
  sync: 'SYNC_ERROR',
  auth: 'AUTH_ERROR',
  firebase: 'FIREBASE_ERROR',
  settlement: 'SETTLEMENT_ERROR',
  runtime: 'UNKNOWN_RUNTIME_ERROR',
};
const COMMAND_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMAND_ERROR_SET = new Set<string>(COMMAND_ERROR_CODES);
const COMMAND_KIND_SET = new Set<string>(ALL_COMMAND_KINDS);

// Error log 保留在 localStorage 而非 IndexedDB：
// appendErrorLog 在 ErrorBoundary.componentDidCatch 與 global error listeners 中被同步呼叫，
// 若改為 async IndexedDB 會導致 race condition（React render 與 error logging 交錯）。
// 所有寫入的 entry 已通過 sanitizeMessage / sanitizeContext 去識別化，localStorage 可接受。

const CONTEXT_ALLOW_LIST = new Set([
  'component', 'action', 'route', 'businessDate', 'transactionType',
  'syncStatus', 'errorCode', 'retryCount', 'deviceType', 'errorHint',
]);

function sanitizeContext(
  context?: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> | undefined {
  if (!context) return undefined;
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(context)) {
    if (CONTEXT_ALLOW_LIST.has(key)) {
      clean[key] = typeof value === 'string' ? sanitizeMessage(value) : value;
    }
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

export function sanitizeMessage(message: string): string {
  return message
    .replace(/學生[：:]\s*[^,\n，]+/g, '學生: [REDACTED]')
    .replace(/姓名[：:]\s*[^,\n，]+/g, '姓名: [REDACTED]')
    .replace(/\bname[：:]\s*[^,\n，]+/gi, 'name: [REDACTED]')
    .replace(/餘額[：:]\s*-?\d+/g, '餘額: [REDACTED]')
    .replace(/金額[：:]\s*-?\d+/g, '金額: [REDACTED]')
    .replace(/09\d{2}[-\s]?\d{3}[-\s]?\d{3}/g, '[PHONE REDACTED]')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL REDACTED]')
    .replace(/(?:\d+[號樓]|\d+巷\d+弄|[鄉鎮市區路街段巷弄號樓]{2,})/g, '[ADDR REDACTED]')
    .replace(/[A-Z]\d{9}/g, '[ID REDACTED]');
}

// Ref: #288 — Strip file paths and user-home directories from stack traces.
// Prevents leaking OS username, project paths, and internal file structure.
export function sanitizeStack(stack: string): string {
  return sanitizeMessage(stack)
    // Strip absolute file paths (Unix and Windows)
    .replace(/(?:\/[\w.-]+){2,}/g, '[PATH]')
    .replace(/(?:[A-Z]:\\[\w\\.-]+)/gi, '[PATH]')
    // Strip webpack/vite internal paths
    .replace(/\b(?:node_modules|__vite_ssr_import__)[\w/.\\-]*/g, '[MODULE]');
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validOccurredAt(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function decodeSafeDiagnostic(value: unknown, now: number): SafeDiagnosticEntry | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (!validOccurredAt(entry.occurredAt)) return null;
  const age = now - Date.parse(entry.occurredAt);
  if (age < 0 || age > LOG_TTL_MS) return null;

  if (entry.type === 'command-failure'
    && exactKeys(entry, ['type', 'commandId', 'kind', 'errorCode', 'occurredAt'])
    && (entry.commandId === null || (typeof entry.commandId === 'string' && COMMAND_ID_PATTERN.test(entry.commandId)))
    && (entry.kind === null || (typeof entry.kind === 'string' && COMMAND_KIND_SET.has(entry.kind)))
    && typeof entry.errorCode === 'string' && COMMAND_ERROR_SET.has(entry.errorCode)) {
    return {
      type: 'command-failure',
      commandId: entry.commandId as string | null,
      kind: entry.kind as BusinessCommandKind | null,
      errorCode: entry.errorCode as CommandErrorCode,
      occurredAt: entry.occurredAt,
    };
  }

  if (entry.type === 'system-error'
    && exactKeys(entry, ['type', 'source', 'systemCode', 'occurredAt'])
    && typeof entry.source === 'string' && SAFE_SOURCES.includes(entry.source as SafeDiagnosticSource)
    && Object.values(SYSTEM_CODE_BY_SOURCE).includes(entry.systemCode as SafeSystemDiagnosticCode)) {
    const source = entry.source as SafeDiagnosticSource;
    if (entry.systemCode !== SYSTEM_CODE_BY_SOURCE[source]) return null;
    return { type: 'system-error', source, systemCode: entry.systemCode as SafeSystemDiagnosticCode, occurredAt: entry.occurredAt };
  }

  return null;
}

function getLocalStorageSafely(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function removeLegacyNonPrototypeLog(storage = getLocalStorageSafely()): boolean {
  if (isPrototypeMode || !storage) return true;
  try {
    storage.removeItem(LEGACY_NON_PROTOTYPE_LOG_KEY);
    return true;
  } catch {
    return false;
  }
}

function readSafeEnvelope(now = Date.now()): SafeDiagnosticEnvelope {
  const storage = getLocalStorageSafely();
  if (!storage) throw new Error('Safe diagnostic storage is unavailable');
  try {
    if (!removeLegacyNonPrototypeLog(storage)) throw new Error('Legacy diagnostic storage is unavailable');
    const raw = storage.getItem(SAFE_DIAGNOSTICS_STORAGE_KEY);
    if (!raw) return { schemaVersion: 1, entries: [] };
    const discardStoredEnvelope = () => {
      storage.removeItem(SAFE_DIAGNOSTICS_STORAGE_KEY);
      return { schemaVersion: 1 as const, entries: [] };
    };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return discardStoredEnvelope();
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return discardStoredEnvelope();
    const envelope = parsed as Record<string, unknown>;
    if (!exactKeys(envelope, ['schemaVersion', 'entries']) || envelope.schemaVersion !== 1 || !Array.isArray(envelope.entries)) {
      return discardStoredEnvelope();
    }
    const entries = envelope.entries
      .map(entry => decodeSafeDiagnostic(entry, now))
      .filter((entry): entry is SafeDiagnosticEntry => entry !== null)
      .slice(0, MAX_LOG_ENTRIES);
    const canonical = JSON.stringify({ schemaVersion: 1, entries } satisfies SafeDiagnosticEnvelope);
    if (raw !== canonical) {
      // Remove the original bytes before any rewrite; a failed write must not restore crafted data.
      storage.removeItem(SAFE_DIAGNOSTICS_STORAGE_KEY);
      if (entries.length > 0) storage.setItem(SAFE_DIAGNOSTICS_STORAGE_KEY, canonical);
    }
    return { schemaVersion: 1, entries };
  } catch {
    // Do not expose storage errors or treat an unreadable envelope as an empty successful read.
    throw new Error('Safe diagnostic storage is unavailable');
  }
}

function persistSafeDiagnostic(entry: SafeDiagnosticEntry): SafeDiagnosticEntry {
  try {
    const now = Date.parse(entry.occurredAt);
    const current = readSafeEnvelope(now).entries;
    localStorage.setItem(SAFE_DIAGNOSTICS_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      entries: [entry, ...current].slice(0, MAX_LOG_ENTRIES),
    } satisfies SafeDiagnosticEnvelope));
  } catch {
    // Diagnostic persistence must never recurse through the error bus or affect the command result.
  }
  return entry;
}

export function readSafeDiagnostics(): SafeDiagnosticEntry[] {
  if (isPrototypeMode) return [];
  return readSafeEnvelope().entries;
}

export function clearSafeDiagnostics(): boolean {
  if (isPrototypeMode) return false;
  try {
    const storage = getLocalStorageSafely();
    if (!storage) return false;
    storage.removeItem(SAFE_DIAGNOSTICS_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function appendCommandDiagnostic(input: {
  commandId: unknown;
  kind: unknown;
  errorCode: unknown;
}): SafeCommandDiagnostic | null {
  if (isPrototypeMode) return null;
  const commandId = typeof input.commandId === 'string' && COMMAND_ID_PATTERN.test(input.commandId) ? input.commandId : null;
  const kind = typeof input.kind === 'string' && COMMAND_KIND_SET.has(input.kind) ? input.kind as BusinessCommandKind : null;
  const errorCode = typeof input.errorCode === 'string' && COMMAND_ERROR_SET.has(input.errorCode)
    ? input.errorCode as CommandErrorCode
    : 'UNKNOWN_RESULT';
  const entry: SafeCommandDiagnostic = {
    type: 'command-failure', commandId, kind, errorCode, occurredAt: new Date().toISOString(),
  };
  persistSafeDiagnostic(entry);
  return entry;
}

function appendSystemDiagnostic(sourceValue: unknown): SafeSystemDiagnostic {
  const source = typeof sourceValue === 'string' && SAFE_SOURCES.includes(sourceValue as SafeDiagnosticSource)
    ? sourceValue as SafeDiagnosticSource
    : 'runtime';
  const entry: SafeSystemDiagnostic = {
    type: 'system-error', source, systemCode: SYSTEM_CODE_BY_SOURCE[source], occurredAt: new Date().toISOString(),
  };
  return persistSafeDiagnostic(entry) as SafeSystemDiagnostic;
}

function safeDiagnosticView(entry: SafeDiagnosticEntry, index = 0): ErrorLogEntry {
  if (entry.type === 'command-failure') {
    return {
      id: `command-${index}-${entry.occurredAt}`,
      createdAt: entry.occurredAt,
      source: 'firebase',
      message: entry.errorCode,
      context: { commandId: entry.commandId, kind: entry.kind, errorCode: entry.errorCode },
    };
  }
  return {
    id: `system-${index}-${entry.occurredAt}`,
    createdAt: entry.occurredAt,
    source: entry.source,
    message: entry.systemCode,
  };
}

export function appendErrorLog(entry: Omit<ErrorLogEntry, 'id' | 'createdAt'>): ErrorLogEntry {
  if (!isPrototypeMode) {
    removeLegacyNonPrototypeLog();
    try {
      return safeDiagnosticView(appendSystemDiagnostic(entry.source));
    } catch {
      return safeDiagnosticView({
        type: 'system-error', source: 'runtime', systemCode: 'UNKNOWN_RUNTIME_ERROR', occurredAt: new Date().toISOString(),
      });
    }
  }

  const next: ErrorLogEntry = {
    ...entry,
    message: sanitizeMessage(entry.message),
    stack: entry.stack ? sanitizeStack(entry.stack) : undefined,
    context: sanitizeContext(entry.context),
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const current = readErrorLog();
  // Ref: #288 — TTL-based rotation: remove entries older than 24h
  const cutoff = Date.now() - LOG_TTL_MS;
  const fresh = current.filter(e => new Date(e.createdAt).getTime() > cutoff);
  localStorage.setItem(LOG_KEY, JSON.stringify([next, ...fresh].slice(0, MAX_LOG_ENTRIES)));
  return next;
}

export function readErrorLog(): ErrorLogEntry[] {
  if (!isPrototypeMode) {
    try {
      return readSafeDiagnostics().map((entry, index) => safeDiagnosticView(entry, index));
    } catch {
      return [];
    }
  }
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? JSON.parse(raw) as ErrorLogEntry[] : [];
  } catch {
    return [];
  }
}


export function clearErrorLog(): boolean {
  const key = isPrototypeMode ? LOG_KEY : LEGACY_NON_PROTOTYPE_LOG_KEY;
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

// Ref: #291 — Return cleanup function so listeners can be removed (prevents HMR leak).
export function installGlobalErrorListeners(): () => void {
  const handleError = (event: ErrorEvent) => {
    appendErrorLog({
      source: 'window-error',
      message: event.message || 'Unknown window error',
      stack: event.error?.stack,
    });
  };

  const handleRejection = (event: PromiseRejectionEvent) => {
    appendErrorLog({
      source: 'unhandled-rejection',
      message: event.reason?.message || String(event.reason),
      stack: event.reason?.stack,
    });
  };

  window.addEventListener('error', handleError);
  window.addEventListener('unhandledrejection', handleRejection);

  return () => {
    window.removeEventListener('error', handleError);
    window.removeEventListener('unhandledrejection', handleRejection);
  };
}

export function installErrorListeners(): () => void {
  const cleanupGlobal = installGlobalErrorListeners();
  return cleanupGlobal;
}

// Ref: #266 — Auto-subscribe appendErrorLog to the event bus.
// Core modules call emitError() instead of importing appendErrorLog directly;
// this subscription bridges the bus to localStorage persistence.
// Ref: #291 — Store unsubscribe for cleanup.
const _unsubscribeErrorBus = onError(appendErrorLog);
export { _unsubscribeErrorBus };

// Retire only the exact old non-prototype key. The prototype namespace and unrelated storage remain untouched.
if (!isPrototypeMode) removeLegacyNonPrototypeLog();
