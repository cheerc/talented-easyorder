import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthGate } from '../AuthGate';
import type { OperatorAccess } from '../../firebase/authService';

vi.mock('../../firebase/authService', () => ({
  signInWithGoogle: vi.fn(),
  signOutOperator: vi.fn(),
}));

describe('AuthGate: 授權閘門與白名單畫面', () => {
  const mockAuth = {} as Parameters<typeof AuthGate>[0]['auth'];
  const mockDb = {} as Parameters<typeof AuthGate>[0]['db'];

  it('signed_out 時顯示 Google 登入按鈕且不渲染業務內容', () => {
    const access: OperatorAccess = { ok: false, reason: 'signed_out' };
    render(
      <AuthGate auth={mockAuth} db={mockDb} access={access}>
        <div data-testid="business-content">業務機密資料</div>
      </AuthGate>,
    );

    expect(screen.getByText('使用 Google 登入')).toBeTruthy();
    expect(screen.queryByTestId('business-content')).toBeNull();
  });

  it('not_whitelisted 時顯示尚未取得使用權畫面，包含 UID 且不渲染業務內容', () => {
    const access: OperatorAccess = {
      ok: false,
      reason: 'not_whitelisted',
      profile: {
        uid: 'uid-test-user',
        email: 'test@example.com',
        displayName: '測試者',
      },
    };
    render(
      <AuthGate auth={mockAuth} db={mockDb} access={access}>
        <div data-testid="business-content">業務機密資料</div>
      </AuthGate>,
    );

    expect(screen.getByText('尚未取得使用權')).toBeTruthy();
    expect(screen.getByText('test@example.com')).toBeTruthy();
    expect(screen.getByText('uid-test-user')).toBeTruthy();
    expect(screen.getByText('登出 / 切換帳號')).toBeTruthy();
    expect(screen.queryByTestId('business-content')).toBeNull();
  });

  it('inactive 時顯示帳號已停用畫面且不渲染業務內容', () => {
    const access: OperatorAccess = {
      ok: false,
      reason: 'inactive',
      profile: {
        uid: 'uid-disabled',
        email: 'disabled@example.com',
        displayName: '停用者',
      },
    };
    render(
      <AuthGate auth={mockAuth} db={mockDb} access={access}>
        <div data-testid="business-content">業務機密資料</div>
      </AuthGate>,
    );

    expect(screen.getByText('帳號已停用')).toBeTruthy();
    expect(screen.queryByTestId('business-content')).toBeNull();
  });

  it('unverified_email 與 non_google_provider 時分別顯示正確錯誤提示且不渲染業務內容', () => {
    const unverifiedAccess: OperatorAccess = { ok: false, reason: 'unverified_email' };
    const { unmount } = render(
      <AuthGate auth={mockAuth} db={mockDb} access={unverifiedAccess}>
        <div data-testid="business-content">業務機密資料</div>
      </AuthGate>,
    );
    expect(screen.getByText('Email 尚未驗證')).toBeTruthy();
    expect(screen.queryByTestId('business-content')).toBeNull();
    unmount();

    const providerAccess: OperatorAccess = { ok: false, reason: 'non_google_provider' };
    render(
      <AuthGate auth={mockAuth} db={mockDb} access={providerAccess}>
        <div data-testid="business-content">業務機密資料</div>
      </AuthGate>,
    );
    expect(screen.getByText('登入方式錯誤')).toBeTruthy();
    expect(screen.queryByTestId('business-content')).toBeNull();
  });

  it('核准使用者（ok: true）進入系統，顯示操作員資訊與內容', async () => {
    const access: OperatorAccess = {
      ok: true,
      profile: {
        uid: 'uid-approved-1',
        email: 'operator1@example.com',
        displayName: '操作員 1',
      },
    };
    render(
      <AuthGate auth={mockAuth} db={mockDb} access={access}>
        <div data-testid="business-content">已核准操作畫面</div>
      </AuthGate>,
    );

    expect(screen.getByText('操作員 1')).toBeTruthy();
    expect(screen.getByText('登出')).toBeTruthy();
    expect(screen.getByTestId('business-content')).toBeTruthy();
  });
});
