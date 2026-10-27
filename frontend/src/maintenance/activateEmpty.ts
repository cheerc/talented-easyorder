import type { FirestoreRest, RestWrite, TimestampMarker } from './firestoreRest';
import { RestoreExecError, assertNoBusinessDocuments } from './restoreExecutor';
import type { OperatorEntry } from './restoreFinalize';
import { buildOperatorDocForRestore } from './operatorDoc';

/** First activation is one conditional atomic commit. It never creates financial starting values. */
export async function planEmptyActivation(rest: FirestoreRest, operators: OperatorEntry[], timestamp: TimestampMarker): Promise<{ datasetId: string; writes: RestWrite[] }> {
  const head = await rest.getWithUpdateTime('system/dataHead');
  const data = head?.data;
  if (!head || !data || data.schemaVersion !== 1 || data.seq !== 0 || data.lastCommandId !== null || data.maintenance !== true
    || typeof data.datasetId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(data.datasetId)
    || typeof data.goLiveDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.goLiveDate)
    || Number.isNaN(Date.parse(`${data.goLiveDate}T00:00:00Z`)) || new Date(`${data.goLiveDate}T00:00:00Z`).toISOString().slice(0, 10) !== data.goLiveDate) {
    throw new RestoreExecError('空白啟用只接受已 init、schema 1、seq 0、有效 dataset/date 且維護中的 dataHead');
  }
  if (operators.length < 1 || operators.length > 50 || new Set(operators.map(item => item.uid)).size !== operators.length
    || operators.some(item => !/^[^/\s]{1,128}$/.test(item.uid) || item.email !== item.email.trim().toLowerCase())) {
    throw new RestoreExecError('操作員須有 1 至 50 位不重複 UID（不含斜線），email 必須是 Auth 顯示的完整小寫 email');
  }
  await assertNoBusinessDocuments(rest);
  for (const name of ['operators', 'accessEvents']) {
    if (await rest.collectionHasDocuments(name)) throw new RestoreExecError(`空白啟用拒絕既有 ${name}；請確認專案，不覆寫`);
  }
  const system = await rest.listDocumentIds('system');
  if (system.length !== 1 || system[0] !== 'dataHead') throw new RestoreExecError('空白啟用拒絕既有控制文件或租約');
  const writes: RestWrite[] = operators.map(operator => ({ kind: 'create', path: `operators/${operator.uid}`,
    data: { ...buildOperatorDocForRestore(operator), createdAt: timestamp, updatedAt: timestamp } }));
  writes.push({ kind: 'create', path: 'system/accessLease', data: { holderUid: null, epoch: 0, updatedAt: timestamp } });
  writes.push({ kind: 'update', path: 'system/dataHead', data: { maintenance: false }, fields: ['maintenance'], updateTime: head.updateTime });
  return { datasetId: data.datasetId, writes };
}
