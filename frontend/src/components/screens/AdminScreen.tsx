import React, { useState, useCallback, useRef, useEffect } from "react";
import { NumericInput } from '../ui/NumericInput';
import { fmt } from "../pos-components";
import type { StudentAccount } from '../../domain/student';
import { validateNewAccount, createLocalAccount, parseAliases, NEW_ACCOUNT_ERROR_MESSAGES, type NewAccountError } from '../../domain/student';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { OpeningCashConfirmDialog } from '../admin/OpeningCashConfirmDialog';
import { useMenu, useMenuForDate, useMenuActions, useStudents, useGlobalActions, useSessionActions, usePracticeDataActions } from '../../store/selectors';
import { PracticeDataPanel } from './PracticeDataPanel';
import { FaceTabletSimulator } from './FaceTabletSimulator';
import { useCashClose } from '../../store/derived/useCashClose';
import { useTweaks } from '../../hooks/useTweaks';
import { useFirebase } from '../../hooks/useFirebase';
import { SYSTEM_OPERATOR_ID } from '../../domain/operatorId';
import { getTaiwanISOString } from '../../utils/dateTime';
import { filterActiveVendors, resolveMenuVendor } from '../../domain/menu';
import { faceEnrollmentText } from '../../domain/faceOrder';
import { validateOpeningCash } from '../../domain/cashSession';
import { RefundDialog } from '../pos/RefundDialog';
import type { LedgerMutationResult } from '../../domain/ledgerAudit';

interface AdminScreenProps {
  viewDate: string;
  /** U4：F3 名單列的退款入口（含停用帳戶，不必先恢復）。寫入失敗回傳失敗結果。 */
  onRefund?: (studentId: string, amount: number, reason: string) => LedgerMutationResult;
  /** 退款對話框開關回報，讓 App 把退款框納入背景快捷鍵 guard。 */
  onRefundDialogOpenChange?: (open: boolean) => void;
}
export const AdminScreen = React.memo(function AdminScreen({ viewDate, onRefund, onRefundDialogOpenChange }: AdminScreenProps) {
  const { vendors } = useMenu();
  // M0：晚餐設定依營業日保存；編輯的是目前檢視的營業日。
  const resolvedMenu = useMenuForDate(viewDate);
  const todayMenu = resolvedMenu.menu;
  const { fb, access } = useFirebase();
  // M0：未連 Firebase（本機練習或無 env）時顯示練習資料與手動建帳戶。
  const isLocal = !fb;
  // Ref: #336 — Real operator UID for audit trail
  const operatorUid = (access.ok && access.profile?.uid) ? access.profile.uid : SYSTEM_OPERATOR_ID;
  const { setMenuForDate } = useMenuActions();
  const { students } = useStudents();
  const { resetData } = useGlobalActions();
  const { openCashSession, updateOpeningCash } = useSessionActions();
  const { openingCash, suggestedOpeningCash, dateStatus, currentCashSession } = useCashClose(viewDate);
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
  // M3 F4：供應商以編號選，只列使用中的；這天菜單的供應商已停用或刪除時不預選，並提醒改選。
  const menuVendor = resolveMenuVendor(todayMenu, vendors);
  const activeVendors = filterActiveVendors(vendors);
  const [vendorId, setVendorId] = useState(menuVendor.vendorId);

  // M0：切換空白／範例後，表單草稿跟著目前的菜單與供應商。
  useEffect(() => {
    setName(todayMenu.itemName);
    setPrice(todayMenu.price);
    setVendorId(resolveMenuVendor(todayMenu, vendors).vendorId);
  }, [todayMenu, vendors]);
  const [menuSavedMsg, setMenuSavedMsg] = useState('');
  // 切換檢視日期時清掉上一天的「已儲存」提示（render 期間調整，避免 effect 連鎖更新）。
  const [menuError, setMenuError] = useState('');
  const [openingCashError, setOpeningCashError] = useState('');
  const [menuMsgDate, setMenuMsgDate] = useState(viewDate);
  if (menuMsgDate !== viewDate) {
    setMenuMsgDate(viewDate);
    setMenuSavedMsg('');
    setMenuError('');
    setOpeningCashError('');
  }
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  // M3：開帳金額只預填，不自動生效；沒有設定時預填建議值（重開日用上次關帳的開帳金額，否則用前一天關帳點算），本人按儲存才算數。
  const initialCashDraft = String(openingCash ?? suggestedOpeningCash?.amount ?? '');
  const [openingCashDraft, setOpeningCashDraft] = useState(initialCashDraft);
  // 換日期，或還原快照、重開帳讓建議值改變時，重新預填（render 期間調整）。
  const cashDraftKey = `${viewDate}|${initialCashDraft}`;
  const [cashDraftSource, setCashDraftSource] = useState(cashDraftKey);
  if (cashDraftSource !== cashDraftKey) {
    setCashDraftSource(cashDraftKey);
    setOpeningCashDraft(initialCashDraft);
  }
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

  const save = () => {
    const n = Number(price);
    // M3 D01：名稱空白或單價不合法時不存，並說明原因；以前會顯示「已儲存」但 F1 仍不能訂餐。
    const errors: string[] = [];
    if (!name.trim()) errors.push('請填寫便當名稱。');
    // Ref: #311, #347 — Financial input validation
    if (!isPositiveInt(n)) errors.push('單價要是大於 0 的整數。');
    if (errors.length > 0) {
      setMenuError(errors.join(''));
      setMenuSavedMsg('');
      return;
    }
    setMenuError('');
    // 下拉只有使用中的供應商；選「未指定」時不帶供應商。
    const selectedVendor = activeVendors.find(v => v.vendorId === vendorId);
    setMenuForDate(viewDate, { itemName: name.trim(), price: n, vendorId: selectedVendor?.vendorId ?? '', vendorNameSnapshot: selectedVendor?.name ?? '' }, getTaiwanISOString());
    setMenuSavedMsg(`已儲存 ${viewDate} 的晚餐`);
  };

  const handleReset = () => {
    resetData();
    setShowResetConfirm(false);
    window.location.reload();
  };

  const doSaveOpeningCash = () => {
    const trimmed = openingCashDraft.trim();
    if (trimmed === '') {
      setOpeningCashError('開帳金額必須是 0 或正整數');
      setShowOpeningCashConfirm(false);
      return;
    }
    const n = Number(trimmed);
    const validation = validateOpeningCash(n);
    if (!validation.ok) {
      setOpeningCashError(validation.reason);
      setShowOpeningCashConfirm(false);
      return;
    }
    if (hasCashSession) {
      onUpdateOpeningCash(n);
    } else {
      onOpeningCashChange(n);
    }
    setShowOpeningCashConfirm(false);
    setOpeningCashError('');
    setCashSavedMsg('已儲存');
    if (cashSavedTimeoutRef.current !== null) clearTimeout(cashSavedTimeoutRef.current);
    cashSavedTimeoutRef.current = setTimeout(() => { setCashSavedMsg(''); cashSavedTimeoutRef.current = null; }, 2000);
  };

  const handleSaveOpeningCash = () => {
    const trimmed = openingCashDraft.trim();
    if (trimmed === '') {
      setOpeningCashError('開帳金額必須是 0 或正整數');
      return;
    }
    const n = Number(trimmed);
    const validation = validateOpeningCash(n);
    if (!validation.ok) {
      setOpeningCashError(validation.reason);
      return;
    }
    setOpeningCashError('');
    if (n === openingCash) return;
    setShowOpeningCashConfirm(true);
  };

  return (
    <div className="screen admin">
      <div className="admin-grid admin-grid-2">
        <div className="card adm-card">
          <div className="card-h">今日便當設定 <span className="card-h-sub mono">{viewDate}</span></div>
          {resolvedMenu.source === 'none' && (
            <p className="dim" style={{ fontSize: '12px', margin: '0 0 8px' }}>這天之前還沒有設定晚餐；儲存後才可訂餐。</p>
          )}
          {resolvedMenu.source === 'inherited' && (
            <p className="dim" style={{ fontSize: '12px', margin: '0 0 8px' }}>這天還沒有自己的設定，目前沿用 {resolvedMenu.fromDate} 的晚餐；儲存後只改這一天起的菜單。</p>
          )}
          <div className="adm-row">
            <label>便當名稱</label>
            <input className="adm-input" aria-label="便當名稱" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="adm-row">
            <label>單價 (元)</label>
            <NumericInput className="adm-input mono" aria-label="便當單價" value={price} onChange={v => setPrice(Number(v))} />
          </div>
          <div className="adm-row">
            <label>供應商</label>
            <select className="adm-input" aria-label="供應商" value={vendorId} onChange={e => setVendorId(e.target.value)}>
              <option value="">（未指定）</option>
              {activeVendors.map(v => <option key={v.vendorId} value={v.vendorId}>{v.name}{v.phone ? ` (${v.phone})` : ''}</option>)}
            </select>
          </div>
          {menuVendor.unavailableName && (
            <p role="note" style={{ fontSize: '12px', margin: '0 0 8px', color: 'var(--c-warn)' }}>
              這天的晚餐設定用的供應商「{menuVendor.unavailableName}」已停用或刪除，請改選供應商後儲存。已登記的訂單不受影響。
            </p>
          )}
          <div className="adm-foot">
            <button className="btn-confirm wide" onClick={save}>儲存今日設定</button>
            {menuError && <span role="alert" style={{ marginLeft: '8px', color: 'var(--c-warn)', fontSize: '13px' }}>{menuError}</span>}
            {menuSavedMsg && <span role="status" style={{ marginLeft: '8px', color: 'var(--accent-ink)', fontSize: '13px' }}>{menuSavedMsg}</span>}
          </div>

          <div style={{ marginTop: '32px', borderTop: '1px solid var(--line)', paddingTop: '20px' }}>
            <div className="card-h">每日開帳金額</div>
            <div className="adm-row">
              <label>開帳金額 (元)</label>
              <NumericInput
                className="adm-input mono"
                aria-label="開帳金額"
                value={openingCashDraft}
                onChange={v => {
                  setOpeningCashDraft(v);
                  if (openingCashError) setOpeningCashError('');
                }}
                disabled={isClosed}
              />
            </div>
            <div className="adm-foot">
              <button className="btn-confirm wide" onClick={handleSaveOpeningCash} disabled={isClosed}>
                儲存開帳金額
              </button>
              {openingCashError && (
                <span role="alert" style={{ marginLeft: '8px', color: 'var(--c-warn)', fontSize: '13px' }}>
                  {openingCashError}
                </span>
              )}
              {cashSavedMsg && <span style={{ marginLeft: '8px', color: 'var(--accent-ink)', fontSize: '13px' }}>{cashSavedMsg}</span>}
            </div>
            <p className="dim" style={{ fontSize: '12px', margin: '8px 0 0' }}>
              {openingCash !== null
                ? `${viewDate} 的開帳金額：$${openingCash.toLocaleString()}`
                : suggestedOpeningCash !== null
                  ? `${viewDate} 還沒設定開帳金額。已預填${suggestedOpeningCash.source === 'same_day' ? '這一天上次關帳用的開帳金額' : '前一天關帳點算的'} $${suggestedOpeningCash.amount.toLocaleString()}，確認後按「儲存開帳金額」。`
                  : `${viewDate} 還沒設定開帳金額；設定後才能關帳。`}
            </p>
          </div>

          <div style={{ marginTop: '32px', borderTop: '1px solid var(--line)', paddingTop: '20px' }}>
            <div className="card-h">顯示設定</div>
            <div className="adm-row">
              <label htmlFor="tweak-theme">主題</label>
              <select
                id="tweak-theme"
                aria-label="主題"
                className="adm-input"
                value={tweaks.theme}
                onChange={e => setTweak('theme', e.target.value)}
              >
                <option value="light">亮色</option>
                <option value="dark">深色</option>
                <option value="warm">暖色</option>
              </select>
            </div>
            <div className="adm-row">
              <label htmlFor="tweak-scale">字體大小</label>
              <select
                id="tweak-scale"
                aria-label="字體大小"
                className="adm-input"
                value={tweaks.scale}
                onChange={e => setTweak('scale', e.target.value)}
              >
                <option value="normal">普通</option>
                <option value="large">大字</option>
              </select>
            </div>
            <div className="adm-row">
              <label htmlFor="tweak-hover">停用滑鼠 hover 選取</label>
              <select
                id="tweak-hover"
                aria-label="停用滑鼠 hover 選取"
                className="adm-input"
                value={tweaks.disableHoverSelection ? 'true' : 'false'}
                onChange={e => setTweak('disableHoverSelection', e.target.value)}
              >
                <option value="false">啟用</option>
                <option value="true">停用</option>
              </select>
            </div>
          </div>

          {isLocal ? (
            <>
              <PracticeDataPanel hasCashSession={hasCashSession} />
              <FaceTabletSimulator businessDate={viewDate} />
            </>
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
          <StudentList students={students} editable={isLocal} onRefund={onRefund} onRefundDialogOpenChange={onRefundDialogOpenChange} />
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
      <OpeningCashConfirmDialog
        open={showOpeningCashConfirm}
        hasCashSession={hasCashSession}
        draftAmount={Number(openingCashDraft)}
        suggestedOpeningCash={suggestedOpeningCash}
        onConfirm={doSaveOpeningCash}
        onCancel={() => setShowOpeningCashConfirm(false)}
      />
    </div>
  );
});

const PAGE_SIZE = 10;

const StudentList = React.memo(function StudentList({ students, editable = false, onRefund, onRefundDialogOpenChange }: {
  students: StudentAccount[];
  editable?: boolean;
  onRefund?: (studentId: string, amount: number, reason: string) => LedgerMutationResult;
  onRefundDialogOpenChange?: (open: boolean) => void;
}) {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [refundStudentId, setRefundStudentId] = useState<string | null>(null);
  const { setLocalStudentStatus } = usePracticeDataActions();
  const refundStudent = refundStudentId ? students.find(s => s.studentId === refundStudentId) ?? null : null;

  const filtered = search.trim()
    ? students.filter(s => s.studentId.includes(search.trim()) || s.displayName.includes(search.trim()) || s.aliases.some(a => a.includes(search.trim())))
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
        {paged.map(s => editingId === s.studentId ? (
          <StudentEditRow key={s.studentId} student={s} onDone={() => setEditingId(null)} />
        ) : (
          <div className={editable ? 'adm-stu' : 'adm-stu adm-stu-2col'} key={s.studentId} data-testid={`student-row-${s.studentId}`}>
            <span className="mono adm-stu-id">{s.studentId}</span>
            <span className="adm-stu-name" style={s.status === 'inactive' ? { color: 'var(--ink-3)' } : undefined}>
              {s.displayName}
              {s.aliases.length > 0 && <span className="dim" style={{ fontWeight: 400, marginLeft: '6px' }}>（{s.aliases.join('、')}）</span>}
              {s.status === 'inactive' && <span className="adm-stu-grade" style={{ marginLeft: '6px' }}>已停用</span>}
            </span>
            {/* 人臉註冊狀態由刷臉平板回報，這裡唯讀 */}
            <span className="adm-stu-face" data-testid={`student-face-${s.studentId}`} title="人臉註冊狀態（由刷臉平板回報，唯讀）">
              <span className="dim">人臉 </span>{faceEnrollmentText(s)}
            </span>
            <span className={'mono adm-stu-bal ' + (s.currentBalance < 0 ? 'warn' : '')}>
              {s.currentBalance < 0 ? `欠 $${fmt(s.currentBalance)}` : `$${fmt(s.currentBalance)}`}
            </span>
            {editable && (
              <span className="adm-stu-actions">
                <button className="ghost-btn" aria-label={`編輯 ${s.studentId}`} onClick={() => setEditingId(s.studentId)}>編輯</button>
                {onRefund && (
                  <button
                    className="ghost-btn"
                    aria-label={`退款 ${s.studentId}`}
                    disabled={s.currentBalance <= 0}
                    title={s.currentBalance <= 0 ? '目前無餘額可退' : '從帳戶退還現金給學生'}
                    onClick={() => { setRefundStudentId(s.studentId); onRefundDialogOpenChange?.(true); }}
                  >
                    退款
                  </button>
                )}
                <button
                  className="ghost-btn"
                  aria-label={`${s.status === 'active' ? '停用' : '恢復'} ${s.studentId}`}
                  onClick={() => setLocalStudentStatus(s.studentId, s.status === 'active' ? 'inactive' : 'active', new Date().toISOString())}
                >
                  {s.status === 'active' ? '停用' : '恢復'}
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
      {refundStudent && onRefund && (
        <RefundDialog
          open={!!refundStudent}
          student={refundStudent}
          onConfirm={(amt, reason) => {
            const result = onRefund(refundStudent.studentId, amt, reason);
            if (result.ok) {
              setRefundStudentId(null);
              onRefundDialogOpenChange?.(false);
            }
            return result;
          }}
          onCancel={() => { setRefundStudentId(null); onRefundDialogOpenChange?.(false); }}
        />
      )}
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

// M0：修改姓名與別名。交易內的姓名快照不會跟著改。
const StudentEditRow = React.memo(function StudentEditRow({ student, onDone }: { student: StudentAccount; onDone: () => void }) {
  const { updateLocalStudent } = usePracticeDataActions();
  const [displayName, setDisplayName] = useState(student.displayName);
  const [aliasText, setAliasText] = useState(student.aliases.join('、'));
  const [error, setError] = useState('');

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const name = displayName.trim();
    if (!name) { setError('請輸入姓名'); return; }
    updateLocalStudent(student.studentId, { displayName: name, aliases: parseAliases(aliasText, name) }, new Date().toISOString());
    onDone();
  };

  return (
    <form onSubmit={save} aria-label={`編輯帳戶 ${student.studentId}`} style={{ padding: '9px 0', borderBottom: '1px solid var(--line-2)' }}>
      <div className="adm-row">
        <label htmlFor={`edit-name-${student.studentId}`}>{student.studentId} 姓名</label>
        <input id={`edit-name-${student.studentId}`} className="adm-input" value={displayName} onChange={e => setDisplayName(e.target.value)} />
      </div>
      <div className="adm-row">
        <label htmlFor={`edit-alias-${student.studentId}`}>別名</label>
        <input id={`edit-alias-${student.studentId}`} className="adm-input" value={aliasText} onChange={e => setAliasText(e.target.value)} placeholder="多個別名以逗號或頓號分隔，例如：小明、Ming" />
      </div>
      {error && <p role="alert" style={{ color: 'var(--red)', fontSize: '13px', margin: '4px 0' }}>{error}</p>}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button type="submit" className="ghost-btn">儲存</button>
        <button type="button" className="ghost-btn" onClick={onDone}>取消</button>
      </div>
    </form>
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
