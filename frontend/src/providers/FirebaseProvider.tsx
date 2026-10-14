// FirebaseProvider — extracts Firebase init + Auth subscription from App.tsx
// into a reusable context provider. Ref: #265
// P04: 整合全公司單一活躍 Google 身分使用權租約

import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { ensureFirebaseInitialized, isFirebaseConfigured, type FirebaseServices, type FirebaseEnv } from '../firebase/firebaseApp';
import { subscribeOperatorAccess, type OperatorAccess } from '../firebase/authService';
import {
  acquireLease as apiAcquireLease,
  releaseLease as apiReleaseLease,
  subscribeLease,
  startLeaseHeartbeat,
  defaultLeaseState,
  type ActiveLeaseState,
  type LeaseResult,
} from '../firebase/activeAccountLease';
import { clearSensitiveData } from '../store/posPersistence';
import { emitError } from '../errors/errorBus';

export interface FirebaseContextValue {
  fb: FirebaseServices | null;
  fbError: string | null;
  access: OperatorAccess;
  lease: ActiveLeaseState;
  acquireLease: () => Promise<LeaseResult>;
  releaseLease: () => Promise<boolean>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

export function FirebaseProvider({ children }: { children: ReactNode }) {
  const [fb, setFb] = useState<FirebaseServices | null>(null);
  const [fbError, setFbError] = useState<string | null>(null);
  const [access, setAccess] = useState<OperatorAccess>({ ok: false, reason: 'signed_out' });
  const [lease, setLease] = useState<ActiveLeaseState>(defaultLeaseState);
  const leaseRef = useRef<ActiveLeaseState>(defaultLeaseState);

  useEffect(() => {
    leaseRef.current = lease;
  }, [lease]);

  useEffect(() => {
    // Ref: #362 — Skip Firebase init when env vars are absent.
    // fb=null + fbError=null = "not configured" (local-only mode).
    if (!isFirebaseConfigured(import.meta.env as FirebaseEnv)) return;

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

  // 監聽 system/accessLease
  useEffect(() => {
    const currentUid = (access.ok && (access.profile?.uid ?? (access as unknown as { operatorId?: string }).operatorId)) || null;
    if (!fb?.db || !currentUid) return;

    const unsubLease = subscribeLease(fb.db, currentUid, newLease => {
      setLease(prev => {
        // 如果原本持有但突然失去持有狀態，清除敏感快取
        if (prev.isHolder && !newLease.isHolder) {
          void clearSensitiveData();
        }
        return newLease;
      });
    });

    return () => {
      unsubLease();
      setLease(defaultLeaseState);
    };
  }, [fb?.db, access]);

  // 持有租約時啟動 60 秒心跳續約
  useEffect(() => {
    const currentUid = (access.ok && (access.profile?.uid ?? (access as unknown as { operatorId?: string }).operatorId)) || null;
    if (!fb?.db || !currentUid || !lease.isHolder) return;

    const stopHeartbeat = startLeaseHeartbeat(
      fb.db,
      currentUid,
      () => leaseRef.current.epoch,
      async reason => {
        emitError({ source: 'auth', message: `[lease] 失去租約使用權: ${reason}` });
        await clearSensitiveData();
        setLease(prev => ({ ...prev, isHolder: false }));
      },
    );

    return () => {
      stopHeartbeat();
    };
  }, [fb?.db, access, lease.isHolder]);

  const acquireLease = async (): Promise<LeaseResult> => {
    if (!fb?.db || !access.ok) {
      return { status: 'lost', message: '尚未登入或未通過白名單' };
    }
    const currentUid = access.profile.uid;
    return apiAcquireLease(fb.db, currentUid, leaseRef.current.epoch);
  };

  const releaseLease = async (): Promise<boolean> => {
    if (!fb?.db || !access.ok || !leaseRef.current.isHolder) {
      return false;
    }
    const currentUid = access.profile.uid;
    const ok = await apiReleaseLease(fb.db, currentUid, leaseRef.current.epoch);
    if (ok) {
      await clearSensitiveData();
      setLease(prev => ({ ...prev, isHolder: false, holderUid: null }));
    }
    return ok;
  };

  return (
    <FirebaseContext.Provider value={{ fb, fbError, access, lease, acquireLease, releaseLease }}>
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
