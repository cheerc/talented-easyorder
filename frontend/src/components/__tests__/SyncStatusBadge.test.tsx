import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { SyncStatusBadge } from '../SyncStatusBadge';
import type { SyncIndicatorKind } from '../../firebase/syncStatus';

describe('SyncStatusBadge', () => {
  it('renders correct class and role', () => {
    const { container } = render(<SyncStatusBadge kind="green_synced" label="已同步" />);
    const badge = container.querySelector('.sync-badge.green_synced') as HTMLElement;
    expect(badge).toBeTruthy();
    expect(badge.getAttribute('role')).toBe('status');
    expect(badge.getAttribute('aria-live')).toBe('polite');
  });

  it('renders label text', () => {
    const { getByText } = render(<SyncStatusBadge kind="green_synced" label="已同步" />);
    expect(getByText('已同步')).toBeTruthy();
  });

  it('renders green icon for green_synced', () => {
    const { container } = render(<SyncStatusBadge kind="green_synced" label="已同步" />);
    expect(container.textContent).toContain('\u{1F7E2}');
  });

  it('renders yellow icon for yellow_syncing', () => {
    const { container } = render(<SyncStatusBadge kind="yellow_syncing" label="同步中" />);
    expect(container.textContent).toContain('\u{1F7E1}');
  });

  it('renders red icon for red_offline_pending', () => {
    const { container } = render(<SyncStatusBadge kind="red_offline_pending" label="離線" />);
    expect(container.textContent).toContain('\u{1F534}');
  });

  it('renders red icon for red_conflict', () => {
    const { container } = render(<SyncStatusBadge kind="red_conflict" label="衝突" />);
    expect(container.textContent).toContain('\u{1F534}');
  });

  it('renders different label per sync state', () => {
    const kinds: Array<{ kind: SyncIndicatorKind; label: string }> = [
      { kind: 'green_synced', label: '已同步' },
      { kind: 'yellow_syncing', label: '同步中' },
      { kind: 'red_offline_pending', label: '離線待處理' },
      { kind: 'red_conflict', label: '衝突' },
    ];
    for (const { kind, label } of kinds) {
      const { getByText, unmount } = render(<SyncStatusBadge kind={kind} label={label} />);
      expect(getByText(label)).toBeTruthy();
      unmount();
    }
  });
});
