import { useEffect } from 'react';

export function useServiceWorkerCleanup() {
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        for (const registration of registrations) {
          registration.unregister().then(() => {
            console.log('[SW] Unregistered Service Worker successfully');
          });
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
