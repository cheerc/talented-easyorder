// #587: a tiny listener on the newest command receipt. Every business command bumps `system/dataHead.seq` (spec §5) and writes one
// receipt whose `after.head` is that head, so the newest receipt tells a holder tab that another device of the same account wrote.
// It is deliberately NOT a listener on system/dataHead: the Firestore SDK shares one watch target per query, and the repositories
// read the head with getDocFromServer as a before/after consistency fence. A listener on the same document would let those fence
// reads join the watch stream and return a head that is a moment behind the server (a dataset switch then surfaced as a stale
// snapshot). The receipt query is a different target, so the fence reads keep going to the server.
// It carries no business data beyond the receipt's `targets`: pages read what changed through their repositories.
import { collection, limit, onSnapshot, orderBy, query, type Firestore } from 'firebase/firestore';

export interface DataHeadSignal {
  seq: number;
  lastCommandId: string;
  datasetId: string;
  targets: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSignal(value: unknown): DataHeadSignal | null {
  if (!isRecord(value)) return null;
  const { seq, commandId, targets, after } = value;
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1) return null;
  if (typeof commandId !== 'string' || commandId === '') return null;
  if (!isRecord(targets) || !isRecord(after) || !isRecord(after.head)) return null;
  const { datasetId, seq: headSeq } = after.head;
  if (typeof datasetId !== 'string' || datasetId === '' || headSeq !== seq) return null;
  return { seq, lastCommandId: commandId, datasetId, targets };
}

/**
 * Reports the newest server-confirmed command receipt. Cache-only and pending-write observations are skipped (they prove nothing
 * about the server). No receipt yet, a malformed one and a listener error report `null`: the signal is only a hint to look again,
 * never an authorization, so a failure here does not mask anything (the lease flow owns that).
 */
export function subscribeDataHead(db: Firestore, onUpdate: (head: DataHeadSignal | null) => void): () => void {
  try {
    return onSnapshot(
      query(collection(db, 'commands'), orderBy('seq', 'desc'), limit(1)),
      { includeMetadataChanges: true },
      snapshot => {
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
        const newest = snapshot.docs[0];
        onUpdate(newest ? readSignal(newest.data()) : null);
      },
      () => onUpdate(null),
    );
  } catch {
    onUpdate(null);
    return () => {};
  }
}
