import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

interface ReopenDialogProps {
  businessDate: string;
  onReopen: (reason: string) => void;
  onCancel: () => void;
}

export function ReopenDialog({ businessDate, onReopen, onCancel }: ReopenDialogProps) {
  const [reason, setReason] = useState('');

  return (
    <Modal open={true} title={`重新開啟 ${businessDate}`} onClose={onCancel}>
      <p className="dim" style={{ marginBottom: '12px' }}>重新開啟後可以繼續編輯和更正交易，之後可以再次關帳。</p>
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '6px' }}>原因 <span style={{color:'var(--c-warn)',fontSize:'11px'}}>必填</span></label>
        <input className="adm-input" value={reason} placeholder="請說明重新開啟的原因" onChange={e => setReason(e.target.value)} style={{ width: '100%' }} />
      </div>
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onCancel}>取消</Button>
        <Button variant="primary" onClick={() => { if (reason.trim()) onReopen(reason); }} disabled={!reason.trim()}>確認重開</Button>
      </div>
    </Modal>
  );
}