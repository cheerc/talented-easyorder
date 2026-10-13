import React, { useState } from "react";
import {
  applyVendorEdit, deleteInactiveVendor, isVendorInLegacyMenu, setVendorStatus, validateVendorDraft, vendorMenuDates,
  type Vendor, type VendorDraft,
} from '../../domain/menu';
import { useMenu, useMenuActions, useMenuForDate } from '../../store/selectors';
import { getTaiwanISOString } from '../../utils/dateTime';
import { ConfirmDialog } from '../ui/ConfirmDialog';

const COLUMNS = '1.4fr 1.2fr 2fr 200px';
const EMPTY_DRAFT: VendorDraft = { name: '', phone: '', note: '' };

interface VendorsScreenProps {
  /** 目前檢視的營業日；停用時提醒這天的晚餐設定是否正在用這家。 */
  viewDate?: string;
}

/**
 * M3 F4：供應商維護。不用了先「停用」（新的晚餐設定選不到，可以恢復）；
 * 已停用的才能「永久刪除」。舊訂單和每日菜單都存了當時的店名，停用或刪除都不會改到歷史紀錄。
 */
export const VendorsScreen = React.memo(function VendorsScreen({ viewDate }: VendorsScreenProps) {
  const { vendors, menusByDate, todayMenu } = useMenu();
  const { setVendors } = useMenuActions();
  const viewMenu = useMenuForDate(viewDate ?? '').menu;
  const [editing, setEditing] = useState<string | null>(null); // 編輯中的 vendorId，或 'new'
  const [draft, setDraft] = useState<VendorDraft>(EMPTY_DRAFT);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Vendor | null>(null);

  const active = vendors.filter(v => v.status === 'active');
  const inactive = vendors.filter(v => v.status !== 'active');

  const startEdit = (v: Vendor) => { setEditing(v.vendorId); setDraft({ name: v.name, phone: v.phone, note: v.note }); setError(''); setNotice(''); };
  const startNew = () => { setEditing('new'); setDraft(EMPTY_DRAFT); setError(''); setNotice(''); };
  const cancel = () => { setEditing(null); setError(''); };

  const save = () => {
    const message = validateVendorDraft(draft, vendors, editing === 'new' ? null : editing);
    if (message) { setError(message); return; }
    const now = getTaiwanISOString();
    if (editing === 'new') {
      const newVendor: Vendor = {
        vendorId: Date.now().toString(),
        name: draft.name.trim(),
        phone: draft.phone.trim(),
        note: draft.note.trim(),
        status: 'active',
        createdAt: now,
        updatedAt: now,
        revision: 1,
      };
      setVendors([...vendors, newVendor]);
      setNotice(`已新增「${newVendor.name}」。`);
    } else {
      setVendors(vendors.map(v => (v.vendorId === editing ? applyVendorEdit(v, draft, now) : v)));
      setNotice(`已儲存「${draft.name.trim()}」。`);
    }
    setEditing(null);
    setError('');
  };

  const deactivate = (v: Vendor) => {
    setVendors(setVendorStatus(vendors, v.vendorId, 'inactive', getTaiwanISOString()));
    if (editing === v.vendorId) setEditing(null);
    const inUseToday = viewDate && viewMenu.vendorId === v.vendorId;
    setNotice(inUseToday
      ? `已停用「${v.name}」。${viewDate} 的晚餐設定還在用這家，已登記的訂單不受影響；請到今日設定（F3）改選供應商。`
      : `已停用「${v.name}」。新的晚餐設定選不到它；要用時可以在「已停用」裡恢復。`);
  };

  const reactivate = (v: Vendor) => {
    setVendors(setVendorStatus(vendors, v.vendorId, 'active', getTaiwanISOString()));
    setNotice(`已恢復「${v.name}」。`);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const result = deleteInactiveVendor(vendors, deleteTarget.vendorId);
    if (result.ok) {
      setVendors(result.vendors);
      setNotice(`已永久刪除「${deleteTarget.name}」。`);
    } else {
      setNotice(result.message);
    }
    setDeleteTarget(null);
  };

  const deleteMessage = (() => {
    if (!deleteTarget) return '';
    const dates = vendorMenuDates(deleteTarget.vendorId, menusByDate);
    const usage = isVendorInLegacyMenu(deleteTarget.vendorId, menusByDate, todayMenu)
      ? '目前的晚餐設定用這家。'
      : dates.length > 0
      ? `有 ${dates.length} 天的晚餐設定用過這家（${dates[0]}${dates.length > 1 ? ` 到 ${dates[dates.length - 1]}` : ''}）。`
      : '目前沒有晚餐設定用過這家。';
    return `確定要永久刪除「${deleteTarget.name}」嗎？${usage}歷史訂單與菜單上的店名會保留，但刪除後不能恢復。`;
  })();

  const onEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  };

  const editRow = (key: string) => (
    <div key={key}>
      <div className="vendor-tr vendor-edit" style={{ gridTemplateColumns: COLUMNS, margin: '8px 0', border: '1px solid var(--accent)' }} onKeyDown={onEditKeyDown}>
        <input className="adm-input" aria-label="供應商名稱" value={draft.name} placeholder="供應商名稱" autoFocus
               onChange={e => setDraft({ ...draft, name: e.target.value })} />
        <input className="adm-input mono" aria-label="電話" value={draft.phone} placeholder="電話"
               onChange={e => setDraft({ ...draft, phone: e.target.value })} />
        <input className="adm-input" aria-label="備註" value={draft.note} placeholder="備註"
               onChange={e => setDraft({ ...draft, note: e.target.value })} />
        <div className="vendor-edit-btns r" style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
          <button className="rpt-mini-btn" onClick={cancel}>取消</button>
          <button className="rpt-mini-btn rpt-mini-strong" onClick={save}>儲存</button>
        </div>
      </div>
      {error && <div role="alert" style={{ color: 'var(--c-warn)', fontSize: '13px', margin: '-4px 0 8px' }}>{error}</div>}
    </div>
  );

  return (
    <div className="screen vendors">
      <div className="card vendors-card">
        <div className="card-h adm-card-h" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div className="card-h-left">
            <div style={{ fontSize: '18px', fontWeight: '600' }}>供應商管理</div>
            <div className="card-h-sub" style={{ marginTop: '4px' }}>
              {active.length} 家使用中{inactive.length > 0 ? `、${inactive.length} 家已停用` : ''}
            </div>
          </div>
          <button className="btn-confirm" style={{ padding: '10px 24px', fontSize: '14px', width: 'auto', flex: 'none', borderRadius: '10px' }} onClick={startNew}>
            ＋ 新增供應商
          </button>
        </div>

        {notice && <div role="status" style={{ color: 'var(--accent-ink)', fontSize: '13px', marginBottom: '12px' }}>{notice}</div>}

        <div className="vendor-list">
          <div className="vendor-th" style={{ gridTemplateColumns: COLUMNS, borderBottom: '2px solid var(--line-2)' }}>
            <div>名稱</div><div>電話</div><div>備註</div><div className="r">操作</div>
          </div>
          {active.length === 0 && editing !== 'new' && (
            <div className="rpt-empty">還沒有使用中的供應商，按「新增供應商」建立。</div>
          )}
          {active.map(v => editing === v.vendorId ? editRow(v.vendorId) : (
            <div className="vendor-tr" key={v.vendorId} style={{ gridTemplateColumns: COLUMNS }}>
              <div className="vendor-name" style={{ fontSize: '16px' }}>{v.name}</div>
              <div className="vendor-phone mono">
                {v.phone ? (
                  <a href={`tel:${v.phone}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '12px' }}>📞</span> {v.phone}
                  </a>
                ) : <span className="dim">-</span>}
              </div>
              <div className="vendor-note dim">{v.note || '-'}</div>
              <div className="vendor-actions r">
                <button className="rpt-mini-btn" onClick={() => startEdit(v)}>編輯</button>
                <button className="rpt-mini-btn" style={{ marginLeft: '6px' }} onClick={() => deactivate(v)}>停用</button>
              </div>
            </div>
          ))}
          {editing === 'new' && editRow('new')}
        </div>

        {inactive.length > 0 && (
          <div style={{ marginTop: '24px' }}>
            <button className="ghost-btn" aria-expanded={showInactive} onClick={() => setShowInactive(s => !s)}>
              {showInactive ? '▾' : '▸'} 已停用（{inactive.length} 家）
            </button>
            {showInactive && (
              <div className="vendor-list" style={{ marginTop: '8px' }}>
                {inactive.map(v => (
                  <div className="vendor-tr" key={v.vendorId} style={{ gridTemplateColumns: COLUMNS }}>
                    <div className="vendor-name dim" style={{ fontSize: '16px' }}>{v.name} <span className="pill" style={{ fontSize: '11px' }}>已停用</span></div>
                    <div className="vendor-phone mono dim">{v.phone || '-'}</div>
                    <div className="vendor-note dim">{v.note || '-'}</div>
                    <div className="vendor-actions r">
                      <button className="rpt-mini-btn" onClick={() => reactivate(v)}>恢復</button>
                      <button className="rpt-mini-btn rpt-mini-del" style={{ marginLeft: '6px' }} onClick={() => { setNotice(''); setDeleteTarget(v); }}>永久刪除</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="永久刪除供應商"
        message={deleteMessage}
        confirmLabel="永久刪除"
        cancelLabel="取消"
        variant="danger"
        defaultAction="cancel"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
});
