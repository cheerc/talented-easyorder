import React from 'react';
import { fmt, money } from '../pos-components';
import type { DailySettlement } from '../../domain/cashClose';
import { operatorLabel } from '../../domain/operatorId';
import { formatTaipeiTime } from '../../utils/dateTime';

interface DayEndBarProps {
  businessDate: string;
  dateStatus: string;
  /** 本人在 F3 確認過的開帳金額；null 表示還沒設定。 */
  openingCash: number | null;
  /** 這一天全部交易的淨現金（不受 F2 區間與搜尋影響）。 */
  netCash: number;
  /** 這一天最後一版結帳紀錄。 */
  settlement: DailySettlement | undefined;
  /** 這一天最後一次「已關帳」的紀錄；重開後提醒上次點了多少。 */
  lastClosed: DailySettlement | undefined;
  expanded: boolean;
  onToggle: () => void;
  onReopen: () => void;
  /** 展開時顯示的點現金表單。 */
  children?: React.ReactNode;
}

const signed = (n: number) => (n === 0 ? '✓ 平' : `${n > 0 ? '+' : '−'}$${fmt(Math.abs(n))}`);

/**
 * M3 F2：今日帳以明細為主，日末才按「日末點現金」展開關帳表單。
 * 已關帳時改顯示這一天最後一版的結帳摘要，旁邊是「重新開啟」。
 */
export const DayEndBar = React.memo(function DayEndBar({
  businessDate, dateStatus, openingCash, netCash, settlement, lastClosed, expanded, onToggle, onReopen, children,
}: DayEndBarProps) {
  if (dateStatus === 'closed') {
    return (
      <div className="card day-end-bar" role="region" aria-label="日末結帳" style={{ marginBottom: '16px', padding: '12px 20px' }}>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>{businessDate} 已關帳</strong>
          {settlement && (
            <>
              <span className="pill">第 {settlement.settlementRevision} 版</span>
              <span className="mono">應有 {money(settlement.expectedCash)}</span>
              <span className="mono">實點 ${fmt(settlement.countedCash)}</span>
              <span className={'mono ' + (settlement.difference === 0 ? '' : settlement.difference > 0 ? 'pos' : 'warn')}>
                差異 {signed(settlement.difference)}
              </span>
              {settlement.note && <span>原因：{settlement.note}</span>}
              <span className="dim" style={{ fontSize: '12px' }}>
                {operatorLabel(settlement.closedBy)} · {formatTaipeiTime(settlement.closedAt)}
              </span>
            </>
          )}
          <span style={{ flex: 1 }} />
          <button className="ghost-btn" onClick={onReopen}>重新開啟日期</button>
        </div>
        <div className="dim" style={{ fontSize: '12px', marginTop: '6px' }}>關帳後這一天不能新增、更正或刪除；要補記請先重新開啟並填理由。</div>
      </div>
    );
  }

  const expected = openingCash === null ? null : openingCash + netCash;
  return (
    <div className="card day-end-bar" role="region" aria-label="日末結帳" style={{ marginBottom: '16px', padding: '12px 20px' }}>
      <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>{businessDate} 日末</strong>
        {dateStatus === 'reopened' && (
          <span className="pill pill-warn">
            已重開{lastClosed ? `（上次關帳第 ${lastClosed.settlementRevision} 版：實點 $${fmt(lastClosed.countedCash)}，差異 ${signed(lastClosed.difference)}）` : ''}
          </span>
        )}
        <span className="mono">開帳 {openingCash === null ? '未設定' : `$${fmt(openingCash)}`}</span>
        <span className="mono">淨現金 {money(netCash)}</span>
        <span className="mono">應有 {expected === null ? '—' : money(expected)}</span>
        <span style={{ flex: 1 }} />
        <button
          className={expanded ? 'ghost-btn' : 'btn-confirm'}
          style={expanded ? undefined : { width: 'auto', flex: 'none', padding: '8px 18px' }}
          aria-expanded={expanded}
          aria-controls="day-end-panel"
          onClick={onToggle}
        >
          {expanded ? '收起點現金' : '日末點現金'}
        </button>
      </div>
      {expanded && (
        <div id="day-end-panel" style={{ marginTop: '12px' }}>
          {children}
        </div>
      )}
    </div>
  );
});
