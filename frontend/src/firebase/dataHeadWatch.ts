// #587: a tiny listener on system/dataHead. Every business command bumps its `seq` (spec §5), so one document tells a holder tab
// that another device of the same account wrote. It carries no business data: pages read what changed through their repositories.
import { doc, onSnapshot, type Firestore } from 'firebase/firestore';
import { dataHeadPath } from './firestorePaths';

export interface DataHeadSignal {
  seq: number;
  lastCommandId: string | null;
  datasetId: string;
}

function readSignal(value: unknown): DataHeadSignal | null {
  if (typeof value !== 'object' || value === null) return null;
  const { seq, lastCommandId, datasetId } = value as Record<string, unknown>;
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) return null;
  if (lastCommandId !== null && typeof lastCommandId !== 'string') return null;
  if (typeof datasetId !== 'string' || datasetId === '') return null;
  return { seq, lastCommandId, datasetId };
}

/**
 * Reports the server-confirmed head. Cache-only and pending-write observations are skipped (they prove nothing about the server).
 * A missing or malformed document and a listener error report `null`: the signal is only a hint to look again, never an
 * authorization, so a failure here does not mask anything (the lease flow owns that).
 */
export function subscribeDataHead(db: Firestore, onUpdate: (head: DataHeadSignal | null) => void): () => void {
  try {
    return onSnapshot(
      doc(db, dataHeadPath()),
      { includeMetadataChanges: true },
      snapshot => {
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
        onUpdate(snapshot.exists() ? readSignal(snapshot.data()) : null);
      },
      () => onUpdate(null),
    );
  } catch {
    onUpdate(null);
    return () => {};
  }
}
