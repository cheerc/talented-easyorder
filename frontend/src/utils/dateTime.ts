/** Taiwan timezone date/time utilities — Ref: #367 */

/** Get Taiwan date as YYYY-MM-DD (Asia/Taipei timezone) */
export function getTaiwanDate(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
}

/** Get Taiwan ISO string with +08:00 offset */
export function getTaiwanISOString(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).replace(' ', 'T') + '+08:00';
}
