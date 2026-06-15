import { onError } from './errorBus';

export interface ErrorLogEntry {
  id: string;
  createdAt: string;
  source: 'react' | 'window-error' | 'unhandled-rejection' | 'storage' | 'sync' | 'auth' | 'firebase' | 'settlement';
  message: string;
  stack?: string;
  context?: Record<string, string | number | boolean | null>;
}

const LOG_KEY = 'easyorder-error-log';
const MAX_LOG_ENTRIES = 100;
const LOG_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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

export function appendErrorLog(entry: Omit<ErrorLogEntry, 'id' | 'createdAt'>): ErrorLogEntry {
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
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? JSON.parse(raw) as ErrorLogEntry[] : [];
  } catch {
    return [];
  }
}

export function getRecentErrors(): ErrorLogEntry[] {
  return readErrorLog();
}

export function clearErrorLog() {
  localStorage.removeItem(LOG_KEY);
}

export function installGlobalErrorListeners() {
  window.addEventListener('error', (event) => {
    appendErrorLog({
      source: 'window-error',
      message: event.message || 'Unknown window error',
      stack: event.error?.stack,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    appendErrorLog({
      source: 'unhandled-rejection',
      message: event.reason?.message || String(event.reason),
      stack: event.reason?.stack,
    });
  });
}

export function installErrorListeners() {
  installGlobalErrorListeners();
}

// Ref: #266 — Auto-subscribe appendErrorLog to the event bus.
// Core modules call emitError() instead of importing appendErrorLog directly;
// this subscription bridges the bus to localStorage persistence.
onError(appendErrorLog);
