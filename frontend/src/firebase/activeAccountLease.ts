/**
 * 零費用正式後端：全公司單一活躍 Google 身分使用權租約
 * 規格來源：docs/superpowers/specs/2026-10-13-free-production-backend-spec.md §4.2
 * 計畫來源：docs/superpowers/plans/2026-10-13-free-production-backend-plan.md §P04
 */

import {
  Timestamp,
  doc,
  getDocFromServer,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import type { CloudAccessEventKind } from './firestoreSchema';

export const LEASE_DOC_PATH = 'system/accessLease';

/** P13c1: one immutable record per epoch change; the document id is the new epoch. */
export const ACCESS_EVENTS_COLLECTION = 'accessEvents';

/** 租約有效時長：5 分鐘 */
export const LEASE_DURATION_MS = 5 * 60 * 1000;

/** 租約心跳續約頻率：120 秒（租約 5 分鐘，容許錯過一次心跳；P16f2 S7） */
export const LEASE_HEARTBEAT_INTERVAL_MS = 120 * 1000;

/** 重新檢查限流門檻：15 秒 */
export const LEASE_RECHECK_THROTTLE_MS = 15 * 1000;

const LEASE_HEARTBEAT_LOCK_NAME = 'easyorder:system-access-lease-heartbeat';

export interface AccessLeaseDoc {
  holderUid: string | null;
  epoch: number;
  updatedAt: Timestamp;
}

export type LeaseResult =
  | {
      status: 'acquired';
      holderUid: string;
      epoch: number;
      updatedAt: Date;
    }
  | {
      status: 'busy';
      currentHolderUid: string;
      epoch: number;
      updatedAt: Date;
    }
  | {
      status: 'stale_epoch';
      expectedEpoch: number;
      actualEpoch: number;
    }
  | {
      status: 'lost';
      message: string;
    };

export interface ActiveLeaseState {
  holderUid: string | null;
  epoch: number;
  updatedAt: Date | null;
  /** Only a server snapshot with valid fields sets this true. */
  isKnown: boolean;
  /** Set only after a successful Rules-authorized renew transaction and server readback. */
  isHolder: boolean;
  /** Client-clock estimate for display only. It never authorizes access or blocks an acquire attempt. */
  isExpired: boolean;
  error?: string;
}

export const defaultLeaseState: ActiveLeaseState = {
  holderUid: null,
  epoch: 0,
  updatedAt: null,
  isKnown: false,
  isHolder: false,
  isExpired: false,
  error: '尚未從伺服器確認租約狀態',
};

function validEpoch(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function readLeaseData(raw: unknown): { data: AccessLeaseDoc; updatedAt: Date } | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const holderUid = value.holderUid;
  if (holderUid !== null && (typeof holderUid !== 'string' || holderUid.length === 0)) return null;
  if (!validEpoch(value.epoch) || !(value.updatedAt instanceof Timestamp)) return null;

  const updatedAt = value.updatedAt.toDate();
  if (!(updatedAt instanceof Date) || !Number.isFinite(updatedAt.getTime())) return null;

  return {
    data: { holderUid: holderUid as string | null, epoch: value.epoch, updatedAt: value.updatedAt },
    updatedAt,
  };
}

/** Convert a Firestore Timestamp to Date; malformed and local values stay unknown. */
export function toLeaseDate(value: unknown): Date | null {
  if (!(value instanceof Timestamp)) return null;
  const date = value.toDate();
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Client time is only a display hint. Firestore Rules `request.time` decide whether a
 * lease can be acquired or renewed.
 */
export function isLeaseExpired(updatedAt: unknown, now = Date.now()): boolean {
  const date = toLeaseDate(updatedAt);
  return date === null || date.getTime() + LEASE_DURATION_MS <= now;
}

function unknownLeaseState(error: string): ActiveLeaseState {
  return { ...defaultLeaseState, error };
}

function stateFromServerLease(
  data: AccessLeaseDoc,
  updatedAt: Date,
): ActiveLeaseState {
  return {
    holderUid: data.holderUid,
    epoch: data.epoch,
    updatedAt,
    isKnown: true,
    // A UID match is an observation, not proof that Rules currently consider the lease valid.
    isHolder: false,
    isExpired: isLeaseExpired(data.updatedAt),
  };
}

function validateEpochArgument(epoch: number): void {
  if (!validEpoch(epoch)) throw new Error('租約操作要求非負整數 expectedEpoch');
}

async function readServerLease(db: Firestore): Promise<{ data: AccessLeaseDoc; updatedAt: Date } | null> {
  const snapshot = await getDocFromServer(doc(db, LEASE_DOC_PATH));
  if (!snapshot.exists()) return null;
  return readLeaseData(snapshot.data());
}

function lost(message: string): LeaseResult {
  return { status: 'lost', message };
}

async function classifyAcquireFailure(
  db: Firestore,
  expectedEpoch: number,
): Promise<LeaseResult> {
  try {
    const serverLease = await readServerLease(db);
    if (!serverLease) return lost('伺服器租約不存在或資料格式無效，無法確認使用權');

    const { data, updatedAt } = serverLease;
    if (data.epoch !== expectedEpoch) {
      return { status: 'stale_epoch', expectedEpoch, actualEpoch: data.epoch };
    }
    if (data.holderUid !== null) {
      return {
        status: 'busy',
        currentHolderUid: data.holderUid,
        epoch: data.epoch,
        updatedAt,
      };
    }
    return lost('伺服器未確認取得使用權；請重新檢查連線與帳號狀態');
  } catch {
    return lost('目前無法連線確認租約，請重新連線後再試');
  }
}

async function confirmCommittedLease(
  db: Firestore,
  uid: string,
  epoch: number,
): Promise<LeaseResult> {
  try {
    const serverLease = await readServerLease(db);
    if (!serverLease) return lost('租約交易完成後無法從伺服器確認狀態');
    const { data, updatedAt } = serverLease;
    if (data.holderUid !== uid || data.epoch !== epoch) {
      return lost('租約在伺服器確認前已變更，請重新檢查');
    }
    return { status: 'acquired', holderUid: uid, epoch, updatedAt };
  } catch {
    return lost('租約交易完成，但伺服器回讀失敗；目前不會開放業務資料');
  }
}

/**
 * The access record of one epoch change, written in the same transaction as the lease update. Rules bind the two
 * (`existsAfter` on the lease, `get`/`getAfter` on the event), so neither can commit without the other.
 */
function accessEventFor(
  kind: CloudAccessEventKind,
  holderUid: string | null,
  previousHolderUid: string | null,
  actorUid: string,
  actorEmail: string,
) {
  return { kind, holderUid, previousHolderUid, actorUid, actorEmail, at: serverTimestamp() };
}

/**
 * Acquire always reaches Firestore Rules. Local time is never used to decide whether
 * another holder has expired; Rules compare the old timestamp with request.time.
 */
export async function acquireLease(
  db: Firestore,
  uid: string,
  expectedEpoch: number,
  actorEmail: string,
): Promise<LeaseResult> {
  if (!uid || !uid.trim()) throw new Error('acquireLease 要求有效 uid');
  if (!actorEmail || !actorEmail.trim()) throw new Error('acquireLease 要求有效 actorEmail');
  validateEpochArgument(expectedEpoch);

  try {
    const leaseRef = doc(db, LEASE_DOC_PATH);
    const result = await runTransaction(db, async tx => {
      const snapshot = await tx.get(leaseRef);
      if (!snapshot.exists()) return { status: 'lost' as const, message: '伺服器租約不存在，需由維護流程初始化' };

      const parsed = readLeaseData(snapshot.data());
      if (!parsed) return { status: 'lost' as const, message: '伺服器租約格式無效，拒絕取得使用權' };
      const { data } = parsed;

      if (data.epoch !== expectedEpoch) {
        return { status: 'stale_epoch' as const, expectedEpoch, actualEpoch: data.epoch };
      }
      if (data.epoch === Number.MAX_SAFE_INTEGER) {
        return { status: 'lost' as const, message: '租約 epoch 已達安全上限，拒絕更新' };
      }

      // The Rules decide whether this holder is null/expired using request.time. The document the transaction read
      // only tells the record which kind it is; Rules re-derive the kind from the lease before and after.
      const newEpoch = data.epoch + 1;
      tx.update(leaseRef, {
        holderUid: uid,
        epoch: newEpoch,
        updatedAt: serverTimestamp(),
      });
      tx.set(
        doc(db, ACCESS_EVENTS_COLLECTION, String(newEpoch)),
        accessEventFor(data.holderUid === null ? 'acquire' : 'takeover', uid, data.holderUid, uid, actorEmail),
      );
      return { status: 'pending' as const, epoch: newEpoch };
    });

    if (result.status !== 'pending') return result;
    return confirmCommittedLease(db, uid, result.epoch);
  } catch {
    return classifyAcquireFailure(db, expectedEpoch);
  }
}

/** Renew is also the server-authorized proof used before rendering a holder's data. */
export async function renewLease(
  db: Firestore,
  uid: string,
  expectedEpoch: number,
): Promise<LeaseResult> {
  if (!uid || !uid.trim()) throw new Error('renewLease 要求有效 uid');
  validateEpochArgument(expectedEpoch);

  try {
    const leaseRef = doc(db, LEASE_DOC_PATH);
    const result = await runTransaction(db, async tx => {
      const snapshot = await tx.get(leaseRef);
      if (!snapshot.exists()) return { status: 'lost' as const, message: '伺服器租約不存在' };

      const parsed = readLeaseData(snapshot.data());
      if (!parsed) return { status: 'lost' as const, message: '伺服器租約格式無效，拒絕續約' };
      const { data } = parsed;
      if (data.epoch !== expectedEpoch) {
        return { status: 'stale_epoch' as const, expectedEpoch, actualEpoch: data.epoch };
      }
      if (data.holderUid !== uid) {
        return { status: 'lost' as const, message: '租約持有人已變更，續約中止' };
      }

      tx.update(leaseRef, {
        holderUid: uid,
        epoch: data.epoch,
        updatedAt: serverTimestamp(),
      });
      return { status: 'pending' as const };
    });

    if (result.status !== 'pending') return result;
    return confirmCommittedLease(db, uid, expectedEpoch);
  } catch {
    try {
      const serverLease = await readServerLease(db);
      if (serverLease && serverLease.data.epoch !== expectedEpoch) {
        return { status: 'stale_epoch', expectedEpoch, actualEpoch: serverLease.data.epoch };
      }
      return lost('伺服器未確認續約；請重新檢查使用權');
    } catch {
      return lost('目前無法連線確認續約；系統已停止授權資料存取');
    }
  }
}

/** Release succeeds only when its post-commit server read confirms the exact new state. */
export async function releaseLease(
  db: Firestore,
  uid: string,
  expectedEpoch: number,
  actorEmail: string,
): Promise<boolean> {
  if (!uid || !uid.trim() || !actorEmail || !actorEmail.trim()) return false;
  try {
    validateEpochArgument(expectedEpoch);
    const leaseRef = doc(db, LEASE_DOC_PATH);
    const result = await runTransaction(db, async tx => {
      const snapshot = await tx.get(leaseRef);
      if (!snapshot.exists()) return { status: 'not_released' as const };
      const parsed = readLeaseData(snapshot.data());
      if (!parsed) return { status: 'not_released' as const };
      const { data } = parsed;
      if (data.epoch !== expectedEpoch || data.holderUid !== uid || data.epoch === Number.MAX_SAFE_INTEGER) {
        return { status: 'not_released' as const };
      }

      const newEpoch = data.epoch + 1;
      tx.update(leaseRef, {
        holderUid: null,
        epoch: newEpoch,
        updatedAt: serverTimestamp(),
      });
      tx.set(
        doc(db, ACCESS_EVENTS_COLLECTION, String(newEpoch)),
        accessEventFor('release', null, uid, uid, actorEmail),
      );
      return { status: 'pending' as const, epoch: newEpoch };
    });
    if (result.status !== 'pending') return false;

    const serverLease = await readServerLease(db);
    return Boolean(
      serverLease &&
      serverLease.data.holderUid === null &&
      serverLease.data.epoch === result.epoch,
    );
  } catch {
    return false;
  }
}

/** Server-only lease read. A UID match here is not itself an authorization proof. */
export async function getLeaseStatus(db: Firestore, currentUid?: string): Promise<ActiveLeaseState> {
  void currentUid;
  try {
    const serverLease = await readServerLease(db);
    if (!serverLease) return unknownLeaseState('伺服器租約不存在或資料格式無效');
    return stateFromServerLease(serverLease.data, serverLease.updatedAt);
  } catch {
    return unknownLeaseState('目前無法從伺服器讀取租約');
  }
}

/**
 * Observe server lease changes. Cache-only and pending-write observations are not
 * emitted: they cannot grant access or revoke a previously server-confirmed lease.
 * The initial provider state remains unknown until a server-confirmed snapshot or
 * server-authorized renew probe arrives. Missing/malformed/server-error states are
 * emitted as unknown so the provider fails closed.
 */
export function subscribeLease(
  db: Firestore,
  currentUid: string | null,
  onUpdate: (state: ActiveLeaseState) => void,
): () => void {
  void currentUid;
  try {
    const leaseRef = doc(db, LEASE_DOC_PATH);
    return onSnapshot(
      leaseRef,
      { includeMetadataChanges: true },
      snapshot => {
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
          return;
        }
        if (!snapshot.exists()) {
          onUpdate(unknownLeaseState('伺服器租約不存在'));
          return;
        }
        const parsed = readLeaseData(snapshot.data());
        if (!parsed) {
          onUpdate(unknownLeaseState('伺服器租約格式無效'));
          return;
        }
        onUpdate(stateFromServerLease(parsed.data, parsed.updatedAt));
      },
      () => onUpdate(unknownLeaseState('無法監聽伺服器租約')),
    );
  } catch {
    onUpdate(unknownLeaseState('無法建立伺服器租約監聽'));
    return () => {};
  }
}

/**
 * Elect one same-origin tab to perform scheduled renewals. Web Locks are available
 * on the supported HTTPS/modern Chromium clients; browsers without Web Locks fail
 * closed rather than allowing multiple tabs to write renewals.
 */
export function startLeaseHeartbeat(
  db: Firestore,
  uid: string,
  getEpoch: () => number,
  onLost: (reason: string) => void,
): () => void {
  let stopped = false;
  let failureReported = false;
  let inFlight = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let releaseLeadership: (() => void) | null = null;
  const abortController = new AbortController();

  const stop = () => {
    if (stopped) return;
    stopped = true;
    abortController.abort();
    if (timer !== null) clearInterval(timer);
    timer = null;
    releaseLeadership?.();
    releaseLeadership = null;
  };

  const reportLost = (reason: string) => {
    if (stopped || failureReported) return;
    failureReported = true;
    stop();
    void onLost(reason);
  };

  const renew = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const result = await renewLease(db, uid, getEpoch());
      if (stopped) return;
      if (result.status !== 'acquired') reportLost(`租約續約失敗：${result.status === 'lost' ? result.message : result.status}`);
    } catch (error) {
      if (!stopped) reportLost(error instanceof Error ? error.message : String(error));
    } finally {
      inFlight = false;
    }
  };

  const lockManager = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!lockManager) {
    reportLost('此瀏覽器不支援安全的跨分頁續約，已停止授權資料存取');
    return stop;
  }

  const isAbortError = (error: unknown) =>
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';

  void Promise.resolve().then(() => lockManager.request(
    LEASE_HEARTBEAT_LOCK_NAME,
    { mode: 'exclusive', signal: abortController.signal },
    async lock => {
      if (!lock || stopped) return;
      timer = setInterval(() => { void renew(); }, LEASE_HEARTBEAT_INTERVAL_MS);
      await new Promise<void>(resolve => {
        releaseLeadership = resolve;
        if (stopped) resolve();
      });
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  )).catch(error => {
    if (stopped || isAbortError(error)) return;
    reportLost(error instanceof Error ? error.message : String(error));
  });

  return stop;
}
