import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthGate } from '../AuthGate';
import type { OperatorAccess } from '../../firebase/authService';
import type { ActiveLeaseState } from '../../firebase/activeAccountLease';
import { signInWithGoogle } from '../../firebase/authService';
import { readLeaseTakerEmail } from '../../firebase/activeAccountLease';

vi.mock('../../firebase/authService', () => ({
  signInWithGoogle: vi.fn(),
  signOutOperator: vi.fn(),
}));
vi.mock('../../firebase/activeAccountLease', async importOriginal => ({
  ...await importOriginal<typeof import('../../firebase/activeAccountLease')>(),
  readLeaseTakerEmail: vi.fn(),
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

  it('P04: 白名單通過但租約被他人占用時，顯示目前有人使用中且不渲染業務內容', async () => {
    vi.mocked(readLeaseTakerEmail).mockReset().mockResolvedValue('other@example.com');
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
    expect(await screen.findByText(/other@example\.com/)).toBeTruthy();
    expect(readLeaseTakerEmail).toHaveBeenCalledWith(mockDb, 2, 'uid-other-operator');
    // #691: no raw UID, no epoch, no engineering wording on the busy screen.
    const gate = screen.getByRole('main');
    expect(gate.textContent).not.toContain('uid-other-operator');
    expect(gate.textContent).not.toMatch(/Epoch|世代|租約|持有/);
    expect(screen.queryByTestId('business-content')).toBeNull();
  });

  it('#691 P7: busy screen offers no silent recheck; the primary button opens a confirmation naming the occupant, and cancel never acquires', async () => {
    vi.mocked(readLeaseTakerEmail).mockReset().mockResolvedValue('other@example.com');
    const acquire = vi.fn().mockResolvedValue({ status: 'acquired', holderUid: 'uid-me', epoch: 3, updatedAt: new Date() });
    const access: OperatorAccess = { ok: true, profile: { uid: 'uid-me', email: 'me@example.com', displayName: '我' } };
    const occupiedLease: ActiveLeaseState = {
      holderUid: 'uid-other-operator', epoch: 2, updatedAt: new Date(), isKnown: true, isHolder: false, isExpired: false,
    };
    render(
      <AuthGate auth={mockAuth} db={mockDb} access={access} lease={occupiedLease} onAcquireLease={acquire}>
        <div data-testid="business-content">業務機密資料</div>
      </AuthGate>,
    );
    await screen.findByText(/other@example\.com/);
    expect(screen.queryByRole('button', { name: '重新檢查' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '登入並讓對方登出' }));
    expect(acquire).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('other@example.com 正在使用。繼續登入會讓對方立即登出，對方尚未送出的操作不會保存。');

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(acquire).not.toHaveBeenCalled();
    expect(screen.queryByTestId('business-content')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '登入並讓對方登出' }));
    fireEvent.click(screen.getByRole('button', { name: '是，讓對方登出並繼續' }));
    await waitFor(() => expect(acquire).toHaveBeenCalledTimes(1));
    // The confirmation names the lease the user was shown, so a lease that changed meanwhile is not taken over blindly.
    expect(acquire).toHaveBeenCalledWith({ confirmedTakeoverEpoch: 2 });
  });

  it('#691 P7: when the occupant email cannot be read the screen and dialog say 其他人 and still show no UID', async () => {
    vi.mocked(readLeaseTakerEmail).mockReset().mockResolvedValue(null);
    const access: OperatorAccess = { ok: true, profile: { uid: 'uid-me', email: 'me@example.com', displayName: '我' } };
    const occupiedLease: ActiveLeaseState = {
      holderUid: 'uid-other-operator', epoch: 2, updatedAt: new Date(), isKnown: true, isHolder: false, isExpired: false,
    };
    render(<AuthGate auth={mockAuth} db={mockDb} access={access} lease={occupiedLease}><span>x</span></AuthGate>);
    expect(await screen.findByText(/目前由其他人使用中/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '登入並讓對方登出' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('其他人 正在使用。');
    expect(screen.getByRole('main').textContent).not.toContain('uid-other-operator');
  });

  it('#691 P7: a taken-over tab shows who is in and “我知道了” returns to the busy screen', async () => {
    vi.mocked(readLeaseTakerEmail).mockReset().mockResolvedValue('other@example.com');
    const acknowledge = vi.fn();
    const access: OperatorAccess = { ok: true, profile: { uid: 'uid-me', email: 'me@example.com', displayName: '我' } };
    const occupiedLease: ActiveLeaseState = {
      holderUid: 'uid-other-operator', epoch: 3, updatedAt: new Date(), isKnown: true, isHolder: false, isExpired: false,
    };
    const view = render(
      <AuthGate auth={mockAuth} db={mockDb} access={access} lease={occupiedLease}
        kicked={{ takerEmail: 'other@example.com' }} onAcknowledgeKicked={acknowledge}>
        <div data-testid="business-content">業務機密資料</div>
      </AuthGate>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('other@example.com 已登入，您已被登出。');
    expect(screen.queryByTestId('business-content')).toBeNull();
    expect(screen.getByRole('main').textContent).not.toMatch(/uid-other-operator|Epoch|租約/);
    fireEvent.click(screen.getByRole('button', { name: '我知道了' }));
    expect(acknowledge).toHaveBeenCalledOnce();

    view.rerender(
      <AuthGate auth={mockAuth} db={mockDb} access={access} lease={occupiedLease} kicked={null} onAcknowledgeKicked={acknowledge}>
        <div data-testid="business-content">業務機密資料</div>
      </AuthGate>,
    );
    expect(screen.getByText('目前有人使用中')).toBeTruthy();
    expect(screen.getByRole('button', { name: '登入並讓對方登出' })).toBeTruthy();
  });

  it('#691 P7: a kicked notice without a readable email says 其他人', () => {
    const access: OperatorAccess = { ok: true, profile: { uid: 'uid-me', email: 'me@example.com', displayName: '我' } };
    const occupiedLease: ActiveLeaseState = {
      holderUid: 'uid-other-operator', epoch: 3, updatedAt: new Date(), isKnown: true, isHolder: false, isExpired: false,
    };
    render(
      <AuthGate auth={mockAuth} db={mockDb} access={access} lease={occupiedLease} kicked={{ takerEmail: null }} onAcknowledgeKicked={vi.fn()}>
        <span>x</span>
      </AuthGate>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('其他人已登入，您已被登出。');
  });

  it('P04: 15 秒重新確認限流防護（同帳號待確認畫面）', async () => {
    const access: OperatorAccess = {
      ok: true,
      profile: { uid: 'uid-me', email: 'me@example.com', displayName: '我' },
    };
    const observedLease: ActiveLeaseState = {
      holderUid: 'uid-me',
      epoch: 2,
      updatedAt: new Date(),
      isKnown: true,
      isHolder: false,
      isExpired: false,
    };
    const mockAcquire = vi.fn().mockResolvedValue({ status: 'lost', message: '伺服器未確認' });

    render(
      <AuthGate
        auth={mockAuth}
        db={mockDb}
        access={access}
        lease={observedLease}
        onAcquireLease={mockAcquire}
      >
        <div data-testid="business-content">業務機密資料</div>
      </AuthGate>,
    );

    // 第一次點擊：可執行
    fireEvent.click(screen.getByText('重新確認使用權'));
    expect(mockAcquire).toHaveBeenCalledTimes(1);

    // 等候第一次非同步檢查完成，按鈕恢復非 disabled
    await waitFor(() => expect(screen.getByText('重新確認使用權')).not.toBeDisabled());

    // 15 秒內再次點擊：觸發限流
    fireEvent.click(screen.getByText('重新確認使用權'));
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

  it('#691 P7 r2: another UID\'s lease that merely looks expired still needs the confirmation (no plain acquire button)', async () => {
    vi.mocked(readLeaseTakerEmail).mockReset().mockResolvedValue('other@example.com');
    const acquire = vi.fn().mockResolvedValue({ status: 'acquired', holderUid: 'uid-me', epoch: 3, updatedAt: new Date() });
    const access: OperatorAccess = { ok: true, profile: { uid: 'uid-me', email: 'me@example.com', displayName: '我' } };
    // A fast local clock makes a live lease look expired (isExpired is only a display estimate).
    const looksExpired: ActiveLeaseState = {
      holderUid: 'uid-other-operator', epoch: 2, updatedAt: new Date(0), isKnown: true, isHolder: false, isExpired: true,
    };
    render(<AuthGate auth={mockAuth} db={mockDb} access={access} lease={looksExpired} onAcquireLease={acquire}><span>x</span></AuthGate>);

    expect(await screen.findByText(/other@example\.com/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '取得系統使用權' })).toBeNull();
    expect(screen.getByRole('main')).toHaveTextContent('可能已閒置');
    expect(screen.getByRole('main').textContent).not.toContain('uid-other-operator');
    expect(acquire).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '登入並讓對方登出' }));
    expect(acquire).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent('other@example.com');
    fireEvent.click(screen.getByRole('button', { name: '是，讓對方登出並繼續' }));
    await waitFor(() => expect(acquire).toHaveBeenCalledWith({ confirmedTakeoverEpoch: 2 }));
  });

  it('#691 P7 r2: only a vacant lease offers the plain acquire button, and its copy no longer promises a server time check', () => {
    const access: OperatorAccess = { ok: true, profile: { uid: 'uid-me', email: 'me@example.com', displayName: '我' } };
    const vacant: ActiveLeaseState = {
      holderUid: null, epoch: 0, updatedAt: null, isKnown: true, isHolder: false, isExpired: true,
    };
    render(<AuthGate auth={mockAuth} db={mockDb} access={access} lease={vacant}><span>x</span></AuthGate>);
    expect(screen.getByRole('button', { name: '取得系統使用權' })).toBeTruthy();
    expect(screen.getByRole('main').textContent).not.toMatch(/權威時間|伺服器會依|逾期/);
  });
});
