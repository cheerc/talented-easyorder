import type { FormEvent } from 'react';
import './CloudDayVendorForms.css';

export type CloudDayVendorStatus = 'active' | 'inactive';

export interface CloudDayVendorDraft {
  vendorId: string;
  name: string;
  phone: string;
  note: string;
  status: CloudDayVendorStatus;
}

export interface CloudDayMenuDraft {
  itemName: string;
  priceText: string;
  vendorId: string;
}

export interface CloudDayVendorChoice {
  vendorId: string;
  name: string;
}

interface CloudDayVendorFormProps {
  mode: 'create' | 'edit';
  value: CloudDayVendorDraft;
  onChange: (value: CloudDayVendorDraft) => void;
  onSubmit: (value: CloudDayVendorDraft) => void;
  disabled?: boolean;
}

export function CloudDayVendorForm({ mode, value, onChange, onSubmit, disabled = false }: CloudDayVendorFormProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(mode === 'create' ? { ...value, status: 'active' } : value);
  };

  const update = <K extends keyof CloudDayVendorDraft>(field: K, nextValue: CloudDayVendorDraft[K]) => {
    onChange({ ...value, [field]: nextValue });
  };

  return (
    <form className="cloud-day-form" aria-label={mode === 'create' ? '新增供應商' : `編輯供應商 ${value.vendorId}`} onSubmit={handleSubmit}>
      <h3>{mode === 'create' ? '新增供應商' : '編輯供應商'}</h3>
      <div className="cloud-day-form__grid">
        <label>
          供應商編號
          <input
            className="cloud-day-form__input cloud-day-form__mono"
            value={value.vendorId}
            onChange={event => update('vendorId', event.target.value)}
            readOnly={mode === 'edit'}
            disabled={disabled}
            required
            autoComplete="off"
          />
        </label>
        <label>
          供應商名稱
          <input
            className="cloud-day-form__input"
            value={value.name}
            onChange={event => update('name', event.target.value)}
            disabled={disabled}
            required
            autoComplete="organization"
          />
        </label>
        <label>
          聯絡電話
          <input
            className="cloud-day-form__input"
            type="text"
            inputMode="tel"
            value={value.phone}
            onChange={event => update('phone', event.target.value)}
            disabled={disabled}
            autoComplete="tel"
          />
        </label>
        <label>
          備註
          <textarea
            className="cloud-day-form__input"
            rows={3}
            value={value.note}
            onChange={event => update('note', event.target.value)}
            disabled={disabled}
          />
        </label>
        {mode === 'edit' ? (
          <label>
            狀態
            <select
              className="cloud-day-form__input"
              value={value.status}
              onChange={event => update('status', event.target.value as CloudDayVendorStatus)}
              disabled={disabled}
            >
              <option value="active">使用中</option>
              <option value="inactive">已停用</option>
            </select>
          </label>
        ) : (
          <p className="cloud-day-form__help">新供應商會以「使用中」狀態建立。</p>
        )}
      </div>
      <div className="cloud-day-form__actions">
        <button type="submit" className="cloud-day-form__primary" disabled={disabled}>
          {mode === 'create' ? '建立供應商' : '儲存供應商'}
        </button>
      </div>
    </form>
  );
}

interface CloudDayMenuFormProps {
  businessDate: string;
  value: CloudDayMenuDraft;
  vendors: CloudDayVendorChoice[];
  onChange: (value: CloudDayMenuDraft) => void;
  onSubmit: (value: CloudDayMenuDraft) => void;
  disabled?: boolean;
  fieldsReadOnly?: boolean;
}

export function CloudDayMenuForm({
  businessDate,
  value,
  vendors,
  onChange,
  onSubmit,
  disabled = false,
  fieldsReadOnly = false,
}: CloudDayMenuFormProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(value);
  };

  const update = <K extends keyof CloudDayMenuDraft>(field: K, nextValue: CloudDayMenuDraft[K]) => {
    onChange({ ...value, [field]: nextValue });
  };

  return (
    <form className="cloud-day-form" aria-label={`${businessDate} 菜單`} onSubmit={handleSubmit}>
      <h3>{businessDate} 菜單</h3>
      <p className="cloud-day-form__help">僅可選擇使用中的供應商。</p>
      <div className="cloud-day-form__grid">
        <label>
          菜單名稱
          <input
            className="cloud-day-form__input"
            value={value.itemName}
            onChange={event => update('itemName', event.target.value)}
            disabled={disabled || fieldsReadOnly}
            required
            autoComplete="off"
          />
        </label>
        <label>
          價格（新臺幣整數）
          <input
            className="cloud-day-form__input cloud-day-form__mono"
            type="text"
            inputMode="numeric"
            value={value.priceText}
            onChange={event => update('priceText', event.target.value)}
            disabled={disabled || fieldsReadOnly}
            required
          />
        </label>
        <label>
          供應商
          <select
            className="cloud-day-form__input"
            value={value.vendorId}
            onChange={event => update('vendorId', event.target.value)}
            disabled={disabled || fieldsReadOnly || vendors.length === 0}
            required
          >
            <option value="">請選擇供應商</option>
            {vendors.map(vendor => (
              <option key={vendor.vendorId} value={vendor.vendorId}>{vendor.name}</option>
            ))}
          </select>
        </label>
      </div>
      {vendors.length === 0 && <p className="cloud-day-form__empty">目前沒有可選供應商，請先新增或恢復供應商。</p>}
      <div className="cloud-day-form__actions">
        <button type="submit" className="cloud-day-form__primary" disabled={disabled || vendors.length === 0}>
          儲存菜單
        </button>
      </div>
    </form>
  );
}

interface CloudDayOpeningCashFormProps {
  businessDate: string;
  currentOpeningCash: number | null;
  amountText: string;
  onAmountTextChange: (value: string) => void;
  onSubmit: (amountText: string) => void;
  disabled?: boolean;
}

export function CloudDayOpeningCashForm({
  businessDate,
  currentOpeningCash,
  amountText,
  onAmountTextChange,
  onSubmit,
  disabled = false,
}: CloudDayOpeningCashFormProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(amountText);
  };

  return (
    <form className="cloud-day-form" aria-label={`${businessDate} 開帳現金`} onSubmit={handleSubmit}>
      <h3>{businessDate} 開帳現金</h3>
      {currentOpeningCash === null ? (
        <p className="cloud-day-form__help">尚未確認開帳。請輸入實際金額；輸入 0 才代表已確認為零元。</p>
      ) : (
        <p className="cloud-day-form__help" role="status">
          伺服器已確認開帳現金 NT$ {new Intl.NumberFormat('zh-TW').format(currentOpeningCash)}。再次儲存只修改金額，首次開帳記錄由伺服器保留。
        </p>
      )}
      <label>
        開帳現金（新臺幣整數，0 至 20,000）
        <input
          className="cloud-day-form__input cloud-day-form__mono"
          type="text"
          inputMode="numeric"
          value={amountText}
          onChange={event => onAmountTextChange(event.target.value)}
          disabled={disabled}
          required
          autoComplete="off"
        />
      </label>
      <div className="cloud-day-form__actions">
        <button type="submit" className="cloud-day-form__primary" disabled={disabled}>
          {currentOpeningCash === null ? '確認開帳金額' : '更新開帳金額'}
        </button>
      </div>
    </form>
  );
}
