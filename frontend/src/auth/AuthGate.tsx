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
  if (!access.ok) {
    return (
      <main className="auth-gate" aria-label="登入 EasyOrder">
        <h1>Talented EasyOrder</h1>
        {access.reason === 'signed_out' && <p>請使用公司 Google Workspace 帳號登入。</p>}
        {access.reason === 'wrong_domain' && <p>此帳號不是 @talented.com.tw，請切換公司帳號。</p>}
        {access.reason === 'not_whitelisted' && <p>此帳號尚未加入 EasyOrder 操作員名單。</p>}
        {access.reason === 'inactive' && <p>此帳號已停用，請聯絡管理員。</p>}
        <button type="button" onClick={() => void signInWithGoogle(auth, db)}>使用 Google 登入</button>
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
