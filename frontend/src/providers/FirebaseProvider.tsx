// FirebaseProvider — extracts Firebase init + Auth subscription from App.tsx
// into a reusable context provider. Ref: #265
// P04: 整合全公司單一活躍 Google 身分使用權租約

import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { ensureFirebaseInitialized, isFirebaseConfigured, type FirebaseServices, type FirebaseEnv } from '../firebase/firebaseApp';
import { subscribeOperatorAccess, type OperatorAccess } from '../firebase/authService';
import {
  acquireLease as apiAcquireLease,
  getLeaseStatus as apiGetLeaseStatus,
  releaseLease as apiReleaseLease,
  renewLease as apiRenewLease,
  subscribeLease,
  startLeaseHeartbeat,
  defaultLeaseState,
  TAB_RETURN_RECHECK_AFTER_MS,
  type ActiveLeaseState,
  type LeaseResult,
} from '../firebase/activeAccountLease';
import { subscribeDataHead, type DataHeadSignal } from '../firebase/dataHeadWatch';
import { clearSensitivePosData } from '../store/clearSensitivePosData';
import { emitError } from '../errors/errorBus';

export interface FirebaseContextValue {
  fb: FirebaseServices | null;
  fbError: string | null;
  storageCleanupError: string | null;
  access: OperatorAccess;
  lease: ActiveLeaseState;
  acquireLease: () => Promise<LeaseResult>;
  releaseLease: () => Promise<boolean>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

function stateFromResult(result: Extract<LeaseResult, { status: 'acquired' | 'busy' }>, currentUid: string): ActiveLeaseState {
  return {
    holderUid: result.status === 'acquired' ? result.holderUid : result.currentHolderUid,
    epoch: result.epoch,
    updatedAt: result.updatedAt,
    isKnown: true,
    isHolder: result.status === 'acquired' && result.holderUid === currentUid,
    isExpired: false,
  };
}

export function FirebaseProvider({ children }: { children: ReactNode }) {
  const [fb, setFb] = useState<FirebaseServices | null>(null);
  const [fbError, setFbError] = useState<string | null>(null);
  const [storageCleanupError, setStorageCleanupError] = useState<string | null>(null);
  const [access, setAccess] = useState<OperatorAccess>({ ok: false, reason: 'signed_out' });
  const accessRef = useRef<OperatorAccess>({ ok: false, reason: 'signed_out' });
  const [lease, setLease] = useState<ActiveLeaseState>(defaultLeaseState);
  const leaseRef = useRef<ActiveLeaseState>(defaultLeaseState);
  const confirmedEpochRef = useRef<number | null>(null);
  const probedEpochRef = useRef<number | null>(null);
  const leaseGenerationRef = useRef(0);
  const stopHeartbeatRef = useRef<(() => void) | null>(null);
  // Set by the lease effect; the heartbeat effect's onLost uses it (#586 P2).
  const reacquireOwnExpiredLeaseRef = useRef<((lostEpoch: number) => Promise<boolean>) | null>(null);
  const cleanupPromiseRef = useRef<Promise<void> | null>(null);

  const clearSensitiveDataSafely = (): Promise<void> => {
    if (cleanupPromiseRef.current) return cleanupPromiseRef.current;
    const cleanup = clearSensitivePosData().then(
      () => setStorageCleanupError(null),
      error => {
        const detail = error instanceof Error ? error.message : String(error);
        setStorageCleanupError(`雲端本機資料尚未確認清除。${detail} 請關閉其他 EasyOrder 分頁後重新載入。`);
      },
    ).finally(() => {
      if (cleanupPromiseRef.current === cleanup) cleanupPromiseRef.current = null;
    });
    cleanupPromiseRef.current = cleanup;
    return cleanup;
  };

  const publishLease = (next: ActiveLeaseState) => {
    leaseRef.current = next;
    setLease(next);
  };

  const stopHeartbeat = () => {
    stopHeartbeatRef.current?.();
    stopHeartbeatRef.current = null;
  };

  useEffect(() => {
    // Ref: #362 — Skip Firebase init when env vars are absent.
    // fb=null + fbError=null = "not configured" (local-only mode).
    if (!isFirebaseConfigured(import.meta.env as FirebaseEnv)) return;

    let cancelled = false;
    const initializationSignal = new AbortController();
    ensureFirebaseInitialized(undefined, {
      signal: initializationSignal.signal,
      onFirestoreCleanupBlocked: () => {
        if (!cancelled) setFbError('舊版 Firestore 快取仍被其他分頁使用。請關閉其他 EasyOrder 分頁後再重新載入。');
      },
    }).then(
      services => {
        if (!cancelled) {
          setFbError(null);
          setFb(services);
        }
      },
      err => { if (!cancelled) setFbError(err instanceof Error ? err.message : String(err)); },
    );
    return () => {
      cancelled = true;
      initializationSignal.abort();
    };
  }, []);

  useEffect(() => {
    if (!fb?.auth || !fb?.db) return;
    let cancelled = false;
    const guardedSetAccess = (nextAccess: OperatorAccess) => {
      if (cancelled) return;
      accessRef.current = nextAccess;
      if (!nextAccess.ok) {
        confirmedEpochRef.current = null;
        probedEpochRef.current = null;
        stopHeartbeat();
        publishLease(defaultLeaseState);
        // `checking`, inactive and signed-out all mask first and clear only Cloud state.
        void clearSensitiveDataSafely();
      }
      setAccess(nextAccess);
    };
    const unsubscribe = subscribeOperatorAccess(fb.auth, fb.db, guardedSetAccess);
    return () => { cancelled = true; unsubscribe(); };
  }, [fb?.auth, fb?.db]);

  const currentUid = access.ok ? access.profile.uid : null;

  useEffect(() => {
    if (!fb?.db || !currentUid) return;

    let cancelled = false;
    const generation = ++leaseGenerationRef.current;
    confirmedEpochRef.current = null;
    probedEpochRef.current = null;
    const isCurrentGeneration = () => !cancelled && leaseGenerationRef.current === generation;
    let visibilityProbeInFlight = false;
    // While an own-lease re-acquire is in flight, its own committed epoch+1 snapshot is not a loss (#586 P2).
    let reacquiringFromEpoch: number | null = null;
    // Monotonic clock: only decides whether to ask the server again, never grants or extends access (#586).
    let hiddenAt: number | null = document.visibilityState === 'hidden' ? performance.now() : null;

    const setObservedLease = (observed: ActiveLeaseState) => {
      if (!isCurrentGeneration()) return;
      if (reacquiringFromEpoch !== null && observed.isKnown && observed.holderUid === currentUid
        && observed.epoch === reacquiringFromEpoch + 1) return;
      const previous = leaseRef.current;
      const stillOurEpoch = observed.isKnown && observed.holderUid === currentUid;
      if (!stillOurEpoch || confirmedEpochRef.current !== observed.epoch) {
        if (!stillOurEpoch || confirmedEpochRef.current !== observed.epoch) confirmedEpochRef.current = null;
      }
      const confirmed = stillOurEpoch && confirmedEpochRef.current === observed.epoch;
      const next = { ...observed, isHolder: confirmed };
      publishLease(next);

      if (previous.isHolder && !confirmed) {
        stopHeartbeat();
        void clearSensitiveDataSafely();
      }

      if (!visibilityProbeInFlight && stillOurEpoch && !confirmed && probedEpochRef.current !== observed.epoch) {
        probedEpochRef.current = observed.epoch;
        void probeHolder(observed.epoch);
      }
    };

    const markUnknownAfterProbeFailure = (epoch: number, message: string) => {
      if (!isCurrentGeneration()) return;
      const current = leaseRef.current;
      confirmedEpochRef.current = null;
      if (current.isKnown && current.holderUid === currentUid && current.epoch === epoch) {
        publishLease({ ...current, isHolder: false, error: message });
      } else if (!current.isKnown) {
        publishLease({ ...current, isHolder: false, error: message });
      }
      stopHeartbeat();
      void clearSensitiveDataSafely();
    };

    /**
     * #586 P2: a confirmed holder lost its lease. Only when the server shows the same lease it held (own uid, same epoch, so
     * nobody touched it) is that expiry, and re-acquiring is what the operator would click anyway. One attempt per loss.
     * Returns true when it handled the loss (re-acquired, or published what the server shows); false means the caller masks.
     */
    const reacquireOwnExpiredLease = async (lostEpoch: number): Promise<boolean> => {
      const startingAccess = accessRef.current;
      if (!startingAccess.ok) return false;
      if (reacquiringFromEpoch !== null) return true; // the attempt already in flight owns this loss
      reacquiringFromEpoch = lostEpoch;
      try {
        const observed = await apiGetLeaseStatus(fb.db!, currentUid);
        if (!isCurrentGeneration()) return true;
        if (!observed.isKnown) return false;
        if (observed.holderUid !== currentUid || observed.epoch !== lostEpoch) {
          reacquiringFromEpoch = null;
          confirmedEpochRef.current = null;
          setObservedLease(observed);
          return true;
        }
        const result = await apiAcquireLease(fb.db!, currentUid, lostEpoch, startingAccess.profile.email);
        if (!isCurrentGeneration()) return true;
        if (result.status === 'acquired' && result.holderUid === currentUid) {
          confirmedEpochRef.current = result.epoch;
          probedEpochRef.current = result.epoch;
          publishLease(stateFromResult(result, currentUid));
          return true;
        }
        if (result.status === 'stale_epoch') {
          const latest = await apiGetLeaseStatus(fb.db!, currentUid);
          if (!isCurrentGeneration()) return true;
          if (!latest.isKnown) return false;
          reacquiringFromEpoch = null;
          confirmedEpochRef.current = null;
          setObservedLease(latest);
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        reacquiringFromEpoch = null;
      }
    };
    reacquireOwnExpiredLeaseRef.current = reacquireOwnExpiredLease;

    const probeHolder = async (epoch: number, options: { reacquire?: boolean } = {}) => {
      const result = await apiRenewLease(fb.db!, currentUid, epoch);
      if (!isCurrentGeneration()) return;

      if (result.status === 'acquired' && result.holderUid === currentUid && result.epoch === epoch) {
        const current = leaseRef.current;
        if (current.isKnown && (current.holderUid !== currentUid || current.epoch !== epoch)) return;
        confirmedEpochRef.current = epoch;
        publishLease(stateFromResult(result, currentUid));
        return;
      }

      if (result.status === 'stale_epoch') {
        const latest = await apiGetLeaseStatus(fb.db!, currentUid);
        if (isCurrentGeneration()) setObservedLease(latest);
        return;
      }

      const offline = result.status === 'lost' && /無法連線|回讀失敗|無法從伺服器/i.test(result.message);
      if (offline) {
        markUnknownAfterProbeFailure(epoch, result.message);
        return;
      }
      if (options.reacquire && await reacquireOwnExpiredLease(epoch)) return;
      if (!isCurrentGeneration()) return;
      const current = leaseRef.current;
      if (current.isKnown && current.holderUid === currentUid && current.epoch === epoch) {
        confirmedEpochRef.current = null;
        publishLease({ ...current, isHolder: false, error: result.status === 'lost' ? result.message : '租約尚未確認' });
        stopHeartbeat();
        void clearSensitiveDataSafely();
      }
    };

    const unsubscribeLease = subscribeLease(fb.db, currentUid, setObservedLease);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt ??= performance.now();
        return;
      }
      if (document.visibilityState !== 'visible') return;
      // No hidden event seen before this visible one counts as an unknown (long) absence.
      const hiddenFor = hiddenAt === null ? Number.POSITIVE_INFINITY : performance.now() - hiddenAt;
      hiddenAt = null;
      if (visibilityProbeInFlight) return;

      const current = leaseRef.current;
      const confirmedHolder = current.isKnown && current.isHolder
        && current.holderUid === currentUid && confirmedEpochRef.current === current.epoch;
      if (confirmedHolder) {
        // #586: a confirmed holder stays mounted; Rules still check every read and write. A short absence does nothing, a
        // long one re-proves the lease once in the background. A refusal goes through probeHolder's fail-closed branches.
        if (hiddenFor < TAB_RETURN_RECHECK_AFTER_MS) return;
        visibilityProbeInFlight = true;
        const epoch = current.epoch;
        probedEpochRef.current = epoch;
        void probeHolder(epoch, { reacquire: true })
          .catch(() => markUnknownAfterProbeFailure(epoch, '無法確認伺服器租約'))
          .finally(() => { visibilityProbeInFlight = false; });
        return;
      }

      visibilityProbeInFlight = true;

      confirmedEpochRef.current = null;
      probedEpochRef.current = null;
      stopHeartbeat();
      publishLease({ ...defaultLeaseState, error: '分頁恢復後正在向伺服器確認租約' });
      void clearSensitiveDataSafely();
      void (async () => {
        try {
          const observed = await apiGetLeaseStatus(fb.db!, currentUid);
          if (!isCurrentGeneration()) return;
          if (!observed.isKnown) {
            publishLease(observed);
            return;
          }

          probedEpochRef.current = observed.holderUid === currentUid ? observed.epoch : null;
          publishLease({ ...observed, isHolder: false });
          if (observed.holderUid === currentUid) await probeHolder(observed.epoch);
        } catch (error) {
          if (!isCurrentGeneration()) return;
          publishLease({
            ...defaultLeaseState,
            error: error instanceof Error ? error.message : '無法確認伺服器租約',
          });
        } finally {
          visibilityProbeInFlight = false;
        }
      })();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      leaseGenerationRef.current += 1;
      confirmedEpochRef.current = null;
      probedEpochRef.current = null;
      unsubscribeLease();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stopHeartbeat();
      if (reacquireOwnExpiredLeaseRef.current === reacquireOwnExpiredLease) reacquireOwnExpiredLeaseRef.current = null;
    };
  }, [fb?.db, currentUid]);

  useEffect(() => {
    if (!fb?.db || !currentUid || !lease.isKnown || !lease.isHolder) return;
    const generation = leaseGenerationRef.current;
    const epoch = lease.epoch;
    const stop = startLeaseHeartbeat(
      fb.db,
      currentUid,
      () => leaseRef.current.epoch,
      reason => {
        if (leaseGenerationRef.current !== generation || leaseRef.current.epoch !== epoch) return;
        const maskLostLease = () => {
          if (leaseGenerationRef.current !== generation || leaseRef.current.epoch !== epoch) return;
          confirmedEpochRef.current = null;
          stopHeartbeatRef.current?.();
          publishLease({
            ...leaseRef.current,
            isKnown: false,
            isHolder: false,
            error: reason,
          });
          void clearSensitiveDataSafely();
          emitError({ source: 'auth', message: `[lease] 失去租約使用權: ${reason}` });
        };
        // #586 P2: an own, untouched, expired lease is re-acquired once without masking; anything else masks as before.
        const reacquire = reacquireOwnExpiredLeaseRef.current;
        if (!reacquire) {
          maskLostLease();
          return;
        }
        void reacquire(epoch).then(handled => { if (!handled) maskLostLease(); }, maskLostLease);
      },
    );
    stopHeartbeatRef.current = stop;
    return () => {
      stop();
      if (stopHeartbeatRef.current === stop) stopHeartbeatRef.current = null;
    };
  }, [fb?.db, currentUid, lease.isKnown, lease.isHolder, lease.epoch]);

  const isConfirmedHolder = lease.isKnown && lease.isHolder;

  const acquireLease = async (): Promise<LeaseResult> => {
    const startingAccess = accessRef.current;
    if (!fb?.db || !startingAccess.ok) {
      return { status: 'lost', message: '尚未登入或未通過白名單' };
    }
    const uid = startingAccess.profile.uid;
    const generation = leaseGenerationRef.current;
    const isCurrentAccess = () => {
      const current = accessRef.current;
      return leaseGenerationRef.current === generation && current.ok && current.profile.uid === uid;
    };
    const observed = await apiGetLeaseStatus(fb.db, uid);
    if (!isCurrentAccess()) return { status: 'lost', message: '帳號或租約狀態已變更，請重新確認' };
    if (!observed.isKnown) {
      confirmedEpochRef.current = null;
      publishLease(observed);
      await clearSensitiveDataSafely();
      return { status: 'lost', message: observed.error ?? '無法確認伺服器租約' };
    }

    const currentConfirmed = observed.holderUid === uid && confirmedEpochRef.current === observed.epoch;
    publishLease({ ...observed, isHolder: currentConfirmed });

    // If this UID is already observed, first ask Rules to prove it is still valid.
    // If expired, an explicit acquire below may advance the epoch under Rules.
    if (observed.holderUid === uid && !currentConfirmed) {
      const proof = await apiRenewLease(fb.db, uid, observed.epoch);
      if (!isCurrentAccess()) return { status: 'lost', message: '帳號或租約狀態已變更，請重新確認' };
      if (proof.status === 'acquired') {
        confirmedEpochRef.current = proof.epoch;
        const next = stateFromResult(proof, uid);
        publishLease(next);
        return proof;
      }
      if (proof.status === 'stale_epoch') {
        const latest = await apiGetLeaseStatus(fb.db, uid);
        if (!isCurrentAccess()) return { status: 'lost', message: '帳號或租約狀態已變更，請重新確認' };
        publishLease(latest);
        return proof;
      }
    }

    const result = await apiAcquireLease(fb.db, uid, observed.epoch, startingAccess.profile.email);
    if (!isCurrentAccess()) return { status: 'lost', message: '帳號或租約狀態已變更，請重新確認' };
    if (result.status === 'acquired') {
      confirmedEpochRef.current = result.epoch;
      probedEpochRef.current = result.epoch;
      publishLease(stateFromResult(result, uid));
    } else if (result.status === 'busy') {
      confirmedEpochRef.current = null;
      publishLease({
        holderUid: result.currentHolderUid,
        epoch: result.epoch,
        updatedAt: result.updatedAt,
        isKnown: true,
        isHolder: false,
        isExpired: false,
      });
    } else if (result.status === 'stale_epoch') {
      confirmedEpochRef.current = null;
      const latest = await apiGetLeaseStatus(fb.db, uid);
      if (!isCurrentAccess()) return { status: 'lost', message: '帳號或租約狀態已變更，請重新確認' };
      publishLease(latest);
    } else {
      confirmedEpochRef.current = null;
      const latest = await apiGetLeaseStatus(fb.db, uid);
      if (!isCurrentAccess()) return { status: 'lost', message: '帳號或租約狀態已變更，請重新確認' };
      publishLease(latest.isKnown ? latest : { ...latest, error: result.message });
      await clearSensitiveDataSafely();
    }
    return result;
  };

  const releaseLease = async (): Promise<boolean> => {
    const startingAccess = accessRef.current;
    const startingLease = leaseRef.current;
    if (!fb?.db || !startingAccess.ok || !startingLease.isKnown || !startingLease.isHolder || startingLease.holderUid !== startingAccess.profile.uid) return false;
    const uid = startingAccess.profile.uid;
    const epoch = startingLease.epoch;
    const generation = leaseGenerationRef.current;
    const isCurrentAccess = () => {
      const current = accessRef.current;
      return leaseGenerationRef.current === generation && current.ok && current.profile.uid === uid;
    };
    const released = await apiReleaseLease(fb.db, uid, epoch, startingAccess.profile.email);
    if (!isCurrentAccess()) return released;
    if (released) {
      confirmedEpochRef.current = null;
      stopHeartbeat();
      const observed = await apiGetLeaseStatus(fb.db, uid);
      if (!isCurrentAccess()) return released;
      publishLease(observed);
      await clearSensitiveDataSafely();
    }
    return released;
  };

  return (
    <FirebaseContext.Provider value={{ fb, fbError, storageCleanupError, access, lease, acquireLease, releaseLease }}>
      <DataHeadProvider db={fb?.db ?? null} uid={currentUid} confirmedHolder={isConfirmedHolder} epoch={lease.epoch}>
        {children}
      </DataHeadProvider>
    </FirebaseContext.Provider>
  );
}

const DataHeadContext = createContext<DataHeadSignal | null>(null);

/**
 * #587: the latest server-confirmed `system/dataHead`, watched only while this tab is a confirmed holder (otherwise null; the
 * watch stops the moment the lease is lost). It lives in its own context and component on purpose: every command of anyone changes
 * the head, and that must re-render only the pages that follow it, not every consumer of the Firebase context.
 */
function DataHeadProvider({ db, uid, confirmedHolder, epoch, children }: {
  db: FirebaseServices['db'] | null;
  uid: string | null;
  confirmedHolder: boolean;
  epoch: number;
  children: ReactNode;
}) {
  const [watchedHead, setWatchedHead] = useState<DataHeadSignal | null>(null);
  useEffect(() => {
    if (!db || !uid || !confirmedHolder) return;
    const unsubscribe = subscribeDataHead(db, setWatchedHead);
    return () => {
      unsubscribe();
      setWatchedHead(null);
    };
  }, [db, uid, confirmedHolder, epoch]);
  // Only a confirmed holder exposes the value; whatever an earlier watch left is dropped by its cleanup.
  return <DataHeadContext.Provider value={confirmedHolder ? watchedHead : null}>{children}</DataHeadContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDataHead(): DataHeadSignal | null {
  return useContext(DataHeadContext);
}

// eslint-disable-next-line react-refresh/only-export-components
export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) throw new Error('useFirebase must be used within FirebaseProvider');
  return ctx;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useFirebaseOptional(): FirebaseContextValue | null {
  return useContext(FirebaseContext);
}
