import { useCallback, useEffect, useRef, useState } from 'react';
import { getCommandDiagnosticNextStep, getSystemDiagnosticNextStep } from '../../errors/errorCatalog';
import {
  clearSafeDiagnostics,
  readSafeDiagnostics,
  type SafeDiagnosticEntry,
} from '../../errors/errorLogger';
import { useFirebase } from '../../hooks/useFirebase';
import { isCurrentCloudActionOwner, useCloudActionOwner, type CloudActionOwnerToken } from './useCloudActionOwner';

interface CloudDiagnosticsPageProps {
  identityKey: string;
  leaseEpoch: number;
}

export function CloudDiagnosticsPage({ identityKey, leaseEpoch }: CloudDiagnosticsPageProps) {
  const { access, lease } = useFirebase();
  const hasLease = access.ok && lease.isKnown && lease.isHolder
    && lease.holderUid === access.profile.uid && lease.epoch === leaseEpoch;
  return <section className="cloud-diagnostics" aria-label="本機診斷">
    <div className="card" style={{ padding: '20px', marginTop: '16px' }}>
      <h2>本機診斷</h2>
      <p>診斷只保存在這台電腦，時間取自本機時鐘並以 ISO 格式保存；最多 100 筆，保留 24 小時。匯出檔只含固定診斷欄位。</p>
      {hasLease
        ? <CloudDiagnosticsControls identityKey={identityKey} leaseEpoch={leaseEpoch} />
        : <p>需要有效的操作租約才能查看本機診斷。</p>}
    </div>
  </section>;
}

function CloudDiagnosticsControls({ identityKey, leaseEpoch }: CloudDiagnosticsPageProps) {
  const actionOwnerRef = useCloudActionOwner(identityKey, leaseEpoch);
  const generationRef = useRef(0);
  const objectUrlRef = useRef<string | null>(null);
  const revokeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [initialRead] = useState(() => {
    try { return { entries: readSafeDiagnostics(), error: '' }; }
    catch { return { entries: [] as SafeDiagnosticEntry[], error: '無法讀取本機診斷紀錄；請檢查瀏覽器本機儲存空間。' }; }
  });
  const [entries, setEntries] = useState<SafeDiagnosticEntry[]>(initialRead.entries);
  const [error, setError] = useState(initialRead.error);
  const [status, setStatus] = useState('');

  const revokePendingDownload = useCallback(() => {
    if (revokeTimerRef.current !== null) {
      clearTimeout(revokeTimerRef.current);
      revokeTimerRef.current = null;
    }
    const url = objectUrlRef.current;
    objectUrlRef.current = null;
    if (url) {
      try { URL.revokeObjectURL(url); } catch { /* URL revocation is best effort cleanup. */ }
    }
  }, []);

  useEffect(() => () => {
    generationRef.current += 1;
    revokePendingDownload();
  }, [revokePendingDownload]);

  const ownsCurrentLease = (generation: number, owner: CloudActionOwnerToken | null): boolean => (
    generationRef.current === generation
    && isCurrentCloudActionOwner(actionOwnerRef, owner)
  );

  const refresh = () => {
    const owner = actionOwnerRef.current;
    const generation = generationRef.current;
    if (!ownsCurrentLease(generation, owner)) return;
    try {
      setEntries(readSafeDiagnostics());
      setError('');
    } catch {
      setError('無法讀取本機診斷紀錄；請檢查瀏覽器本機儲存空間。');
    }
  };

  const exportDiagnostics = () => {
    const owner = actionOwnerRef.current;
    const generation = generationRef.current;
    if (!ownsCurrentLease(generation, owner)) return;
    setError('');
    setStatus('');
    let url: string | null = null;
    let anchor: HTMLAnchorElement | null = null;
    try {
      const currentEntries = readSafeDiagnostics();
      if (!ownsCurrentLease(generation, owner)) return;
      setEntries(currentEntries);
      if (currentEntries.length === 0) return;
      const exportedAt = new Date().toISOString();
      const contents = JSON.stringify({
        schemaVersion: 1,
        exportedAt,
        timeBasis: 'local-device-clock',
        retentionHours: 24,
        storage: 'local-only',
        entries: currentEntries,
      }, null, 2);
      const blob = new Blob([contents], { type: 'application/json' });
      url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      if (!ownsCurrentLease(generation, owner)) {
        revokePendingDownload();
        return;
      }
      anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `easyorder-diagnostics-${exportedAt.slice(0, 10)}.json`;
      document.body.append(anchor);
      if (!ownsCurrentLease(generation, owner)) {
        anchor.remove();
        revokePendingDownload();
        return;
      }
      anchor.click();
      anchor.remove();
      anchor = null;
      revokeTimerRef.current = setTimeout(() => {
        if (objectUrlRef.current !== url || !url) return;
        try { URL.revokeObjectURL(url); } catch { /* URL revocation is best effort cleanup. */ }
        objectUrlRef.current = null;
        revokeTimerRef.current = null;
        if (ownsCurrentLease(generation, owner)) setStatus('已發出下載請求。');
      }, 0);
    } catch {
      anchor?.remove();
      if (url && objectUrlRef.current === url) revokePendingDownload();
      setError('無法建立診斷下載；紀錄仍只保存在這台電腦，請稍後再試。');
    }
  };

  const clearDiagnostics = () => {
    const owner = actionOwnerRef.current;
    const generation = generationRef.current;
    if (!ownsCurrentLease(generation, owner)) return;
    setError('');
    setStatus('');
    if (!clearSafeDiagnostics()) {
      setError('無法清除本機診斷紀錄；請檢查瀏覽器本機儲存空間。');
      return;
    }
    if (!ownsCurrentLease(generation, owner)) return;
    setEntries([]);
    setStatus('本機診斷紀錄已清除。');
  };

  return <>
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      {entries.length === 0 ? <p>目前沒有可匯出的診斷紀錄。</p> : (
        <ol aria-label="診斷紀錄">
          {entries.map((entry, index) => entry.type === 'command-failure' ? (
            <li key={`${entry.occurredAt}-${index}`}>
              <p><strong>命令錯誤：{entry.errorCode}</strong></p>
              <p>命令類型：{entry.kind ?? '未知'}</p>
              <p>原 command ID：{entry.commandId ?? '未取得有效 ID'}</p>
              <p>本機時間：{entry.occurredAt}</p>
              <p>下一步：{getCommandDiagnosticNextStep(entry.errorCode)}</p>
            </li>
          ) : (
            <li key={`${entry.occurredAt}-${index}`}>
              <p><strong>系統診斷：{entry.systemCode}</strong></p>
              <p>來源：{entry.source}</p>
              <p>本機時間：{entry.occurredAt}</p>
              <p>下一步：{getSystemDiagnosticNextStep(entry.systemCode)}</p>
            </li>
          ))}
        </ol>
      )}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '16px' }}>
        <button type="button" onClick={refresh}>重新載入紀錄</button>
        <button type="button" className="btn-confirm" onClick={exportDiagnostics} disabled={entries.length === 0}>
          匯出本機診斷
        </button>
        <button type="button" onClick={clearDiagnostics} disabled={entries.length === 0}>
          清除本機診斷
        </button>
      </div>
  </>;
}
