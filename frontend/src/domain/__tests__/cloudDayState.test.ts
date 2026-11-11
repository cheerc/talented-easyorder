import { describe, expect, it } from 'vitest';
import { dayStateLabel } from '../cloudDayState';

const TODAY = '2026-11-11';

describe('dayStateLabel（#688：日期列與橫幅 chip 共用的狀態文字）', () => {
  it('shows a closed day as 已關帳 (ok), even if it was backfilled', () => {
    expect(dayStateLabel({ status: 'closed', backfill: false, kind: null, dayId: '2026-11-05', today: TODAY })).toEqual({ text: '已關帳', variant: 'ok' });
    expect(dayStateLabel({ status: 'closed', backfill: true, kind: null, dayId: '2026-11-05', today: TODAY }).text).toBe('已關帳');
  });

  it('labels a backfilling day 補登中, and 補登中（已重開） when it was reopened', () => {
    expect(dayStateLabel({ status: 'open', backfill: true, kind: 'needs-close', dayId: '2026-11-05', today: TODAY })).toEqual({ text: '補登中', variant: 'warn' });
    expect(dayStateLabel({ status: 'reopened', backfill: true, kind: 'needs-close', dayId: '2026-11-05', today: TODAY })).toEqual({ text: '補登中（已重開）', variant: 'warn' });
  });

  it('labels a reopened ordinary day 已重開', () => {
    expect(dayStateLabel({ status: 'reopened', backfill: false, kind: 'needs-close', dayId: '2026-11-05', today: TODAY })).toEqual({ text: '已重開', variant: 'warn' });
  });

  it('labels a day that still needs its opening cash confirmed 待確認開帳', () => {
    expect(dayStateLabel({ status: 'open', backfill: false, kind: 'missing-opening', dayId: '2026-11-05', today: TODAY })).toEqual({ text: '待確認開帳', variant: 'warn' });
    expect(dayStateLabel({ status: 'open', backfill: false, kind: 'missing-opening', dayId: TODAY, today: TODAY }).text).toBe('待確認開帳');
  });

  it('keeps a future day on 開啟中 even without opening cash: only today and past days wait for the opening (#688 nit)', () => {
    expect(dayStateLabel({ status: 'open', backfill: false, kind: 'missing-opening', dayId: '2026-11-12', today: TODAY })).toEqual({ text: '開啟中', variant: 'warn' });
    expect(dayStateLabel({ status: 'open', backfill: false, kind: 'missing-opening', dayId: TODAY, today: TODAY }).text).toBe('待確認開帳');
  });

  it('calls an open day 開啟中 today or later and 尚未關帳 once it is in the past', () => {
    expect(dayStateLabel({ status: 'open', backfill: false, kind: 'needs-close', dayId: TODAY, today: TODAY })).toEqual({ text: '開啟中', variant: 'warn' });
    expect(dayStateLabel({ status: 'open', backfill: false, kind: null, dayId: '2026-11-12', today: TODAY }).text).toBe('開啟中');
    expect(dayStateLabel({ status: 'open', backfill: false, kind: 'needs-close', dayId: '2026-11-05', today: TODAY })).toEqual({ text: '尚未關帳', variant: 'warn' });
  });

  it('keeps a no-business day on its existing 開啟中 wording (nothing to close)', () => {
    expect(dayStateLabel({ status: 'open', backfill: false, kind: 'no-business', dayId: '2026-11-03', today: TODAY }).text).toBe('開啟中');
  });
});
