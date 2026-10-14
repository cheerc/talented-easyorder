import { EMPTY_TODAY_MENU } from '../mocks/initialData';
import { isCloudMode } from '../appMode';
import { clearSensitiveData, defaultState } from './posPersistence';
import { usePosStore } from './posStore';

/** Erase sensitive Cloud POS values from Zustand synchronously, without seeded defaults. */
export function clearSensitivePosMemory(): void {
  if (!isCloudMode) return;

  usePosStore.setState({
    students: [],
    transactions: [],
    vendors: [],
    todayMenu: EMPTY_TODAY_MENU,
    simulationDate: null,
    ...defaultState,
  });
}

/** Erase Cloud in-memory state first, then its persisted/cache namespaces. */
export async function clearSensitivePosData(): Promise<void> {
  if (!isCloudMode) return;
  clearSensitivePosMemory();
  try {
    await usePosStore.persist.clearStorage();
  } catch { /* keep the in-memory mask even when persistence cleanup fails */ }
  try {
    await clearSensitiveData();
  } catch { /* best-effort disk cleanup */ }
}
