import React, { useMemo } from 'react';
import { useFace } from '../../store/selectors';
import { faceEventActionLabel, faceEventResultLabel, faceEventsForDate } from '../../domain/faceOrder';
import { formatTaipeiTime } from '../../utils/dateTime';

interface FaceActivityStripProps {
  viewDate: string;
  /** 點一列選那個人到 F1；歷史或關帳日不傳。 */
  onStudentClick?: (studentId: string) => void;
}

/**
 * F1「刷臉訂餐」動態（CheerC 2026-10-13）：快速看誰是刷臉的。純資訊，櫃台不用操作；
 * 統計照舊算全部訂單，這裡不放任何刷臉統計數字。當天沒有刷臉事件時不顯示。
 */
export const FaceActivityStrip = React.memo(function FaceActivityStrip({ viewDate, onStudentClick }: FaceActivityStripProps) {
  const { faceEvents } = useFace();
  const events = useMemo(() => faceEventsForDate(faceEvents, viewDate), [faceEvents, viewDate]);
  if (events.length === 0) return null;

  return (
    <div className="recent face-activity" role="region" aria-label="刷臉訂餐">
      <div className="recent-head">刷臉訂餐</div>
      <div className="recent-list">
        {events.map(ev => {
          const rejected = ev.status === 'rejected';
          const clickable = Boolean(onStudentClick) && !rejected;
          return (
            <div
              key={ev.eventId}
              className={'face-activity-row' + (rejected ? ' face-activity-row--rejected' : '')}
              onClick={clickable ? () => onStudentClick?.(ev.studentId) : undefined}
              style={{ cursor: clickable ? 'pointer' : 'default' }}
            >
              <span className="recent-time mono">{formatTaipeiTime(ev.handledAt).slice(0, 5)}</span>
              <span className="face-activity-who">
                <span className="recent-id mono">{ev.studentId}</span>{' '}
                <span className="recent-name">{ev.studentName ?? ''}</span>
                {ev.memberName && <span className="dim">（{ev.memberName}）</span>}
              </span>
              <span className="face-activity-action">{faceEventActionLabel(ev)}</span>
              <span className="face-activity-result">{faceEventResultLabel(ev)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});
