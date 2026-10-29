import type { LedgerAnomaly, OpeningMismatchAnomaly } from '../../domain/ledgerAnomalies';
import type { CloudLedgerView } from '../../hooks/useCloudLedger';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import './CloudLedgerAnomaliesPage.css';

export interface CloudLedgerAnomaliesPageProps {
  ledger: CloudLedgerView;
  onReload: () => void;
  /** 切到日結頁；帶 dayId 時直接選到那一天。 */
  onOpenDayClose: (dayId?: string) => void;
  /** 帶入開帳差額預覽；原因由日結頁上的操作者填寫。 */
  onOpenPostCloseEntry: (anomaly: OpeningMismatchAnomaly) => void;
}

function formatMoney(value: number): string {
  return `NT$ ${new Intl.NumberFormat('zh-TW').format(value)}`;
}

function AnomalyItem({ anomaly, onOpenDayClose, onOpenPostCloseEntry }: {
  anomaly: LedgerAnomaly;
  onOpenDayClose: (dayId?: string) => void;
  onOpenPostCloseEntry: (anomaly: OpeningMismatchAnomaly) => void;
}) {
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
          <Button type="button" variant="secondary" onClick={() => onOpenDayClose(anomaly.dayId)}>到日結頁處理 {anomaly.dayId}</Button>
          {anomaly.status === 'open' && (
            <Button type="button" variant="ghost" onClick={() => onOpenDayClose(anomaly.dayId)} data-testid={`anomaly-mark-backfill-${anomaly.dayId}`}>
              標為回填，補登剩下的交易（{anomaly.dayId}）
            </Button>
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
        補登當天的訂餐、繳費與櫃台收支。若中間沒有缺少營業日資料，且差額是前一個已關帳日漏記的現金收支，可以在該日新增一筆有原因的關帳後補記；補記不會修改原關帳實點，也不會自動更正其他交易。
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
                <Button type="button" variant="secondary" onClick={() => onOpenDayClose(gapDay)} data-testid={`backfill-gap-${gapDay}`}>回填這一天（{gapDay}）</Button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <p>兩個日期之間每一天都已經有營業日資料，沒有可以回填的空日。</p>
          <Button type="button" variant="secondary" onClick={() => onOpenPostCloseEntry(anomaly)} data-testid={`post-close-shortcut-${anomaly.dayId}`}>
            到前一個已關帳日補記差額（{anomaly.previousClosedDayId}）
          </Button>
        </>
      )}
    </li>
  );
}

export function CloudLedgerAnomaliesPage({ ledger, onReload, onOpenDayClose, onOpenPostCloseEntry }: CloudLedgerAnomaliesPageProps) {
  return (
    <main className="cloud-ledger-anomalies" aria-label="帳務異常">
      <header className="cloud-ledger-anomalies__header">
        <div className="cloud-ledger-anomalies__title">
          <p className="cloud-ledger-anomalies__eyebrow">雲端資料 · 線上操作</p>
          <h1>帳務異常</h1>
        </div>
        <Button type="button" variant="secondary" onClick={onReload} disabled={ledger.status === 'loading'}>
          {ledger.status === 'loading' ? '讀取中…' : '重新讀取'}
        </Button>
      </header>
      <details className="cloud-ledger-anomalies__intro">
        <summary>異常判定與處理原則</summary>
        <p>
          這裡列出伺服器上的帳務異常：過去沒有關帳的日子，以及開帳現金和上一個已關帳日實點不同的日子。
          異常不會擋住當天作業，但請儘速處理，避免帳務核對越來越困難。
        </p>
      </details>
      {ledger.status === 'loading' && <p role="status">正在從伺服器檢查帳務異常…</p>}
      {ledger.status === 'error' && <div className="cloud-ledger-anomalies__alert" role="alert">無法檢查帳務異常：{ledger.message}</div>}
      {ledger.status === 'ready' && (
        <>
          <p role="status" className="cloud-ledger-anomalies__range">
            檢查範圍：{ledger.snapshot.goLiveDate} 至 {ledger.snapshot.today}，共 {ledger.snapshot.anomalies.length} 筆異常。
          </p>
          {ledger.snapshot.anomalies.length === 0 ? (
            <div className="cloud-ledger-anomalies__card">
              <EmptyState title="目前沒有帳務異常。" />
            </div>
          ) : (
            <ul className="cloud-ledger-anomalies__list" aria-label="帳務異常清單">
              {ledger.snapshot.anomalies.map(anomaly => (
                <AnomalyItem
                  key={`${anomaly.kind}:${anomaly.dayId}`}
                  anomaly={anomaly}
                  onOpenDayClose={onOpenDayClose}
                  onOpenPostCloseEntry={onOpenPostCloseEntry}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
