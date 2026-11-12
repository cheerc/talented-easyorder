import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { ErrorBoundary, AppCrashPage } from './components/ErrorBoundary';
import { appendErrorLog } from './errors/errorLogger';
import { useTweaks } from './hooks/useTweaks';
import { FirebaseProvider } from './providers/FirebaseProvider';
import { useFirebase } from './hooks/useFirebase';
import { validateAppModeConfig } from './appMode';
import { AuthGate } from './auth/AuthGate';
import { useOperator } from './auth/OperatorContext';
import { useAutoSignOut } from './auth/autoSignOut';
import { AppShell } from './components/AppShell';
import { navigationKey, isCompositionKey } from './components/navigationKeys';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import { CloudOrdersPage } from './components/cloud/CloudOrdersPage';
import { CloudStudentsPage } from './components/cloud/CloudStudentsPage';
import { CloudDayVendorsPage } from './components/cloud/CloudDayVendorsPage';
import { CloudDayClosePage } from './components/cloud/CloudDayClosePage';
import { CloudLedgerAnomaliesPage } from './components/cloud/CloudLedgerAnomaliesPage';
import { CloudReportPage } from './components/cloud/CloudReportPage';
import { CloudAccountHistoryPage } from './components/cloud/CloudAccountHistoryPage';
import { CloudPendingRecoveryBoundary } from './components/cloud/CloudPendingRecoveryBoundary';
import { CloudDiagnosticsPage } from './components/cloud/CloudDiagnosticsPage';
import { CloudBackupPage } from './components/cloud/CloudBackupPage';
import type { CloudLedgerDateRange } from './domain/cloudLedgerReport';
import { useCloudLedger } from './hooks/useCloudLedger';
import type { OpeningMismatchAnomaly } from './domain/ledgerAnomalies';
import type { Firestore } from 'firebase/firestore';
import { TriangleAlert } from 'lucide-react';

type CloudSection = 'orders' | 'students' | 'day-vendors' | 'vendors' | 'day-close' | 'anomalies' | 'reports' | 'account-history' | 'diagnostics' | 'backup';

const CLOUD_SECTION_LABELS: Record<CloudSection, string> = {
  orders: '雲端櫃台點餐',
  students: '雲端學生管理',
  'day-vendors': '菜單與開帳',
  vendors: '供應商',
  'day-close': '雲端日結',
  anomalies: '帳務異常',
  reports: '雲端報表',
  'account-history': '雲端查帳',
  diagnostics: '雲端本機診斷',
  backup: '資料備份',
};

// 放在 AuthGate 之內：帳務異常只在已登入並持有使用權之後才從伺服器讀取。
function CloudSections({ db, leaseEpoch, identityKey, operatorUid, hasUnresolvedPendingCommands }: {
  db: Firestore;
  leaseEpoch: number;
  identityKey: string;
  /** 目前操作員的 UID；只用來在頁面上辨識「是不是自己」，不顯示。 */
  operatorUid: string;
  hasUnresolvedPendingCommands: boolean;
}) {
  const [cloudSection, setCloudSection] = useState<CloudSection>('students');
  const pageGenerationRef = useRef(0);
  const [pageGeneration, setPageGeneration] = useState(0);
  const [settingsTab, setSettingsTab] = useState<CloudSection>('day-vendors');
  const [accountTab, setAccountTab] = useState<CloudSection>('day-close');
  const [dayVendorGeneration, setDayVendorGeneration] = useState(0);
  const [ordersGeneration, setOrdersGeneration] = useState(0);
  const [leaveTarget, setLeaveTarget] = useState<{ section: CloudSection; dayId?: string; postCloseEntry?: OpeningMismatchAnomaly } | null>(null);
  const dirtyRef = useRef(false);
  const operator = useOperator();
  const { autoSignOutDue, noteAutoSignOut } = useFirebase();
  const { tweaks, setTweak } = useTweaks();
  const [dayCloseFocus, setDayCloseFocus] = useState<string | undefined>(undefined);
  const [postCloseEntryFocus, setPostCloseEntryFocus] = useState<OpeningMismatchAnomaly | undefined>(undefined);
  const [ordersFocus, setOrdersFocus] = useState<string | undefined>(undefined);
  const [viewDay, setViewDay] = useState<{ date: string; backfill: boolean } | null>(null);
  const onViewDayChange = useCallback((date: string, backfill: boolean) => setViewDay({ date, backfill }), []);
  const [accountHistoryStudentId, setAccountHistoryStudentId] = useState<string | null>(null);
  const [accountHistoryRange, setAccountHistoryRange] = useState<CloudLedgerDateRange | null>(null);
  const [navigationLocked, setNavigationLocked] = useState(false);
  const navigationLockRef = useRef<{ identityKey: string; locked: boolean; revoked: boolean } | null>(null);
  // #691 P9: the fixed eight hours end in the operator menu's normal sign-out, and wait while a command is unresolved.
  useAutoSignOut({ due: autoSignOutDue, locked: navigationLocked, signOut: operator?.signOut, onSigningOut: noteAutoSignOut });
  const { ledger, reload: reloadLedger } = useCloudLedger(db, `${identityKey}:${leaseEpoch}`);

  const reportNavigationState = useCallback((reportedKey: string, state: 'recovering' | 'revoked' | 'resolved') => {
    if (reportedKey !== identityKey || pageGenerationRef.current !== pageGeneration) return;
    const currentLock = navigationLockRef.current;
    const current = currentLock?.identityKey === reportedKey
      ? currentLock
      : { identityKey: reportedKey, locked: false, revoked: false };
    let locked = current.locked;
    let revoked = current.revoked;
    if (state === 'revoked') {
      revoked = true;
      locked = true;
    } else if (state === 'recovering') {
      locked = true;
    } else if (!revoked) {
      locked = false;
    }
    const lock = { identityKey: reportedKey, locked, revoked };
    navigationLockRef.current = lock;
    setNavigationLocked(lock.locked);
  }, [identityKey, pageGeneration]);
  const applySection = (section: CloudSection, dayId?: string, postCloseEntry?: OpeningMismatchAnomaly, reset = false) => {
    const dayVendorViews = ['day-vendors', 'vendors'];
    if (reset || !dayVendorViews.includes(section) || !dayVendorViews.includes(cloudSection)) {
      pageGenerationRef.current += 1;
      setPageGeneration(pageGenerationRef.current);
    }
    dirtyRef.current = false;
    if (section === 'orders') setViewDay(null);
    if (section === 'anomalies') reloadLedger();
    if (section === 'students' || section === 'day-vendors' || section === 'diagnostics' || section === 'backup') setSettingsTab(section);
    if (section === 'day-close' || section === 'reports') setAccountTab(section);
    setDayCloseFocus(section === 'day-close' ? dayId : undefined);
    setPostCloseEntryFocus(section === 'day-close' ? postCloseEntry : undefined);
    setOrdersFocus(section === 'orders' ? dayId : undefined);
    setCloudSection(section);
  };
  const selectSection = (section: CloudSection, dayId?: string, postCloseEntry?: OpeningMismatchAnomaly) => {
    if (navigationLockRef.current?.locked || leaveTarget || document.querySelector('.cloud-app')?.closest('[inert]') || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    const selectedOrder = cloudSection === 'orders' && !!document.querySelector('form[aria-label="訂餐"], form[aria-label="繳費"], form[aria-label="櫃台收支"]');
    if (section === cloudSection && !dayId && !postCloseEntry) {
      if (section === 'orders' && (dirtyRef.current || selectedOrder)) setLeaveTarget({ section });
      else if (section === 'orders') document.querySelector<HTMLInputElement>('#cloud-student-search')?.focus();
      return;
    }
    if (dirtyRef.current || selectedOrder) { setLeaveTarget({ section, dayId, postCloseEntry }); return; }
    applySection(section, dayId, postCloseEntry);
  };
  const selectPrimary = (id: string) => {
    if (id === 'pos') selectSection('orders');
    if (id === 'report') selectSection(accountTab);
    if (id === 'admin') selectSection(settingsTab);
    if (id === 'vendors') selectSection('vendors');
    if (id === 'history') selectSection('account-history');
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = navigationKey(event);
      if (key === null) return;
      event.preventDefault();
      if (isCompositionKey(event) || event.repeat) return;
      if (navigationLockRef.current?.locked || leaveTarget || document.querySelector('.cloud-app')?.closest('[inert]') || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      selectPrimary(['pos', 'report', 'admin', 'vendors', 'history'][key]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  // 原生 <details> 不會自己在點外部時收起（#704）。開著時，外部的 pointerdown 就收起；不搶焦點，焦點留在使用者點的位置。
  const operatorMenuRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const onPointerDown = (event: Event) => {
      const menu = operatorMenuRef.current;
      if (menu?.open && !menu.contains(event.target as Node)) menu.open = false;
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);
  const openAnomalies = () => selectSection('anomalies');
  const onDraftCleared = useCallback(() => { if (pageGenerationRef.current === pageGeneration) dirtyRef.current = false; }, [pageGeneration]);
  const common = { db, leaseEpoch, identityKey, onNavigationStateChange: reportNavigationState, onDraftCleared };
  const operatorSelf = useMemo(() => ({ uid: operatorUid, name: operator?.name ?? '' }), [operatorUid, operator?.name]);

  return (
    <main className="cloud-app" aria-label={CLOUD_SECTION_LABELS[cloudSection]} onChangeCapture={event => {
      const element = event.target as HTMLElement;
      if (element.closest('form') && !element.closest('.cloud-day-vendors__date-form, .cloud-day-close__date-form, .cloud-report__controls, .cloud-account-history__date-form')) dirtyRef.current = true;
    }}>
      <AppShell active={cloudSection === 'orders' ? 'pos' : cloudSection === 'day-close' || cloudSection === 'reports' ? 'report' : cloudSection === 'students' || cloudSection === 'day-vendors' || cloudSection === 'diagnostics' || cloudSection === 'backup' ? 'admin' : cloudSection === 'vendors' ? 'vendors' : cloudSection === 'account-history' ? 'history' : ''}
        select={selectPrimary} disabled={navigationLocked}
        brand={<div className="brand"><div className="brand-mark">●</div><div><div className="brand-name">訂餐櫃台</div><div className="brand-sub">{cloudSection === 'orders' && viewDay?.backfill ? <span className="backfill-badge">補登 {viewDay.date}</span> : cloudSection === 'orders' ? viewDay?.date ?? '營業日未確認' : ledger.status === 'ready' ? ledger.snapshot.today : '營業日未確認'}</div></div></div>}
        status={<div className="status">{ledger.status === 'ready' && ledger.snapshot.anomalies.length > 0 && <button disabled={navigationLocked} onClick={openAnomalies}><TriangleAlert size={14} aria-hidden="true" /> 異常 {ledger.snapshot.anomalies.length}</button>}
          <details ref={operatorMenuRef} className="operator-menu operator-strip" data-lease-epoch={leaseEpoch} onClick={event => { if ((event.target as HTMLElement).closest('button')) { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }} onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}><summary>{operator?.name ?? '操作員'}</summary><div className="operator-menu__panel">
            <button type="button" disabled={navigationLocked} onClick={openAnomalies}>帳務檢查</button>
            <label>主題 <select value={tweaks.theme} onChange={event => setTweak('theme', event.target.value)}><option value="warm">暖色</option><option value="light">淺色</option><option value="dark">深色</option></select></label>
            <p className="operator-menu__help">F1–F5 或 Alt／Option + 1–5 切換頁面；F5 已改為切換頁面，重新整理請按 Ctrl+R／Cmd+R。</p>
            <button type="button" disabled={navigationLocked} onClick={() => operator?.signOut()}>登出</button>
          </div></details></div>} />
      {(cloudSection === 'day-close' || cloudSection === 'reports') && <nav className="cloud-subnav" aria-label="今日帳"><button disabled={navigationLocked} aria-current={cloudSection === 'day-close' ? 'page' : undefined} onClick={() => selectSection('day-close')}>今日</button><button disabled={navigationLocked} aria-current={cloudSection === 'reports' ? 'page' : undefined} onClick={() => selectSection('reports')}>本週／本月</button></nav>}
      {(cloudSection === 'students' || cloudSection === 'day-vendors' || cloudSection === 'diagnostics' || cloudSection === 'backup') && <nav className="cloud-subnav" aria-label="今日設定"><button disabled={navigationLocked} aria-current={cloudSection === 'students' ? 'page' : undefined} onClick={() => selectSection('students')}>學生</button><button disabled={navigationLocked} aria-current={cloudSection === 'day-vendors' ? 'page' : undefined} onClick={() => selectSection('day-vendors')}>菜單與開帳</button><button disabled={navigationLocked} aria-current={cloudSection === 'diagnostics' ? 'page' : undefined} onClick={() => selectSection('diagnostics')}>本機診斷</button><button disabled={navigationLocked} aria-current={cloudSection === 'backup' ? 'page' : undefined} onClick={() => selectSection('backup')}>資料備份</button></nav>}
      <ConfirmDialog open={leaveTarget !== null} title="離開並捨棄草稿？" message="尚未送出的草稿會被捨棄。" defaultAction="cancel" confirmLabel="捨棄草稿" cancelLabel="取消離開" onCancel={() => setLeaveTarget(null)} onConfirm={() => { if (leaveTarget && !navigationLockRef.current?.locked) { setDayVendorGeneration(value => value + 1); if (leaveTarget.section === 'orders' && cloudSection === 'orders') setOrdersGeneration(value => value + 1); applySection(leaveTarget.section, leaveTarget.dayId, leaveTarget.postCloseEntry, true); } setLeaveTarget(null); }} />
      {cloudSection === 'orders' ? (
        <CloudOrdersPage key={ordersGeneration} {...common} initialBackfillDayId={ordersFocus} onViewDayChange={onViewDayChange} onOpenSettings={() => selectSection('day-vendors')} />
      ) : cloudSection === 'students' ? (
        <CloudStudentsPage {...common} />
      ) : cloudSection === 'day-vendors' || cloudSection === 'vendors' ? (
        <CloudDayVendorsPage key={dayVendorGeneration} view={cloudSection === 'vendors' ? 'vendors' : 'day'} {...common} operatorSelf={operatorSelf} ledger={ledger} onOpenAnomalies={openAnomalies} onLedgerChanged={reloadLedger} />
      ) : cloudSection === 'day-close' ? (
        <CloudDayClosePage
          {...common}
          operatorSelf={operatorSelf}
          ledger={ledger}
          onOpenAnomalies={openAnomalies}
          onLedgerChanged={reloadLedger}
          initialDayId={dayCloseFocus}
          initialPostCloseEntry={postCloseEntryFocus}
          onOpenOrders={dayId => selectSection('orders', dayId)}
          hasUnresolvedPendingCommands={hasUnresolvedPendingCommands}
        />
      ) : cloudSection === 'reports' ? (
        <CloudReportPage
          key={`${identityKey}:${leaseEpoch}`}
          {...common}
          operatorSelf={operatorSelf}
          onOpenDayClose={dayId => selectSection('day-close', dayId)}
          onOpenAccountHistory={(studentId, range) => {
            setAccountHistoryStudentId(studentId);
            setAccountHistoryRange(range);
            selectSection('account-history');
          }}
        />
      ) : cloudSection === 'account-history' ? (
        <CloudAccountHistoryPage
          key={`${identityKey}:${leaseEpoch}`}
          {...common}
          operatorSelf={operatorSelf}
          initialStudentId={accountHistoryStudentId}
          initialRange={accountHistoryRange}
        />
      ) : cloudSection === 'diagnostics' ? (
        <CloudDiagnosticsPage key={`${identityKey}:${leaseEpoch}`} identityKey={identityKey} leaseEpoch={leaseEpoch} />
      ) : cloudSection === 'backup' ? (
        <CloudBackupPage key={`${identityKey}:${leaseEpoch}`} identityKey={identityKey} onNavigationStateChange={reportNavigationState} hasUnresolvedPendingCommands={hasUnresolvedPendingCommands} />
      ) : (
        <CloudLedgerAnomaliesPage
          ledger={ledger}
          onReload={reloadLedger}
          onOpenDayClose={dayId => selectSection('day-close', dayId)}
          onOpenPostCloseEntry={anomaly => selectSection('day-close', anomaly.previousClosedDayId, anomaly)}
        />
      )}
    </main>
  );
}

function CloudBrowserKeyGuard() {
  useEffect(() => {
    const intercept = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && /^F[1-6]$/.test(event.key)) event.preventDefault();
      if (navigationKey(event) !== null) event.preventDefault();
    };
    window.addEventListener('keydown', intercept, true);
    return () => window.removeEventListener('keydown', intercept, true);
  }, []);
  return null;
}

function CloudAppContent() {
  const { fb, fbError, storageCleanupError, access, lease } = useFirebase();
  // 與本機模式共用 U1 顯示偏好（easyorder-ui-tweaks）：主題與字級套在 body 上。
  useTweaks();

  if (fbError) return <InitializationProblemPage message={fbError} />;
  if (storageCleanupError) return <InitializationProblemPage message={storageCleanupError} />;
  if (!fb) {
    return <div className="app-loading" aria-label="載入中"><div className="app-loading-spinner" />載入中...</div>;
  }

  return (
    <ErrorBoundary fallback={<AppCrashPage />} onError={(error) => appendErrorLog({ source: 'react', message: error.message, stack: error.stack })}>
      <AuthGate auth={fb.auth} db={fb.db} access={access} showOperatorStrip={false}>
        <CloudBrowserKeyGuard />
        {access.ok && (
          <CloudPendingRecoveryBoundary
            db={fb.db}
            uid={access.profile.uid}
            leaseEpoch={lease.epoch}
          >
            {hasUnresolvedPendingCommands => (
              <CloudSections
                key={`${access.profile.uid}:${lease.epoch}`}
                db={fb.db}
                leaseEpoch={lease.epoch}
                identityKey={`${access.profile.uid}:${lease.epoch}`}
                operatorUid={access.profile.uid}
                hasUnresolvedPendingCommands={hasUnresolvedPendingCommands}
              />
            )}
          </CloudPendingRecoveryBoundary>
        )}
      </AuthGate>
    </ErrorBoundary>
  );
}

function InitializationProblemPage({ message }: { message: string }) {
  return (
    <main className="auth-gate" aria-label="本機資料清理狀態">
      <h1>Talented EasyOrder</h1>
      <p role="alert">{message}</p>
      <button type="button" onClick={() => window.location.reload()}>重新載入</button>
    </main>
  );
}

function AppModeContent() {
  const config = validateAppModeConfig(import.meta.env);
  if (!config.ok) {
    return (
      <main className="auth-gate" aria-label="Firebase 設定錯誤">
        <h1>Talented EasyOrder</h1>
        <p role="alert">{config.error}</p>
      </main>
    );
  }
  return <CloudAppContent />;
}

export default function App() {
  return (
    <FirebaseProvider>
      <AppModeContent />
    </FirebaseProvider>
  );
}

