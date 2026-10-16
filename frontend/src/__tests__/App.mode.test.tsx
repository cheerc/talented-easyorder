import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const appMocks = vi.hoisted(() => ({
  cloudModeValid: false,
  firebase: {
    fbError: null,
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
vi.mock('../auth/AuthGate', () => ({
  AuthGate: ({ children }: { children: ReactNode }) => children,
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

import App from '../App';
import { act } from '@testing-library/react';
import { useUiTweaksStore } from '../store/uiTweaksStore';

describe('App mode gate', () => {
  beforeEach(() => {
    appMocks.cloudModeValid = false;
    appMocks.firebase.access = { ok: true, profile: { uid: 'uid-a', email: 'a@example.test' } };
    appMocks.firebase.lease = { epoch: 4 };
  });

  it('fails closed when non-prototype mode has incomplete Firebase configuration', () => {
    render(<App />);

    expect(screen.getByRole('alert').textContent).toContain('missing Firebase configuration');
    expect(screen.queryByRole('tab')).toBeNull();
    expect(document.querySelector('.app')).toBeNull();
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

    expect(studentsTab).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '回報使用權失效' }));
    expect(dayVendorsTab).toBeDisabled();
    appMocks.firebase.access = { ok: true, profile: { uid: 'uid-b', email: 'b@example.test' } };
    view.rerender(<App />);
    fireEvent.click(screen.getByRole('button', { name: '回報已確認' }));

    expect(studentsTab).toBeEnabled();
    fireEvent.click(dayVendorsTab);
    expect(dayVendorsTab).toHaveAttribute('aria-pressed', 'true');
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
