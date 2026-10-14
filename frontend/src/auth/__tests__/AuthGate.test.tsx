import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthGate } from '../AuthGate';
import type { OperatorAccess } from '../../firebase/authService';
import type { ActiveLeaseState } from '../../firebase/activeAccountLease';

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

  it('P04: 白名單通過但租約被他人占用時，顯示目前有人使用中且不渲染業務內容', () => {
    const access: OperatorAccess = {
      ok: true,
      profile: { uid: 'uid-me', email: 'me@example.com', displayName: '我' },
    };
    const occupiedLease: ActiveLeaseState = {
      holderUid: 'uid-other-operator',
      epoch: 2,
      updatedAt: new Date(),
      isHolder: false,
      isExpired: false,
    };

    render(
      <AuthGate auth={mockAuth} db={mockDb} access={access} lease={occupiedLease}>
        <div data-testid="business-content">業務機密資料</div>
      </AuthGate>,
    );

    expect(screen.getByText('目前有人使用中')).toBeTruthy();
    expect(screen.getByText('uid-other-operator')).toBeTruthy();
    expect(screen.queryByTestId('business-content')).toBeNull();
  });

  it('P04: 15 秒重新檢查限流防護', async () => {
    const access: OperatorAccess = {
      ok: true,
      profile: { uid: 'uid-me', email: 'me@example.com', displayName: '我' },
    };
    const occupiedLease: ActiveLeaseState = {
      holderUid: 'uid-other-operator',
      epoch: 2,
      updatedAt: new Date(),
      isHolder: false,
      isExpired: false,
    };
    const mockAcquire = vi.fn().mockResolvedValue({ status: 'busy', currentHolderUid: 'uid-other-operator' });

    render(
      <AuthGate
        auth={mockAuth}
        db={mockDb}
        access={access}
        lease={occupiedLease}
        onAcquireLease={mockAcquire}
      >
        <div data-testid="business-content">業務機密資料</div>
      </AuthGate>,
    );

    const recheckBtn = screen.getByText('重新檢查');
    // 第一次點擊：可執行
    fireEvent.click(recheckBtn);
    expect(mockAcquire).toHaveBeenCalledTimes(1);

    // 等候第一次非同步檢查完成，按鈕恢復非 disabled
    await waitFor(() => expect(screen.getByText('重新檢查')).not.toBeDisabled());

    // 15 秒內再次點擊：觸發限流
    fireEvent.click(screen.getByText('重新檢查'));
    expect(mockAcquire).toHaveBeenCalledTimes(1); // 未再增加呼叫
    expect(screen.getByText(/檢查過於頻繁/)).toBeTruthy();
  });

  it('P04: 白名單通過且租約閒置時，顯示待取得使用權按鈕', () => {
    const access: OperatorAccess = {
      ok: true,
      profile: { uid: 'uid-me', email: 'me@example.com', displayName: '我' },
    };
    const idleLease: ActiveLeaseState = {
      holderUid: null,
      epoch: 0,
      updatedAt: null,
      isHolder: false,
      isExpired: true,
    };

    render(
      <AuthGate auth={mockAuth} db={mockDb} access={access} lease={idleLease}>
        <div data-testid="business-content">業務機密資料</div>
      </AuthGate>,
    );

    expect(screen.getByText('待取得使用權')).toBeTruthy();
    expect(screen.getByText('取得系統使用權')).toBeTruthy();
    expect(screen.queryByTestId('business-content')).toBeNull();
  });

  it('P04: 核准且持有租約（isHolder: true）進入系統，顯示操作員條與業務畫面', () => {
    const access: OperatorAccess = {
      ok: true,
      profile: { uid: 'uid-me', email: 'me@example.com', displayName: '操作員 1' },
    };
    const activeLease: ActiveLeaseState = {
      holderUid: 'uid-me',
      epoch: 3,
      updatedAt: new Date(),
      isHolder: true,
      isExpired: false,
    };

    render(
      <AuthGate auth={mockAuth} db={mockDb} access={access} lease={activeLease}>
        <div data-testid="business-content">已核准操作畫面</div>
      </AuthGate>,
    );

    expect(screen.getByText('操作員 1')).toBeTruthy();
    expect(screen.getByText('[租約 Epoch: 3]')).toBeTruthy();
    expect(screen.getByText('釋放使用權並登出')).toBeTruthy();
    expect(screen.getByTestId('business-content')).toBeTruthy();
  });
});
