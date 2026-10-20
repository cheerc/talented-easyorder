import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SafeDiagnosticEntry } from '../../../errors/errorLogger';

const mocks = vi.hoisted(() => ({
  firebase: {
    access: { ok: true, profile: { uid: 'operator-a' } },
    lease: { isKnown: true, isHolder: true, holderUid: 'operator-a', epoch: 3 },
  },
  entries: [] as SafeDiagnosticEntry[],
  clearResult: true,
}));

vi.mock('../../../hooks/useFirebase', () => ({ useFirebase: () => mocks.firebase }));
vi.mock('../../../errors/errorLogger', () => ({
  readSafeDiagnostics: () => mocks.entries,
  clearSafeDiagnostics: () => mocks.clearResult,
}));

import { CloudDiagnosticsPage } from '../CloudDiagnosticsPage';

const commandEntry: SafeDiagnosticEntry = {
  type: 'command-failure',
  commandId: 'f1111111-1111-4111-8111-111111111111',
  kind: 'CreatePayment',
  errorCode: 'UNKNOWN_RESULT',
  occurredAt: '2026-10-20T12:00:00.000Z',
};

describe('P13b1 Cloud F3 diagnostics actions', () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    mocks.firebase = {
      access: { ok: true, profile: { uid: 'operator-a' } },
      lease: { isKnown: true, isHolder: true, holderUid: 'operator-a', epoch: 3 },
    };
    mocks.entries = [commandEntry];
    mocks.clearResult = true;
    vi.restoreAllMocks();
    vi.useFakeTimers();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:p13b1-diagnostic') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  it('hides export and clear controls when the lease is not held', () => {
    mocks.firebase.lease = { isKnown: true, isHolder: false, holderUid: 'operator-b', epoch: 4 };
    render(<CloudDiagnosticsPage identityKey="operator-a:3" leaseEpoch={3} />);
    expect(screen.queryByRole('button', { name: '匯出本機診斷' })).toBeNull();
    expect(screen.queryByRole('button', { name: '清除本機診斷' })).toBeNull();
  });

  it('revokes a pending download on unmount and suppresses delayed success output', () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const view = render(<CloudDiagnosticsPage identityKey="operator-a:3" leaseEpoch={3} />);
    fireEvent.click(screen.getByRole('button', { name: '匯出本機診斷' }));
    expect(anchorClick).toHaveBeenCalledTimes(1);
    view.unmount();
    vi.runOnlyPendingTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:p13b1-diagnostic');
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });

  it('does not report a download when browser download creation fails', () => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => { throw new Error('download failure marker'); }) });
    render(<CloudDiagnosticsPage identityKey="operator-a:3" leaseEpoch={3} />);
    fireEvent.click(screen.getByRole('button', { name: '匯出本機診斷' }));
    expect(screen.getByRole('alert')).toHaveTextContent('無法建立診斷下載');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the empty state after clearing and reports a storage failure without success', () => {
    mocks.clearResult = false;
    render(<CloudDiagnosticsPage identityKey="operator-a:3" leaseEpoch={3} />);
    fireEvent.click(screen.getByRole('button', { name: '清除本機診斷' }));
    expect(screen.getByRole('alert')).toHaveTextContent('無法清除本機診斷');
    expect(screen.queryByText('本機診斷紀錄已清除。')).toBeNull();
    expect(screen.queryByText('目前沒有可匯出的診斷紀錄。')).toBeNull();

    mocks.clearResult = true;
    fireEvent.click(screen.getByRole('button', { name: '清除本機診斷' }));
    expect(screen.getByText('目前沒有可匯出的診斷紀錄。')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('本機診斷紀錄已清除。');
  });
});
