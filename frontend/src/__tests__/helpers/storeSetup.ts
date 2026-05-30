import { usePosStore } from '../../store/posStore';

export function resetStoreForTest() {
  window.localStorage.clear();
  usePosStore.getState().resetData();
  usePosStore.persist.rehydrate();
}
