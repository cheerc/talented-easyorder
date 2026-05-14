interface ExportActionsProps {
  onExportCsv: () => void;
  onPrint: () => void;
  onPushCloud?: () => void;
}

export function ExportActions({ onExportCsv, onPrint, onPushCloud }: ExportActionsProps) {
  return (
    <div className="rpt-toolbar">
      <div className="rpt-actions">
        <button className="ghost-btn" onClick={onPrint}>列印</button>
        <button className="ghost-btn" onClick={onExportCsv}>匯出 CSV</button>
        {onPushCloud && (
          <button className="ghost-btn ghost-strong" onClick={onPushCloud}>推送至雲端</button>
        )}
      </div>
    </div>
  );
}