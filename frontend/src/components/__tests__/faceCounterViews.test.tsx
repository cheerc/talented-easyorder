import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { usePosStore } from '../../store/posStore';
import { createLocalAccount } from '../../domain/student';
import { FaceActivityStrip } from '../pos/FaceActivityStrip';
import { TopBar } from '../pos/TopBar';
import { TransactionStatusView } from '../pos/TransactionStatusView';
import { AdminScreen } from '../screens/AdminScreen';
import { FirebaseProvider } from '../../providers/FirebaseProvider';
import { FACE_REFUND_NOTICE, type FaceOrderRequest } from '../../domain/faceOrder';
import { buildPosTransactionDraft } from '../../domain/posTransaction';
import { resolveMenuForDate } from '../../domain/menu';

// 人臉連線第二批：櫃台看得到的刷臉畫面（F1 動態、頂部平板狀態、F3 人臉欄、F1 個人當日的刷臉標示）。
const D = '2026-10-14';
const s = () => usePosStore.getState();
let seq = 0;
const req = (studentId: string, action: 'order' | 'cancel' = 'order', extra: Partial<FaceOrderRequest> = {}): FaceOrderRequest => ({
  eventId: `ui-${++seq}`, deviceId: 'faceorder-01', action, studentId, businessDate: D, recognizedAt: `${D}T02:00:00.000Z`, ...extra,
});

beforeEach(() => {
  s().startBlankData();
  s().addLocalStudent(createLocalAccount({ studentId: '005', displayName: '陳小明/陳大強', openingBalance: 300, openingNote: '', asOfDate: D }, 'now'));
  s().addLocalStudent(createLocalAccount({ studentId: '006', displayName: '林小華', openingBalance: 0, openingNote: '', asOfDate: D }, 'now'));
  s().setMenuForDate(D, { itemName: '排骨便當', price: 90, vendorId: '', vendorNameSnapshot: '' }, 'now');
});

describe('F1 刷臉訂餐動態', () => {
  it('當天沒有刷臉事件時不佔空間', () => {
    const { container } = render(<FaceActivityStrip viewDate={D} />);
    expect(container.innerHTML).toBe('');
  });

  it('新的在前：時間（台北）、帳戶、成員、訂餐／加訂／取消、入帳／退回與提醒；點一列選那個人', () => {
    // 006 在櫃台付現 100 訂餐，之後平板取消 → 提醒退餐費
    const st = s();
    const r = st.commitPosTransactionDraft(buildPosTransactionDraft({
      intent: { businessDate: D, studentId: '006', type: 'order', mealPrice: 90, paidAmount: 100, note: '', sourceDevice: 'pc' },
      student: st.students.find(x => x.studentId === '006')!, menu: resolveMenuForDate(st.menusByDate, st.todayMenu, D).menu,
    }));
    expect(r.ok).toBe(true);
    s().handleFaceEvent(req('005', 'order', { memberName: '陳小明' }), `${D}T02:00:00.000Z`);
    s().handleFaceEvent(req('005', 'order', { memberName: '陳大強' }), `${D}T02:01:00.000Z`);
    s().handleFaceEvent(req('006', 'cancel'), `${D}T02:02:00.000Z`);
    s().handleFaceEvent(req('999'), `${D}T02:03:00.000Z`);
    s().handleFaceEvent(req('005', 'order', { businessDate: '2026-10-15' }), `${D}T02:04:00.000Z`);

    const onClick = vi.fn();
    render(<FaceActivityStrip viewDate={D} onStudentClick={onClick} />);
    const rows = within(screen.getByRole('region', { name: '刷臉訂餐' })).getAllByText(/^\d\d:\d\d$/).map(el => el.parentElement!);
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain('10:03');
    expect(rows[0].textContent).toContain('退回：找不到這個帳戶，請到櫃台。');
    expect(rows[1].textContent).toContain('林小華');
    expect(rows[1].textContent).toContain('取消');
    expect(rows[1].textContent).toContain(`已取消 · ${FACE_REFUND_NOTICE}`);
    expect(rows[2].textContent).toContain('（陳大強）');
    expect(rows[2].textContent).toContain('加訂');
    expect(rows[2].textContent).toContain('入帳');
    expect(rows[3].textContent).toContain('10:00');
    expect(rows[3].textContent).toContain('訂餐');
    expect(rows[3].textContent).not.toContain('加訂');
    fireEvent.click(rows[2]);
    expect(onClick).toHaveBeenCalledWith('005');
  });
});

describe('頂部刷臉平板在線／離線', () => {
  const props = { tab: 'pos', setTab: () => {}, online: true, syncing: false, lastSync: '12:00', todayCount: 0, viewDate: D, setViewDate: () => {}, storageMode: 'prototype' as const };

  it('沒有平板登記時不顯示', () => {
    const { container } = render(<TopBar {...props} />);
    expect(container.textContent).not.toContain('刷臉平板');
  });

  it('顯示在線／離線；title 有最後上線時間（台北）與版本；不放刷臉統計數字', () => {
    s().setFaceDeviceStatus({ deviceId: 'faceorder-01', online: true, lastSeenAt: `${D}T02:05:00.000Z`, appVersion: '1.2', modelVersion: 'w600k_r50' });
    const { container, rerender } = render(<TopBar {...props} />);
    const badge = screen.getByText('刷臉平板 · 在線').parentElement!;
    expect(badge.getAttribute('title')).toBe('刷臉平板 01：最後上線 2026-10-14 10:05:00 · App 1.2 · 模型 w600k_r50');
    s().setFaceDeviceStatus({ deviceId: 'faceorder-01', online: false, lastSeenAt: `${D}T02:06:00.000Z` });
    rerender(<TopBar {...props} />);
    expect(screen.getByText('刷臉平板 · 離線')).toBeTruthy();
    expect(container.textContent).not.toMatch(/刷臉.*\d+ ?(份|筆)/);
  });
});

describe('F3 帳戶清單人臉欄（唯讀）', () => {
  it('顯示註冊狀態；平板回報 2 張後顯示「已註冊（2 張）」', () => {
    s().applyFaceEnrollment({ deviceId: 'faceorder-01', studentId: '005', status: 'enrolled', faceCount: 2, reportedAt: `${D}T02:00:00.000Z` });
    render(<FirebaseProvider><AdminScreen viewDate={D} /></FirebaseProvider>);
    expect(screen.getByTestId('student-face-005').textContent).toBe('人臉 已註冊（2 張）');
    expect(screen.getByTestId('student-face-006').textContent).toBe('人臉 未註冊');
  });
});

describe('F1 個人當日狀況的刷臉標示', () => {
  it('刷臉來的交易有「刷臉」小標示，櫃台的沒有', () => {
    s().handleFaceEvent(req('005'), `${D}T02:00:00.000Z`);
    const st = s();
    st.commitPosTransactionDraft(buildPosTransactionDraft({
      intent: { businessDate: D, studentId: '005', type: 'order', mealPrice: 90, paidAmount: 0, note: '', sourceDevice: 'pc' },
      student: st.students.find(x => x.studentId === '005')!, menu: resolveMenuForDate(st.menusByDate, st.todayMenu, D).menu,
    }));
    render(<TransactionStatusView transactions={s().transactions} />);
    const tags = screen.getAllByText('刷臉');
    expect(tags).toHaveLength(1);
    expect(tags[0].getAttribute('title')).toBe('刷臉訂餐');
  });
});
