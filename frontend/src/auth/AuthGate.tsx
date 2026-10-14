import type { ReactNode } from 'react';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { signInWithGoogle, signOutOperator, type OperatorAccess } from '../firebase/authService';

export function AuthGate({ auth, db, access, children }: {
  auth: Auth;
  db: Firestore;
  access: OperatorAccess;
  children: ReactNode;
}) {
  const domain = import.meta.env.VITE_ALLOWED_EMAIL_DOMAIN;

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

  return (
    <>
      <div className="operator-strip">
        <span>{access.profile.displayName}</span>
        <button type="button" onClick={() => void signOutOperator(auth)}>登出</button>
      </div>
      {children}
    </>
  );
}
