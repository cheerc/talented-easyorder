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

// ─── M3 F4：供應商維護 ───
// 舊訂單（menuSnapshot）與每日菜單都存了當時的供應商名稱，所以停用或刪除供應商不會改到歷史紀錄。

export interface VendorDraft {
  name: string;
  phone: string;
  note: string;
}

/** 新增或編輯供應商前的檢查；回傳要顯示的訊息，沒問題時回傳 null。名稱不能空白，也不能和其他供應商同名。 */
export function validateVendorDraft(draft: VendorDraft, vendors: Vendor[], editingVendorId: string | null): string | null {
  const name = draft.name.trim();
  if (!name) return '請填寫供應商名稱。';
  const dup = vendors.find(v => v.vendorId !== editingVendorId && v.name.trim() === name);
  if (dup) return dup.status === 'active'
    ? `已經有一家叫「${name}」的供應商。`
    : `已停用的供應商裡有「${name}」，請到下方「已停用」恢復它，或換個名稱。`;
  return null;
}

/** 套用編輯內容；電話與備註可以清空。 */
export function applyVendorEdit(vendor: Vendor, draft: VendorDraft, now: string): Vendor {
  return {
    ...vendor,
    name: draft.name.trim(),
    phone: draft.phone.trim(),
    note: draft.note.trim(),
    updatedAt: now,
    revision: vendor.revision + 1,
  };
}

/** 停用或恢復。停用的供應商不能被新的晚餐設定選到，但仍保留在清單裡，可以恢復。 */
export function setVendorStatus(vendors: Vendor[], vendorId: string, status: RecordStatus, now: string): Vendor[] {
  return vendors.map(v => (v.vendorId === vendorId && v.status !== status
    ? { ...v, status, updatedAt: now, revision: v.revision + 1 }
    : v));
}

export type VendorDeleteResult = { ok: true; vendors: Vendor[] } | { ok: false; message: string };

/** 永久刪除：只有已停用的供應商可以刪；刪掉後不能恢復，歷史訂單與菜單上的店名照舊。 */
export function deleteInactiveVendor(vendors: Vendor[], vendorId: string): VendorDeleteResult {
  const target = vendors.find(v => v.vendorId === vendorId);
  if (!target) return { ok: false, message: '找不到這家供應商，可能已經刪除。' };
  if (target.status === 'active') return { ok: false, message: '請先停用這家供應商，才能永久刪除。' };
  return { ok: true, vendors: vendors.filter(v => v.vendorId !== vendorId) };
}

/** 哪些營業日的晚餐設定用過這家供應商（依日期排序）。 */
export function vendorMenuDates(vendorId: string, menusByDate: MenusByDate): string[] {
  return Object.keys(menusByDate).filter(d => menusByDate[d].vendorId === vendorId).sort();
}

/**
 * 還沒有任何日期設定時（範例資料、舊資料），每天都用舊版單一 todayMenu；它用的是不是這家。
 * 永久刪除的確認訊息要把這種情況也講出來。
 */
export function isVendorInLegacyMenu(vendorId: string, menusByDate: MenusByDate, legacyMenu: TodayMenu): boolean {
  return Object.keys(menusByDate).length === 0 && !!vendorId && legacyMenu.vendorId === vendorId;
}

/**
 * F3 下拉選單的預設值：這天菜單的供應商還在使用中就選它；菜單還沒指定供應商時選第一家使用中的；
 * 菜單的供應商已停用或已刪除時不預選（回傳空字串），由畫面提醒改選。
 * 舊資料的 vendorId 對不到時，再用名稱找一次。
 */
export function resolveMenuVendor(menu: TodayMenu, vendors: Vendor[]): { vendorId: string; unavailableName: string | null } {
  const active = filterActiveVendors(vendors);
  if (!menu.vendorId && !menu.vendorNameSnapshot) return { vendorId: active[0]?.vendorId ?? '', unavailableName: null };
  const byId = vendors.find(v => v.vendorId === menu.vendorId)
    ?? vendors.find(v => v.name === menu.vendorNameSnapshot);
  if (byId && byId.status === 'active') return { vendorId: byId.vendorId, unavailableName: null };
  return { vendorId: '', unavailableName: byId?.name ?? (menu.vendorNameSnapshot || null) };
}

/** 依營業日保存的晚餐設定（key 為 YYYY-MM-DD）。 */
export type MenusByDate = Record<string, TodayMenu>;

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
