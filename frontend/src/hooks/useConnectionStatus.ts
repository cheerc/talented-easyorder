import { useSyncExternalStore } from 'react';

/**
 * Ref: #314 — Connection status hook for detecting onSnapshot staleness.
 *
 * Uses navigator.onLine + window 'online'/'offline' events to expose
 * network connectivity state to the UI. When offline, Firestore snapshots
 * may silently serve stale cached data — this hook lets the UI display
 * a staleness indicator.
 *
 * Uses useSyncExternalStore for tear-free reads (React 18+ best practice).
 */

function subscribe(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function getSnapshot(): boolean {
  return navigator.onLine;
}

function getServerSnapshot(): boolean {
  // SSR always assumes online
  return true;
}

export function useConnectionStatus(): { isOnline: boolean } {
  const isOnline = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { isOnline };
}
