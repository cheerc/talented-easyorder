import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CloudLedgerView } from '../../hooks/useCloudLedger';
import { CloudLedgerAnomaliesPage } from './CloudLedgerAnomaliesPage';

const ready = (anomalies: Extract<CloudLedgerView, { status: 'ready' }>['snapshot']['anomalies']): CloudLedgerView => ({
  status: 'ready',
  snapshot: { today: '2026-10-17', goLiveDate: '2026-10-01', anomalies, closedDays: [], seq: 3 },
});

function renderPage(ledger: CloudLedgerView) {
  const onReload = vi.fn();
  const onOpenDayClose = vi.fn();
  render(<CloudLedgerAnomaliesPage ledger={ledger} onReload={onReload} onOpenDayClose={onOpenDayClose} />);
  return { onReload, onOpenDayClose };
}

describe('CloudLedgerAnomaliesPage', () => {
  it('says there are no anomalies', () => {
    renderPage(ready([]));
    expect(screen.getByText('目前沒有帳務異常。')).toBeInTheDocument();
    expect(screen.getByText(/檢查範圍：2026-10-01 至 2026-10-17，共 0 筆異常/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '帳務異常清單' })).not.toBeInTheDocument();
  });

  it('explains an unclosed past day and sends that day to the close page', () => {
    const { onOpenDayClose } = renderPage(ready([
      { kind: 'unclosed-past-day', dayId: '2026-10-15', status: 'reopened', openingCash: null, activeTransactionCount: 3 },
    ]));
    const item = within(screen.getByRole('list', { name: '帳務異常清單' })).getByRole('listitem');
    expect(item).toHaveTextContent('2026-10-15 尚未關帳');
    expect(item).toHaveTextContent('重開後還沒有關帳');
    expect(item).toHaveTextContent('還沒有確認開帳現金');
    expect(item).toHaveTextContent('3 筆有效交易');
    fireEvent.click(within(item).getByRole('button', { name: '到日結頁處理 2026-10-15' }));
    expect(onOpenDayClose).toHaveBeenCalledWith('2026-10-15');
  });

  it('shows the opening amount of an unclosed day that has one', () => {
    renderPage(ready([
      { kind: 'unclosed-past-day', dayId: '2026-10-15', status: 'open', openingCash: 1200, activeTransactionCount: 0 },
    ]));
    expect(screen.getByRole('listitem')).toHaveTextContent('開帳現金 NT$ 1,200');
  });

  it('explains an opening mismatch without promising that the amount was corrected', () => {
    renderPage(ready([
      {
        kind: 'opening-mismatch', dayId: '2026-10-16', openingCash: 800, previousClosedDayId: '2026-10-13',
        previousCountedCash: 870, previousPostCloseNet: 0, previousEffectiveCash: 870, difference: -70, daysApart: 3, gapDays: [], gapDayCount: 0,
      },
    ]));
    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('2026-10-16 開帳現金與上次關帳不符');
    expect(item).toHaveTextContent('開帳現金是 NT$ 800');
    expect(item).toHaveTextContent('2026-10-13 的實點現金是 NT$ 870');
    expect(item).toHaveTextContent('少了 NT$ 70');
    expect(item).toHaveTextContent('相隔 3 天');
    expect(item).toHaveTextContent('在前一個已關帳日補記一筆有標記的收支還沒開放');
    expect(item).toHaveTextContent('金額尚未更正');
    expect(item).toHaveTextContent('每一天都已經有營業日資料，沒有可以回填的空日');
    expect(item).not.toHaveTextContent(/已更正完成|已修正/);
    expect(within(item).queryByRole('button')).not.toBeInTheDocument();
  });

  it('lists the gap days of an opening mismatch with a backfill button each', () => {
    const { onOpenDayClose } = renderPage(ready([
      {
        kind: 'opening-mismatch', dayId: '2026-10-16', openingCash: 800, previousClosedDayId: '2026-10-13',
        previousCountedCash: 870, previousPostCloseNet: 0, previousEffectiveCash: 870, difference: -70, daysApart: 3, gapDays: ['2026-10-14', '2026-10-15'], gapDayCount: 2,
      },
    ]));
    const gap = screen.getByTestId('gap-days-2026-10-16');
    expect(gap).toHaveTextContent('中間沒有營業日資料的日子共 2 天');
    expect(gap).not.toHaveTextContent('先列出最早的');
    fireEvent.click(within(gap).getByRole('button', { name: '回填這一天（2026-10-15）' }));
    expect(onOpenDayClose).toHaveBeenCalledWith('2026-10-15');
    fireEvent.click(within(gap).getByRole('button', { name: '回填這一天（2026-10-14）' }));
    expect(onOpenDayClose).toHaveBeenLastCalledWith('2026-10-14');
  });

  it('says honestly when only the earliest gap days are listed', () => {
    renderPage(ready([
      {
        kind: 'opening-mismatch', dayId: '2026-12-01', openingCash: 800, previousClosedDayId: '2026-10-01',
        previousCountedCash: 870, previousPostCloseNet: 0, previousEffectiveCash: 870, difference: -70, daysApart: 61, gapDays: ['2026-10-02', '2026-10-03'], gapDayCount: 59,
      },
    ]));
    expect(screen.getByTestId('gap-days-2026-12-01')).toHaveTextContent('共 59 天，這裡先列出最早的 2 天');
  });

  it('offers to mark an open past day as backfilled, but not a reopened one', () => {
    const { onOpenDayClose } = renderPage(ready([
      { kind: 'unclosed-past-day', dayId: '2026-10-14', status: 'open', openingCash: 1200, activeTransactionCount: 2 },
      { kind: 'unclosed-past-day', dayId: '2026-10-15', status: 'reopened', openingCash: 1200, activeTransactionCount: 2 },
    ]));
    fireEvent.click(screen.getByTestId('anomaly-mark-backfill-2026-10-14'));
    expect(onOpenDayClose).toHaveBeenCalledWith('2026-10-14');
    expect(screen.queryByTestId('anomaly-mark-backfill-2026-10-15')).not.toBeInTheDocument();
  });

  it('says more when the opening is higher than the last close', () => {
    renderPage(ready([
      {
        kind: 'opening-mismatch', dayId: '2026-10-16', openingCash: 900, previousClosedDayId: '2026-10-15',
        previousCountedCash: 870, previousPostCloseNet: 0, previousEffectiveCash: 870, difference: 30, daysApart: 1, gapDays: [], gapDayCount: 0,
      },
    ]));
    expect(screen.getByRole('listitem')).toHaveTextContent('多了 NT$ 30');
  });

  it('shows the loading state', () => {
    renderPage({ status: 'loading' });
    expect(screen.getByRole('status')).toHaveTextContent('正在從伺服器檢查帳務異常');
    expect(screen.getByRole('button', { name: '讀取中…' })).toBeDisabled();
  });

  it('shows a failure and lets the operator retry', () => {
    const { onReload } = renderPage({ status: 'error', message: '無法連線確認雲端日結' });
    expect(screen.getByRole('alert')).toHaveTextContent('無法檢查帳務異常：無法連線確認雲端日結');
    fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
