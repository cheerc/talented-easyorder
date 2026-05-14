import { useState } from 'react';
import type { LedgerTransaction } from '../../domain/ledger';

interface VoidDialogProps {
  tx: LedgerTransaction;
  onVoid: (txId: string, reason: string) => void;
  onHardDelete: (txId: string, reason: string) => void;
  onCancel: () => void;
}

export function VoidDialog({ tx, onVoid, onHardDelete, onCancel }: VoidDialogProps) {
  const [reason, setReason] = useState('');
  const canHardDelete = tx.syncStatus === 'local';

  const handleAction = () => {
    if (!reason.trim()) return;
    if (canHardDelete) {
      onHardDelete(tx.transactionId, reason);
    } else {
      onVoid(tx.transactionId, reason);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
        <div className="dialog-h">刪除交易</div>
        <div className="dialog-body">
          <p className="dim" style={{ marginBottom: '12px' }}>
            {canHardDelete
              ? '此交易尚未同步，可直接刪除（hard delete）。'
              : '此交易已同步或排隊中，將以作廢記錄（void）保留審計軌跡。'}
          </p>
          <div className="dialog-row">
            <label>原因 <span style={{color:'var(--c-warn)',fontSize:'11px'}}>必填</span></label>
            <input className="adm-input" value={reason} placeholder="請說明刪除原因" onChange={e => setReason(e.target.value)} />
          </div>
        </div>
        <div className="dialog-foot">
          <button className="btn-cancel" onClick={onCancel}>取消</button>
          <button className="btn-confirm danger" onClick={handleAction} disabled={!reason.trim()}>
            {canHardDelete ? '永久刪除' : '確認作廢'}
          </button>
        </div>
      </div>
    </div>
  );
}