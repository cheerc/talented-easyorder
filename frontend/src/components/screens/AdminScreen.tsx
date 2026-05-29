import React, { useState } from "react";
import { NumericInput } from '../ui/NumericInput';
import { fmt } from "../pos-components";
import type { TodayMenu } from '../../domain/menu';
import type { StudentAccount } from '../../domain/student';
import type { Vendor } from '../../domain/menu';
import { ConfirmDialog } from '../ui/ConfirmDialog';

interface AdminScreenProps {
  todayMenu: TodayMenu;
  setTodayMenu: (menu: TodayMenu) => void;
  vendors: Vendor[];
  students: StudentAccount[];
  resetData: () => void;
  openingCash: number;
  dateStatus: string;
  hasCashSession: boolean;
  onOpeningCashChange: (amount: number) => void;
  onUpdateOpeningCash: (amount: number) => void;
  tweaks: { theme: string; fontSize: string; disableHoverSelection: boolean };
  setTweak: (k: string, v: string) => void;
}
export const AdminScreen = React.memo(function AdminScreen({ todayMenu, setTodayMenu, vendors, students, resetData, openingCash, dateStatus, hasCashSession, onOpeningCashChange, onUpdateOpeningCash, tweaks, setTweak }: AdminScreenProps) {
  const [name, setName] = useState(todayMenu.itemName);
  const [price, setPrice] = useState(todayMenu.price);
  const [vendor, setVendor] = useState(todayMenu.vendorNameSnapshot);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [openingCashDraft, setOpeningCashDraft] = useState(String(openingCash));
  const [cashSavedMsg, setCashSavedMsg] = useState('');
  const [showOpeningCashConfirm, setShowOpeningCashConfirm] = useState(false);

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
    setTimeout(() => setCashSavedMsg(''), 2000);
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
