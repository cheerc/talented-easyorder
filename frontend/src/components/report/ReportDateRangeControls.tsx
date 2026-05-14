import type { LedgerDateRangeKind } from '../../domain/ledgerReport';

interface ReportDateRangeControlsProps {
  dateRange: LedgerDateRangeKind;
  setDateRange: (r: LedgerDateRangeKind) => void;
  todayStr: string;
  txCount: number;
  customStart: string;
  customEnd: string;
  setCustomStart: (v: string) => void;
  setCustomEnd: (v: string) => void;
}

export function ReportDateRangeControls({
  dateRange,
  setDateRange,
  todayStr,
  txCount,
  customStart,
  customEnd,
  setCustomStart,
  setCustomEnd,
}: ReportDateRangeControlsProps) {
  const dates: { id: LedgerDateRangeKind; label: string }[] = [
    { id: 'today',  label: `今日 (${todayStr})` },
    { id: 'week',   label: '本週' },
    { id: 'month',  label: '本月' },
    { id: 'custom', label: '自訂…' },
  ];

  return (
    <div className="rpt-daterange">
      {dates.map(d => (
        <button key={d.id}
          className={'rpt-date ' + (dateRange === d.id ? 'rpt-on' : '')}
          onClick={() => setDateRange(d.id)}>
          {d.label}
        </button>
      ))}
      {dateRange === 'custom' && (
        <span style={{ display: 'flex', gap: '6px', alignItems: 'center', marginLeft: '8px' }}>
          <input type="date" className="rpt-edit-input" value={customStart} onChange={e => setCustomStart(e.target.value)} style={{ width: '140px' }} />
          <span>～</span>
          <input type="date" className="rpt-edit-input" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={{ width: '140px' }} />
        </span>
      )}
      <div className="rpt-date-meta dim">
        {dateRange === 'today' && `今日即時更新中 · 共 ${txCount} 筆交易`}
      </div>
    </div>
  );
}