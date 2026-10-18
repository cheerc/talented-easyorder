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
import type { PreviousClosedDay } from '../../domain/ledgerAnomalies';

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

  describe('CloudDayOpeningCashForm: difference from the last close (contract §11)', () => {
    const previousClosed: PreviousClosedDay = { dayId: '2026-10-14', countedCash: 870 };

    function renderForm(props: { amountText: string; previousClosed?: typeof previousClosed | null; ledgerNotice?: string }) {
      const onSubmit = vi.fn();
      const onReasonTextChange = vi.fn();
      render(
        <CloudDayOpeningCashForm
          businessDate="2026-10-16"
          currentOpeningCash={null}
          amountText={props.amountText}
          onAmountTextChange={vi.fn()}
          onSubmit={onSubmit}
          reasonText=""
          onReasonTextChange={onReasonTextChange}
          {...('previousClosed' in props ? { previousClosed: props.previousClosed } : {})}
          {...(props.ledgerNotice ? { ledgerNotice: props.ledgerNotice } : {})}
        />,
      );
      return { onSubmit, onReasonTextChange };
    }

    it('shows the last closed day and its counted cash', () => {
      renderForm({ amountText: '870', previousClosed });
      expect(screen.getByText(/上一個已關帳日 2026-10-14 的實點現金為 NT\$ 870/)).toBeInTheDocument();
    });

    it('shows the post-close net and the effective closing cash when there are entries (contract §15)', () => {
      renderForm({ amountText: '820', previousClosed: { ...previousClosed, postCloseNet: -50 } });
      expect(screen.getByText(/關帳後補記淨支出 NT\$ 50，有效關帳現金 NT\$ 820/)).toBeInTheDocument();
    });

    it('shows a difference warning and a required reason field when the amount differs, and still allows submitting', () => {
      const { onSubmit, onReasonTextChange } = renderForm({ amountText: '800', previousClosed });
      expect(screen.getByRole('alert')).toHaveTextContent('比上次關帳實點少了 NT$ 70');
      fireEvent.change(screen.getByLabelText(/差額原因/), { target: { value: '漏記' } });
      expect(onReasonTextChange).toHaveBeenCalledWith('漏記');
      fireEvent.click(screen.getByRole('button', { name: '確認開帳金額' }));
      expect(onSubmit).toHaveBeenCalledWith('800');
    });

    it('says more when the amount is higher', () => {
      renderForm({ amountText: '900', previousClosed });
      expect(screen.getByRole('alert')).toHaveTextContent('多了 NT$ 30');
    });

    it('shows no reason field when the amount equals the last close, is not a number yet, or there is no closed day', () => {
      for (const props of [
        { amountText: '870', previousClosed },
        { amountText: '', previousClosed },
        { amountText: 'abc', previousClosed },
        { amountText: '800', previousClosed: null },
        { amountText: '800' },
      ]) {
        const view = render(
          <CloudDayOpeningCashForm
            businessDate="2026-10-16" currentOpeningCash={null} amountText={props.amountText}
            onAmountTextChange={vi.fn()} onSubmit={vi.fn()}
            {...('previousClosed' in props ? { previousClosed: props.previousClosed } : {})}
          />,
        );
        expect(screen.queryByLabelText(/差額原因/)).not.toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        view.unmount();
      }
    });

    it('blocks submitting while the last close is still unknown', () => {
      const { onSubmit } = renderForm({ amountText: '800', ledgerNotice: '正在確認上一個已關帳日的實點現金…' });
      expect(screen.getByText('正在確認上一個已關帳日的實點現金…')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '確認開帳金額' })).toBeDisabled();
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });
});
