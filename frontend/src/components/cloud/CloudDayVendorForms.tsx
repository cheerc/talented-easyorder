import { useEffect, useRef, useState, type FormEvent } from 'react';
import { effectiveCashOf, openingDifference, type PreviousClosedDay } from '../../domain/ledgerAnomalies';
import type { CloudLastWeekMenuItem } from '../../firebase/cloudDayVendorRepository';
import { Callout } from '../ui/Callout';
import { HelpTip } from '../ui/HelpTip';
import { Modal } from '../ui/Modal';
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
      <div className="cloud-day-form__title-row">
        <h3>{mode === 'create' ? '新增供應商' : '編輯供應商'}</h3>
        {mode === 'create' && <HelpTip label="新增供應商說明">新供應商會以「使用中」狀態建立。</HelpTip>}
      </div>
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
        ) : null}
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
  /** #686: reads last week's menus on demand. Without it the 「複製上週菜單」 button is not offered. */
  loadLastWeekMenus?: () => Promise<CloudLastWeekMenuItem[]>;
}

type LastWeekState =
  | { status: 'loading' }
  | { status: 'ready'; items: CloudLastWeekMenuItem[] }
  | { status: 'error'; message: string };

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

/** "11/03（二）" from a YYYY-MM-DD id; the weekday comes from the date string, not from the browser clock. */
function lastWeekDayLabel(dayId: string): string {
  const weekday = WEEKDAY_LABELS[new Date(`${dayId}T00:00:00.000Z`).getUTCDay()] ?? '';
  return `${dayId.slice(5, 7)}/${dayId.slice(8, 10)}（${weekday}）`;
}

export function CloudDayMenuForm({
  businessDate,
  value,
  vendors,
  onChange,
  onSubmit,
  disabled = false,
  loadLastWeekMenus,
}: CloudDayMenuFormProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [lastWeek, setLastWeek] = useState<LastWeekState>({ status: 'loading' });
  const focusNameAfterCloseRef = useRef(false);
  // Only the newest read may answer; closing or retrying makes an older answer stale.
  const readRequestRef = useRef(0);

  // The dialog gives focus back to the copy button when it closes; after a pick the name field takes it instead.
  // This effect runs after the dialog's own cleanup in the same commit.
  useEffect(() => {
    if (copyOpen || !focusNameAfterCloseRef.current) return;
    focusNameAfterCloseRef.current = false;
    nameRef.current?.focus();
  }, [copyOpen]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(value);
  };

  const update = <K extends keyof CloudDayMenuDraft>(field: K, nextValue: CloudDayMenuDraft[K]) => {
    onChange({ ...value, [field]: nextValue });
  };

  const readLastWeek = () => {
    if (!loadLastWeekMenus) return;
    const request = ++readRequestRef.current;
    setLastWeek({ status: 'loading' });
    loadLastWeekMenus().then(
      items => { if (readRequestRef.current === request) setLastWeek({ status: 'ready', items }); },
      error => {
        if (readRequestRef.current !== request) return;
        setLastWeek({ status: 'error', message: error instanceof Error && error.message ? error.message : '讀取失敗，請稍後再試。' });
      },
    );
  };

  const openCopy = () => {
    setCopyOpen(true);
    readLastWeek();
  };

  const closeCopy = () => {
    readRequestRef.current += 1;
    setCopyOpen(false);
  };

  const pick = (item: CloudLastWeekMenuItem) => {
    onChange({ itemName: item.itemName, priceText: String(item.price), vendorId: item.vendorId });
    focusNameAfterCloseRef.current = true;
    closeCopy();
  };

  return (
    <>
      <form className="cloud-day-form" aria-label={`${businessDate} 菜單`} onSubmit={handleSubmit}>
        <div className="cloud-day-form__title-row">
          <h3>{businessDate} 菜單</h3>
          <HelpTip label="菜單說明">僅可選擇使用中的供應商。{'\n'}可用「複製上週菜單」帶入上週一～五的菜單，帶入後仍可修改。</HelpTip>
          {loadLastWeekMenus && (
            <button type="button" className="cloud-day-form__secondary" onClick={openCopy} disabled={disabled}>
              複製上週菜單
            </button>
          )}
        </div>
        <div className="cloud-day-form__grid">
          <label>
            菜單名稱
            <input
              ref={nameRef}
              className="cloud-day-form__input"
              value={value.itemName}
              onChange={event => update('itemName', event.target.value)}
              disabled={disabled}
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
              disabled={disabled}
              required
            />
          </label>
          <label>
            供應商
            <select
              className="cloud-day-form__input"
              value={value.vendorId}
              onChange={event => update('vendorId', event.target.value)}
              disabled={disabled || vendors.length === 0}
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
      <Modal open={copyOpen} title="複製上週菜單" onClose={closeCopy}>
        <div className="cloud-day-form__copy">
          {lastWeek.status === 'loading' && <p role="status">讀取中…</p>}
          {lastWeek.status === 'error' && (
            <>
              <p role="alert">{lastWeek.message}</p>
              <button type="button" className="cloud-day-form__secondary" onClick={readLastWeek}>重試</button>
            </>
          )}
          {lastWeek.status === 'ready' && lastWeek.items.length === 0 && <p>上週沒有菜單</p>}
          {lastWeek.status === 'ready' && lastWeek.items.length > 0 && (
            <ul className="cloud-day-form__copy-list">
              {lastWeek.items.map(item => (
                <li key={item.dayId}>
                  <button type="button" className="cloud-day-form__copy-item" onClick={() => pick(item)}>
                    {`${lastWeekDayLabel(item.dayId)}· ${item.itemName} · $${item.price} · ${item.vendorName}`}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </>
  );
}

interface CloudDayOpeningCashFormProps {
  businessDate: string;
  currentOpeningCash: number | null;
  amountText: string;
  onAmountTextChange: (value: string) => void;
  onSubmit: (amountText: string) => void;
  disabled?: boolean;
  /**
   * 上一個已關帳日（日期早於 businessDate）與它的實點現金；null 表示沒有，undefined 表示呼叫端沒提供
   * 帳務異常資訊（不顯示差額與原因欄）。
   */
  previousClosed?: PreviousClosedDay | null;
  /** 帳務資料尚未讀到（載入中或失敗）時的說明；有值時不能送出，因為無法判斷是否需要差額原因。 */
  ledgerNotice?: string;
  reasonText?: string;
  onReasonTextChange?: (value: string) => void;
}

function formatMoney(value: number): string {
  return `NT$ ${new Intl.NumberFormat('zh-TW').format(value)}`;
}

export function CloudDayOpeningCashForm({
  businessDate,
  currentOpeningCash,
  amountText,
  onAmountTextChange,
  onSubmit,
  disabled = false,
  previousClosed,
  ledgerNotice = '',
  reasonText = '',
  onReasonTextChange,
}: CloudDayOpeningCashFormProps) {
  const typedAmount = /^\d+$/.test(amountText) ? Number(amountText) : null;
  const difference = previousClosed && typedAmount !== null ? openingDifference(previousClosed, typedAmount) : null;
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(amountText);
  };

  return (
    <form className="cloud-day-form" aria-label={`${businessDate} 開帳現金`} onSubmit={handleSubmit}>
      <h3>{businessDate} 開帳現金</h3>
      {currentOpeningCash === null ? (
        <Callout variant="warn">尚未確認開帳。請輸入實際金額；輸入 0 才代表已確認為零元。</Callout>
      ) : (
        <Callout variant="info" role="status">
          伺服器已確認開帳現金 NT$ {new Intl.NumberFormat('zh-TW').format(currentOpeningCash)}。再次儲存只修改金額，首次開帳記錄由伺服器保留。
        </Callout>
      )}
      {previousClosed && (
        <Callout variant="info" role="status">
          上一個已關帳日 {previousClosed.dayId} 的實點現金為 {formatMoney(previousClosed.countedCash)}
          {(previousClosed.postCloseNet ?? 0) !== 0 && `，關帳後補記淨${(previousClosed.postCloseNet ?? 0) > 0 ? '收入' : '支出'} ${formatMoney(Math.abs(previousClosed.postCloseNet ?? 0))}，有效關帳現金 ${formatMoney(effectiveCashOf(previousClosed))}`}
          ，開帳現金通常應與有效關帳現金相同。
        </Callout>
      )}
      {ledgerNotice && <Callout variant="warn" role="status">{ledgerNotice}</Callout>}
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
      {previousClosed && difference !== null && (
        <>
          <Callout variant="warn" role="alert">
            開帳現金比上次關帳實點{difference > 0 ? '多' : '少'}了 {formatMoney(Math.abs(difference))}。仍可照輸入的金額開帳，
            但會記成帳務異常，請填寫原因。
          </Callout>
          <label>
            差額原因（必填，1–500 字）
            <textarea
              className="cloud-day-form__input"
              value={reasonText}
              onChange={event => onReasonTextChange?.(event.target.value)}
              maxLength={500}
              disabled={disabled}
              rows={2}
            />
          </label>
        </>
      )}
      <div className="cloud-day-form__actions">
        <button type="submit" className="cloud-day-form__primary" disabled={disabled || ledgerNotice !== ''}>
          {currentOpeningCash === null ? '確認開帳金額' : '更新開帳金額'}
        </button>
      </div>
    </form>
  );
}
