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
