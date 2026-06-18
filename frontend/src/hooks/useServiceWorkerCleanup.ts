import { useEffect } from 'react';

/**
 * Ref: #327 — Service worker cleanup hook.
 *
 * This hook unconditionally unregisters all service workers and clears
 * all caches. This is intentional: the app uses VitePWA's autoUpdate
 * strategy which manages its own SW lifecycle. Any stale/orphaned SWs
 * from previous deployments or dev sessions should be cleaned up.
 *
 * The VitePWA plugin re-registers its own SW after page load, so
 * unregistering here only removes stale registrations.
 *
 * Guard: only runs in development mode to avoid interfering with
 * production PWA behavior where VitePWA handles SW updates.
 */
export function useServiceWorkerCleanup() {
  useEffect(() => {
    // Ref: #327 — Only clean up in dev mode; production relies on VitePWA autoUpdate
    if (!import.meta.env.DEV) return;

    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        for (const registration of registrations) {
          registration.unregister();
        }
      });
    }
    if (typeof window !== 'undefined' && 'caches' in window) {
      caches.keys().then(names => {
        for (const name of names) {
          caches.delete(name);
        }
      });
    }
  }, []);
}
