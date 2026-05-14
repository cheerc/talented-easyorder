import { useState } from 'react';
import type { LedgerTransaction } from '../../domain/ledger';

interface CorrectionDialogProps {
  tx: LedgerTransaction;
  onSave: (txId: string, updates: Partial<LedgerTransaction>, reason: string) => void;
  onCancel: () => void;
}

export function CorrectionDialog({ tx, onSave, onCancel }: CorrectionDialogProps) {
  const [mealPrice, setMealPrice] = useState(tx.mealPrice);
  const [paidAmount, setPaidAmount] = useState(tx.paidAmount);
  const [note, setNote] = useState(tx.note);
  const [reason, setReason] = useState('');

  const changed = mealPrice !== tx.mealPrice || paidAmount !== tx.paidAmount;
  const reasonRequired = changed;

  const handleSave = () => {
    if (reasonRequired && !reason.trim()) return;
    onSave(tx.transactionId, { mealPrice, paidAmount, note }, reason);
  };

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
        <div className="dialog-h">更正交易</div>
        <div className="dialog-body">
          <div className="dialog-row">
            <label>類型</label>
            <span className="mono">{tx.type === 'order' ? '訂餐' : tx.type === 'topup' ? '儲值' : '取消'}</span>
          </div>
          <div className="dialog-row">
            <label>便當金額</label>
            <input type="number" className="adm-input" value={mealPrice} onChange={e => setMealPrice(Number(e.target.value))} />
          </div>
          <div className="dialog-row">
            <label>實收金額</label>
            <input type="number" className="adm-input" value={paidAmount} onChange={e => setPaidAmount(Number(e.target.value))} />
          </div>
          <div className="dialog-row">
            <label>備註</label>
            <input className="adm-input" value={note} onChange={e => setNote(e.target.value)} />
          </div>
          <div className="dialog-row">
            <label>更正原因 {reasonRequired && <span style={{color:'var(--c-warn)',fontSize:'11px'}}>必填</span>}</label>
            <input className="adm-input" value={reason} placeholder="金額變更需要說明原因" onChange={e => setReason(e.target.value)} />
          </div>
        </div>
        <div className="dialog-foot">
          <button className="btn-cancel" onClick={onCancel}>取消</button>
          <button className="btn-confirm" onClick={handleSave} disabled={reasonRequired && !reason.trim()}>確認更正</button>
        </div>
      </div>
    </div>
  );
}