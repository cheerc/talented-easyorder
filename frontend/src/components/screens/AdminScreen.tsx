import React, { useState, useCallback, useRef, useEffect } from "react";
import { NumericInput } from '../ui/NumericInput';
import { fmt } from "../pos-components";
import type { StudentAccount } from '../../domain/student';
import { validateNewAccount, createLocalAccount, NEW_ACCOUNT_ERROR_MESSAGES, type NewAccountError } from '../../domain/student';
import { isMenuReady } from '../../domain/menu';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useMenu, useMenuActions, useStudents, useGlobalActions, useSessionActions, usePracticeDataActions, useTransactions } from '../../store/selectors';
import { isPrototypeMode } from '../../appMode';
import { useCashClose } from '../../store/derived/useCashClose';
import { useTweaks } from '../../hooks/useTweaks';
import { useFirebase } from '../../hooks/useFirebase';
import { SYSTEM_OPERATOR_ID } from '../../domain/operatorId';
import { getTaiwanISOString } from '../../utils/dateTime';

interface AdminScreenProps {
  viewDate: string;
}
export const AdminScreen = React.memo(function AdminScreen({ viewDate }: AdminScreenProps) {
  const { todayMenu, vendors } = useMenu();
  const { fb, access } = useFirebase();
  // M0：未連 Firebase（本機練習或無 env）時顯示練習資料與手動建帳戶。
  const isLocal = !fb;
  // Ref: #336 — Real operator UID for audit trail
  const operatorUid = (access.ok && access.profile?.uid) ? access.profile.uid : SYSTEM_OPERATOR_ID;
  const { setTodayMenu } = useMenuActions();
  const { students } = useStudents();
  const { resetData } = useGlobalActions();
  const { startBlankData, loadSampleData } = usePracticeDataActions();
  const { transactions } = useTransactions();
  const [practiceConfirm, setPracticeConfirm] = useState<'blank' | 'sample' | null>(null);
  const { openCashSession, updateOpeningCash } = useSessionActions();
  const { openingCash, dateStatus, currentCashSession } = useCashClose(viewDate);
  const hasCashSession = !!currentCashSession;
  const { tweaks, setTweak } = useTweaks();

  // Wrapper callbacks (moved from AppRouter — reviewer finding #1)
  const onOpeningCashChange = useCallback((amount: number) => {
    openCashSession({ businessDate: viewDate, openingCash: amount, operatorId: operatorUid, openedAt: getTaiwanISOString() });
  }, [viewDate, openCashSession, operatorUid]);

  const onUpdateOpeningCash = useCallback((amount: number) => {
    updateOpeningCash(viewDate, amount);
  }, [viewDate, updateOpeningCash]);
  const [name, setName] = useState(todayMenu.itemName);
  const [price, setPrice] = useState(todayMenu.price);
  const [vendor, setVendor] = useState(todayMenu.vendorNameSnapshot || vendors[0]?.name || '');

  // M0：切換空白／範例後，表單草稿跟著目前的菜單與供應商。
  useEffect(() => {
    setName(todayMenu.itemName);
    setPrice(todayMenu.price);
    setVendor(todayMenu.vendorNameSnapshot || vendors[0]?.name || '');
  }, [todayMenu, vendors]);
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

  // Ref: #347 — DRY validation helpers for financial input guards
  const isPositiveInt = (n: number) => Number.isFinite(n) && Number.isSafeInteger(n) && n > 0;
  const isNonNegativeInt = (n: number) => Number.isFinite(n) && Number.isSafeInteger(n) && n >= 0;

  const save = () => {
    const n = Number(price);
    // Ref: #311, #347 — Financial input validation
    if (!isPositiveInt(n)) return;
    const selectedVendor = vendors.find(v => v.name === vendor);
    setTodayMenu({ ...todayMenu, itemName: name, price: n, vendorId: selectedVendor?.vendorId ?? todayMenu.vendorId, vendorNameSnapshot: vendor });
  };

  const handlePracticeConfirm = () => {
    if (practiceConfirm === 'blank') startBlankData();
    if (practiceConfirm === 'sample') loadSampleData();
    setPracticeConfirm(null);
  };

  const practiceSteps = [
    { done: students.length > 0, label: '建立帳戶（右側「學員管理」）' },
    { done: vendors.length > 0, label: '新增供應商（F4 供應商）' },
    { done: isMenuReady(todayMenu), label: '設定今日晚餐（上方「今日便當設定」）' },
    { done: hasCashSession, label: '設定開帳金額（上方「每日開帳金額」）' },
  ];

  const handleReset = () => {
    resetData();
    setShowResetConfirm(false);
    window.location.reload();
  };

  const doSaveOpeningCash = () => {
    const n = Number(openingCashDraft);
    // Ref: #311, #347 — Financial input validation
    if (!isNonNegativeInt(n)) return;
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
    // Ref: #311, #347 — Financial input validation
    if (!isNonNegativeInt(n)) return;
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

          {isLocal ? (
            <div style={{ marginTop: '40px', borderTop: '1px solid var(--line)', paddingTop: '20px' }} aria-label="練習資料">
              <div className="card-h">練習資料 <span className="card-h-sub">{isPrototypeMode ? '本機練習 · 僅此瀏覽器' : '本機模式 · 未連雲端'}</span></div>
              <p className="dim" style={{ fontSize: '13px', marginBottom: '10px' }}>
                目前：{students.length} 位帳戶、{vendors.length} 家供應商、{transactions.length} 筆交易
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="ghost-btn" onClick={() => setPracticeConfirm('blank')}>從空白開始…</button>
                <button className="ghost-btn" onClick={() => setPracticeConfirm('sample')}>載入驗收範例…</button>
              </div>
              <div className="card-h" style={{ marginTop: '16px', fontSize: '13px' }}>開始訂餐前的準備</div>
              <ol style={{ fontSize: '13px', margin: '4px 0 0', paddingLeft: '20px' }} aria-label="開始訂餐前的準備">
                {practiceSteps.map(step => (
                  <li key={step.label} style={{ color: step.done ? 'var(--ink-3)' : 'inherit' }}>
                    {step.done ? '✓ ' : ''}{step.label}
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <div style={{ marginTop: '40px', borderTop: '1px solid #eee', paddingTop: '20px' }}>
              <div className="card-h" style={{ color: '#d32f2f' }}>危險區域</div>
              <p className="dim" style={{ fontSize: '13px', marginBottom: '10px' }}>這會清空目前的所有快取資料，重置為系統初始狀態。</p>
              <button className="rpt-mini-btn rpt-mini-del wide" style={{ height: '40px' }} onClick={() => setShowResetConfirm(true)}>重置系統數據 (Reset)</button>
            </div>
          )}
        </div>

        <div className="card adm-card">
          <div className="card-h">學員管理 <span className="card-h-sub">{students.length} 人</span></div>
          {isLocal && <NewAccountForm students={students} asOfDate={viewDate} />}
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
        open={practiceConfirm !== null}
        title={practiceConfirm === 'blank' ? '從空白開始' : '載入驗收範例'}
        message={`將清除目前的 ${students.length} 位帳戶、${vendors.length} 家供應商、${transactions.length} 筆交易，以及更正、關帳與開帳紀錄，`
          + (practiceConfirm === 'blank' ? '改成完全空白的資料。' : '改成固定的匿名驗收範例。')
          + '此動作無法復原；匯出快照功能尚未提供。按取消不會變更任何資料。'}
        onConfirm={handlePracticeConfirm}
        onCancel={() => setPracticeConfirm(null)}
        confirmLabel={practiceConfirm === 'blank' ? '確認清空' : '確認載入範例'}
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

// M0：本機手動建帳戶。編號保留原字串，期初必須明確輸入（0 也要填）。
const NewAccountForm = React.memo(function NewAccountForm({ students, asOfDate }: { students: StudentAccount[]; asOfDate: string }) {
  const { addLocalStudent } = usePracticeDataActions();
  const [studentId, setStudentId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [openingText, setOpeningText] = useState('');
  const [openingNote, setOpeningNote] = useState('');
  const [errors, setErrors] = useState<NewAccountError[]>([]);
  const [message, setMessage] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = validateNewAccount({ studentId, displayName, openingBalanceText: openingText, openingNote }, students);
    if (!result.ok) {
      setErrors(result.errors);
      setMessage('');
      return;
    }
    addLocalStudent(createLocalAccount({
      studentId: result.studentId,
      displayName: result.displayName,
      openingBalance: result.openingBalance,
      openingNote,
      asOfDate,
    }, new Date().toISOString()));
    setErrors([]);
    setMessage(result.sameNameIds.length > 0
      ? `已新增 ${result.studentId} ${result.displayName}。注意：與編號 ${result.sameNameIds.join('、')} 同名，訂餐時請以編號區分。`
      : `已新增 ${result.studentId} ${result.displayName}，期初 $${fmt(result.openingBalance)}。`);
    setStudentId('');
    setDisplayName('');
    setOpeningText('');
    setOpeningNote('');
  };

  return (
    <form onSubmit={submit} aria-label="新增帳戶" style={{ marginBottom: '16px', paddingBottom: '16px', borderBottom: '1px solid var(--line)' }}>
      <div className="adm-row">
        <label htmlFor="new-account-id">帳戶編號</label>
        <input id="new-account-id" className="adm-input mono" value={studentId} onChange={e => setStudentId(e.target.value)} placeholder="例如 001" />
      </div>
      <div className="adm-row">
        <label htmlFor="new-account-name">姓名</label>
        <input id="new-account-name" className="adm-input" value={displayName} onChange={e => setDisplayName(e.target.value)} />
      </div>
      <div className="adm-row">
        <label htmlFor="new-account-opening">期初餘額 (元)</label>
        <input id="new-account-opening" className="adm-input mono" inputMode="numeric" value={openingText} onChange={e => setOpeningText(e.target.value)} placeholder="沒有就填 0，欠款填負數" />
      </div>
      <div className="adm-row">
        <label htmlFor="new-account-note">期初備註</label>
        <input id="new-account-note" className="adm-input" value={openingNote} onChange={e => setOpeningNote(e.target.value)} placeholder="選填，例如：紙本結餘" />
      </div>
      {errors.length > 0 && (
        <ul role="alert" style={{ color: 'var(--red)', fontSize: '13px', margin: '4px 0', paddingLeft: '20px' }}>
          {errors.map(code => <li key={code}>{NEW_ACCOUNT_ERROR_MESSAGES[code]}</li>)}
        </ul>
      )}
      {message && <p role="status" style={{ color: 'var(--accent-ink)', fontSize: '13px', margin: '4px 0' }}>{message}</p>}
      <div className="adm-foot">
        <button type="submit" className="btn-confirm wide">新增帳戶</button>
      </div>
    </form>
  );
});
