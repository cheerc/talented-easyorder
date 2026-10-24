/**
 * Finalize (Ruling R11): after a verified restore, rebuild the operator allow-list and an empty lease, then — last —
 * clear maintenance. The lease epoch is never below an existing `accessEvents` number (spec §4.2), so the first
 * acquire can always write its event. Output carries counts only: never an operator's UID or e-mail.
 */
import { buildOperatorDocForRestore } from './operatorDoc';
import { RestoreExecError } from './restoreExecutor';
import type { FirestoreRest, RestWrite } from './firestoreRest';
import type { LoadedChain } from './restoreChain';
import type { RestorePlan } from './restorePlan';

export class OperatorsFileError extends Error {
  constructor(message: string) { super(message); this.name = 'OperatorsFileError'; }
}

export interface OperatorEntry { uid: string; email: string; displayName?: string }

/** `[{ "uid": "...", "email": "...", "displayName": "optional" }]`, at least one, no duplicate UIDs, no other keys. */
export function parseOperators(text: string): OperatorEntry[] {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new OperatorsFileError('操作員檔不是有效的 JSON'); }
  if (!Array.isArray(value) || value.length === 0) throw new OperatorsFileError('操作員檔必須是至少一位操作員的陣列');
  const seen = new Set<string>();
  return value.map((entry: unknown, index: number): OperatorEntry => {
    const item = entry as Record<string, unknown> | null;
    const keys = item && typeof item === 'object' ? Object.keys(item) : [];
    if (!item || typeof item !== 'object' || Array.isArray(item) || keys.some(key => !['uid', 'email', 'displayName'].includes(key))
      || typeof item.uid !== 'string' || !item.uid.trim() || typeof item.email !== 'string' || !item.email.includes('@')
      || (item.displayName !== undefined && typeof item.displayName !== 'string')) {
      throw new OperatorsFileError(`操作員檔第 ${index + 1} 筆必須只有 uid、email（與選填的 displayName），且 uid、email 不可為空`);
    }
    if (seen.has(item.uid.trim())) throw new OperatorsFileError('操作員檔有重複的 uid');
    seen.add(item.uid.trim());
    return { uid: item.uid.trim(), email: item.email, ...(typeof item.displayName === 'string' ? { displayName: item.displayName } : {}) };
  });
}

export interface FinalizePlan {
  /** Operators that do not exist yet. */
  operatorsToCreate: number;
  operatorsExisting: number;
  leaseEpoch: number;
  leaseExists: boolean;
  writes: RestWrite[];
}

const maxOf = (values: number[]) => values.reduce((most, value) => Math.max(most, value), 0);

/** Reads the target and decides the writes. Fails closed on a conflicting lease or operator; writes nothing. */
export async function planFinalize(
  rest: FirestoreRest, chain: LoadedChain, plan: RestorePlan, operators: OperatorEntry[], timestamp: { _type: 'timestamp'; seconds: number; nanoseconds: number },
): Promise<FinalizePlan> {
  const ids = await rest.listDocumentIds('accessEvents');
  const eventMax = maxOf(ids.filter(id => /^[1-9]\d*$/.test(id)).map(Number));
  const commandMax = maxOf(chain.records.slice(0, plan.toSeq).map(record => (Number.isSafeInteger(record.leaseEpoch) ? record.leaseEpoch : 0)));
  const lease = await rest.getWithUpdateTime('system/accessLease');
  const leaseEpoch = Math.max(eventMax, commandMax, Number.isSafeInteger(lease?.data.epoch) ? Number(lease?.data.epoch) : 0);
  if (lease && (lease.data.holderUid !== null || lease.data.epoch !== leaseEpoch)) {
    throw new RestoreExecError('目標已經有 system/accessLease，而且有人持有或 epoch 不是預期值；finalize 不覆蓋既有租約');
  }

  const docs = operators.map(operator => ({ path: `operators/${buildOperatorDocForRestore(operator).uid}`, doc: buildOperatorDocForRestore(operator) }));
  const existing = await rest.batchGet(docs.map(item => item.path));
  const writes: RestWrite[] = [];
  let operatorsExisting = 0;
  for (const { path, doc } of docs) {
    const found = existing.get(path) ?? null;
    if (found === null) {
      writes.push({ kind: 'create', path, data: { ...doc, createdAt: timestamp, updatedAt: timestamp } });
    } else if (found.uid === doc.uid && found.email === doc.email && found.active === doc.active) {
      operatorsExisting += 1;
    } else {
      throw new RestoreExecError('目標已經有同 UID 但內容不同的 operators 文件；finalize 不覆蓋');
    }
  }
  const operatorsToCreate = writes.length;
  if (!lease) writes.push({ kind: 'create', path: 'system/accessLease', data: { holderUid: null, epoch: leaseEpoch, updatedAt: timestamp } });
  return { operatorsToCreate, operatorsExisting, leaseEpoch, leaseExists: lease !== null, writes };
}

/** Writes operators and the lease, then clears maintenance with a precondition on the dataHead not having changed. */
export async function applyFinalize(rest: FirestoreRest, finalize: FinalizePlan): Promise<void> {
  await rest.commit(finalize.writes);
  const head = await rest.getWithUpdateTime('system/dataHead');
  if (!head || head.data.maintenance !== true) throw new RestoreExecError('目標的 dataHead 在 finalize 途中改變；停止，請重新檢查');
  await rest.commit([{
    kind: 'update', path: 'system/dataHead', data: { maintenance: false }, fields: ['maintenance'], updateTime: head.updateTime,
  }]);
}
