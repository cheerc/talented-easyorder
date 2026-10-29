import { useEffect, useState, type ReactNode } from 'react';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { signInWithGoogle, signOutOperator, type OperatorAccess } from '../firebase/authService';
import {
  LEASE_RECHECK_THROTTLE_MS,
  type ActiveLeaseState,
  type LeaseResult,
} from '../firebase/activeAccountLease';
import { useFirebase } from '../providers/FirebaseProvider';
import { OperatorContext } from './OperatorContext';

export interface AuthGateProps {
  showOperatorStrip?: boolean;
  auth: Auth;
  db: Firestore;
  access: OperatorAccess;
  lease?: ActiveLeaseState;
  onAcquireLease?: () => Promise<LeaseResult>;
  onReleaseLease?: () => Promise<boolean>;
  children: ReactNode;
}

export function AuthGate({
  auth,
  db,
  access,
  lease: propLease,
  onAcquireLease: propAcquire,
  onReleaseLease: propRelease,
  children,
  showOperatorStrip = true,
}: AuthGateProps) {
  // 嘗試從 FirebaseProvider 取得 context，若不在 Provider 內則使用 props
  let contextValue: ReturnType<typeof useFirebase> | null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    contextValue = useFirebase();
  } catch {
    contextValue = null;
  }

  const activeLease = propLease ?? contextValue?.lease;
  const doAcquire = propAcquire ?? contextValue?.acquireLease;
  const doRelease = propRelease ?? contextValue?.releaseLease;

  const [lastCheckTime, setLastCheckTime] = useState<number>(0);
  const [throttleMessage, setThrottleMessage] = useState<string>('');
  const [busyError, setBusyError] = useState<string>('');
  const [isAcquiring, setIsAcquiring] = useState<boolean>(false);
  const [signInError, setSignInError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [showSignInWait, setShowSignInWait] = useState(false);

  useEffect(() => {
    if (!signingIn) return;
    const timer = window.setTimeout(() => setShowSignInWait(true), 15000);
    return () => window.clearTimeout(timer);
  }, [signingIn]);

  const signIn = async () => {
    if (signingIn) return;
    setSignInError('');
    setShowSignInWait(false);
    setSigningIn(true);
    try {
      await signInWithGoogle(auth, db);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
      setSignInError(code === 'auth/popup-blocked'
        ? '登入視窗被瀏覽器阻擋。請允許此網站的彈出視窗，再按「使用 Google 登入」。'
        : code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request'
          ? '登入尚未完成；準備好後可再按「使用 Google 登入」。'
          : 'Google 登入未完成，請確認網路與網站的登入設定後重試。');
    } finally { setSigningIn(false); setShowSignInWait(false); }
  };

  // 1. 白名單未通過處理
  if (!access.ok) {
    return (
      <main className="auth-gate" aria-label="登入 EasyOrder">
        <h1>Talented EasyOrder</h1>

        {access.reason === 'checking' && (
          <div className="auth-gate-checking" role="status">
            正在確認 Google 帳號與操作員權限…
          </div>
        )}

        {access.reason === 'signed_out' && (
          <>
            <p>請使用 Google 帳號登入系統。</p>
            <button type="button" className="auth-gate-primary" disabled={signingIn} onClick={() => void signIn()}>
              {signingIn ? '正在等待 Google 登入…' : '使用 Google 登入'}
            </button>
            {signingIn && showSignInWait && (
              <p role="status">Google 登入仍在進行。請檢查 Google 登入視窗並完成帳號選擇；若視窗已關閉，可重新載入頁面後再試。</p>
            )}
            {signInError && <p role="alert">{signInError}</p>}
          </>
        )}

        {access.reason === 'not_whitelisted' && (
          <div className="auth-gate-pending" aria-label="尚未取得使用權">
            <h2>尚未取得使用權</h2>
            <p>您的 Google 帳號尚未加入操作員白名單，無法存取系統業務資料。</p>
            {access.profile && (
              <div
                className="auth-gate-profile-box"
                style={{
                  margin: '16px 0',
                  padding: '12px',
                  background: 'var(--surface-subtle, #f5f5f5)',
                  borderRadius: '6px',
                }}
              >
                <div><strong>登入帳號：</strong>{access.profile.email}</div>
                <div><strong>帳號 UID：</strong><code>{access.profile.uid}</code></div>
                <div style={{ fontSize: '12px', color: 'var(--text-dim, #666)', marginTop: '6px' }}>
                  請將上述 UID 提供給系統維護者以核准權限。
                </div>
              </div>
            )}
            <button type="button" onClick={() => void signOutOperator(auth)}>
              登出 / 切換帳號
            </button>
          </div>
        )}

        {access.reason === 'inactive' && (
          <div className="auth-gate-inactive" aria-label="帳號已停用">
            <h2>帳號已停用</h2>
            <p>此帳號已被系統管理員停用，無法存取系統業務資料。</p>
            {access.profile && (
              <p style={{ fontSize: '13px', color: 'var(--text-dim, #666)' }}>
                帳號：{access.profile.email} (UID: {access.profile.uid})
              </p>
            )}
            <button type="button" onClick={() => void signOutOperator(auth)}>
              登出
            </button>
          </div>
        )}

        {access.reason === 'unverified_email' && (
          <div className="auth-gate-unverified" aria-label="Email 尚未驗證">
            <h2>Email 尚未驗證</h2>
            <p>您的 Google 帳號 Email 尚未完成驗證，請先驗證後再登入。</p>
            <button type="button" onClick={() => void signOutOperator(auth)}>
              登出
            </button>
          </div>
        )}

        {access.reason === 'non_google_provider' && (
          <div className="auth-gate-provider" aria-label="登入方式錯誤">
            <h2>登入方式錯誤</h2>
            <p>系統僅允許 Google 帳號登入，請使用 Google 登入。</p>
            <button type="button" onClick={() => void signOutOperator(auth)}>
              登出
            </button>
          </div>
        )}

        {access.reason === 'email_mismatch' && (
          <div className="auth-gate-mismatch" aria-label="帳號資料不符">
            <h2>帳號資料不符</h2>
            <p>登入的 Google Email 與白名單設定不一致，請聯絡系統維護者。</p>
            <button type="button" onClick={() => void signOutOperator(auth)}>
              登出
            </button>
          </div>
        )}
      </main>
    );
  }

  const attemptAcquire = async () => {
    setIsAcquiring(true);
    setBusyError('');
    try {
      if (!doAcquire) throw new Error('租約服務尚未就緒，請重新連線後再試');
      const result = await doAcquire();
      if (result.status === 'busy') {
        setBusyError(`目前由操作員 ${result.currentHolderUid} 使用中`);
      } else if (result.status === 'stale_epoch') {
        setBusyError('租約狀態已更新，請重新檢查後再試');
      } else if (result.status === 'lost') {
        setBusyError(result.message);
      }
    } catch (error) {
      setBusyError(error instanceof Error ? error.message : '目前無法連線確認使用權，請稍後重試');
    } finally {
      setIsAcquiring(false);
    }
  };

  const handleRecheck = async () => {
    const now = Date.now();
    const elapsed = now - lastCheckTime;
    if (elapsed < LEASE_RECHECK_THROTTLE_MS) {
      const remainingSeconds = Math.ceil((LEASE_RECHECK_THROTTLE_MS - elapsed) / 1000);
      setThrottleMessage(`檢查過於頻繁，請等待 ${remainingSeconds} 秒後再試`);
      return;
    }

    setLastCheckTime(now);
    setThrottleMessage('');
    await attemptAcquire();
  };

  // Unknown/cache-only lease data never opens the business UI or appears idle.
  if (!activeLease?.isKnown) {
    return (
      <main className="auth-gate" aria-label="EasyOrder 使用權租約">
        <h1>Talented EasyOrder</h1>
        <div className="auth-gate-checking" role="status">
          <h2>正在確認系統使用權</h2>
          <p>{activeLease?.error ?? '尚未從伺服器確認租約狀態。'}</p>
        </div>
        {busyError && <div role="alert">{busyError}</div>}
        {throttleMessage && <div>{throttleMessage}</div>}
        <button type="button" onClick={() => void handleRecheck()} disabled={isAcquiring}>
          {isAcquiring ? '檢查中...' : '重新確認使用權'}
        </button>
        <button type="button" onClick={() => void signOutOperator(auth)}>登出</button>
      </main>
    );
  }

  const hasCurrentLease = activeLease.isHolder && activeLease.holderUid === access.profile.uid;

  // 2. Lease observations never auto-acquire. Only an explicit operator action writes.
  if (!hasCurrentLease) {
    const isSameUidUnconfirmed = activeLease.holderUid === access.profile.uid;
    const isOccupied = activeLease.holderUid !== null && !activeLease.isExpired && !isSameUidUnconfirmed;

    return (
      <main className="auth-gate" aria-label="EasyOrder 使用權租約">
        <h1>Talented EasyOrder</h1>

        {isSameUidUnconfirmed ? (
          <div className="auth-gate-checking" aria-label="正在確認目前帳號使用權">
            <h2>正在確認此分頁的使用權</h2>
            <p>伺服器觀察到此帳號先前持有租約；確認成功前不會開放業務資料。</p>
            {busyError && <div role="alert">{busyError}</div>}
            {throttleMessage && <div>{throttleMessage}</div>}
            <button type="button" onClick={() => void handleRecheck()} disabled={isAcquiring}>
              {isAcquiring ? '檢查中...' : '重新確認使用權'}
            </button>
            <button type="button" onClick={() => void signOutOperator(auth)}>登出</button>
          </div>
        ) : isOccupied ? (
          <div className="auth-gate-busy" aria-label="目前有人使用中">
            <h2>目前有人使用中</h2>
            <p>全公司同一時間僅限一位操作員使用。伺服器觀察到其他持有人；租約到期與否由伺服器時間判定，您可以重新檢查並提出交接。</p>
            <div
              style={{
                margin: '16px 0',
                padding: '12px',
                background: 'var(--surface-subtle, #f5f5f5)',
                borderRadius: '6px',
                fontSize: '13px',
              }}
            >
              <div><strong>目前持有者：</strong><code>{activeLease.holderUid}</code></div>
              <div><strong>目前租約世代 (Epoch)：</strong>{activeLease.epoch}</div>
              {activeLease.updatedAt && (
                <div><strong>最後活動時間：</strong>{activeLease.updatedAt.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei' })}</div>
              )}
            </div>

            {busyError && <div style={{ color: 'var(--color-danger, #d32f2f)', margin: '8px 0' }}>{busyError}</div>}
            {throttleMessage && <div style={{ color: 'var(--text-dim, #666)', margin: '8px 0' }}>{throttleMessage}</div>}

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
              <button type="button" onClick={() => void handleRecheck()} disabled={isAcquiring}>
                {isAcquiring ? '檢查中...' : '重新檢查'}
              </button>
              <button type="button" onClick={() => void signOutOperator(auth)}>
                登出
              </button>
            </div>
          </div>
        ) : (
          <div className="auth-gate-acquire" aria-label="待取得使用權">
            <h2>待取得使用權</h2>
            <p>租約目前看起來閒置或可能已逾期。送出申請後，伺服器會依權威時間確認能否取得使用權。</p>
            {busyError && <div style={{ color: 'var(--color-danger, #d32f2f)', margin: '8px 0' }}>{busyError}</div>}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
              <button type="button" className="auth-gate-primary" onClick={() => void attemptAcquire()} disabled={isAcquiring}>
                {isAcquiring ? '取得中...' : '取得系統使用權'}
              </button>
              <button type="button" onClick={() => void signOutOperator(auth)}>
                登出
              </button>
            </div>
          </div>
        )}
      </main>
    );
  }

  // 3. 已持有租約，進入系統
  const handleSignOutWithRelease = async () => {
    if (doRelease) {
      await doRelease();
    }
    await signOutOperator(auth);
  };

  return (
    <OperatorContext.Provider value={{ name: access.profile.displayName, epoch: activeLease.epoch, signOut: () => void handleSignOutWithRelease() }}>
      {showOperatorStrip && <div className="operator-strip">
        <span>{access.profile.displayName}</span>
        {activeLease?.epoch !== undefined && (
          <span className="mono" style={{ fontSize: '11px', color: 'var(--text-dim, #888)', marginLeft: '8px' }}>
            [租約 Epoch: {activeLease.epoch}]
          </span>
        )}
        <button type="button" onClick={() => void handleSignOutWithRelease()}>
          釋放使用權並登出
        </button>
      </div>}
      {children}
    </OperatorContext.Provider>
  );
}
