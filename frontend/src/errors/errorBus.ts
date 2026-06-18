// Ref: #266 — Lightweight event bus for error reporting.
// Core modules emit errors via emitError() instead of importing appendErrorLog directly.
// errorLogger.ts subscribes its appendErrorLog to this bus for backward compatibility.

import type { ErrorLogEntry } from './errorLogger';

type ErrorInput = Omit<ErrorLogEntry, 'id' | 'createdAt'>;
type ErrorListener = (entry: ErrorInput) => void;

const listeners: Set<ErrorListener> = new Set();

/**
 * Emit an error entry to all subscribed listeners.
 * Core modules call this instead of appendErrorLog directly.
 */
export function emitError(entry: ErrorInput): void {
  for (const listener of listeners) {
    try {
      listener(entry);
    } catch {
      // Listener errors must not break the emitter or other listeners
    }
  }
}

/**
 * Subscribe a listener to error events.
 * Returns an unsubscribe function.
 */
export function onError(listener: ErrorListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Remove a previously subscribed listener.
 */
export function offError(listener: ErrorListener): void {
  listeners.delete(listener);
}

/** @internal — test-only reset */
export function _resetForTest(): void {
  listeners.clear();
}
