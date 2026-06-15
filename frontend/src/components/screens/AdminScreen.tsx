import React, { useState, useCallback, useRef, useEffect } from "react";
import { NumericInput } from '../ui/NumericInput';
import { fmt } from "../pos-components";
import type { StudentAccount } from '../../domain/student';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useMenu, useMenuActions, useStudents, useGlobalActions, useSessionActions } from '../../store/selectors';
import { useCashClose } from '../../store/derived/useCashClose';
import { useTweaks } from '../../hooks/useTweaks';

interface AdminScreenProps {
  viewDate: string;
}
export const AdminScreen = React.memo(function AdminScreen({ viewDate }: AdminScreenProps) {
  const { todayMenu, vendors } = useMenu();
  const { setTodayMenu } = useMenuActions();
  const { students } = useStudents();
  const { resetData } = useGlobalActions();
  const { openCashSession, updateOpeningCash } = useSessionActions();
  const { openingCash, dateStatus, currentCashSession } = useCashClose(viewDate);
  const hasCashSession = !!currentCashSession;
  const { tweaks, setTweak } = useTweaks();

  // Wrapper callbacks (moved from AppRouter — reviewer finding #1)
  const onOpeningCashChange = useCallback((amount: number) => {
    openCashSession({ businessDate: viewDate, openingCash: amount, operatorId: 'admin', openedAt: new Date().toISOString() });
  }, [viewDate, openCashSession]);

  const onUpdateOpeningCash = useCallback((amount: number) => {
    updateOpeningCash(viewDate, amount);
  }, [viewDate, updateOpeningCash]);
  const [name, setName] = useState(todayMenu.itemName);
  const [price, setPrice] = useState(todayMenu.price);
  const [vendor, setVendor] = useState(todayMenu.vendorNameSnapshot);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [openingCashDraft, setOpeningCashDraft] = useState(String(openingCash));
  const [cashSavedMsg, setCashSavedMsg] = useState('');
  const [showOpeningCashConfirm, setShowOpeningCashConfirm] = useState(false);

  // Ref: #294 — Store timeout ID for cleanup on unmount.
  const cashSavedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (cashSavedTimeoutRef.current !== null) clearTimeout(cashSavedTimeoutRef.current);
    };
  }, []);

  const isClosed = dateStatus === 'closed';
  const save = () => {
    const n = Number(price);
    if (!Number.isSafeInteger(n) || n <= 0) return;
    setTodayMenu({ ...todayMenu, itemName: name, price: n, vendorNameSnapshot: vendor });
  };

  const handleReset = () => {
    resetData();
    setShowResetConfirm(false);
    window.location.reload();
  };

  const doSaveOpeningCash = () => {
    const n = Number(openingCashDraft);
    if (!Number.isSafeInteger(n) || n < 0) return;
    if (hasCashSession) {
      onUpdateOpeningCash(n);
    } else {
      onOpeningCashChange(n);
    }
    setShowOpeningCashConfirm(false);
    setCashSavedMsg('已儲存');
    if (cashSavedTimeoutRef.current !== null) clearTimeout(cashSavedTimeoutRef.current);
    cashSavedTimeoutRef.current = setTimeout(() => { setCashSavedMsg(''); cashSavedTimeoutRef.current = null; }, 2000);
  };

  const handleSaveOpeningCash = () => {
    const n = Number(openingCashDraft);
    if (!Number.isSafeInteger(n) || n < 0) return;
    if (n === openingCash) return;
    setShowOpeningCashConfirm(true);
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
            <NumericInput className="adm-input mono" aria-label="便當單價" value={price} onChange={v => setPrice(Number(v))} />
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

          <div style={{ marginTop: '32px', borderTop: '1px solid var(--line)', paddingTop: '20px' }}>
            <div className="card-h">每日開帳金額</div>
            <div className="adm-row">
              <label>開帳金額 (元)</label>
              <NumericInput className="adm-input mono" aria-label="開帳金額" value={openingCashDraft} onChange={setOpeningCashDraft} disabled={isClosed} />
            </div>
            <div className="adm-foot">
              <button className="btn-confirm wide" onClick={handleSaveOpeningCash} disabled={isClosed}>
                儲存開帳金額
              </button>
              {cashSavedMsg && <span style={{ marginLeft: '8px', color: 'var(--accent-ink)', fontSize: '13px' }}>{cashSavedMsg}</span>}
            </div>
          </div>

          <div style={{ marginTop: '32px', borderTop: '1px solid var(--line)', paddingTop: '20px' }}>
            <div className="card-h">顯示設定</div>
            <div className="adm-row">
              <label>主題</label>
              <select className="adm-input" value={tweaks.theme} onChange={e => setTweak('theme', e.target.value)}>
                <option value="light">亮色</option>
                <option value="dark">深色</option>
                <option value="warm">暖色</option>
              </select>
            </div>
            <div className="adm-row">
              <label>字體大小</label>
              <select className="adm-input" value={tweaks.fontSize} onChange={e => setTweak('fontSize', e.target.value)}>
                <option value="md">普通</option>
                <option value="lg">大字</option>
              </select>
            </div>
            <div className="adm-row">
              <label>停用滑鼠 hover 選取</label>
              <select className="adm-input" value={tweaks.disableHoverSelection ? 'true' : 'false'} onChange={e => setTweak('disableHoverSelection', e.target.value)}>
                <option value="true">停用 (預設)</option>
                <option value="false">啟用 (傳統行為)</option>
              </select>
            </div>
          </div>

          <div style={{ marginTop: '40px', borderTop: '1px solid #eee', paddingTop: '20px' }}>
            <div className="card-h" style={{ color: '#d32f2f' }}>危險區域</div>
            <p className="dim" style={{ fontSize: '13px', marginBottom: '10px' }}>這會清空目前的所有快取資料，重置為系統初始狀態。</p>
            <button className="rpt-mini-btn rpt-mini-del wide" style={{ height: '40px' }} onClick={() => setShowResetConfirm(true)}>重置系統數據 (Reset)</button>
          </div>
        </div>

        <div className="card adm-card">
          <div className="card-h">學員管理 <span className="card-h-sub">{students.length} 人</span></div>
          <StudentList students={students} />
        </div>
      </div>
      <ConfirmDialog
        open={showResetConfirm}
        title="重置系統數據"
        message="確定要清空所有交易紀錄並重置為範例數據嗎？重置後將重新載入頁面。"
        onConfirm={handleReset}
        onCancel={() => setShowResetConfirm(false)}
        confirmLabel="確認重置"
        variant="danger"
      />
      <ConfirmDialog
        open={showOpeningCashConfirm}
        title={hasCashSession ? "修改開帳金額" : "設定開帳金額"}
        message={hasCashSession
          ? "修改開帳金額會影響今日所有帳務計算，確定要繼續嗎？"
          : `確定要將今日開帳金額設為 $${Number(openingCashDraft).toLocaleString()} 嗎？`}
        onConfirm={doSaveOpeningCash}
        onCancel={() => setShowOpeningCashConfirm(false)}
        confirmLabel={hasCashSession ? "確認修改" : "確認設定"}
        variant={hasCashSession ? "danger" : "primary"}
      />
    </div>
  );
});

const PAGE_SIZE = 10;

const StudentList = React.memo(function StudentList({ students }: { students: StudentAccount[] }) {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');

  const filtered = search.trim()
    ? students.filter(s => s.studentId.includes(search.trim()) || s.displayName.includes(search.trim()))
    : students;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <>
      <div style={{ marginBottom: '8px' }}>
        <input
          className="adm-input"
          aria-label="搜尋學員"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0); }}
          placeholder="搜尋學員編號或姓名…"
          style={{ width: '100%', boxSizing: 'border-box' }}
        />
      </div>
      <div className="adm-stu-list">
        {paged.map(s => (
          <div className="adm-stu adm-stu-2col" key={s.studentId}>
            <span className="mono adm-stu-id">{s.studentId}</span>
            <span className="adm-stu-name">{s.displayName}</span>
            <span className={'mono adm-stu-bal ' + (s.currentBalance < 0 ? 'warn' : '')}>
              {s.currentBalance < 0 ? `欠 $${fmt(s.currentBalance)}` : `$${fmt(s.currentBalance)}`}
            </span>
          </div>
        ))}
      </div>
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginTop: '12px' }}>
          <button className="ghost-btn" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>上一頁</button>
          <span style={{ fontSize: '13px', color: 'var(--ink-2)' }}>{safePage + 1} / {totalPages}</span>
          <button className="ghost-btn" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>下一頁</button>
        </div>
      )}
    </>
  );
});
