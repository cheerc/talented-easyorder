import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataHeadSignal } from '../../firebase/dataHeadWatch';

const headMock = vi.hoisted(() => ({ current: null as DataHeadSignal | null }));
vi.mock('../../providers/FirebaseProvider', () => ({ useDataHead: () => headMock.current }));

import { DataUpdatedNotice } from './DataUpdatedNotice';

const head = (seq: number): DataHeadSignal => ({ seq, lastCommandId: `cmd-${seq}`, datasetId: 'ds-1', targets: {} });

describe('#587 P2 DataUpdatedNotice', () => {
  beforeEach(() => { headMock.current = null; });

  it('shows one status line with a reload button when the data head is ahead of the page', () => {
    headMock.current = head(8);
    const onReload = vi.fn();
    render(<DataUpdatedNotice pageSeq={7} onReload={onReload} />);
    expect(screen.getByRole('status')).toHaveTextContent('其他裝置已更新資料。');
    fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the head equals the page sequence', head(7), 7],
    ['the head is behind the page', head(3), 7],
    ['there is no head (not a confirmed holder, or no command yet)', null, 7],
    ['the page shows nothing yet', head(9), null],
  ])('shows nothing when %s', (_label, current, pageSeq) => {
    headMock.current = current;
    render(<DataUpdatedNotice pageSeq={pageSeq} onReload={vi.fn()} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows nothing while the page itself reads or has a command in flight (hidden)', () => {
    headMock.current = head(8);
    render(<DataUpdatedNotice pageSeq={7} onReload={vi.fn()} hidden />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('goes away once the page has caught up and comes back when the head moves on again', () => {
    headMock.current = head(8);
    const view = render(<DataUpdatedNotice pageSeq={7} onReload={vi.fn()} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    view.rerender(<DataUpdatedNotice pageSeq={8} onReload={vi.fn()} />);
    expect(screen.queryByRole('status')).toBeNull();
    headMock.current = head(9);
    view.rerender(<DataUpdatedNotice pageSeq={8} onReload={vi.fn()} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
