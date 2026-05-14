import React, { useState, useMemo, useEffect } from "react";
import { fmt } from "./pos-components";
import type { LedgerTransaction } from '../domain/ledger';
import type { TodayMenu } from '../domain/menu';
import type { StudentAccount } from '../domain/student';
import type { Vendor } from '../domain/menu';
import {
  createLedgerDateRange,
  getEffectiveLedgerRows,
  calculateLedgerTotals,
  groupLedgerRowsByStudent,
  type LedgerDateRangeKind,
} from '../domain/ledgerReport';
import { ReportDateRangeControls } from './report/ReportDateRangeControls';
import { ReportSummaryStats } from './report/ReportSummaryStats';
import { LedgerGroupedTable } from './report/LedgerGroupedTable';
import { CashClosePanel } from './report/CashClosePanel';
import { ExportActions } from './report/ExportActions';
import { CorrectionDialog } from './report/CorrectionDialog';
import { VoidDialog } from './report/VoidDialog';
import { ReopenDialog } from './report/ReopenDialog';
import { usePosStore } from '../store/posStore';

interface ReportScreenProps {
  todayMenu: TodayMenu;
  viewDate: string;
  studentFilter?: string;
  onClearStudentFilter?: () => void;
}
export function ReportScreen({ todayMenu, viewDate, studentFilter, onClearStudentFilter }: ReportScreenProps) {
  const [dateRange, setDateRange] = useState<LedgerDateRangeKind>('today');
  const [customStart, setCustomStart] = useState(viewDate);
  const [customEnd, setCustomEnd] = useState(viewDate);
  const [expandedSids, setExpandedSids] = useState<Set<string>>(new Set());
  const [correctingTx, setCorrectingTx] = useState<LedgerTransaction | null>(null);
  const [voidingTx, setVoidingTx] = useState<LedgerTransaction | null>(null);
  const [showReopen, setShowReopen] = useState(false);
  const [studentSearch, setStudentSearch] = useState(studentFilter || '');

  const store = usePosStore();
  const dateStatus = store.getBusinessDateStatus(viewDate);
  const {
    closeBusinessDate,
    reopenBusinessDate,
    transactions,
  } = store;

  const range = useMemo(() => createLedgerDateRange(
    dateRange,
    viewDate,
    dateRange === 'custom' ? { startDate: customStart, endDate: customEnd } : undefined,
  ), [dateRange, viewDate, customStart, customEnd]);

  const effective = useMemo(() => getEffectiveLedgerRows(transactions), [transactions]);
  const filtered = useMemo(() =>
    effective.filter(t => t.businessDate >= range.startDate && t.businessDate <= range.endDate),
  [effective, range]);

  const totals = useMemo(() => calculateLedgerTotals(filtered), [filtered]);
  const groups = useMemo(() => groupLedgerRowsByStudent(filtered), [filtered]);

  // When studentFilter arrives from App, schedule auto-expand
  useEffect(() => {
    if (!studentFilter) return;
    const sid = studentFilter;
    const t = setTimeout(() => {
      setExpandedSids(prev => {
        if (prev.has(sid)) return prev;
        return new Set(prev).add(sid);
      });
    }, 0);
    return () => clearTimeout(t);
  }, [studentFilter]);

  const filteredGroups = useMemo(() => {
    if (!studentSearch.trim()) return groups;
    const q = studentSearch.toLowerCase();
    return groups.filter(g =>
      g.studentId.toLowerCase().includes(q) ||
      g.studentNameSnapshot.toLowerCase().includes(q)
    );
  }, [groups, studentSearch]);

  const hasQueuedRows = filtered.some(t => t.syncStatus === 'queued');
  const hasFailedConflict = filtered.some(t => t.syncStatus === 'failed' || t.syncStatus === 'conflict');

  const todayStr = useMemo(() => {
    const [, m, d] = viewDate.split('-');
    return `${parseInt(m)}/${parseInt(d)}`;
  }, [viewDate]);

  const toggleExpand = (sid: string) => {
    const next = new Set(expandedSids);
    if (next.has(sid)) next.delete(sid);
    else next.add(sid);
    setExpandedSids(next);
  };

  const handleCorrectSave = (txId: string, updates: Partial<LedgerTransaction>, reason: string) => {
    store.correctTransaction({ transactionId: txId, updates, reason, operatorId: 'op-report' });
    setCorrectingTx(null);
  };

  const handleVoidAction = (txId: string, reason: string) => {
    store.voidTransaction({ transactionId: txId, reason, operatorId: 'op-report' });
    setVoidingTx(null);
  };

  const handleHardDelete = (txId: string, reason: string) => {
    store.hardDeleteLocalDraft({ transactionId: txId, reason, operatorId: 'op-report' });
    setVoidingTx(null);
  };

  const handleCashClose = (countedCash: number, note: string) => {
    closeBusinessDate({ businessDate: viewDate, countedCash, note, queuedSettlementAccepted: true, operatorId: 'op-report' });
  };

  const handleReopen = (reason: string) => {
    reopenBusinessDate({ businessDate: viewDate, reason, operatorId: 'op-report' });
    setShowReopen(false);
  };

  return (
    <div className="screen report">
      <ReportDateRangeControls
        dateRange={dateRange}
        setDateRange={setDateRange}
        todayStr={todayStr}
        txCount={filtered.length}
        customStart={customStart}
        customEnd={customEnd}
        setCustomStart={setCustomStart}
        setCustomEnd={setCustomEnd}
      />

      <ReportSummaryStats totals={totals} itemName={todayMenu.itemName} />

      {dateStatus === 'closed' && (
        <button className="ghost-btn" style={{ marginBottom: '12px' }} onClick={() => setShowReopen(true)}>
          重新開啟日期
        </button>
      )}

      <CashClosePanel
        totals={totals}
        businessDate={viewDate}
        dateStatus={dateStatus}
        hasQueuedRows={hasQueuedRows}
        hasFailedConflict={hasFailedConflict}
        onClose={handleCashClose}
      />

      <ExportActions
        onExportCsv={() => {}}
        onPrint={() => window.print()}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <input
          className="adm-input"
          value={studentSearch}
          onChange={e => setStudentSearch(e.target.value)}
          placeholder="搜尋學員編號或姓名…"
          style={{ flex: '1', maxWidth: '280px' }}
        />
        {studentSearch && (
          <button className="ghost-btn" style={{ fontSize: '12px' }}
                  onClick={() => { setStudentSearch(''); onClearStudentFilter?.(); }}>
            清除
          </button>
        )}
      </div>

      <LedgerGroupedTable
        groups={filteredGroups}
        onToggleExpand={toggleExpand}
        expandedSids={expandedSids}
        onCorrectClick={setCorrectingTx}
        onVoidClick={setVoidingTx}
        dateStatus={dateStatus}
      />

      {correctingTx && (
        <CorrectionDialog
          tx={correctingTx}
          onSave={handleCorrectSave}
          onCancel={() => setCorrectingTx(null)}
        />
      )}

      {voidingTx && (
        <VoidDialog
          tx={voidingTx}
          onVoid={handleVoidAction}
          onHardDelete={handleHardDelete}
          onCancel={() => setVoidingTx(null)}
        />
      )}

      {showReopen && (
        <ReopenDialog
          businessDate={viewDate}
          onReopen={handleReopen}
          onCancel={() => setShowReopen(false)}
        />
      )}
    </div>
  );
}

// ============ Admin (today's menu only — no prepared count) ============
interface AdminScreenProps {
  todayMenu: TodayMenu;
  setTodayMenu: (menu: TodayMenu) => void;
  vendors: Vendor[];
  students: StudentAccount[];
  resetData: () => void;
}
export function AdminScreen({ todayMenu, setTodayMenu, vendors, students, resetData }: AdminScreenProps) {
  const [name, setName] = useState(todayMenu.itemName);
  const [price, setPrice] = useState(todayMenu.price);
  const [vendor, setVendor] = useState(todayMenu.vendorNameSnapshot);

  const save = () => setTodayMenu({ ...todayMenu, itemName: name, price: Number(price), vendorNameSnapshot: vendor });

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
            <input className="adm-input mono" type="number" value={price} onChange={e => setPrice(Number(e.target.value))} />
          </div>
          <div className="adm-row">
            <label>供應商</label>
            <select className="adm-input" value={vendor} onChange={e => setVendor(e.target.value)}>
              {vendors.map(v => <option key={v.vendorId} value={v.name}>{v.name} ({v.phone})</option>)}
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
              <div className="adm-stu adm-stu-2col" key={s.studentId}>
                <span className="mono adm-stu-id">{s.studentId}</span>
                <span className="adm-stu-name">{s.displayName}</span>
                <span className={'mono adm-stu-bal ' + (s.currentBalance < 0 ? 'warn' : '')}>
                  {s.currentBalance < 0 ? `欠 $${fmt(s.currentBalance)}` : `$${fmt(s.currentBalance)}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ Vendors ============
interface VendorsScreenProps {
  vendors: Vendor[];
  setVendors: (v: Vendor[]) => void;
}
export function VendorsScreen({ vendors, setVendors }: VendorsScreenProps) {
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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
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
}

// ============ Backup / Restore ============
export function BackupScreen() {
  const [step, setStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [op, setOp] = useState<keyof typeof opMeta | null>(null); // 'export-local' | 'import-local' | 'restore-cloud'

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

  const start = (kind: keyof typeof opMeta) => { setOp(kind); setStep(1); };
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

