import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FaceTabletSimulator } from '../screens/FaceTabletSimulator';
import { usePosStore } from '../../store/posStore';
import { createLocalAccount } from '../../domain/student';

const D = '2026-10-14';
const s = () => usePosStore.getState();

beforeEach(() => {
  s().startBlankData();
  s().addLocalStudent(createLocalAccount({ studentId: '005', displayName: '張家', openingBalance: 300, openingNote: '', asOfDate: D }, 'now'));
  s().setMenuForDate(D, { itemName: '排骨餐點', price: 90, vendorId: '', vendorNameSnapshot: '' }, 'now');
});

describe('模擬刷臉平板', () => {
  it('第一次刷臉只有「正確，訂餐」；之後變成「加訂一份」「取消訂餐」；結果用平板的文字顯示', () => {
    render(<FaceTabletSimulator businessDate={D} />);
    fireEvent.change(screen.getByLabelText('刷臉的帳戶'), { target: { value: '005' } });
    fireEvent.change(screen.getByLabelText('刷臉的成員'), { target: { value: '張小華' } });
    expect(screen.queryByRole('button', { name: '取消訂餐' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '正確，訂餐。' }));
    expect(screen.getByRole('status').textContent).toBe('平板顯示：張家 訂餐成功！');
    expect(s().transactions[0]).toMatchObject({ note: '刷臉訂餐（張小華）', mealPrice: 90, paidAmount: 0 });

    fireEvent.click(screen.getByRole('button', { name: '加訂一份' }));
    expect(s().transactions.filter(t => t.type === 'order')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '取消訂餐' }));
    expect(screen.getByRole('status').textContent).toBe('平板顯示：張家 已取消訂餐。');
    expect(s().students[0].currentBalance).toBe(210);
  });

  it('註冊異動回報到帳戶；上線離線切換', () => {
    render(<FaceTabletSimulator businessDate={D} />);
    fireEvent.change(screen.getByLabelText('刷臉的帳戶'), { target: { value: '005' } });
    fireEvent.change(screen.getByLabelText('註冊張數'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '回報' }));
    expect(s().students[0]).toMatchObject({ faceEnrollmentStatus: 'enrolled', faceCount: 2 });
    fireEvent.click(screen.getByRole('button', { name: '設為離線' }));
    expect(s().faceDevices['faceorder-01'].online).toBe(false);
  });
});
