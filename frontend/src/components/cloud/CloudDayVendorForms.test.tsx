import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import type { CloudLastWeekMenuItem } from '../../firebase/cloudDayVendorRepository';

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
  describe('說明與警示分類（#650）', () => {
    it('puts form usage notes into HelpTip instead of inline paragraphs', () => {
      const { unmount } = render(<VendorFormHarness mode="create" initial={{ vendorId: '', name: '', phone: '', note: '', status: 'active' }} onSubmit={vi.fn()} />);
      expect(screen.queryByText('新供應商會以「使用中」狀態建立。')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '新增供應商說明' }));
      expect(screen.getByRole('tooltip')).toHaveTextContent('新供應商會以「使用中」狀態建立。');
      unmount();

      render(<MenuFormHarness onSubmit={vi.fn()} />);
      expect(screen.queryByText('僅可選擇使用中的供應商。')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '菜單說明' }));
      expect(screen.getByRole('tooltip')).toHaveTextContent('僅可選擇使用中的供應商。');
    });

    it('shows the opening-cash warnings as always-visible Callout', () => {
      const onChange = vi.fn();
      const previousClosed = {
        dayId: '2026-10-14', countedCash: 870, postCloseNet: 0,
      } as unknown as PreviousClosedDay;
      render(
        <CloudDayOpeningCashForm
          businessDate="2026-10-15"
          currentOpeningCash={null}
          amountText="800"
          onAmountTextChange={onChange}
          onSubmit={vi.fn()}
          previousClosed={previousClosed}
          ledgerNotice="無法確認上一個已關帳日的實點現金（離線），暫時不能開帳。"
        />,
      );
      for (const pattern of [
        /尚未確認開帳。請輸入實際金額；輸入 0 才代表已確認為零元。/,
        /上一個已關帳日 2026-10-14 的實點現金為 NT\$ 870/,
        /無法確認上一個已關帳日的實點現金（離線），暫時不能開帳。/,
        /開帳現金比上次關帳實點少了 NT\$ 70/,
      ]) {
        expect(screen.getByText(pattern).closest('.callout-ui')).not.toBeNull();
      }
      expect(screen.getByText(/比上次關帳實點少了/).closest('.callout-warn')).not.toBeNull();
      expect(screen.queryByRole('button', { name: /說明/ })).not.toBeInTheDocument();
    });

    it('shows the confirmed opening-cash amount as Callout', () => {
      render(
        <CloudDayOpeningCashForm businessDate="2026-10-15" currentOpeningCash={0} amountText="0" onAmountTextChange={vi.fn()} onSubmit={vi.fn()} />,
      );
      expect(screen.getByText(/伺服器已確認開帳現金 NT\$ 0/).closest('.callout-ui')).not.toBeNull();
    });
  });

  describe('「複製上週菜單」(#686)', () => {
    const item = (dayId: string, itemName: string, price: number, vendorName = '甲供應商'): CloudLastWeekMenuItem => ({
      dayId, itemName, price, vendorId: 'vendor-a', vendorName,
    });

    function Harness({ load, disabled = false, initial }: {
      load: () => Promise<CloudLastWeekMenuItem[]>;
      disabled?: boolean;
      initial?: CloudDayMenuDraft;
    }) {
      const [value, setValue] = useState<CloudDayMenuDraft>(initial ?? { itemName: '', priceText: '', vendorId: '' });
      return (
        <CloudDayMenuForm
          businessDate="2026-11-12"
          value={value}
          vendors={[{ vendorId: 'vendor-a', name: '甲供應商' }]}
          onChange={setValue}
          onSubmit={vi.fn()}
          loadLastWeekMenus={load}
          disabled={disabled}
        />
      );
    }

    it('is always offered, also when the day already has a menu, and follows the form disabled state', () => {
      const load = vi.fn().mockResolvedValue([]);
      const { rerender } = render(<Harness load={load} initial={{ itemName: '已有菜單', priceText: '80', vendorId: 'vendor-a' }} />);
      expect(screen.getByRole('button', { name: '複製上週菜單' })).toBeEnabled();
      expect(load).not.toHaveBeenCalled();
      rerender(<Harness load={load} disabled initial={{ itemName: '已有菜單', priceText: '80', vendorId: 'vendor-a' }} />);
      expect(screen.getByRole('button', { name: '複製上週菜單' })).toBeDisabled();
    });

    it('opens a dialog that reads on demand and lists every day with its date, without merging identical menus', async () => {
      const load = vi.fn().mockResolvedValue([
        item('2026-11-02', '雞腿便當', 90, '供應商A'),
        item('2026-11-03', '雞腿便當', 90, '供應商A'),
      ]);
      render(<Harness load={load} />);
      fireEvent.click(screen.getByRole('button', { name: '複製上週菜單' }));

      const dialog = await screen.findByRole('dialog');
      expect(load).toHaveBeenCalledTimes(1);
      expect(await within(dialog).findByRole('button', { name: '11/02（一）· 雞腿便當 · $90 · 供應商A' })).toBeEnabled();
      expect(within(dialog).getByRole('button', { name: '11/03（二）· 雞腿便當 · $90 · 供應商A' })).toBeEnabled();
    });

    it('shows reading, an empty state, and a retryable error with text', async () => {
      let resolve!: (rows: CloudLastWeekMenuItem[]) => void;
      const load = vi.fn()
        .mockImplementationOnce(() => new Promise<CloudLastWeekMenuItem[]>(r => { resolve = r; }))
        .mockRejectedValueOnce(new Error('讀取失敗，請稍後再試。'))
        .mockResolvedValueOnce([]);
      render(<Harness load={load} />);
      fireEvent.click(screen.getByRole('button', { name: '複製上週菜單' }));
      expect(await screen.findByText('讀取中…')).toBeInTheDocument();
      resolve([]);
      expect(await screen.findByText('上週沒有菜單')).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      fireEvent.click(screen.getByRole('button', { name: '複製上週菜單' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('讀取失敗，請稍後再試。');
      fireEvent.click(screen.getByRole('button', { name: '重試' }));
      expect(await screen.findByText('上週沒有菜單')).toBeInTheDocument();
      expect(load).toHaveBeenCalledTimes(3);
    });

    it('fills the editable fields from the picked day, closes, and returns focus to the name field', async () => {
      const load = vi.fn().mockResolvedValue([item('2026-11-04', '排骨便當', 95)]);
      render(<Harness load={load} initial={{ itemName: '舊草稿', priceText: '1', vendorId: '' }} />);
      fireEvent.click(screen.getByRole('button', { name: '複製上週菜單' }));
      fireEvent.click(await screen.findByRole('button', { name: '11/04（三）· 排骨便當 · $95 · 甲供應商' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      const name = screen.getByRole('textbox', { name: '菜單名稱' });
      expect(name).toHaveValue('排骨便當');
      expect(name).toBeEnabled();
      expect(screen.getByLabelText('價格（新臺幣整數）')).toHaveValue('95');
      expect(screen.getByRole('combobox', { name: '供應商' })).toHaveValue('vendor-a');
      await waitFor(() => expect(name).toHaveFocus());

      // The copied values stay editable like any typed values.
      fireEvent.change(screen.getByLabelText('價格（新臺幣整數）'), { target: { value: '100' } });
      expect(screen.getByLabelText('價格（新臺幣整數）')).toHaveValue('100');
    });

    it('closes on Escape without touching the form draft', async () => {
      const load = vi.fn().mockResolvedValue([item('2026-11-04', '排骨便當', 95)]);
      render(<Harness load={load} initial={{ itemName: '我的草稿', priceText: '70', vendorId: 'vendor-a' }} />);
      fireEvent.click(screen.getByRole('button', { name: '複製上週菜單' }));
      await screen.findByRole('button', { name: /排骨便當/ });
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(screen.getByRole('textbox', { name: '菜單名稱' })).toHaveValue('我的草稿');
    });

    it('has no copy button when the page supplies no loader, and no read-only mode for the fields', () => {
      render(<MenuFormHarness onSubmit={vi.fn()} />);
      expect(screen.queryByRole('button', { name: '複製上週菜單' })).toBeNull();
      expect(screen.getByRole('textbox', { name: '菜單名稱' })).toBeEnabled();
    });
  });
});
