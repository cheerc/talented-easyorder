import type { LedgerAnomaly } from '../../domain/ledgerAnomalies';
import type { CloudLedgerView } from '../../hooks/useCloudLedger';
import './CloudLedgerAnomaliesPage.css';

export interface CloudLedgerAnomaliesPageProps {
  ledger: CloudLedgerView;
  onReload: () => void;
  /** 切到日結頁；帶 dayId 時直接選到那一天。 */
  onOpenDayClose: (dayId?: string) => void;
}

function formatMoney(value: number): string {
  return `NT$ ${new Intl.NumberFormat('zh-TW').format(value)}`;
}

function AnomalyItem({ anomaly, onOpenDayClose }: { anomaly: LedgerAnomaly; onOpenDayClose: (dayId?: string) => void }) {
  if (anomaly.kind === 'unclosed-past-day') {
    return (
      <li className="cloud-ledger-anomalies__item" data-kind={anomaly.kind}>
        <h3>{anomaly.dayId} 尚未關帳</h3>
        <p>
          這一天{anomaly.status === 'reopened' ? '重開後' : ''}還沒有關帳，
          {anomaly.openingCash === null ? '也還沒有確認開帳現金' : `開帳現金 ${formatMoney(anomaly.openingCash)}`}，
          目前有 {anomaly.activeTransactionCount} 筆有效交易。
          在它被處理之前，之後每天開帳與關帳都會看到警示。
        </p>
        <p>
          處理方式：到「日結」頁查看這一天，核對全日現金後關帳；沒有開帳現金時先補開帳（需填原因）。
          {anomaly.status === 'open' && '如果是斷線等原因漏記了交易，也可以先標為回填，再補登剩下的交易。'}
        </p>
        <div className="cloud-ledger-anomalies__actions">
          <button type="button" onClick={() => onOpenDayClose(anomaly.dayId)}>到日結頁處理 {anomaly.dayId}</button>
          {anomaly.status === 'open' && (
            <button type="button" onClick={() => onOpenDayClose(anomaly.dayId)} data-testid={`anomaly-mark-backfill-${anomaly.dayId}`}>
              標為回填，補登剩下的交易（{anomaly.dayId}）
            </button>
          )}
        </div>
      </li>
    );
  }
  const direction = anomaly.difference > 0 ? '多' : '少';
  return (
    <li className="cloud-ledger-anomalies__item" data-kind={anomaly.kind}>
      <h3>{anomaly.dayId} 開帳現金與上次關帳不符</h3>
      <p>
        {anomaly.dayId} 的開帳現金是 {formatMoney(anomaly.openingCash)}，上一個已關帳日 {anomaly.previousClosedDayId} 的實點現金是
        {' '}{formatMoney(anomaly.previousCountedCash)}
        {anomaly.previousPostCloseNet !== 0
          ? `，關帳後補記淨額 ${anomaly.previousPostCloseNet > 0 ? '+' : '−'}${formatMoney(Math.abs(anomaly.previousPostCloseNet))}，有效關帳現金 ${formatMoney(anomaly.previousEffectiveCash)}`
          : ''}
        ，開帳比{anomaly.previousPostCloseNet !== 0 ? '有效關帳現金' : '實點'}{direction}了 {formatMoney(Math.abs(anomaly.difference))}。
        兩天相隔 {anomaly.daysApart} 天。
      </p>
      <p>
        差額可能來自中間沒有記到的日子，或前一個已關帳日的帳。中間完全沒有營業日資料的日子可以在下面回填，
        補登當天的訂餐、繳費與櫃台收支；在前一個已關帳日補記一筆有標記的收支還沒開放。這一筆只是記錄異常，金額尚未更正。
      </p>
      {anomaly.gapDayCount > 0 ? (
        <div data-testid={`gap-days-${anomaly.dayId}`}>
          <p>
            中間沒有營業日資料的日子共 {anomaly.gapDayCount} 天
            {anomaly.gapDayCount > anomaly.gapDays.length ? `，這裡先列出最早的 ${anomaly.gapDays.length} 天，處理完再重新讀取就會輪到後面的` : ''}：
          </p>
          <ul className="cloud-ledger-anomalies__gap-days">
            {anomaly.gapDays.map(gapDay => (
              <li key={gapDay}>
                <span>{gapDay}</span>
                <button type="button" onClick={() => onOpenDayClose(gapDay)} data-testid={`backfill-gap-${gapDay}`}>回填這一天（{gapDay}）</button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p>兩個日期之間每一天都已經有營業日資料，沒有可以回填的空日。</p>
      )}
    </li>
  );
}

export function CloudLedgerAnomaliesPage({ ledger, onReload, onOpenDayClose }: CloudLedgerAnomaliesPageProps) {
  return (
    <main className="cloud-ledger-anomalies" aria-label="帳務異常">
      <header className="cloud-ledger-anomalies__header">
        <div>
          <p className="cloud-ledger-anomalies__eyebrow">雲端資料 · 線上操作</p>
          <h1>帳務異常</h1>
          <p>
            這裡列出伺服器上的帳務異常：過去沒有關帳的日子，以及開帳現金和上一個已關帳日實點不同的日子。
            異常不會擋住當天作業，但請儘速處理，避免帳務核對越來越困難。
          </p>
        </div>
        <button type="button" onClick={onReload} disabled={ledger.status === 'loading'}>
          {ledger.status === 'loading' ? '讀取中…' : '重新讀取'}
        </button>
      </header>
      {ledger.status === 'loading' && <p role="status">正在從伺服器檢查帳務異常…</p>}
      {ledger.status === 'error' && <div className="cloud-ledger-anomalies__alert" role="alert">無法檢查帳務異常：{ledger.message}</div>}
      {ledger.status === 'ready' && (
        <>
          <p role="status">
            檢查範圍：{ledger.snapshot.goLiveDate} 至 {ledger.snapshot.today}，共 {ledger.snapshot.anomalies.length} 筆異常。
          </p>
          {ledger.snapshot.anomalies.length === 0 ? (
            <p className="cloud-ledger-anomalies__empty">目前沒有帳務異常。</p>
          ) : (
            <ul className="cloud-ledger-anomalies__list" aria-label="帳務異常清單">
              {ledger.snapshot.anomalies.map(anomaly => (
                <AnomalyItem key={`${anomaly.kind}:${anomaly.dayId}`} anomaly={anomaly} onOpenDayClose={onOpenDayClose} />
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
