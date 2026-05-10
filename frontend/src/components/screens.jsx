import React from "react";

// Report, Admin, Vendors, Backup screens (v2)
import { fmt, sign } from "./pos-components";

import {  useState as useS2, useMemo as useM2  } from "react";

export function ReportScreen({ tx, onUpdate, onDelete, todayMenu, viewDate }) {
  const [dateRange, setDateRange] = useS2('today');
  const [expandedSids, setExpandedSids] = useS2(new Set());
  const [editingId, setEditingId] = useS2(null); // t.id for editing
  const [draft, setDraft] = useS2(null);

  const toggleExpand = (sid) => {
    const next = new Set(expandedSids);
    if (next.has(sid)) next.delete(sid);
    else next.add(sid);
    setExpandedSids(next);
  };

  const totals = useM2(() => {
    let order = 0, topup = 0, debt = 0;
    tx.forEach(t => {
      const mP = t.mealPrice || 0;
      const pA = t.paidAmount || 0;
      if (t.type === 'order') order += mP;
      if (pA > 0) topup += pA;
      if (t.type === 'order' && mP > pA) debt += (mP - pA);
    });
    return { order, topup, debt };
  }, [tx]);

  const grouped = useM2(() => {
    const map = new Map();
    tx.forEach(t => {
      if (!map.has(t.sid)) {
        map.set(t.sid, {
          sid: t.sid,
          name: t.name,
          mealPrice: 0,
          paidAmount: 0,
          after: 0,
          lastTime: '',
          txs: []
        });
      }
      const g = map.get(t.sid);
      g.mealPrice += (t.mealPrice || 0);
      g.paidAmount += (t.paidAmount || 0);
      g.after = t.after; // Assume tx are in order, so last one is current
      g.lastTime = t.time;
      g.txs.push(t);
    });
    return Array.from(map.values()).reverse(); // Latest student activity first
  }, [tx]);

  const orderCount = tx.filter(t => t.type === 'order').length;

  const todayStr = useM2(() => {
    if (!viewDate) return '';
    const [y, m, d] = viewDate.split('-');
    return `${parseInt(m)}/${parseInt(d)}`;
  }, [viewDate]);

  const dates = [
    { id: 'today',  label: `今日 (${todayStr})` },
    { id: 'week',   label: '本週' },
    { id: 'month',  label: '本月' },
    { id: 'custom', label: '自訂…' },
  ];

  const startEdit = (e, t) => {
    e.stopPropagation();
    setEditingId(t.id);
    setDraft({ ...t });
  };
  const saveEdit = (e) => {
    e.stopPropagation();
    onUpdate(editingId, draft);
    setEditingId(null);
  };
  const cancelEdit = (e) => {
    e.stopPropagation();
    setEditingId(null);
  };
  const deleteRow = (e, tid) => {
    e.stopPropagation();
    if (!confirm('確定要刪除這筆紀錄?')) return;
    onDelete(tid);
  };

  return (
    <div className="screen report">
      <div className="rpt-daterange">
        {dates.map(d => (
          <button key={d.id}
            className={'rpt-date ' + (dateRange === d.id ? 'rpt-on' : '')}
            onClick={() => setDateRange(d.id)}>
            {d.label}
          </button>
        ))}
        <div className="rpt-date-meta dim">
          {dateRange === 'today' && '今日 11:42 即時更新中 · 共 ' + tx.length + ' 筆交易'}
        </div>
      </div>

      <div className="rpt-stats">
        <div className="stat stat-strong">
          <div className="stat-lbl">訂餐</div>
          <div className="stat-num mono">{orderCount}<span className="stat-of"> 份</span></div>
          <div className="stat-sub">{todayMenu.name}</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">訂餐金額</div>
          <div className="stat-num mono">${fmt(totals.order)}</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">收現總額</div>
          <div className="stat-num mono accent">+${fmt(totals.topup)}</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">新增欠款</div>
          <div className="stat-num mono warn">${fmt(totals.debt)}</div>
        </div>
      </div>

      <div className="rpt-toolbar">
        <div className="rpt-actions">
          <button className="ghost-btn">列印</button>
          <button className="ghost-btn">匯出 CSV</button>
          <button className="ghost-btn ghost-strong">推送至雲端</button>
        </div>
      </div>

      <div className="rpt-table">
        <div className="rpt-th" style={{ gridTemplateColumns: '80px 60px 100px 1fr 1fr 1fr auto' }}>
          <div>最後時間</div><div>編號</div><div>姓名</div>
          <div className="r">當日應付</div><div className="r">當日實收</div><div className="r">目前餘額</div><div className="r">狀態</div>
        </div>
        {grouped.map(g => {
          const isExpanded = expandedSids.has(g.sid);
          return (
            <React.Fragment key={g.sid}>
              <div className={'rpt-tr ' + (isExpanded ? 'expanded-head' : '')} 
                   onClick={() => toggleExpand(g.sid)}
                   style={{ gridTemplateColumns: '80px 60px 100px 1fr 1fr 1fr auto', cursor: 'pointer' }}>
                <div className="mono dim">{g.lastTime}</div>
                <div className="mono">{g.sid}</div>
                <div style={{ fontWeight: '600' }}>{g.name}</div>
                <div className="r mono neg">{g.mealPrice > 0 ? `−$${fmt(g.mealPrice)}` : '-'}</div>
                <div className="r mono pos">{g.paidAmount > 0 ? `+$${fmt(g.paidAmount)}` : '-'}</div>
                <div className="r mono">{g.after < 0 ? '−' : ''}${fmt(g.after)}</div>
                <div className="r">
                  <span className="pill" style={{ fontSize: '10px', background: isExpanded ? 'var(--ink)' : 'var(--line-2)', color: isExpanded ? '#fff' : 'var(--ink-3)' }}>
                    {g.txs.length} 筆紀錄 {isExpanded ? '▴' : '▾'}
                  </span>
                </div>
              </div>
              
              {isExpanded && (
                <div className="rpt-details">
                  {g.txs.slice().reverse().map(t => {
                    const isEditing = editingId === t.id;
                    return (
                      <div key={t.id} className={'rpt-detail-row ' + (isEditing ? 'rpt-tr-editing' : '')}>
                        <div className="mono dim">{t.time}</div>
                        <div className="dim">{t.type === 'order' ? '訂餐' : t.type === 'topup' ? '儲值' : '取消'}</div>
                        <div className={'r mono ' + (t.mealPrice > 0 ? 'neg' : t.mealPrice < 0 ? 'pos' : '')}>
                          {isEditing ? (
                            <input type="number" className="rpt-edit-input mono r" value={draft.mealPrice}
                                   onChange={e => setDraft({...draft, mealPrice: Number(e.target.value)})} />
                          ) : (t.mealPrice !== 0 ? <>{t.mealPrice > 0 ? '−' : '+'}${fmt(Math.abs(t.mealPrice))}</> : <>-</>)}
                        </div>
                        <div className={'r mono ' + (t.paidAmount > 0 ? 'pos' : '')}>
                          {isEditing ? (
                            <input type="number" className="rpt-edit-input mono r" value={draft.paidAmount}
                                   onChange={e => setDraft({...draft, paidAmount: Number(e.target.value)})} />
                          ) : (t.paidAmount > 0 ? <>+${fmt(t.paidAmount)}</> : <>-</>)}
                        </div>
                        <div className="dim italic" style={{ fontSize: '12px' }}>
                          {isEditing ? (
                            <input className="rpt-edit-input" value={draft.note}
                                   onChange={e => setDraft({...draft, note: e.target.value})} />
                          ) : t.note}
                        </div>
                        <div className="rpt-row-actions">
                          {isEditing ? (
                            <>
                              <button className="rpt-mini-btn" onClick={cancelEdit}>取消</button>
                              <button className="rpt-mini-btn rpt-mini-strong" onClick={saveEdit}>儲存</button>
                            </>
                          ) : (
                            <>
                              <button className="rpt-mini-btn" onClick={(e) => startEdit(e, t)}>編輯</button>
                              <button className="rpt-mini-btn rpt-mini-del" onClick={(e) => deleteRow(e, t.id)}>刪除</button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </React.Fragment>
          );
        })}
        {grouped.length === 0 && (
          <div className="rpt-empty">今日尚無交易紀錄</div>
        )}
      </div>
    </div>
  );
}

// ============ Admin (today's menu only — no prepared count) ============
export function AdminScreen({ todayMenu, setTodayMenu, vendors, students, resetData }) {
  const [name, setName] = useS2(todayMenu.name);
  const [price, setPrice] = useS2(todayMenu.price);
  const [vendor, setVendor] = useS2(todayMenu.vendor);

  const save = () => setTodayMenu({ ...todayMenu, name, price: Number(price), vendor });

  const handleReset = () => {
    if (confirm('確定要清空所有交易紀錄並重置為範例數據嗎？')) {
      resetData();
      alert('已完成重置！');
      window.location.reload(); // Force reload to clear any local state
    }
  };

  return (
    <div className="screen admin">
      <div className="admin-grid admin-grid-2">
        <div className="card adm-card">
          <div className="card-h">今日便當設定</div>
          <div className="adm-row">
            <label>便當名稱</label>
            <input className="adm-input" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="adm-row">
            <label>單價 (元)</label>
            <input className="adm-input mono" type="number" value={price} onChange={e => setPrice(e.target.value)} />
          </div>
          <div className="adm-row">
            <label>供應商</label>
            <select className="adm-input" value={vendor} onChange={e => setVendor(e.target.value)}>
              {vendors.map(v => <option key={v.id} value={v.name}>{v.name} ({v.phone})</option>)}
            </select>
          </div>
          <div className="adm-foot">
            <button className="btn-confirm wide" onClick={save}>儲存今日設定</button>
          </div>

          <div style={{ marginTop: '40px', borderTop: '1px solid #eee', paddingTop: '20px' }}>
            <div className="card-h" style={{ color: '#d32f2f' }}>危險區域</div>
            <p className="dim" style={{ fontSize: '13px', marginBottom: '10px' }}>這會清空目前的所有快取資料，重置為系統初始狀態。</p>
            <button className="rpt-mini-btn rpt-mini-del wide" style={{ height: '40px' }} onClick={handleReset}>重置系統數據 (Reset)</button>
          </div>
        </div>

        <div className="card adm-card">
          <div className="card-h">學員管理 <span className="card-h-sub">{students.length} 人</span></div>
          <div className="adm-stu-list">
            {students.slice(0, 10).map(s => (
              <div className="adm-stu adm-stu-2col" key={s.id}>
                <span className="mono adm-stu-id">{s.id}</span>
                <span className="adm-stu-name">{s.name}</span>
                <span className={'mono adm-stu-bal ' + (s.balance < 0 ? 'warn' : '')}>
                  {s.balance < 0 ? `欠 $${fmt(s.balance)}` : `$${fmt(s.balance)}`}
                </span>
              </div>
            ))}
            <button className="ghost-btn ghost-wide">查看全部 / 新增學員</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ Vendors ============
export function VendorsScreen({ vendors, setVendors }) {
  const [editing, setEditing] = useS2(null); // id of row being edited, or 'new'
  const [draft, setDraft] = useS2({ name:'', phone:'', note:'' });

  const startEdit = (v) => { setEditing(v.id); setDraft({ ...v }); };
  const startNew  = () => { setEditing('new'); setDraft({ name:'', phone:'', note:'' }); };
  const cancel    = () => setEditing(null);
  const save = () => {
    if (!draft.name.trim()) return alert('請輸入供應商名稱');
    if (editing === 'new') {
      setVendors([...vendors, { ...draft, id: Date.now().toString() }]);
    } else {
      setVendors(vendors.map(v => v.id === editing ? { ...v, ...draft } : v));
    }
    setEditing(null);
  };
  const remove = (id) => {
    if (confirm('確定要刪除此供應商嗎？')) {
      setVendors(vendors.filter(v => v.id !== id));
    }
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
          {vendors.map(v => editing === v.id ? (
            <div className="vendor-tr vendor-edit" key={v.id} style={{ gridTemplateColumns: '1.4fr 1.2fr 2fr 120px', margin: '8px 0', border: '1px solid var(--accent)', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
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
            <div className="vendor-tr" key={v.id} style={{ gridTemplateColumns: '1.4fr 1.2fr 2fr 120px' }}>
              <div className="vendor-name" style={{ fontSize: '16px' }}>{v.name}</div>
              <div className="vendor-phone mono">
                <a href={`tel:${v.phone}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '12px' }}>📞</span> {v.phone}
                </a>
              </div>
              <div className="vendor-note dim">{v.note || '-'}</div>
              <div className="vendor-actions r">
                <button className="rpt-mini-btn" onClick={() => startEdit(v)}>編輯</button>
                <button className="rpt-mini-btn rpt-mini-del" style={{ marginLeft: '6px' }} onClick={() => remove(v.id)}>刪除</button>
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
    </div>
  );
}

// ============ Backup / Restore ============
export function BackupScreen() {
  const [step, setStep] = useS2(0);
  const [progress, setProgress] = useS2(0);
  const [op, setOp] = useS2(null); // 'export-local' | 'import-local' | 'restore-cloud'

  React.useEffect(() => {
    if (step !== 2) return;
    const t = setInterval(() => {
      setProgress(p => {
        if (p >= 100) { clearInterval(t); setStep(3); return 100; }
        return p + 5;
      });
    }, 60);
    return () => clearInterval(t);
  }, [step]);

  const start = (kind) => { setOp(kind); setStep(1); };
  const go    = () => { setProgress(0); setStep(2); };
  const reset = () => { setStep(0); setOp(null); setProgress(0); };

  const opMeta = {
    'export-local': { title: '匯出本地備份',  desc: '將目前的 SQLite 資料庫匯出為 .json 檔。', danger: false, btn: '匯出檔案' },
    'import-local': { title: '匯入本地備份',  desc: '從 .json 檔還原資料庫。會覆蓋目前所有資料。', danger: true, btn: '選擇檔案並匯入' },
    'restore-cloud':{ title: '從雲端還原 (DR)', desc: '從 Google Sheets 完整下載並重建本地 SQLite。會覆蓋目前所有資料。', danger: true, btn: '我了解,開始還原' },
  };

  return (
    <div className="screen backup">
      {step === 0 && (
        <div className="bk-cards">
          <div className="card bk-card" onClick={() => start('export-local')}>
            <div className="bk-icon">⬇</div>
            <div className="bk-h">匯出本地備份</div>
            <div className="bk-sub">下載一份 .json 檔做為手動備份。建議每日下班前執行一次。</div>
            <div className="bk-meta mono">最後匯出 · 2026/05/06 18:32</div>
          </div>
          <div className="card bk-card" onClick={() => start('import-local')}>
            <div className="bk-icon">⬆</div>
            <div className="bk-h">匯入本地備份</div>
            <div className="bk-sub">從之前匯出的 .json 檔還原。會覆蓋目前資料。</div>
            <div className="bk-meta dim">小心使用 · 此動作無法復原</div>
          </div>
          <div className="card bk-card bk-card-cloud" onClick={() => start('restore-cloud')}>
            <div className="bk-icon">☁︎</div>
            <div className="bk-h">從雲端還原 (DR)</div>
            <div className="bk-sub">PC 毀損後使用。從 Google Sheets 完整下載並重建本地 SQLite。</div>
            <div className="bk-meta mono">雲端最後更新 · 2026/05/07 11:42</div>
          </div>
        </div>
      )}

      {step >= 1 && op && (
        <div className="card bk-flow">
          <div className="bk-flow-h">{opMeta[op].title}</div>
          <div className="bk-flow-sub">{opMeta[op].desc}</div>

          <div className="rest-meta">
            <div className="rest-meta-row"><span>本地資料筆數</span><span className="mono">12,847</span></div>
            <div className="rest-meta-row"><span>本地最後備份</span><span className="mono">2026/05/06 18:32:14</span></div>
            <div className="rest-meta-row"><span>雲端最後更新</span><span className="mono">2026/05/07 11:42:08</span></div>
          </div>

          {step === 1 && (
            <>
              {opMeta[op].danger && <div className="rest-warn">⚠ 此動作會覆蓋本地資料,無法復原</div>}
              <div className="rest-btns">
                <button className="btn-cancel wide" onClick={reset}>取消</button>
                <button className={'btn-confirm wide ' + (opMeta[op].danger ? 'danger' : '')} onClick={go}>
                  {opMeta[op].btn}
                </button>
              </div>
            </>
          )}
          {step === 2 && (
            <div className="rest-prog">
              <div className="rest-prog-bar"><div className="rest-prog-fill" style={{ width: `${progress}%` }}></div></div>
              <div className="rest-prog-txt mono">{progress}%  ‧  處理中…</div>
            </div>
          )}
          {step === 3 && (
            <div className="rest-done">
              <div className="rest-done-tick">✓</div>
              <div className="rest-done-h">完成</div>
              <div className="rest-done-sub">{op === 'export-local' ? '備份檔已下載 (bento-backup-20260507.json)' : '本地資料庫已重建。'}</div>
              <button className="btn-confirm wide" onClick={reset}>返回</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

