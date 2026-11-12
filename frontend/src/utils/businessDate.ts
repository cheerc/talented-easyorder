/** #707：營業日（YYYY-MM-DD）的顯示格式。只改畫面文字，不碰 key、命令內容、CSV 或 aria-label。 */

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 星期只由日期字串決定（以 UTC 解析），不看瀏覽器時區或現在時間。
 * 格式不符或不存在的日期（例如 2023-02-29）回傳空字串。
 */
export function businessWeekday(dayId: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayId)) return '';
  const date = new Date(`${dayId}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dayId) return '';
  return WEEKDAY_LABELS[date.getUTCDay()] ?? '';
}

/** "2026-11-13（五）"（全形括號）；無效日期原樣回傳，絕不丟錯、不捏造星期。 */
export function formatBusinessDate(dayId: string): string {
  const weekday = businessWeekday(dayId);
  return weekday ? `${dayId}（${weekday}）` : dayId;
}
