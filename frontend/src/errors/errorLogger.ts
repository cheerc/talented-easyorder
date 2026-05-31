export interface ErrorLogEntry {
  id: string;
  createdAt: string;
  source: 'react' | 'window-error' | 'unhandled-rejection' | 'storage' | 'sync' | 'auth';
  message: string;
  stack?: string;
  context?: Record<string, string | number | boolean | null>;
}

const LOG_KEY = 'easyorder-error-log';
const MAX_LOG_ENTRIES = 100;

const CONTEXT_ALLOW_LIST = new Set([
  'component', 'action', 'route', 'businessDate', 'transactionType',
  'syncStatus', 'errorCode', 'retryCount', 'deviceType',
]);

function sanitizeContext(
  context?: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> | undefined {
  if (!context) return undefined;
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(context)) {
    if (CONTEXT_ALLOW_LIST.has(key)) clean[key] = value;
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

function sanitizeMessage(message: string): string {
  return message
    .replace(/學生[：:]\s*[^,\n，]+/g, '學生: [REDACTED]')
    .replace(/姓名[：:]\s*[^,\n，]+/g, '姓名: [REDACTED]')
    .replace(/\bname[：:]\s*[^,\n，]+/gi, 'name: [REDACTED]')
    .replace(/餘額[：:]\s*-?\d+/g, '餘額: [REDACTED]')
    .replace(/金額[：:]\s*-?\d+/g, '金額: [REDACTED]');
}

function sanitizeStack(stack: string): string {
  return sanitizeMessage(stack);
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
  localStorage.setItem(LOG_KEY, JSON.stringify([next, ...current].slice(0, MAX_LOG_ENTRIES)));
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
