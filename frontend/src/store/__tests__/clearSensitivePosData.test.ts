import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isCloudMode: vi.fn(),
  setState: vi.fn(),
  clearStorage: vi.fn().mockResolvedValue(undefined),
  clearSensitiveData: vi.fn().mockResolvedValue(undefined),
  defaultState: {
    auditEvents: [],
    dailySettlements: [],
    businessDateStatuses: {},
    cashSessions: {},
    menusByDate: {},
    faceEvents: [],
    faceDevices: {},
  },
}));

vi.mock('../../appMode', () => Object.defineProperty({}, 'isCloudMode', {
  enumerable: true,
  get: () => mocks.isCloudMode(),
}));
vi.mock('../posPersistence', () => ({
  clearSensitiveData: mocks.clearSensitiveData,
  defaultState: mocks.defaultState,
}));
vi.mock('../posStore', () => ({
  usePosStore: {
    setState: mocks.setState,
    persist: { clearStorage: mocks.clearStorage },
  },
}));

import { EMPTY_TODAY_MENU } from '../../mocks/initialData';
import { clearSensitivePosData } from '../clearSensitivePosData';

describe('clearSensitivePosData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isCloudMode.mockReturnValue(false);
    mocks.clearStorage.mockResolvedValue(undefined);
    mocks.clearSensitiveData.mockResolvedValue(undefined);
  });

  it('clears Cloud memory to empty values without restoring seeded defaults', async () => {
    mocks.isCloudMode.mockReturnValue(true);

    await clearSensitivePosData();

    expect(mocks.setState).toHaveBeenCalledOnce();
    expect(mocks.setState).toHaveBeenCalledWith(expect.objectContaining({
      students: [],
      transactions: [],
      vendors: [],
      todayMenu: EMPTY_TODAY_MENU,
      simulationDate: null,
      auditEvents: [],
      dailySettlements: [],
      businessDateStatuses: {},
      cashSessions: {},
    }));
    expect(mocks.clearStorage).toHaveBeenCalledOnce();
    expect(mocks.clearSensitiveData).toHaveBeenCalledOnce();
  });

  it('leaves prototype and local-only state untouched', async () => {
    mocks.isCloudMode.mockReturnValue(false);

    await clearSensitivePosData();

    expect(mocks.setState).not.toHaveBeenCalled();
    expect(mocks.clearStorage).not.toHaveBeenCalled();
    expect(mocks.clearSensitiveData).not.toHaveBeenCalled();
  });

  it('keeps memory masked and continues disk cleanup if persist clearing rejects', async () => {
    mocks.isCloudMode.mockReturnValue(true);
    mocks.clearStorage.mockRejectedValue(new Error('persist unavailable'));

    await expect(clearSensitivePosData()).resolves.toBeUndefined();

    expect(mocks.setState).toHaveBeenCalledOnce();
    expect(mocks.clearSensitiveData).toHaveBeenCalledOnce();
  });
});
