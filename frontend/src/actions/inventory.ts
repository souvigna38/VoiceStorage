// Barrel file — re-exports all inventory actions for backward compatibility
export { getProducts, getProductById, getLocations, getCategories } from "./inventory/queries";
export { transferItem, checkoutItem, checkinItem, updateItem, backfillAssetTags, mergeItems, correctAiLabel } from "./inventory/mutations";
export { semanticSearch, hybridSearch } from "./inventory/search";
