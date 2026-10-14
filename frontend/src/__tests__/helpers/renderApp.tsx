import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import App from '../../App';
import { NEXT_ENTER_GUARD_MS } from '../../components/pos/ConfirmBanner';

vi.mock('../../appMode', async importOriginal => ({
  ...(await importOriginal<typeof import('../../appMode')>()),
  isPrototypeMode: true,
}));

// These UI regression tests exercise the prototype POS shell. Auth/lease protocol
// behavior has dedicated tests; give the shell a verified, server-confirmed lease.
vi.mock('../../firebase/activeAccountLease', () => {
  const lease = {
    holderUid: 'uid-counter',
    epoch: 1,
    updatedAt: new Date('2026-10-14T00:00:00.000Z'),
    isKnown: true,
    isHolder: false,
    isExpired: false,
  };
  const acquired = {
    status: 'acquired',
    holderUid: 'uid-counter',
    epoch: 1,
    updatedAt: new Date('2026-10-14T00:00:00.000Z'),
  };
  return {
    defaultLeaseState: {
      holderUid: null,
      epoch: 0,
      updatedAt: null,
      isKnown: false,
      isHolder: false,
      isExpired: false,
      error: '尚未從伺服器確認租約狀態',
    },
    acquireLease: vi.fn(async () => acquired),
    getLeaseStatus: vi.fn(async () => lease),
    releaseLease: vi.fn(async () => true),
    renewLease: vi.fn(async () => acquired),
    subscribeLease: vi.fn((_db: unknown, _uid: string | null, onUpdate: (state: typeof lease) => void) => {
      onUpdate(lease);
      return () => {};
    }),
    startLeaseHeartbeat: vi.fn(() => () => {}),
  };
});

/** M4：成功畫面出現後要隔一下、放開再按 Enter 才回下一位；測試照人的節奏等過保護時間再按。 */
export async function pressEnterForNext(user: { keyboard: (text: string) => Promise<void> }) {
  await new Promise(r => setTimeout(r, NEXT_ENTER_GUARD_MS + 20));
  await user.keyboard('{Enter}');
}

export async function renderApp() {
  render(<App />);
  await waitFor(() => {
    expect(screen.queryByLabelText('載入中')).toBeNull();
  });
  // Wait for AuthGate to authorize the operator and render the main UI
  await waitFor(() => {
    expect(screen.queryByText('Counter')).toBeTruthy();
  });
}
