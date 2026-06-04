# Menu And Vendor Management Spec

## 功能描述

Menu And Vendor Management 定義每日餐點設定、供應商主檔、菜單 catalog、價格與圖片 metadata，以及歷史交易需要保存的菜單/供應商快照。

已實作完整的領域層（`domain/menu.ts`）：`TodayMenu`（每日餐點）、`Vendor`（供應商）、`MenuCatalogItem`（菜單目錄）、`MenuSnapshot`（交易快照）。驗證邏輯（`validateTodayMenu`）檢查 itemName 非空、price 正整數、vendorId 指向 active vendor。支援從 catalog 推廣到今日菜單（`promoteCatalogItemToTodayMenu`）。供應商篩選（`filterActiveVendors`）預設只顯示 active 供應商。

## 使用者故事

- As an admin, I want to set today's menu name, price, and vendor before lunch service so that the POS charges the correct amount.
- As an admin, I want to maintain vendor contact information so that operators can call the right vendor from the counter screen.
- As an admin, I want to reuse menu catalog entries so that repeated meals do not need to be retyped.
- As an admin, I want to deactivate old vendors or menu items so that historical data remains intact while new operations stay clean.
- As a counter operator, I want today's menu and vendor phone visible in the POS idle state so that I can confirm the service day setup quickly.
- As a reporting user, I want transaction and settlement rows to preserve menu/vendor snapshots so that later edits do not rewrite history.

## 驗收標準

### Today's Menu Setup

Given no transactions exist for the selected business date
When an admin saves today's menu with valid name, positive integer price, and active vendor
Then POS idle state, order preview, and report summaries use the saved menu immediately.

Given an admin saves today's menu with an empty item name
When `validateTodayMenu` runs
Then the validation result has `valid: false` and `errors` includes `'itemName'`.

Given an admin saves today's menu with price `0`, a negative price, or a non-integer value
When `validateTodayMenu` runs
Then the validation result has `valid: false` and `errors` includes `'price'`.

Given an admin saves today's menu with an inactive or non-existent vendor
When `validateTodayMenu` runs
Then the validation result has `valid: false` and `errors` includes `'vendorId'`.

Given at least one transaction already exists for the business date
When an admin changes today's menu name, price, or vendor
Then the UI warns that existing transactions keep their original snapshots and the change applies only to future transactions.

### Vendor Management

Given an admin creates a vendor with name and phone
When the vendor is saved
Then it appears in the active vendor list (via `filterActiveVendors`) and can be selected for today's menu.

Given a vendor is referenced by historical menu or transaction data
When an admin attempts to delete it
Then hard delete is blocked and the UI offers deactivate instead (`status = 'inactive'`).

Given a vendor is inactive
When an admin opens today's menu vendor dropdown
Then `filterActiveVendors` excludes the inactive vendor by default.

Given an admin edits a vendor phone number
When viewing old transaction or settlement records
Then historical rows still show the vendor snapshot (`vendorNameSnapshot`) captured at transaction time via `createMenuSnapshot`.

### Menu Catalog

Given an admin creates a catalog item with name, default price, and default vendor
When they promote it via `promoteCatalogItemToTodayMenu`
Then today's menu is prefilled from the catalog item (businessDate, itemName, price, vendorId, vendorNameSnapshot, catalogItemId) and remains editable before save.

`MenuCatalogItem` supports: itemId, name, defaultPrice, defaultVendorId, category, imageUrl, description, status, createdAt, updatedAt, revision.

## 技術約束

- Vite 8 + React 19 + TypeScript 6 + Zustand 5.
- Price fields use integer TWD only. No floating-point currency.
- Phase 1 requires one active primary lunch menu per business date. Multi-item cart is out of scope.
- Menu/vendor records must be plain serializable data for Zustand persistence and Firebase mapping.
- Historical transactions store `MenuSnapshot` via `createMenuSnapshot`: menuNameSnapshot, menuPriceSnapshot, vendorIdSnapshot, vendorNameSnapshot.
- Image handling is URL/path metadata only. Binary upload/storage is out of scope.
- Vendor ids and catalog item ids must be stable; UI list keys must not use array index.
- Test chain: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build`.

## 實際型別（對齊 `domain/menu.ts`）

```ts
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

export interface MenuSnapshot {
  menuNameSnapshot: string;
  menuPriceSnapshot: number;
  vendorIdSnapshot: string;
  vendorNameSnapshot: string;
}

export interface MenuValidationResult {
  valid: boolean;
  errors: string[];
}
```

## 與其他模組的介面

### 輸入

- Active business date from `pc-pos-order-flow-spec` / app date context.
- Vendor and catalog edits from admin UI.
- Historical reference checks from `order-ledger-cash-close-spec`.

### 輸出

- `TodayMenu` for POS order preview and transaction creation.
- `Vendor` records for admin CRUD and display.
- `MenuCatalogItem` records for reusable future menu setup.
- Menu/vendor snapshots (`MenuSnapshot`) for transactions and daily settlements.

### 依賴關係

- `pc-pos-order-flow-spec` depends on active today's menu price/name/vendor to compute order transactions.
- `order-ledger-cash-close-spec` depends on snapshots for historical reporting and settlement.
- Firebase layer depends on flat serializable menu/vendor rows and stable ids.

## 不在本模組範圍

- Multi-item cart and checkout; Phase 1 remains one primary lunch item.
- Inventory, vendor billing, or purchase order management.
- Binary image upload/storage.
- Payment provider integration.
