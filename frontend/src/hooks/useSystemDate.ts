import { useState, useEffect } from 'react';
import { getTaiwanDate } from '../utils/dateTime';
import { useSimulationDate } from '../store/selectors';
import { isPrototypeMode } from '../appMode';

export function useSystemDate() {
  const getSystemDate = () => getTaiwanDate();
  const [realDate, setRealDate] = useState(getSystemDate);
  // M0 S-DATE：本機練習模式可設定模擬營業日，取代實際日期作為可寫入的營業日。
  const simulationDate = useSimulationDate();
  const systemDate = (isPrototypeMode && simulationDate) ? simulationDate : realDate;
  const [viewDate, setViewDate] = useState(systemDate);

  useEffect(() => {
    const tick = setInterval(() => setRealDate(getSystemDate()), 60_000);
    const onVisible = () => setRealDate(getSystemDate());
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // 切換模擬營業日時，檢視日期跟著移到新的營業日（render 期間調整 state，避免 effect 連鎖更新）。
  // 只跟著模擬日期的變更移動；實際跨午夜仍由 MidnightBanner 提示，行為與一般模式相同。
  const [prevSimulationDate, setPrevSimulationDate] = useState(simulationDate);
  if (isPrototypeMode && prevSimulationDate !== simulationDate) {
    setPrevSimulationDate(simulationDate);
    setViewDate(systemDate);
  }

  return { systemDate, viewDate, setViewDate };
}
