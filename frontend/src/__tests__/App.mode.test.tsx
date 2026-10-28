import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const appMocks = vi.hoisted(() => ({
  cloudModeValid: false,
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
  CloudPendingRecoveryBoundary: ({ children }: { children: (hasUnresolvedPendingCommands: boolean) => ReactNode }) => children(false),
}));

vi.mock('../components/cloud/CloudStudentsPage', () => ({
  CloudStudentsPage: ({
    identityKey,
    onNavigationStateChange,
  }: {
    identityKey: string;
    onNavigationStateChange: (identityKey: string, state: 'recovering' | 'revoked' | 'resolved') => void;
  }) => (
    <section aria-label="mock students page">
      <button type="button" onClick={() => onNavigationStateChange(identityKey, 'recovering')}>保持待確認命令</button>
      <button type="button" onClick={() => onNavigationStateChange(identityKey, 'revoked')}>回報使用權失效</button>
      <button type="button" onClick={() => onNavigationStateChange(identityKey, 'resolved')}>回報已確認</button>
    </section>
  ),
}));
vi.mock('../components/cloud/CloudDayVendorsPage', () => ({
  CloudDayVendorsPage: ({
    identityKey,
    onNavigationStateChange,
  }: {
    identityKey: string;
    onNavigationStateChange: (identityKey: string, state: 'recovering' | 'revoked' | 'resolved') => void;
  }) => (
    <section aria-label="mock day vendors page">
      <button type="button" onClick={() => onNavigationStateChange(identityKey, 'recovering')}>保持待確認命令</button>
      <button type="button" onClick={() => onNavigationStateChange(identityKey, 'revoked')}>回報使用權失效</button>
      <button type="button" onClick={() => onNavigationStateChange(identityKey, 'resolved')}>回報已確認</button>
    </section>
  ),
}));
vi.mock('../components/cloud/CloudReportPage', () => ({
  CloudReportPage: () => <section aria-label="mock cloud report page" />,
}));
vi.mock('../components/cloud/CloudAccountHistoryPage', () => ({
  CloudAccountHistoryPage: () => <section aria-label="mock cloud account history page" />,
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

    const studentsTab = screen.getByRole('button', { name: '學生管理' });
    const dayVendorsTab = screen.getByRole('button', { name: '日期與供應商' });
    fireEvent.click(screen.getByRole('button', { name: '保持待確認命令' }));

    expect(studentsTab).toBeDisabled();
    expect(dayVendorsTab).toBeDisabled();
    fireEvent.click(dayVendorsTab);
    expect(studentsTab).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: '回報已確認' }));
    expect(studentsTab).toBeEnabled();
    fireEvent.click(dayVendorsTab);
    expect(dayVendorsTab).toHaveAttribute('aria-pressed', 'true');
  });

  it('exposes the formal cloud report and account history sections', () => {
    appMocks.cloudModeValid = true;
    render(<App />);

    expect(screen.getByRole('button', { name: '雲端報表' })).toBeVisible();
    expect(screen.getByRole('button', { name: '雲端查帳' })).toBeVisible();
  });

  it('keeps a same-scope authorization latch until the lease epoch or UID changes', () => {
    appMocks.cloudModeValid = true;
    const view = render(<App />);
    const studentsTab = screen.getByRole('button', { name: '學生管理' });
    const dayVendorsTab = screen.getByRole('button', { name: '日期與供應商' });

    fireEvent.click(screen.getByRole('button', { name: '回報使用權失效' }));
    expect(dayVendorsTab).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '回報已確認' }));
    expect(dayVendorsTab).toBeDisabled();
    fireEvent.click(dayVendorsTab);
    expect(studentsTab).toHaveAttribute('aria-pressed', 'true');

    appMocks.firebase.access = { ok: true, profile: { uid: 'uid-a', email: 'a@example.test' } };
    appMocks.firebase.lease = { epoch: 5 };
    view.rerender(<App />);
    fireEvent.click(screen.getByRole('button', { name: '回報已確認' }));

    expect(screen.getByRole('button', { name: '學生管理' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '回報使用權失效' }));
    expect(dayVendorsTab).toBeDisabled();
    appMocks.firebase.access = { ok: true, profile: { uid: 'uid-b', email: 'b@example.test' } };
    view.rerender(<App />);
    fireEvent.click(screen.getByRole('button', { name: '回報已確認' }));

    expect(screen.getByRole('button', { name: '學生管理' })).toBeEnabled();
    const currentDayVendorsTab = screen.getByRole('button', { name: '日期與供應商' });
    fireEvent.click(currentDayVendorsTab);
    expect(currentDayVendorsTab).toHaveAttribute('aria-pressed', 'true');
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
