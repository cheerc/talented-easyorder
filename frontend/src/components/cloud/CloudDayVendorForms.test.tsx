import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  CloudDayMenuForm,
  CloudDayOpeningCashForm,
  CloudDayVendorForm,
  type CloudDayMenuDraft,
  type CloudDayVendorDraft,
} from './CloudDayVendorForms';

function VendorFormHarness({
  mode,
  initial,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  initial: CloudDayVendorDraft;
  onSubmit: (value: CloudDayVendorDraft) => void;
}) {
  const [value, setValue] = useState(initial);
  return <CloudDayVendorForm mode={mode} value={value} onChange={setValue} onSubmit={onSubmit} />;
}

function MenuFormHarness({ onSubmit }: { onSubmit: (value: CloudDayMenuDraft) => void }) {
  const [value, setValue] = useState<CloudDayMenuDraft>({ itemName: '', priceText: '', vendorId: '' });
  return (
    <CloudDayMenuForm
      businessDate="2026-10-15"
      value={value}
      vendors={[{ vendorId: 'vendor-a', name: '甲供應商' }]}
      onChange={setValue}
      onSubmit={onSubmit}
    />
  );
}

describe('CloudDayVendorForms', () => {
  it('emits raw vendor form values and only makes the identifier editable during creation', () => {
    const onSubmit = vi.fn();
    const initial: CloudDayVendorDraft = {
      vendorId: '',
      name: '',
      phone: '',
      note: '',
      status: 'inactive',
    };
    const { unmount } = render(<VendorFormHarness mode="create" initial={initial} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('供應商編號'), { target: { value: ' vendor-01 ' } });
    fireEvent.change(screen.getByLabelText('供應商名稱'), { target: { value: ' 甲店 ' } });
    fireEvent.change(screen.getByLabelText('聯絡電話'), { target: { value: ' 02-1234 ' } });
    fireEvent.change(screen.getByLabelText('備註'), { target: { value: ' 只傳草稿 ' } });
    fireEvent.click(screen.getByRole('button', { name: '建立供應商' }));

    expect(onSubmit).toHaveBeenCalledWith({
      vendorId: ' vendor-01 ',
      name: ' 甲店 ',
      phone: ' 02-1234 ',
      note: ' 只傳草稿 ',
      status: 'active',
    });

    unmount();
    const editSubmit = vi.fn();
    render(
      <VendorFormHarness
        mode="edit"
        initial={{ ...initial, vendorId: 'vendor-fixed', name: '原名稱' }}
        onSubmit={editSubmit}
      />,
    );
    expect(screen.getByLabelText('供應商編號')).toHaveAttribute('readonly');
    fireEvent.change(screen.getByLabelText('狀態'), { target: { value: 'inactive' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存供應商' }));
    expect(editSubmit).toHaveBeenCalledWith(expect.objectContaining({ status: 'inactive', vendorId: 'vendor-fixed' }));
  });

  it('emits the selected vendor and raw menu price text without converting the draft', () => {
    const onSubmit = vi.fn();
    render(<MenuFormHarness onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('菜單名稱'), { target: { value: ' 週四餐 ' } });
    fireEvent.change(screen.getByLabelText('價格（新臺幣整數）'), { target: { value: '0088' } });
    fireEvent.change(screen.getByLabelText('供應商'), { target: { value: 'vendor-a' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存菜單' }));

    expect(onSubmit).toHaveBeenCalledWith({
      itemName: ' 週四餐 ',
      priceText: '0088',
      vendorId: 'vendor-a',
    });
  });

  it('keeps an unconfirmed opening blank and reports an explicit zero as a distinct value', () => {
    const onSubmit = vi.fn();
    const onAmountTextChange = vi.fn();
    const { rerender } = render(
      <CloudDayOpeningCashForm
        businessDate="2026-10-15"
        currentOpeningCash={null}
        amountText=""
        onAmountTextChange={onAmountTextChange}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole('textbox', { name: /^開帳現金/ })).toHaveValue('');
    expect(screen.getByText(/尚未確認開帳/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '確認開帳金額' }));
    expect(onSubmit).not.toHaveBeenCalled();

    rerender(
      <CloudDayOpeningCashForm
        businessDate="2026-10-15"
        currentOpeningCash={null}
        amountText="0"
        onAmountTextChange={onAmountTextChange}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '確認開帳金額' }));
    expect(onSubmit).toHaveBeenCalledWith('0');

    rerender(
      <CloudDayOpeningCashForm
        businessDate="2026-10-15"
        currentOpeningCash={0}
        amountText="0"
        onAmountTextChange={onAmountTextChange}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByText(/伺服器已確認開帳現金 NT\$ 0/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更新開帳金額' })).toBeInTheDocument();
  });

  it('requires a supplied vendor option before saving a menu', () => {
    const onSubmit = vi.fn();
    const onChange = vi.fn();
    render(
      <CloudDayMenuForm
        businessDate="2026-10-15"
        value={{ itemName: '今日餐', priceText: '90', vendorId: '' }}
        vendors={[]}
        onChange={onChange}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole('button', { name: '儲存菜單' })).toBeDisabled();
    expect(screen.getByText(/目前沒有可選供應商/)).toBeInTheDocument();
  });
});
