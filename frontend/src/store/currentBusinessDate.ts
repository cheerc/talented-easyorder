import { isPrototypeMode } from '../appMode';
import { getTaiwanDate } from '../utils/dateTime';

/**
 * U4 #9：目前唯一可寫入的營業日。
 *
 * 本機練習模式可設模擬營業日（`simulationDate`）取代實際日期；否則用台北當天。
 * 這裡**不**用 `viewDate`（那是使用者正在瀏覽的日期，可能是歷史日），
 * 也**不**用 `todayMenu.businessDate`（那是菜單快照的日期，可能是舊資料殘留）。
 *
 * store 的退款擋下檢查與 `useSystemDate` 都要用這一個來源，
 * 否則「系統日期」與「可寫入日期」會在還原舊資料時分歧。
 */
export function resolveCurrentBusinessDate(simulationDate: string | null, realDate?: string): string {
  if (isPrototypeMode && simulationDate) return simulationDate;
  return realDate ?? getTaiwanDate();
}
