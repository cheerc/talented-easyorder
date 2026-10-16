import React, { useEffect, useRef, useState } from 'react';
import { useFirebaseOptional } from '../../providers/FirebaseProvider';
import { createCloudBackupRepository } from '../../firebase/cloudBackupRepository';
import { createCloudCommandRepository } from '../../firebase/cloudCommandRepository';
import { decryptBackup, encryptBackup, sha256Hex, verifyBackupFile, type BackupManifest } from '../../firebase/cloudBackup';

type BackupStage = 'idle' | 'generated' | 'downloadRequested' | 'verifiedLocal';

export const BackupScreen = React.memo(function BackupScreen() {
  const firebase = useFirebaseOptional();
  const fb = firebase?.fb ?? null;
  const access = firebase?.access ?? { ok: false as const };
  const lease = firebase?.lease ?? { isHolder: false, epoch: 0 };
  const [stage, setStage] = useState<BackupStage>('idle');
  const [headSeq, setHeadSeq] = useState<number | null>(null);
  const [fromSeq, setFromSeq] = useState(0);
  const [packageBytes, setPackageBytes] = useState<Uint8Array<ArrayBuffer> | null>(null);
  const [packageSha, setPackageSha] = useState<string | null>(null);
  const [manifest, setManifest] = useState<BackupManifest | null>(null);
  const [previousManifest, setPreviousManifest] = useState<BackupManifest | null>(null);
  const [previousPackageSha, setPreviousPackageSha] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const operationRef = useRef(0);
  const receiptCommandIdRef = useRef<string | null>(null);

  useEffect(() => {
    operationRef.current += 1;
    receiptCommandIdRef.current = null;
    setStage('idle'); setHeadSeq(null); setPackageBytes(null); setPackageSha(null);
    setManifest(null); setPreviousManifest(null); setPreviousPackageSha(null); setPassword(''); setError(''); setBusy(false);
    return () => { operationRef.current += 1; };
  }, [access.ok, lease.isHolder, lease.epoch]);

  const readPrevious = async (file: File) => {
    const id = ++operationRef.current;
    try {
      const bytes = await file.arrayBuffer();
      const loaded = await decryptBackup(bytes, password);
      if (id !== operationRef.current || !lease.isHolder) return;
      const hash = await sha256Hex(new Uint8Array(bytes));
      if (id !== operationRef.current || !lease.isHolder) return;
      setPreviousManifest(loaded); setPreviousPackageSha(hash); setFromSeq(loaded.toSeq); setError('');
    } catch (cause) { if (id === operationRef.current) setError(cause instanceof Error ? cause.message : '無法讀取前次備份'); }
  };

  const generate = async () => {
    if (!fb?.db || !access.ok || !lease.isHolder || !password) return;
    const id = ++operationRef.current;
    receiptCommandIdRef.current = null;
    setBusy(true); setError(''); setPackageBytes(null); setPackageSha(null); setManifest(null); setStage('idle');
    try {
      const repository = createCloudBackupRepository(fb.db, { currentUid: () => lease.isHolder ? access.profile.uid : null });
      const exported = await repository.exportRange({
        fromSeq, previousManifest,
        previousPackageSha256: previousPackageSha,
      });
      if (id !== operationRef.current || !lease.isHolder) return;
      const bytes = await encryptBackup(exported.manifest, password);
      const hash = await sha256Hex(bytes);
      if (id !== operationRef.current || !lease.isHolder) return;
      setHeadSeq(exported.toSeq); setPackageBytes(bytes); setPackageSha(hash); setManifest(exported.manifest); setStage('generated');
    } catch (cause) { if (id === operationRef.current) setError(cause instanceof Error ? cause.message : '備份產生失敗'); }
    finally { if (id === operationRef.current) setBusy(false); }
  };

  const download = () => {
    if (!packageBytes || !manifest) return;
    const blob = new Blob([packageBytes.buffer], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `easyorder-backup-${manifest.fromSeq}-${manifest.toSeq}.eobackup`;
    document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    setStage('downloadRequested');
  };

  const verifySelected = async (file: File | undefined) => {
    if (!file || !manifest || !packageSha || !fb?.db || !access.ok || !lease.isHolder) return;
    const id = ++operationRef.current;
    setBusy(true); setError('');
    try {
      const readback = await verifyBackupFile(file, password, packageSha);
      if (readback.datasetId !== manifest.datasetId || readback.fromSeq !== manifest.fromSeq || readback.toSeq !== manifest.toSeq) {
        throw new Error('重新選取的備份範圍或 dataset 不一致');
      }
      if (id !== operationRef.current || !lease.isHolder) return;
      const commands = createCloudCommandRepository(fb.db);
      const result = await commands.commitCommand({
        commandId: receiptCommandIdRef.current ?? (receiptCommandIdRef.current = crypto.randomUUID()),
        kind: 'RecordBackup', leaseEpoch: lease.epoch,
        targets: {}, expectedRevisions: {},
        payload: { backupType: 'command-incremental', sourceSeq: manifest.toSeq, fromSeq: manifest.fromSeq,
          toSeq: manifest.toSeq, sha256: packageSha },
      });
      if (id !== operationRef.current || !lease.isHolder) return;
      if (!result.ok) throw new Error(result.error.message);
      setStage('verifiedLocal');
    } catch (cause) { if (id === operationRef.current) setError(cause instanceof Error ? cause.message : '本機備份驗證失敗'); }
    finally {
      if (id === operationRef.current) {
        setBusy(false);
        if (fileRef.current) fileRef.current.value = '';
      }
    }
  };

  return <section className="screen backup" aria-label="每日增量備份">
    <div className="card bk-flow">
      <h2 className="bk-flow-h">每日加密備份</h2>
      <p className="bk-flow-sub">手動下載每日增量。下載後請重新選取檔案驗證；第二份副本需由操作者複製至公司受控電腦或加密離線媒體並確認。</p>
      <label>備份密碼
        <input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
      </label>
      <label>前次可讀備份（首次完整備份可留空）
        <input type="file" accept=".eobackup,application/json" onChange={event => { const file = event.target.files?.[0]; if (file) void readPrevious(file); }} disabled={busy} />
      </label>
      {previousManifest && <p>前包已解密：seq {previousManifest.fromSeq}–{previousManifest.toSeq}，增量從 {previousManifest.toSeq + 1} 開始。</p>}
      {headSeq !== null && <p role="status">固定匯出 head H={headSeq}；範圍 {fromSeq}–{headSeq}。{stage === 'verifiedLocal' ? '本機副本已驗證。' : `狀態：${stage}。`}</p>}
      <div className="rest-btns">
        <button type="button" className="btn-confirm" onClick={() => void generate()} disabled={busy || !lease.isHolder || !password || (fromSeq > 0 && !previousManifest)}>
          {busy ? '處理中…' : '產生加密備份'}
        </button>
        <button type="button" className="btn-confirm" onClick={download} disabled={!packageBytes || busy}>下載備份</button>
      </div>
      {packageBytes && <label>重新選取剛存下的備份檔
        <input ref={fileRef} type="file" accept=".eobackup,application/json" disabled={busy || stage === 'verifiedLocal'}
          onChange={event => void verifySelected(event.target.files?.[0])} />
      </label>}
      {stage === 'verifiedLocal' && <p role="status">備份雜湊與 manifest 已從本機檔案驗證，且已登記 RecordBackup。</p>}
      {error && <p role="alert">{error}</p>}
      <p>產生備份與瀏覽器發起下載都不代表檔案已存好；只有重新選取、解密並比對成功後才登記。取消、錯誤或失去使用權不會推進驗證狀態。</p>
    </div>
  </section>;
});
