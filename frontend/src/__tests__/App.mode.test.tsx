import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState, type ReactNode } from 'react';

const appMocks = vi.hoisted(() => ({
  cloudModeValid: false,
  recoveryGate: false,
  studentCallback: null as null | ((key: string, state: 'recovering' | 'revoked' | 'resolved') => void),
  dayCallback: null as null | ((key: string, state: 'recovering' | 'revoked' | 'resolved') => void),
  crashDraft: {
    load: vi.fn(async () => null),
    save: vi.fn(async () => undefined),
    clear: vi.fn(),
  },
  firebase: {
    fbError: null as string | null,
    storageCleanupError: null as string | null,
    fb: { auth: {}, db: {} },
    access: { ok: true, profile: { uid: 'uid-a', email: 'a@example.test' } },
    lease: { epoch: 4 },
  },
}));

vi.mock('../appMode', async importOriginal => ({
  ...(await importOriginal<typeof import('../appMode')>()),
  isPrototypeMode: false,
  validateAppModeConfig: () => appMocks.cloudModeValid
    ? ({ ok: true as const })
    : ({ ok: false as const, error: 'missing Firebase configuration' }),
}));
vi.mock('../providers/FirebaseProvider', () => ({
  FirebaseProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../hooks/useFirebase', () => ({
  useFirebase: () => appMocks.firebase,
}));
vi.mock('../storage/crashDraft', () => ({
  loadCrashDraft: appMocks.crashDraft.load,
  saveCrashDraft: appMocks.crashDraft.save,
  clearCrashDraft: appMocks.crashDraft.clear,
  isCrashDraftAvailable: vi.fn(async () => false),
}));
vi.mock('../auth/AuthGate', () => ({
  AuthGate: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../components/cloud/CloudPendingRecoveryBoundary', () => ({
  CloudPendingRecoveryBoundary: ({ children }: { children: (hasUnresolvedPendingCommands: boolean) => ReactNode }) => <div inert={appMocks.recoveryGate}>{children(false)}</div>,
}));

vi.mock('../components/cloud/CloudOrdersPage', () => ({
  CloudOrdersPage: function Orders({ onViewDayChange }: { onViewDayChange?: (date: string, backfill: boolean) => void }) {
    const [selected, setSelected] = useState(false);
    return <section aria-label="mock orders page"><button onClick={() => onViewDayChange?.('2026-10-01', true)}>測試補登日</button>{selected
      ? <form aria-label="訂餐"><input aria-label="金額" /></form>
      : <><input id="cloud-student-search" aria-label="搜尋" /><button onClick={() => setSelected(true)}>選擇學生</button></>}
    </section>;
  },
}));
vi.mock('../components/cloud/CloudStudentsPage', () => ({
  CloudStudentsPage: ({
    identityKey,
    onNavigationStateChange,
    onDraftCleared,
  }: {
    onDraftCleared?: () => void;
    identityKey: string;
    onNavigationStateChange: (identityKey: string, state: 'recovering' | 'revoked' | 'resolved') => void;
  }) => {
    appMocks.studentCallback = onNavigationStateChange;
    return (
    <section aria-label="mock students page">
      <form><label>測試草稿<input /></label></form>
      <button type="button" onClick={onDraftCleared}>確認草稿已清除</button>
      <button type="button" onClick={() => onNavigationStateChange(identityKey, 'recovering')}>保持待確認命令</button>
      <button type="button" onClick={() => onNavigationStateChange(identityKey, 'revoked')}>回報使用權失效</button>
      <button type="button" onClick={() => onNavigationStateChange(identityKey, 'resolved')}>回報已確認</button>
    </section>
  ); },
}));
vi.mock('../components/cloud/CloudDayVendorsPage', () => ({
  CloudDayVendorsPage: ({
    identityKey,
    onNavigationStateChange,
  }: {
    identityKey: string;
    onNavigationStateChange: (identityKey: string, state: 'recovering' | 'revoked' | 'resolved') => void;
  }) => {
    appMocks.dayCallback = onNavigationStateChange;
    return (
    <section aria-label="mock day vendors page">
      <input aria-label="日期選擇" defaultValue="2026-10-28" />
      <button type="button" onClick={() => onNavigationStateChange(identityKey, 'recovering')}>保持待確認命令</button>
      <button type="button" onClick={() => onNavigationStateChange(identityKey, 'revoked')}>回報使用權失效</button>
      <button type="button" onClick={() => onNavigationStateChange(identityKey, 'resolved')}>回報已確認</button>
    </section>
  ); },
}));
vi.mock('../components/cloud/CloudDayClosePage', () => ({ CloudDayClosePage: () => <section aria-label="mock day close page"><form className="cloud-day-close__date-form"><label>查詢日期<input /></label></form></section> }));
vi.mock('../components/cloud/CloudReportPage', () => ({
  CloudReportPage: () => <section aria-label="mock cloud report page"><form className="cloud-report__controls"><label>報表日期<input /></label></form></section>,
}));
vi.mock('../components/cloud/CloudAccountHistoryPage', () => ({
  CloudAccountHistoryPage: () => <section aria-label="mock cloud account history page"><form className="cloud-account-history__date-form"><label>查帳日期<input /></label></form><form className="cloud-account-history__mutation"><label>更正理由<input /></label></form></section>,
}));

import App from '../App';
import { act } from '@testing-library/react';
import { useUiTweaksStore } from '../store/uiTweaksStore';

describe('App mode gate', () => {
  beforeEach(() => {
    appMocks.cloudModeValid = false;
    appMocks.firebase.fbError = null;
    appMocks.firebase.storageCleanupError = null;
    appMocks.firebase.access = { ok: true, profile: { uid: 'uid-a', email: 'a@example.test' } };
    appMocks.firebase.lease = { epoch: 4 };
    vi.clearAllMocks();
  });

  it('fails closed when non-prototype mode has incomplete Firebase configuration', () => {
    render(<App />);

    expect(screen.getByRole('alert').textContent).toContain('missing Firebase configuration');
    expect(screen.queryByRole('tab')).toBeNull();
    expect(document.querySelector('.app')).toBeNull();
  });

  it('shows actionable Firebase cache cleanup guidance and blocks the cloud app', () => {
    appMocks.cloudModeValid = true;
    appMocks.firebase.fbError = '舊版 Firestore 快取仍被其他分頁使用。請關閉其他 EasyOrder 分頁後再重新載入。';
    render(<App />);

    expect(screen.getByRole('alert')).toHaveTextContent(appMocks.firebase.fbError);
    expect(screen.getByRole('button', { name: '重新載入' })).toBeVisible();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('button', { name: '取得系統使用權' })).toBeNull();
  });

  it('blocks the cloud app when app-scoped local storage cleanup is incomplete', () => {
    appMocks.cloudModeValid = true;
    appMocks.firebase.storageCleanupError = '雲端本機資料尚未確認清除。請關閉其他 EasyOrder 分頁後重新載入。';
    render(<App />);

    expect(screen.getByRole('alert')).toHaveTextContent(appMocks.firebase.storageCleanupError);
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('button', { name: '取得系統使用權' })).toBeNull();
  });

  it('does not read or write the legacy POS crash draft from the cloud entrypoint', () => {
    appMocks.cloudModeValid = true;
    render(<App />);

    expect(screen.getByRole('region', { name: 'mock students page' })).toBeVisible();
    expect(appMocks.crashDraft.load).not.toHaveBeenCalled();
    expect(appMocks.crashDraft.save).not.toHaveBeenCalled();
    expect(appMocks.crashDraft.clear).not.toHaveBeenCalled();
  });

  it('blocks section changes while a command is unresolved and unlocks after recovery', () => {
    appMocks.cloudModeValid = true;
    render(<App />);

    const studentsTab = screen.getByRole('button', { name: '學生' });
    const dayVendorsTab = screen.getByRole('button', { name: '菜單與開帳' });
    fireEvent.click(screen.getByRole('button', { name: '保持待確認命令' }));

    expect(studentsTab).toBeDisabled();
    expect(dayVendorsTab).toBeDisabled();
    fireEvent.click(dayVendorsTab);
    expect(studentsTab).toHaveAttribute('aria-current', 'page');

    fireEvent.click(screen.getByRole('button', { name: '回報已確認' }));
    expect(studentsTab).toBeEnabled();
    fireEvent.click(dayVendorsTab);
    expect(dayVendorsTab).toHaveAttribute('aria-current', 'page');
  });

  it('exposes the formal cloud report and account history sections', () => {
    appMocks.cloudModeValid = true;
    render(<App />);

    fireEvent.keyDown(window, { key: 'F2' });
    fireEvent.click(screen.getByRole('button', { name: '本週／本月' }));
    expect(screen.getByRole('region', { name: 'mock cloud report page' })).toBeVisible();
    fireEvent.keyDown(window, { key: 'F5' });
    expect(screen.getByRole('region', { name: 'mock cloud account history page' })).toBeVisible();
  });

  it('keeps a same-scope authorization latch until the lease epoch or UID changes', () => {
    appMocks.cloudModeValid = true;
    const view = render(<App />);
    const studentsTab = screen.getByRole('button', { name: '學生' });
    const dayVendorsTab = screen.getByRole('button', { name: '菜單與開帳' });

    fireEvent.click(screen.getByRole('button', { name: '回報使用權失效' }));
    expect(dayVendorsTab).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '回報已確認' }));
    expect(dayVendorsTab).toBeDisabled();
    fireEvent.click(dayVendorsTab);
    expect(studentsTab).toHaveAttribute('aria-current', 'page');

    appMocks.firebase.access = { ok: true, profile: { uid: 'uid-a', email: 'a@example.test' } };
    appMocks.firebase.lease = { epoch: 5 };
    view.rerender(<App />);
    fireEvent.click(screen.getByRole('button', { name: '回報已確認' }));

    expect(screen.getByRole('button', { name: '學生' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '回報使用權失效' }));
    expect(dayVendorsTab).toBeDisabled();
    appMocks.firebase.access = { ok: true, profile: { uid: 'uid-b', email: 'b@example.test' } };
    view.rerender(<App />);
    fireEvent.click(screen.getByRole('button', { name: '回報已確認' }));

    expect(screen.getByRole('button', { name: '學生' })).toBeEnabled();
    const currentDayVendorsTab = screen.getByRole('button', { name: '菜單與開帳' });
    fireEvent.click(currentDayVendorsTab);
    expect(currentDayVendorsTab).toHaveAttribute('aria-current', 'page');
  });

  it('applies the shared U1 display preferences in cloud mode and follows later changes', () => {
    appMocks.cloudModeValid = true;
    act(() => useUiTweaksStore.getState().setTweaks({ theme: 'dark', scale: 'normal' }));
    // 模擬 body 被其他畫面改過：雲端頁掛載時要重新套用共用偏好。
    document.body.setAttribute('data-theme', 'warm');
    document.body.setAttribute('data-scale', 'large');
    render(<App />);

    expect(document.body).toHaveAttribute('data-theme', 'dark');
    expect(document.body).toHaveAttribute('data-scale', 'normal');

    act(() => useUiTweaksStore.getState().setTweaks({ theme: 'light', scale: 'large' }));
    expect(document.body).toHaveAttribute('data-theme', 'light');
    expect(document.body).toHaveAttribute('data-scale', 'large');
    act(() => useUiTweaksStore.getState().resetToDefault());
  });
});

describe('cloud navigation contract', () => {
  it('ignores IME composition and repeated navigation keys at the cloud shell', () => {
    appMocks.cloudModeValid = true;
    render(<App />);
    expect(screen.getByRole('region', { name: 'mock students page' })).toBeVisible();

    const composing = new KeyboardEvent('keydown', { key: 'F2', isComposing: true, bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(composing); });
    expect(screen.getByRole('region', { name: 'mock students page' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'mock cloud report page' })).toBeNull();

    act(() => { window.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3', bubbles: true, cancelable: true })); });
    expect(screen.getByRole('region', { name: 'mock students page' })).toBeVisible();
    act(() => { window.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); });

    const legacy229 = new KeyboardEvent('keydown', { key: 'F4', bubbles: true, cancelable: true });
    Object.defineProperty(legacy229, 'keyCode', { value: 229 });
    act(() => { window.dispatchEvent(legacy229); });
    expect(screen.getByRole('region', { name: 'mock students page' })).toBeVisible();

    const repeated = new KeyboardEvent('keydown', { key: 'F5', repeat: true, bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(repeated); });
    expect(screen.getByRole('region', { name: 'mock students page' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'mock cloud account history page' })).toBeNull();

    const altComposing = new KeyboardEvent('keydown', { key: '£', code: 'Digit3', altKey: true, isComposing: true, bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(altComposing); });
    expect(screen.getByRole('region', { name: 'mock students page' })).toBeVisible();

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3', bubbles: true, cancelable: true })); });
    expect(screen.getByRole('region', { name: 'mock day vendors page' })).toBeVisible();

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true })); });
    expect(screen.getByRole('region', { name: 'mock day close page' })).toBeVisible();
  });

  it('does not treat the day-close date filter as an unsubmitted draft', () => {
    appMocks.cloudModeValid = true;
    render(<App />);
    fireEvent.keyDown(window, { key: 'F2' });
    fireEvent.change(screen.getByLabelText('查詢日期'), { target: { value: '2026-10-26' } });
    fireEvent.keyDown(window, { key: 'F1' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'mock orders page' })).toBeVisible();
  });

  it('allows navigation after report and history filters but protects a history correction draft', () => {
    appMocks.cloudModeValid = true;
    render(<App />);
    fireEvent.keyDown(window, { key: 'F2' });
    fireEvent.click(screen.getByRole('button', { name: '本週／本月' }));
    fireEvent.change(screen.getByLabelText('報表日期'), { target: { value: '2026-10-26' } });
    fireEvent.keyDown(window, { key: 'F5' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('查帳日期'), { target: { value: '2026-10-26' } });
    fireEvent.keyDown(window, { key: 'F1' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'F5' });
    fireEvent.change(screen.getByLabelText('更正理由'), { target: { value: '更正' } });
    fireEvent.keyDown(window, { key: 'F1' });
    expect(screen.getByRole('dialog', { name: '離開並捨棄草稿？' })).toBeVisible();
  });

  it('does not show a previous backfill date while a newly mounted cashier is loading', () => {
    appMocks.cloudModeValid = true;
    render(<App />);
    fireEvent.keyDown(window, { key: 'F1' });
    fireEvent.click(screen.getByRole('button', { name: '測試補登日' }));
    expect(screen.getByText('補登 2026-10-01')).toBeVisible();
    fireEvent.keyDown(window, { key: 'F3' });
    fireEvent.keyDown(window, { key: 'F1' });
    expect(screen.queryByText('補登 2026-10-01')).not.toBeInTheDocument();
    expect(screen.getByText('營業日未確認')).toBeVisible();
  });

  it('asks before discarding an active cashier draft when F1 returns to search', () => {
    appMocks.cloudModeValid = true;
    render(<App />);
    fireEvent.keyDown(window, { key: 'F1' });
    fireEvent.click(screen.getByRole('button', { name: '選擇學生' }));
    fireEvent.keyDown(window, { key: 'F1' });
    expect(screen.getByRole('dialog')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '捨棄草稿' }));
    expect(screen.getByLabelText('搜尋')).toBeVisible();
  });

  it('only clears the leave warning when the page confirms its draft was cleared', () => {
    appMocks.cloudModeValid = true;
    render(<App />);
    fireEvent.change(screen.getByLabelText('測試草稿'), { target: { value: '987' } });
    fireEvent.click(screen.getByRole('button', { name: '回報已確認' }));
    fireEvent.keyDown(window, { key: 'F3' });
    expect(screen.getByRole('dialog')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '取消離開' }));
    fireEvent.click(screen.getByRole('button', { name: '確認草稿已清除' }));
    fireEvent.keyDown(window, { key: 'F3' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'mock day vendors page' })).toBeVisible();
  });

  it('keeps the day/vendor page instance when switching its presentation without a draft', () => {
    appMocks.cloudModeValid = true;
    render(<App />);
    fireEvent.keyDown(window, { key: 'F3' });
    const input = screen.getByLabelText('日期選擇') as HTMLInputElement;
    const callback = appMocks.dayCallback;
    input.value = '2026-10-20';
    fireEvent.keyDown(window, { key: 'F4' });
    expect(screen.getByLabelText('日期選擇')).toBe(input);
    expect(appMocks.dayCallback).toBe(callback);
    expect(input.value).toBe('2026-10-20');
  });

  it('ignores a late callback from the page that was unmounted', () => {
    appMocks.cloudModeValid = true;
    render(<App />);
    const stale = appMocks.studentCallback!;
    fireEvent.keyDown(window, { key: 'F3' });
    fireEvent.click(screen.getByRole('button', { name: '保持待確認命令' }));
    act(() => stale('uid-a:4', 'resolved'));
    expect(screen.getByRole('button', { name: '歷史' })).toBeDisabled();
  });

  it('keeps a mounted page in place while the recovery boundary is inert', () => {
    appMocks.cloudModeValid = true;
    appMocks.recoveryGate = true;
    const view = render(<App />);
    const event = new KeyboardEvent('keydown', { key: 'F3', bubbles: true, cancelable: true });
    act(() => window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    appMocks.recoveryGate = false;
    view.rerender(<App />);
    expect(screen.getByRole('region', { name: 'mock students page' })).toBeVisible();
  });

  it('intercepts browser F5 while recovery locks navigation and preserves native modifiers', () => {
    appMocks.cloudModeValid = true;
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '保持待確認命令' }));
    const locked = new KeyboardEvent('keydown', { key: 'F5', bubbles: true, cancelable: true });
    act(() => window.dispatchEvent(locked));
    expect(locked.defaultPrevented).toBe(true);
    expect(screen.getByRole('region', { name: 'mock students page' })).toBeVisible();
    const browser = new KeyboardEvent('keydown', { key: 'F5', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => window.dispatchEvent(browser));
    expect(browser.defaultPrevented).toBe(false);
  });

  it('remembers the selected settings page after navigating away', () => {
    appMocks.cloudModeValid = true;
    render(<App />);
    fireEvent.keyDown(window, { key: 'F3' });
    expect(screen.getByRole('region', { name: 'mock day vendors page' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '學生' }));
    fireEvent.keyDown(window, { key: 'F5' });
    fireEvent.keyDown(window, { key: 'F3' });
    expect(screen.getByRole('region', { name: 'mock students page' })).toBeVisible();
  });

  it('uses physical Alt+3 from an input to open the default settings subpage', () => {
    appMocks.cloudModeValid = true;
    render(<App />);
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    const event = new KeyboardEvent('keydown', { key: '£', code: 'Digit3', altKey: true, bubbles: true, cancelable: true });
    act(() => { input.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole('region', { name: 'mock day vendors page' })).toBeVisible();
    input.remove();
  });
});
