// Report, Admin, Vendors, Backup screens (v2)
const { useState: useS2, useMemo: useM2 } = React;

function ReportScreen({ tx, setTx, todayMenu }) {
  const [filter, setFilter] = useS2('all');
  const [dateRange, setDateRange] = useS2('today'); // today | week | month | custom
  const [editingIdx, setEditingIdx] = useS2(null);
  const [draft, setDraft] = useS2(null);

  const filtered = useM2(() => {
    let list = tx;
    if (filter !== 'all') list = list.filter(t => t.type === filter);
    return list;
  }, [tx, filter]);

  const totals = useM2(() => {
    let order = 0, topup = 0, pay = 0, debt = 0;
    tx.forEach(t => {
      if (t.type === 'order') order += -t.amount;
      else if (t.type === 'topup') topup += t.amount;
      else if (t.type === 'pay' || t.type === 'order_pay') pay += t.amount;
      else if (t.type === 'debt') debt += -t.amount;
    });
    return { order, topup, pay, debt };
  }, [tx]);

  const orderCount = tx.filter(t => t.type === 'order' || t.type === 'order_pay' || t.type === 'debt').length;

  const filters = [
    { id: 'all',    label: '全部'   },
    { id: 'order',  label: '訂餐'   },
    { id: 'order_pay', label: '訂+繳' },
    { id: 'topup',  label: '儲值'   },
    { id: 'pay',    label: '繳費'   },
    { id: 'debt',   label: '記欠'   },
  ];

  const dates = [
    { id: 'today',  label: '今日 (5/7)' },
    { id: 'week',   label: '本週' },
    { id: 'month',  label: '本月' },
    { id: 'custom', label: '自訂…' },
  ];

  const startEdit = (idx, t) => {
    setEditingIdx(idx);
    setDraft({ amount: t.amount, note: t.note, type: t.type });
  };
  const saveEdit = () => {
    setTx(prev => prev.map((t, i) => i === editingIdx ? { ...t, ...draft } : t));
    setEditingIdx(null);
  };
  const cancelEdit = () => setEditingIdx(null);
  const deleteRow = (idx) => {
    if (!confirm('確定要刪除這筆紀錄?此動作會影響該學生餘額。')) return;
    setTx(prev => prev.filter((_, i) => i !== idx));
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
          {dateRange === 'today' && '今日 11:42 即時更新中 · 共 ' + tx.length + ' 筆'}
          {dateRange === 'week' && '本週 5/4–5/10 · 共 89 筆 (示意)'}
          {dateRange === 'month' && '本月 5/1–5/31 · 共 412 筆 (示意)'}
          {dateRange === 'custom' && '自訂區間 — 點此選擇日期'}
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
          <div className="stat-lbl">收現 (儲值+繳費)</div>
          <div className="stat-num mono accent">+${fmt(totals.topup + totals.pay)}</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">新增欠款</div>
          <div className="stat-num mono warn">${fmt(totals.debt)}</div>
        </div>
      </div>

      <div className="rpt-toolbar">
        <div className="rpt-filters">
          {filters.map(f => (
            <button key={f.id}
              className={'rpt-filter ' + (filter === f.id ? 'rpt-on' : '')}
              onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="rpt-actions">
          <button className="ghost-btn">列印</button>
          <button className="ghost-btn">匯出 CSV</button>
          <button className="ghost-btn ghost-strong">推送至雲端</button>
        </div>
      </div>

      <div className="rpt-table">
        <div className="rpt-th rpt-th-edit">
          <div>時間</div><div>編號</div><div>姓名</div><div>類別</div>
          <div className="r">金額</div><div className="r">餘額</div><div>備註</div><div>操作</div>
        </div>
        {filtered.map((t, i) => {
          const idx = tx.indexOf(t);
          const isEditing = editingIdx === idx;
          return (
            <div className={'rpt-tr rpt-tr-edit ' + (isEditing ? 'rpt-tr-editing' : '')} key={idx}>
              <div className="mono">{t.time}</div>
              <div className="mono">{t.sid}</div>
              <div>{t.name}</div>
              <div>
                {isEditing ? (
                  <select className="rpt-edit-input" value={draft.type} onChange={e => setDraft({...draft, type: e.target.value})}>
                    <option value="order">訂餐</option>
                    <option value="order_pay">訂+繳</option>
                    <option value="topup">儲值</option>
                    <option value="pay">繳費</option>
                    <option value="debt">記欠</option>
                  </select>
                ) : (
                  <span className={'pill pill-' + t.type}>{
                    t.type === 'order' ? '訂餐' :
                    t.type === 'order_pay' ? '訂+繳' :
                    t.type === 'topup' ? '儲值' :
                    t.type === 'pay' ? '繳費' :
                    t.type === 'debt' ? '記欠' : t.type
                  }</span>
                )}
              </div>
              <div className={'r mono ' + (t.amount > 0 ? 'pos' : 'neg')}>
                {isEditing ? (
                  <input type="number" className="rpt-edit-input mono r" value={draft.amount}
                         onChange={e => setDraft({...draft, amount: Number(e.target.value)})} />
                ) : (<>{sign(t.amount)}${fmt(t.amount)}</>)}
              </div>
              <div className="r mono dim">{t.after < 0 ? '−' : ''}${fmt(t.after)}</div>
              <div className="dim">
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
                    <button className="rpt-mini-btn" onClick={() => startEdit(idx, t)}>編輯</button>
                    <button className="rpt-mini-btn rpt-mini-del" onClick={() => deleteRow(idx)}>刪除</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="rpt-empty">無符合條件的紀錄</div>
        )}
      </div>
    </div>
  );
}

// ============ Admin (today's menu only — no prepared count) ============
function AdminScreen({ todayMenu, setTodayMenu, vendors }) {
  const [name, setName] = useS2(todayMenu.name);
  const [price, setPrice] = useS2(todayMenu.price);
  const [vendor, setVendor] = useS2(todayMenu.vendor);

  const save = () => setTodayMenu({ ...todayMenu, name, price: Number(price), vendor });

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
        </div>

        <div className="card adm-card">
          <div className="card-h">學員管理 <span className="card-h-sub">{STUDENTS.length} 人</span></div>
          <div className="adm-stu-list">
            {STUDENTS.slice(0, 10).map(s => (
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
function VendorsScreen({ vendors, setVendors }) {
  const [editing, setEditing] = useS2(null); // id of row being edited, or 'new'
  const [draft, setDraft] = useS2({ name:'', phone:'', note:'' });

  const startEdit = (v) => { setEditing(v.id); setDraft({ name: v.name, phone: v.phone, note: v.note || '' }); };
  const startNew  = () => { setEditing('new'); setDraft({ name:'', phone:'', note:'' }); };
  const cancel = () => { setEditing(null); };
  const save = () => {
    if (editing === 'new') {
      setVendors([...vendors, { id: 'v' + (vendors.length + 1), ...draft }]);
    } else {
      setVendors(vendors.map(v => v.id === editing ? { ...v, ...draft } : v));
    }
    setEditing(null);
  };
  const remove = (id) => setVendors(vendors.filter(v => v.id !== id));

  return (
    <div className="screen vendors">
      <div className="card vendors-card">
        <div className="card-h">
          <span>供應商列表 <span className="card-h-sub">{vendors.length} 家</span></span>
          <button className="ghost-btn ghost-strong" onClick={startNew}>＋ 新增供應商</button>
        </div>
        <div className="vendor-list">
          <div className="vendor-th">
            <div>名稱</div><div>電話</div><div>備註</div><div></div>
          </div>
          {vendors.map(v => editing === v.id ? (
            <div className="vendor-tr vendor-edit" key={v.id}>
              <input className="adm-input" value={draft.name} placeholder="供應商名稱"
                     onChange={e => setDraft({...draft, name: e.target.value})} />
              <input className="adm-input mono" value={draft.phone} placeholder="電話"
                     onChange={e => setDraft({...draft, phone: e.target.value})} />
              <input className="adm-input" value={draft.note} placeholder="備註"
                     onChange={e => setDraft({...draft, note: e.target.value})} />
              <div className="vendor-edit-btns">
                <button className="ghost-btn" onClick={cancel}>取消</button>
                <button className="ghost-btn ghost-strong" onClick={save}>儲存</button>
              </div>
            </div>
          ) : (
            <div className="vendor-tr" key={v.id}>
              <div className="vendor-name">{v.name}</div>
              <div className="vendor-phone mono">
                <a href={`tel:${v.phone}`}>📞 {v.phone}</a>
              </div>
              <div className="vendor-note dim">{v.note}</div>
              <div className="vendor-actions">
                <button className="ghost-btn" onClick={() => startEdit(v)}>編輯</button>
                <button className="ghost-btn vendor-del" onClick={() => remove(v.id)}>刪除</button>
              </div>
            </div>
          ))}
          {editing === 'new' && (
            <div className="vendor-tr vendor-edit">
              <input className="adm-input" value={draft.name} placeholder="供應商名稱" autoFocus
                     onChange={e => setDraft({...draft, name: e.target.value})} />
              <input className="adm-input mono" value={draft.phone} placeholder="電話"
                     onChange={e => setDraft({...draft, phone: e.target.value})} />
              <input className="adm-input" value={draft.note} placeholder="備註"
                     onChange={e => setDraft({...draft, note: e.target.value})} />
              <div className="vendor-edit-btns">
                <button className="ghost-btn" onClick={cancel}>取消</button>
                <button className="ghost-btn ghost-strong" onClick={save}>儲存</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ Backup / Restore ============
function BackupScreen() {
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

window.ReportScreen = ReportScreen;
window.AdminScreen = AdminScreen;
window.VendorsScreen = VendorsScreen;
window.BackupScreen = BackupScreen;
