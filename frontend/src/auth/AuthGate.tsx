import { useState, type ReactNode } from 'react';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { signInWithGoogle, signOutOperator, type OperatorAccess } from '../firebase/authService';
import {
  LEASE_RECHECK_THROTTLE_MS,
  type ActiveLeaseState,
  type LeaseResult,
} from '../firebase/activeAccountLease';
import { useFirebase } from '../providers/FirebaseProvider';

export interface AuthGateProps {
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
}: AuthGateProps) {
  const domain = import.meta.env.VITE_ALLOWED_EMAIL_DOMAIN;

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

  // 1. 白名單未通過處理
  if (!access.ok) {
    return (
      <main className="auth-gate" aria-label="登入 EasyOrder">
        <h1>Talented EasyOrder</h1>

        {access.reason === 'signed_out' && (
          <>
            <p>請使用 Google 帳號登入系統。</p>
            <button type="button" onClick={() => void signInWithGoogle(auth, db)}>
              使用 Google 登入
            </button>
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

        {access.reason === 'wrong_domain' && (
          <>
            <p>此帳號不是 @{domain ?? 'example.com'}，請切換公司帳號。</p>
            <button type="button" onClick={() => void signInWithGoogle(auth, db)}>
              切換帳號登入
            </button>
          </>
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

  // 2. 租約閘門判斷（P04 核心）：
  // 如果提供了 activeLease 且當前未持有租約
  if (activeLease && !activeLease.isHolder) {
    const isOccupied = activeLease.holderUid !== null && !activeLease.isExpired;

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
      setBusyError('');

      if (doAcquire) {
        setIsAcquiring(true);
        try {
          const res = await doAcquire();
          if (res.status === 'busy') {
            setBusyError(`目前仍由操作員 ${res.currentHolderUid} 使用中`);
          }
        } finally {
          setIsAcquiring(false);
        }
      }
    };

    const handleAcquire = async () => {
      if (doAcquire) {
        setIsAcquiring(true);
        setBusyError('');
        try {
          const res = await doAcquire();
          if (res.status === 'busy') {
            setBusyError(`目前有人使用中，無法取得使用權`);
          }
        } finally {
          setIsAcquiring(false);
        }
      }
    };

    return (
      <main className="auth-gate" aria-label="EasyOrder 使用權租約">
        <h1>Talented EasyOrder</h1>

        {isOccupied ? (
          <div className="auth-gate-busy" aria-label="目前有人使用中">
            <h2>目前有人使用中</h2>
            <p>全公司同一時間僅限一位操作員使用。目前已有其他帳號持有使用權，請請對方登出或等待 5 分鐘逾時交接。</p>
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
                <div><strong>最後活動時間：</strong>{activeLease.updatedAt.toLocaleTimeString()}</div>
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
            <p>租約目前閒置或已逾期，您可以取得使用權開始操作系統。</p>
            {busyError && <div style={{ color: 'var(--color-danger, #d32f2f)', margin: '8px 0' }}>{busyError}</div>}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
              <button type="button" onClick={() => void handleAcquire()} disabled={isAcquiring}>
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
    <>
      <div className="operator-strip">
        <span>{access.profile.displayName}</span>
        {activeLease?.epoch !== undefined && (
          <span className="mono" style={{ fontSize: '11px', color: 'var(--text-dim, #888)', marginLeft: '8px' }}>
            [租約 Epoch: {activeLease.epoch}]
          </span>
        )}
        <button type="button" onClick={() => void handleSignOutWithRelease()}>
          釋放使用權並登出
        </button>
      </div>
      {children}
    </>
  );
}
