/** #707：e2e 用的獨立星期表（不引用正式的 formatBusinessDate），避免格式化函式出錯時預期值跟著一起錯。 */
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function withWeekday(dayId: string): string {
  return `${dayId}（${WEEKDAYS[new Date(`${dayId}T00:00:00.000Z`).getUTCDay()]}）`;
}
