import React, { useState } from "react";
import type { Vendor } from '../../domain/menu';
import { useMenu, useMenuActions } from '../../store/selectors';
import { getTaiwanISOString } from '../../utils/dateTime';

export const VendorsScreen = React.memo(function VendorsScreen() {
  const { vendors } = useMenu();
  const { setVendors } = useMenuActions();
  const [editing, setEditing] = useState<string | null>(null); // id of row being edited, or 'new'
  const [draft, setDraft] = useState<Partial<Vendor>>({ name:'', phone:'', note:'' });
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const startEdit = (v: Vendor) => { setEditing(v.vendorId); setDraft({ ...v }); };
  const startNew  = () => { setEditing('new'); setDraft({ name:'', phone:'', note:'' }); };
  const cancel    = () => setEditing(null);
  const save = () => {
    if (!draft.name?.trim()) return alert('請輸入供應商名稱');
    if (editing === 'new') {
      const newVendor: Vendor = {
        vendorId: Date.now().toString(),
        name: draft.name || '',
        phone: draft.phone || '',
        note: draft.note || '',
        status: 'active',
        createdAt: getTaiwanISOString(),
        updatedAt: getTaiwanISOString(),
        revision: 1,
      };
      setVendors([...vendors, newVendor]);
    } else {
      setVendors(vendors.map(v => v.vendorId === editing ? { ...v, name: draft.name || v.name, phone: draft.phone || v.phone, note: draft.note || v.note } : v));
    }
    setEditing(null);
  };
  const confirmDelete = () => {
    if (!deleteTarget) return;
    setVendors(vendors.filter(v => v.vendorId !== deleteTarget));
    setDeleteTarget(null);
  };

  return (
    <div className="screen vendors">
      <div className="card vendors-card">
        <div className="card-h adm-card-h" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div className="card-h-left">
            <div style={{ fontSize: '18px', fontWeight: '600' }}>供應商管理</div>
            <div className="card-h-sub" style={{ marginTop: '4px' }}>{vendors.length} 家合作對象</div>
          </div>
          <button className="btn-confirm" style={{ padding: '10px 24px', fontSize: '14px', width: 'auto', flex: 'none', borderRadius: '10px' }} onClick={startNew}>
            ＋ 新增供應商
          </button>
        </div>

        <div className="vendor-list">
          <div className="vendor-th" style={{ gridTemplateColumns: '1.4fr 1.2fr 2fr 120px', borderBottom: '2px solid var(--line-2)' }}>
            <div>名稱</div><div>電話</div><div>備註</div><div className="r">操作</div>
          </div>
          {vendors.map(v => editing === v.vendorId ? (
            <div className="vendor-tr vendor-edit" key={v.vendorId} style={{ gridTemplateColumns: '1.4fr 1.2fr 2fr 120px', margin: '8px 0', border: '1px solid var(--accent)', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
              <input className="adm-input" value={draft.name} placeholder="供應商名稱" autoFocus
                     onChange={e => setDraft({...draft, name: e.target.value})} />
              <input className="adm-input mono" value={draft.phone} placeholder="電話"
                     onChange={e => setDraft({...draft, phone: e.target.value})} />
              <input className="adm-input" value={draft.note} placeholder="備註"
                     onChange={e => setDraft({...draft, note: e.target.value})} />
              <div className="vendor-edit-btns r" style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                <button className="rpt-mini-btn" onClick={cancel}>取消</button>
                <button className="rpt-mini-btn rpt-mini-strong" onClick={save}>儲存</button>
              </div>
            </div>
          ) : (
            <div className="vendor-tr" key={v.vendorId} style={{ gridTemplateColumns: '1.4fr 1.2fr 2fr 120px' }}>
              <div className="vendor-name" style={{ fontSize: '16px' }}>{v.name}</div>
              <div className="vendor-phone mono">
                <a href={`tel:${v.phone}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '12px' }}>📞</span> {v.phone}
                </a>
              </div>
              <div className="vendor-note dim">{v.note || '-'}</div>
              <div className="vendor-actions r">
                <button className="rpt-mini-btn" onClick={() => startEdit(v)}>編輯</button>
                <button className="rpt-mini-btn rpt-mini-del" style={{ marginLeft: '6px' }} onClick={() => setDeleteTarget(v.vendorId)}>刪除</button>
              </div>
            </div>
          ))}
          {editing === 'new' && (
            <div className="vendor-tr vendor-edit" style={{ gridTemplateColumns: '1.4fr 1.2fr 2fr 120px', margin: '8px 0', border: '1px solid var(--accent)' }}>
              <input className="adm-input" value={draft.name} placeholder="供應商名稱" autoFocus
                     onChange={e => setDraft({...draft, name: e.target.value})} />
              <input className="adm-input mono" value={draft.phone} placeholder="電話"
                     onChange={e => setDraft({...draft, phone: e.target.value})} />
              <input className="adm-input" value={draft.note} placeholder="備註"
                     onChange={e => setDraft({...draft, note: e.target.value})} />
              <div className="vendor-edit-btns r" style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                <button className="rpt-mini-btn" onClick={cancel}>取消</button>
                <button className="rpt-mini-btn rpt-mini-strong" onClick={save}>儲存</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {deleteTarget && (
        <div className="dialog-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="dialog-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '380px' }}>
            <div className="dialog-h">確認刪除供應商</div>
            <div className="dialog-body">
              <p style={{ marginBottom: '12px' }}>確定要刪除此供應商嗎？此操作無法復原。</p>
              {vendors.find(v => v.vendorId === deleteTarget) && (
                <div className="dialog-row">
                  <label>供應商</label>
                  <span className="mono">{vendors.find(v => v.vendorId === deleteTarget)!.name}</span>
                </div>
              )}
            </div>
            <div className="dialog-foot">
              <button className="btn-cancel" onClick={() => setDeleteTarget(null)}>取消</button>
              <button className="btn-confirm danger" onClick={confirmDelete}>確定刪除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
