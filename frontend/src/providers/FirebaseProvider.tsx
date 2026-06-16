// FirebaseProvider — extracts Firebase init + Auth subscription from App.tsx
// into a reusable context provider. Ref: #265

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { ensureFirebaseInitialized, type FirebaseServices } from '../firebase/firebaseApp';
import { subscribeOperatorAccess, type OperatorAccess } from '../firebase/authService';

interface FirebaseContextValue {
  fb: FirebaseServices | null;
  fbError: string | null;
  access: OperatorAccess;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

export function FirebaseProvider({ children }: { children: ReactNode }) {
  const [fb, setFb] = useState<FirebaseServices | null>(null);
  const [fbError, setFbError] = useState<string | null>(null);
  const [access, setAccess] = useState<OperatorAccess>({ ok: false, reason: 'signed_out' });

  useEffect(() => {
    let cancelled = false;
    ensureFirebaseInitialized().then(
      services => { if (!cancelled) setFb(services); },
      err => { if (!cancelled) setFbError(err instanceof Error ? err.message : String(err)); },
    );
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!fb?.auth || !fb?.db) return;
    // Ref: #320 — Guard against stale setAccess after unmount
    let cancelled = false;
    const guardedSetAccess = (a: OperatorAccess) => {
      if (!cancelled) setAccess(a);
    };
    const unsub = subscribeOperatorAccess(fb.auth, fb.db, guardedSetAccess);
    return () => { cancelled = true; unsub(); };
  }, [fb?.auth, fb?.db]);

  return (
    <FirebaseContext.Provider value={{ fb, fbError, access }}>
      {children}
    </FirebaseContext.Provider>
  );
}
// eslint-disable-next-line react-refresh/only-export-components
export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) throw new Error('useFirebase must be used within FirebaseProvider');
  return ctx;
}
