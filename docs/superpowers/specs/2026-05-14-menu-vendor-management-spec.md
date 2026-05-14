# Menu And Vendor Management Spec

## 功能描述

Menu And Vendor Management 定義每日餐點設定、供應商主檔、未來菜單 catalog、價格與圖片 metadata，以及歷史交易需要保存的菜單/供應商快照。

這個模組解決目前 prototype 只有單一 `todayMenu` 和 local vendor CRUD 的限制。PDF Phase 1 的核心是單一午餐 POS，不是多品項購物車；因此本模組優先穩定每日便當作業，並把分類、圖片、catalog 設計成可漸進擴充的 admin 功能。

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
When the admin clicks save
Then the save is blocked and the item name field shows a validation message.

Given an admin saves today's menu with price `0`, a negative price, or a non-integer value
When the admin clicks save
Then the save is blocked and the price field shows a validation message.

Given at least one transaction already exists for the business date
When an admin changes today's menu name, price, or vendor
Then the UI warns that existing transactions keep their original snapshots and the change applies only to future transactions.

### Vendor Management

Given an admin creates a vendor with name and phone
When the vendor is saved
Then it appears in the active vendor list and can be selected for today's menu.

Given a vendor is referenced by historical menu or transaction data
When an admin attempts to delete it
Then hard delete is blocked and the UI offers deactivate instead.

Given a vendor is inactive
When an admin opens today's menu vendor dropdown
Then the inactive vendor is hidden by default but remains visible in historical reports.

Given an admin edits a vendor phone number
When viewing old transaction or settlement records
Then historical rows still show the vendor snapshot captured at transaction/settlement time.

### Menu Catalog

Given an admin creates a catalog item with name, default price, and default vendor
When they promote it to today's menu
Then today's menu is prefilled from the catalog item and remains editable before save.

Given a catalog item has category and image URL/path metadata
When the admin views the catalog list
Then category and image preview are shown without affecting POS order math.

## 技術約束

- Frontend remains pure Vite 8 + React 19 + TypeScript 6 + Zustand 5.
- Price fields use integer TWD only. Do not use floating-point currency.
- Phase 1 requires one active primary lunch menu per business date. Multi-item cart behavior is out of scope unless a later scope decision changes it.
- Menu/vendor records must be plain serializable data for Zustand persistence and Google Sheets mapping.
- Historical transactions must store `menuNameSnapshot`, `menuPriceSnapshot`, `vendorIdSnapshot`, and `vendorNameSnapshot` or equivalent immutable fields.
- Image handling starts as URL/path metadata only. Binary upload/storage is out of scope until a storage backend is chosen.
- Vendor ids and catalog item ids must be stable; UI list keys must not use array index.
- Existing test chain applies from `frontend/`: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build`.

## UI/UX 要求

- Today's menu setup remains in the admin area and must be visually separate from reset/test-data danger actions.
- POS idle state shows today's menu name, price, vendor, vendor phone, and current order count in large readable text.
- Menu changes after transactions exist require a blocking confirmation with explicit "future transactions only" copy.
- Vendor management uses a dense table/list with inline edit, save, cancel, deactivate/reactivate actions.
- Catalog item creation uses field-level validation and should not interrupt the fast POS counter screen.
- Inactive vendors/catalog items are hidden from default pickers but available through admin filters.
- Menu images, when present, support admin recognition and future catalog UX; they should not dominate the Phase 1 counter workflow.

## 與其他模組的介面

### 輸入

- Active business date from `pc-pos-order-flow` / app date context.
- Vendor and catalog edits from admin UI.
- Historical reference checks from `order-ledger-and-cash-close`.
- Sync status/revision updates from `google-sheets-sync-and-offline`.

### 輸出

- `TodayMenu` for POS order preview and transaction creation.
- `Vendor` records for admin CRUD and display.
- `MenuCatalogItem` records for reusable future menu setup.
- Menu/vendor snapshots for transactions and daily settlements.

### 依賴關係

- `pc-pos-order-flow` depends on active today's menu price/name/vendor to compute order transactions.
- `order-ledger-and-cash-close` depends on snapshots for historical reporting and settlement.
- `google-sheets-sync-and-offline` depends on flat serializable menu/vendor rows and stable ids.
- `student-account-management` has no direct dependency on menu/vendor, but transaction snapshots combine both domains.

## 建議資料型別

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

export interface MenuCatalogItem {
  itemId: string;
  name: string;
  defaultPrice: number;
  defaultVendorId?: string;
  category?: string;
  imageUrl?: string;
  description?: string;
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
```

## 現有實作對照

- Current model: `frontend/src/mocks/initialData.ts` defines `TodayMenu { date, name, price, vendor }` and `Vendor { id, name, phone, note }`.
- Current store: `setTodayMenu` and `setVendors` persist through Zustand.
- Current UI: `AdminScreen` edits today's menu and vendor selection; `VendorsScreen` supports local create/edit/delete.
- Current gaps: no status/deactivation, no catalog, no snapshots in transaction schema, no post-transaction menu-change warning, no validation tests, no image/category support.

## 不在本模組範圍

- Multi-item cart and checkout; the PDF Phase 1 flow remains one primary lunch item.
- Inventory, vendor billing, or purchase order management.
- Binary image upload/storage.
- Payment provider integration.
