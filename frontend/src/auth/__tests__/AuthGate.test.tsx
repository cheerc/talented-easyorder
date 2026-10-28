import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthGate } from '../AuthGate';
import type { OperatorAccess } from '../../firebase/authService';
import type { ActiveLeaseState } from '../../firebase/activeAccountLease';
import { signInWithGoogle } from '../../firebase/authService';

vi.mock('../../firebase/authService', () => ({
  signInWithGoogle: vi.fn(),
  signOutOperator: vi.fn(),
}));

describe('AuthGate: 授權閘門與白名單畫面', () => {
  const mockAuth = {} as Parameters<typeof AuthGate>[0]['auth'];
  const mockDb = {} as Parameters<typeof AuthGate>[0]['db'];

  it('P17: a long pending login offers guidance without retrying or failing it', async () => {
    vi.useFakeTimers();
    try {
      let reject!: (reason: unknown) => void;
      vi.mocked(signInWithGoogle).mockReset().mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
      render(<AuthGate auth={mockAuth} db={mockDb} access={{ ok: false, reason: 'signed_out' }}><span>business</span></AuthGate>);
      fireEvent.click(screen.getByRole('button', { name: '使用 Google 登入' }));
      expect(screen.getByRole('button', { name: '正在等待 Google 登入…' })).toBeDisabled();
      act(() => vi.advanceTimersByTime(14999));
      expect(screen.queryByRole('status')).toBeNull();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.getByRole('status')).toHaveTextContent('Google 登入仍在進行');
      expect(screen.getByRole('status')).toHaveTextContent('登入視窗');
      fireEvent.click(screen.getByRole('button', { name: '正在等待 Google 登入…' }));
      expect(signInWithGoogle).toHaveBeenCalledTimes(1);
      await act(async () => reject({ code: 'auth/popup-blocked' }));
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.getByRole('alert')).toHaveTextContent('允許此網站的彈出視窗');
      expect(screen.getByRole('button', { name: '使用 Google 登入' })).toBeEnabled();
    } finally { vi.useRealTimers(); }
  });

  it('P17: settled or unmounted logins do not leave a delayed hint', async () => {
    vi.useFakeTimers();
    try {
      let resolve!: (access: OperatorAccess) => void;
      vi.mocked(signInWithGoogle).mockReset().mockImplementationOnce(() => new Promise(r => { resolve = r; }));
      const view = render(<AuthGate auth={mockAuth} db={mockDb} access={{ ok: false, reason: 'signed_out' }}><span>business</span></AuthGate>);
      fireEvent.click(screen.getByRole('button', { name: '使用 Google 登入' }));
      await act(async () => resolve({ ok: false, reason: 'not_whitelisted' }));
      act(() => vi.advanceTimersByTime(15000));
      expect(screen.queryByRole('status')).toBeNull();
      vi.mocked(signInWithGoogle).mockImplementationOnce(() => new Promise(() => {}));
      fireEvent.click(screen.getByRole('button', { name: '使用 Google 登入' }));
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      view.unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('P17: popup blocked gives a visible recovery instruction, and retries only after another click', async () => {
    vi.mocked(signInWithGoogle).mockRejectedValueOnce({ code: 'auth/popup-blocked', message: 'private-provider-details' })
      .mockResolvedValueOnce({ ok: false, reason: 'not_whitelisted' });
    render(<AuthGate auth={mockAuth} db={mockDb} access={{ ok: false, reason: 'signed_out' }}><span>business</span></AuthGate>);
    const count = vi.mocked(signInWithGoogle).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '使用 Google 登入' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('允許此網站的彈出視窗');
    await waitFor(() => expect(screen.getByRole('button', { name: '使用 Google 登入' })).toBeEnabled());
    expect(screen.getByRole('alert')).not.toHaveTextContent('private-provider-details');
    expect(vi.mocked(signInWithGoogle).mock.calls.length).toBe(count + 1);
    fireEvent.click(screen.getByRole('button', { name: '使用 Google 登入' }));
    await waitFor(() => expect(vi.mocked(signInWithGoogle).mock.calls.length).toBe(count + 2));
  });

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
      isKnown: true,
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
      isKnown: true,
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
      isKnown: true,
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
      isKnown: true,
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

  it('P04: idle lease does not auto-acquire; acquisition requires an explicit click', () => {
    const acquire = vi.fn().mockResolvedValue({
      status: 'acquired', holderUid: 'uid-me', epoch: 1, updatedAt: new Date(),
    });
    const access: OperatorAccess = {
      ok: true,
      profile: { uid: 'uid-me', email: 'me@example.com', displayName: '我' },
    };
    const idleLease: ActiveLeaseState = {
      holderUid: null, epoch: 0, updatedAt: null, isKnown: true,
      isHolder: false, isExpired: true,
    };

    render(
      <AuthGate auth={mockAuth} db={mockDb} access={access} lease={idleLease} onAcquireLease={acquire}>
        <div data-testid="business-content">業務機密資料</div>
      </AuthGate>,
    );

    expect(acquire).not.toHaveBeenCalled();
    expect(screen.queryByTestId('business-content')).toBeNull();
    fireEvent.click(screen.getByText('取得系統使用權'));
    expect(acquire).toHaveBeenCalledOnce();
  });

  it('P04: rejected acquire is caught and shown in the gate', async () => {
    const acquire = vi.fn().mockRejectedValue(new Error('offline test failure'));
    const access: OperatorAccess = {
      ok: true,
      profile: { uid: 'uid-me', email: 'me@example.com', displayName: '我' },
    };
    const idleLease: ActiveLeaseState = {
      holderUid: null, epoch: 0, updatedAt: null, isKnown: true,
      isHolder: false, isExpired: true,
    };

    render(
      <AuthGate auth={mockAuth} db={mockDb} access={access} lease={idleLease} onAcquireLease={acquire}>
        <div data-testid="business-content">業務機密資料</div>
      </AuthGate>,
    );

    fireEvent.click(screen.getByText('取得系統使用權'));
    expect(await screen.findByText('offline test failure')).toBeTruthy();
    expect(screen.queryByTestId('business-content')).toBeNull();
  });

  it('P04: same UID observed in the lease stays masked until an explicit server recheck', async () => {
    const acquire = vi.fn().mockResolvedValue({
      status: 'acquired', holderUid: 'uid-me', epoch: 4, updatedAt: new Date(),
    });
    const access: OperatorAccess = {
      ok: true,
      profile: { uid: 'uid-me', email: 'me@example.com', displayName: '我' },
    };
    const observedLease: ActiveLeaseState = {
      holderUid: 'uid-me', epoch: 4, updatedAt: new Date(),
      isKnown: true, isHolder: false, isExpired: false,
    };

    render(
      <AuthGate auth={mockAuth} db={mockDb} access={access} lease={observedLease} onAcquireLease={acquire}>
        <div data-testid="business-content">業務機密資料</div>
      </AuthGate>,
    );

    expect(screen.getByText('正在確認此分頁的使用權')).toBeTruthy();
    expect(screen.queryByTestId('business-content')).toBeNull();
    expect(acquire).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('重新確認使用權'));
    expect(acquire).toHaveBeenCalledOnce();
  });

  it('P04: a stale holder flag for a different UID never opens the business UI', () => {
    const access: OperatorAccess = {
      ok: true,
      profile: { uid: 'uid-current', email: 'current@example.com', displayName: 'Current' },
    };
    const staleLease: ActiveLeaseState = {
      holderUid: 'uid-previous', epoch: 8, updatedAt: new Date(),
      isKnown: true, isHolder: true, isExpired: false,
    };

    render(
      <AuthGate auth={mockAuth} db={mockDb} access={access} lease={staleLease}>
        <div data-testid="business-content">業務機密資料</div>
      </AuthGate>,
    );

    expect(screen.getByText('目前有人使用中')).toBeTruthy();
    expect(screen.queryByTestId('business-content')).toBeNull();
  });
});
