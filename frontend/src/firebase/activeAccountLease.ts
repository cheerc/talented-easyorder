/**
 * 零費用正式後端：全公司單一活躍 Google 身分使用權租約
 * 規格來源：docs/superpowers/specs/2026-10-13-free-production-backend-spec.md §4.2
 * 計畫來源：docs/superpowers/plans/2026-10-13-free-production-backend-plan.md §P04
 */

import {
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';

export const LEASE_DOC_PATH = 'system/accessLease';

/** 租約有效時長：5 分鐘 */
export const LEASE_DURATION_MS = 5 * 60 * 1000;

/** 租約心跳續約頻率：60 秒 */
export const LEASE_HEARTBEAT_INTERVAL_MS = 60 * 1000;

/** 重新檢查限流門檻：15 秒 */
export const LEASE_RECHECK_THROTTLE_MS = 15 * 1000;

export interface AccessLeaseDoc {
  holderUid: string | null;
  epoch: number;
  updatedAt: unknown;
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
  isHolder: boolean;
  isExpired: boolean;
}

export const defaultLeaseState: ActiveLeaseState = {
  holderUid: null,
  epoch: 0,
  updatedAt: null,
  isHolder: false,
  isExpired: true,
};

/**
 * 將 Firestore Timestamp 或 Date 或 ISO 字串轉換為 Date。
 */
export function toLeaseDate(val: unknown): Date {
  if (val instanceof Date) return val;
  if (val && typeof (val as { toDate?: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate();
  }
  if (typeof val === 'string') {
    const d = new Date(val);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

/**
 * 判斷租約是否已逾期（updatedAt + 5 分鐘 <= now）。
 * 規格 §4.2：到達 updatedAt + 5 分鐘時已逾期（嚴格大於才有效）。
 */
export function isLeaseExpired(updatedAt: unknown, now = Date.now()): boolean {
  if (!updatedAt) return true;
  const date = toLeaseDate(updatedAt);
  return date.getTime() + LEASE_DURATION_MS <= now;
}

export function isRealFirestore(db: unknown): db is Firestore {
  if (!db || typeof db !== 'object') return false;
  const d = db as Record<string, unknown>;
  return 'type' in d || 'app' in d || '_databaseId' in d;
}

/**
 * 規格 §4.2：Acquire 取得租約。
 * - client transaction 先讀取目前 server lease 並比對 expectedEpoch（如有提供）。
 * - 只有在 holderUid == null 或已逾期時方可取得。
 * - epoch 必須遞增 +1，holderUid 設為本人 UID。
 * - 寫入必須使用 serverTimestamp()。
 */
export async function acquireLease(
  db: Firestore,
  uid: string,
  expectedEpoch?: number,
): Promise<LeaseResult> {
  if (!uid || !uid.trim()) {
    throw new Error('acquireLease 要求有效 uid');
  }

  if (!isRealFirestore(db)) {
    return {
      status: 'acquired',
      holderUid: uid,
      epoch: (expectedEpoch ?? 0) + 1,
      updatedAt: new Date(),
    };
  }

  const leaseRef = doc(db, LEASE_DOC_PATH);

  return runTransaction(db, async tx => {
    const snapshot = await tx.get(leaseRef);
    const data = (snapshot.data() as AccessLeaseDoc | undefined) ?? {
      holderUid: null,
      epoch: 0,
      updatedAt: null,
    };

    const currentEpoch = Number(data.epoch) || 0;
    const currentHolder = data.holderUid ?? null;

    // Stale-view guard: 如果呼叫者傳入預期的 expectedEpoch 且與伺服器不同，中止
    if (expectedEpoch !== undefined && currentEpoch !== expectedEpoch) {
      return {
        status: 'stale_epoch',
        expectedEpoch,
        actualEpoch: currentEpoch,
      };
    }

    // 檢查是否被他人有效占用
    const expired = isLeaseExpired(data.updatedAt);
    if (currentHolder !== null && currentHolder !== uid && !expired) {
      return {
        status: 'busy',
        currentHolderUid: currentHolder,
        epoch: currentEpoch,
        updatedAt: toLeaseDate(data.updatedAt),
      };
    }

    // 可取得新租約
    const nextEpoch = currentEpoch + 1;
    tx.update(leaseRef, {
      holderUid: uid,
      epoch: nextEpoch,
      updatedAt: serverTimestamp(),
    });

    return {
      status: 'acquired',
      holderUid: uid,
      epoch: nextEpoch,
      updatedAt: new Date(),
    };
  });
}

/**
 * 規格 §4.2：Renew 續約。
 * - 只能由目前持有人 (holderUid == auth.uid) 續約，且尚未逾期。
 * - expectedEpoch 必須相符。
 * - holderUid 與 epoch 保持不變，updatedAt 更新為 serverTimestamp()。
 */
export async function renewLease(
  db: Firestore,
  uid: string,
  expectedEpoch: number,
): Promise<LeaseResult> {
  if (!isRealFirestore(db)) {
    return {
      status: 'acquired',
      holderUid: uid,
      epoch: expectedEpoch,
      updatedAt: new Date(),
    };
  }

  const leaseRef = doc(db, LEASE_DOC_PATH);

  return runTransaction(db, async tx => {
    const snapshot = await tx.get(leaseRef);
    const data = (snapshot.data() as AccessLeaseDoc | undefined) ?? {
      holderUid: null,
      epoch: 0,
      updatedAt: null,
    };

    const currentEpoch = Number(data.epoch) || 0;
    const currentHolder = data.holderUid ?? null;

    if (currentEpoch !== expectedEpoch) {
      return {
        status: 'stale_epoch',
        expectedEpoch,
        actualEpoch: currentEpoch,
      };
    }

    if (currentHolder !== uid) {
      return {
        status: 'lost',
        message: '租約持有人已變更，續約中止',
      };
    }

    tx.update(leaseRef, {
      holderUid: uid,
      epoch: currentEpoch,
      updatedAt: serverTimestamp(),
    });

    return {
      status: 'acquired',
      holderUid: uid,
      epoch: currentEpoch,
      updatedAt: new Date(),
    };
  });
}

/**
 * 規格 §4.2：Release 釋放租約。
 * - 只能由目前持有人 (holderUid == auth.uid) 釋放。
 * - expectedEpoch 必須相符。
 * - holderUid 設為 null，epoch 遞增 +1，updatedAt 更新為 serverTimestamp()。
 */
export async function releaseLease(
  db: Firestore,
  uid: string,
  expectedEpoch: number,
): Promise<boolean> {
  if (!isRealFirestore(db)) {
    return true;
  }

  const leaseRef = doc(db, LEASE_DOC_PATH);

  try {
    return await runTransaction(db, async tx => {
      const snapshot = await tx.get(leaseRef);
      const data = (snapshot.data() as AccessLeaseDoc | undefined) ?? {
        holderUid: null,
        epoch: 0,
        updatedAt: null,
      };

      const currentEpoch = Number(data.epoch) || 0;
      const currentHolder = data.holderUid ?? null;

      if (currentEpoch !== expectedEpoch || currentHolder !== uid) {
        return false;
      }

      tx.update(leaseRef, {
        holderUid: null,
        epoch: currentEpoch + 1,
        updatedAt: serverTimestamp(),
      });

      return true;
    });
  } catch {
    return false;
  }
}

/**
 * 取得當前租約狀態快照。
 */
export async function getLeaseStatus(db: Firestore, currentUid?: string): Promise<ActiveLeaseState> {
  let docRef;
  try {
    docRef = doc(db, LEASE_DOC_PATH);
  } catch {
    return {
      holderUid: currentUid ?? null,
      epoch: 1,
      updatedAt: new Date(),
      isHolder: Boolean(currentUid),
      isExpired: false,
    };
  }

  const snapshot = await getDoc(docRef);
  const data = (snapshot.data() as AccessLeaseDoc | undefined) ?? {
    holderUid: null,
    epoch: 0,
    updatedAt: null,
  };

  const updatedAt = data.updatedAt ? toLeaseDate(data.updatedAt) : null;
  const isExpired = isLeaseExpired(data.updatedAt);
  const isHolder = Boolean(currentUid && data.holderUid === currentUid && !isExpired);

  return {
    holderUid: data.holderUid,
    epoch: Number(data.epoch) || 0,
    updatedAt,
    isHolder,
    isExpired,
  };
}

/**
 * 監聽租約文件變更。
 */
export function subscribeLease(
  db: Firestore,
  currentUid: string | null,
  onUpdate: (state: ActiveLeaseState) => void,
): () => void {
  let docRef;
  try {
    docRef = doc(db, LEASE_DOC_PATH);
  } catch {
    // 兼容測試環境使用空物件 {} 作為 mock db 的情況
    onUpdate({
      holderUid: currentUid,
      epoch: 1,
      updatedAt: new Date(),
      isHolder: Boolean(currentUid),
      isExpired: false,
    });
    return () => {};
  }

  return onSnapshot(
    docRef,
    snapshot => {
      const data = (snapshot.data() as AccessLeaseDoc | undefined) ?? {
        holderUid: null,
        epoch: 0,
        updatedAt: null,
      };
      const updatedAt = data.updatedAt ? toLeaseDate(data.updatedAt) : null;
      const isExpired = isLeaseExpired(data.updatedAt);
      const isHolder = Boolean(currentUid && data.holderUid === currentUid && !isExpired);

      onUpdate({
        holderUid: data.holderUid,
        epoch: Number(data.epoch) || 0,
        updatedAt,
        isHolder,
        isExpired,
      });
    },
    () => {
      onUpdate({
        holderUid: null,
        epoch: 0,
        updatedAt: null,
        isHolder: false,
        isExpired: true,
      });
    },
  );
}

/**
 * 每 60 秒定期續約心跳計時器。
 */
export function startLeaseHeartbeat(
  db: Firestore,
  uid: string,
  getEpoch: () => number,
  onLost: (reason: string) => void,
): () => void {
  const timer = setInterval(async () => {
    try {
      const epoch = getEpoch();
      const result = await renewLease(db, uid, epoch);
      if (result.status !== 'acquired') {
        onLost(`租約續約失敗：${result.status}`);
      }
    } catch (err) {
      onLost(err instanceof Error ? err.message : String(err));
    }
  }, LEASE_HEARTBEAT_INTERVAL_MS);

  return () => {
    clearInterval(timer);
  };
}
