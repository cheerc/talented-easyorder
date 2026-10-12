/** Taiwan timezone date/time utilities — Ref: #367 */

/** Get Taiwan date as YYYY-MM-DD (Asia/Taipei timezone) */
export function getTaiwanDate(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
}

/** Get Taiwan ISO string with +08:00 offset */
export function getTaiwanISOString(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).replace(' ', 'T') + '+08:00';
}

const TAIPEI_DATE_TIME = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Taipei',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
});

/**
 * M2 F10：畫面上的時間一律以台北時間顯示（YYYY-MM-DD HH:mm:ss）。
 * 存檔的 createdAt 是 UTC ISO 字串，直接切字串會差 8 小時。空字串或無法解析時回傳空字串。
 */
export function formatTaipeiDateTime(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return TAIPEI_DATE_TIME.format(d);
}

/** M2 F10：只要時分秒（HH:mm:ss）的地方用這個，同樣是台北時間。 */
export function formatTaipeiTime(iso: string | undefined | null): string {
  return formatTaipeiDateTime(iso).slice(11);
}
