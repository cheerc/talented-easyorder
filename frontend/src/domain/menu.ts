export type RecordStatus = 'active' | 'inactive';

export interface Vendor {
  vendorId: string;
  name: string;
  phone: string;
  note: string;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface TodayMenu {
  businessDate: string;
  itemName: string;
  price: number;
  vendorId: string;
  vendorNameSnapshot: string;
  catalogItemId?: string;
  updatedAt: string;
  revision: number;
}

export interface MenuSnapshot {
  menuNameSnapshot: string;
  menuPriceSnapshot: number;
  vendorIdSnapshot: string;
  vendorNameSnapshot: string;
}

export interface MenuCatalogItem {
  itemId: string;
  name: string;
  defaultPrice: number;
  defaultVendorId?: string;
  category: string;
  imageUrl?: string;
  description?: string;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface MenuValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateTodayMenu(menu: TodayMenu, vendors: Vendor[]): MenuValidationResult {
  const errors: string[] = [];

  if (!menu.itemName.trim()) {
    errors.push('itemName');
  }

  if (menu.price <= 0 || !Number.isInteger(menu.price)) {
    errors.push('price');
  }

  const vendor = vendors.find(v => v.vendorId === menu.vendorId);
  if (!vendor || vendor.status !== 'active') {
    errors.push('vendorId');
  }

  return { valid: errors.length === 0, errors };
}

export function filterActiveVendors(vendors: Vendor[]): Vendor[] {
  return vendors.filter(v => v.status === 'active');
}

/** M0：空白資料集尚未設定今日晚餐時不可訂餐。 */
export function isMenuReady(menu: TodayMenu): boolean {
  return menu.itemName.trim() !== '' && Number.isSafeInteger(menu.price) && menu.price > 0;
}

/** 依營業日保存的晚餐設定（key 為 YYYY-MM-DD）。 */
export type MenusByDate = Record<string, TodayMenu>;

export type ResolvedMenu =
  | { source: 'own'; menu: TodayMenu }
  | { source: 'inherited'; menu: TodayMenu; fromDate: string }
  | { source: 'legacy'; menu: TodayMenu };

/**
 * M0 日期 key 菜單：該營業日有自己的設定就用它；沒有就沿用最近一個較早日期的設定；
 * 都沒有時用舊版單一 todayMenu。回傳菜單的 businessDate 一律是查詢的營業日。
 */
export function resolveMenuForDate(menusByDate: MenusByDate, legacyMenu: TodayMenu, date: string): ResolvedMenu {
  const own = menusByDate[date];
  if (own) return { source: 'own', menu: own };
  let fromDate: string | null = null;
  for (const key of Object.keys(menusByDate)) {
    if (key < date && (fromDate === null || key > fromDate)) fromDate = key;
  }
  if (fromDate !== null) return { source: 'inherited', menu: { ...menusByDate[fromDate], businessDate: date }, fromDate };
  return { source: 'legacy', menu: legacyMenu.businessDate === date ? legacyMenu : { ...legacyMenu, businessDate: date } };
}

export function createMenuSnapshot(menu: TodayMenu): MenuSnapshot {
  return {
    menuNameSnapshot: menu.itemName,
    menuPriceSnapshot: menu.price,
    vendorIdSnapshot: menu.vendorId,
    vendorNameSnapshot: menu.vendorNameSnapshot,
  };
}

export function promoteCatalogItemToTodayMenu(
  item: MenuCatalogItem,
  vendor: Vendor,
  businessDate: string,
  updatedAt: string,
): TodayMenu {
  return {
    businessDate,
    itemName: item.name,
    price: item.defaultPrice,
    vendorId: vendor.vendorId,
    vendorNameSnapshot: vendor.name,
    catalogItemId: item.itemId,
    updatedAt,
    revision: 1,
  };
}
