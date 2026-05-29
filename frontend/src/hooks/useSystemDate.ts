import { useState, useEffect } from 'react';

export function useSystemDate() {
  const getSystemDate = () => new Date().toISOString().split('T')[0];
  const [systemDate, setSystemDate] = useState(getSystemDate);
  const [viewDate, setViewDate] = useState(systemDate);

  useEffect(() => {
    const tick = setInterval(() => setSystemDate(getSystemDate()), 60_000);
    const onVisible = () => setSystemDate(getSystemDate());
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return { systemDate, viewDate, setViewDate };
}
