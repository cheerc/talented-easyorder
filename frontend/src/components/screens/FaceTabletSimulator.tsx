import React, { useMemo, useState } from 'react';
import { useFace, useFaceActions, useStudents, useTransactions } from '../../store/selectors';
import {
  FACE_ENROLLMENT_LABELS, faceDailyStatus, faceDeviceLabel,
  type FaceOrderEvent, type FaceEventAction,
} from '../../domain/faceOrder';
import type { FaceEnrollmentStatus } from '../../domain/student';

const DEVICE_ID = 'faceorder-01';

interface FaceTabletSimulatorProps {
  /** 平板送出事件的營業日（練習模式下是練習營業日）。 */
  businessDate: string;
}

/** 平板上看到的結果文字（成功不說「已驗證本人」；退回時請到櫃台）。 */
function tabletMessage(ev: FaceOrderEvent): string {
  const name = ev.studentName ?? ev.studentId;
  if (ev.status === 'rejected') return ev.reason ?? '請到櫃台。';
  const base = ev.action === 'order' ? `${name} 訂餐成功！` : `${name} 已取消訂餐。`;
  return ev.notice ? `${base}${ev.notice}` : base;
}

/**
 * 練習模式的「模擬刷臉平板」。這一輪沒有真的平板連線，用這裡送出和真平板相同的事件：
 * 訂餐（第二次刷臉時是加訂一份）、取消訂餐、註冊異動、上線／離線。規則都在 store 的 handleFaceEvent，與日後真平板相同。
 */
export const FaceTabletSimulator = React.memo(function FaceTabletSimulator({ businessDate }: FaceTabletSimulatorProps) {
  const { students } = useStudents();
  const { transactions } = useTransactions();
  const { faceDevices } = useFace();
  const { handleFaceEvent, applyFaceEnrollment, setFaceDeviceStatus } = useFaceActions();
  const [studentId, setStudentId] = useState('');
  const [memberName, setMemberName] = useState('');
  const [enrollStatus, setEnrollStatus] = useState<FaceEnrollmentStatus>('enrolled');
  const [faceCount, setFaceCount] = useState('1');
  const [lastMessage, setLastMessage] = useState('');

  const device = faceDevices[DEVICE_ID];
  const status = useMemo(
    () => (studentId ? faceDailyStatus(students, transactions, businessDate, studentId) : null),
    [students, transactions, businessDate, studentId],
  );

  const send = (action: FaceEventAction) => {
    if (!studentId) return;
    const now = new Date().toISOString();
    const ev = handleFaceEvent({
      eventId: crypto.randomUUID(), deviceId: DEVICE_ID, action, studentId,
      ...(memberName.trim() ? { memberName: memberName.trim() } : {}),
      businessDate, recognizedAt: now,
    }, now);
    setLastMessage(tabletMessage(ev));
  };

  const sendEnrollment = () => {
    if (!studentId) return;
    const n = Number(faceCount);
    const ok = applyFaceEnrollment({
      deviceId: DEVICE_ID, studentId, status: enrollStatus,
      ...(Number.isSafeInteger(n) && n >= 0 ? { faceCount: n } : {}),
      reportedAt: new Date().toISOString(),
    });
    setLastMessage(ok ? `已回報 ${studentId} 的人臉註冊：${FACE_ENROLLMENT_LABELS[enrollStatus]}` : '找不到這個帳戶。');
  };

  return (
    <div style={{ marginTop: '32px', borderTop: '1px solid var(--line)', paddingTop: '20px' }} role="region" aria-label="模擬刷臉平板">
      <div className="card-h">模擬刷臉平板 <span className="card-h-sub">練習用；送出的事件和真平板相同，會直接入帳</span></div>
      <div className="adm-row">
        <label>平板</label>
        <span>
          {faceDeviceLabel(DEVICE_ID)} · {device?.online ? '在線' : '離線'}
          <button className="ghost-btn" style={{ marginLeft: '8px' }}
                  onClick={() => setFaceDeviceStatus({ deviceId: DEVICE_ID, online: !device?.online, lastSeenAt: new Date().toISOString(), appVersion: '練習', modelVersion: 'w600k_r50' })}>
            {device?.online ? '設為離線' : '設為上線'}
          </button>
        </span>
      </div>
      <div className="adm-row">
        <label>刷臉的人</label>
        <select className="adm-input" aria-label="刷臉的帳戶" value={studentId} onChange={e => { setStudentId(e.target.value); setLastMessage(''); }}>
          <option value="">（選帳戶）</option>
          {students.map(s => <option key={s.studentId} value={s.studentId}>{s.studentId} {s.displayName}</option>)}
        </select>
      </div>
      <div className="adm-row">
        <label>成員（共用帳戶）</label>
        <input className="adm-input" aria-label="刷臉的成員" value={memberName} placeholder="例如兄弟姊妹之一；可空白" onChange={e => setMemberName(e.target.value)} />
      </div>
      {status && (
        <div style={{ margin: '8px 0', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '10px' }}>
          <div className="dim" style={{ fontSize: '12px', marginBottom: '6px' }}>平板畫面（只看得到名字與今天訂了幾份，看不到餘額）</div>
          <div style={{ fontWeight: 600, marginBottom: '8px' }}>
            {status.displayName}{status.orderCount > 0 ? `（今天已訂 ${status.orderCount} 份）` : ''}
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {status.orderCount === 0 ? (
              <button className="btn-confirm" style={{ width: 'auto', flex: 'none' }} onClick={() => send('order')}>正確，訂餐。</button>
            ) : (
              <>
                <button className="btn-confirm" style={{ width: 'auto', flex: 'none' }} onClick={() => send('order')}>加訂一份</button>
                <button className="ghost-btn" onClick={() => send('cancel')}>取消訂餐</button>
              </>
            )}
          </div>
        </div>
      )}
      {lastMessage && <div role="status" style={{ margin: '6px 0', fontWeight: 600 }}>平板顯示：{lastMessage}</div>}
      <div className="adm-row" style={{ marginTop: '12px' }}>
        <label>註冊異動</label>
        <span style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="adm-input" aria-label="註冊狀態" value={enrollStatus} onChange={e => setEnrollStatus(e.target.value as FaceEnrollmentStatus)} style={{ width: 'auto' }}>
            {(Object.keys(FACE_ENROLLMENT_LABELS) as FaceEnrollmentStatus[]).map(k => <option key={k} value={k}>{FACE_ENROLLMENT_LABELS[k]}</option>)}
          </select>
          <input className="adm-input mono" aria-label="註冊張數" value={faceCount} onChange={e => setFaceCount(e.target.value)} style={{ width: '60px' }} />
          <span className="dim">張</span>
          <button className="ghost-btn" disabled={!studentId} onClick={sendEnrollment}>回報</button>
        </span>
      </div>
    </div>
  );
});
