import { useState } from 'react';

interface ReopenDialogProps {
  businessDate: string;
  onReopen: (reason: string) => void;
  onCancel: () => void;
}

export function ReopenDialog({ businessDate, onReopen, onCancel }: ReopenDialogProps) {
  const [reason, setReason] = useState('');

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
        <div className="dialog-h">重新開啟 {businessDate}</div>
        <div className="dialog-body">
          <p className="dim" style={{ marginBottom: '12px' }}>重新開啟後可以繼續編輯和更正交易，之後可以再次關帳。</p>
          <div className="dialog-row">
            <label>原因 <span style={{color:'var(--c-warn)',fontSize:'11px'}}>必填</span></label>
            <input className="adm-input" value={reason} placeholder="請說明重新開啟的原因" onChange={e => setReason(e.target.value)} />
          </div>
        </div>
        <div className="dialog-foot">
          <button className="btn-cancel" onClick={onCancel}>取消</button>
          <button className="btn-confirm" onClick={() => { if (reason.trim()) onReopen(reason); }} disabled={!reason.trim()}>確認重開</button>
        </div>
      </div>
    </div>
  );
}