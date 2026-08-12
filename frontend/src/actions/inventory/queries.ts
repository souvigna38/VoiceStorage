"use server";

import { prisma } from "@/lib/prisma";
import type {
  ProductItem,
  ProductDetail,
  Location,
  Category,
  ResearchSource,
} from "@/lib/types";

// =============================================================================
// GET ALL PRODUCTS — feeds the ProductFeed grid
// =============================================================================
export async function getProducts(
  query?: string,
  categorySlug?: string,
  status?: string
): Promise<ProductItem[]> {
  const where: Record<string, unknown> = {
    deleted_at: null,
  };

  // Search filter
  if (query && query.trim().length > 0) {
    where.OR = [
      { title: { contains: query, mode: "insensitive" } },
      { description: { contains: query, mode: "insensitive" } },
      { asset_tag: { contains: query, mode: "insensitive" } },
      { model_name: { contains: query, mode: "insensitive" } },
      { manufacturer: { contains: query, mode: "insensitive" } },
      { serial_number: { contains: query, mode: "insensitive" } },
    ];
  }

  // Category filter
  if (categorySlug) {
    where.categories = { slug: categorySlug };
  }

  // Status filter
  if (status && status !== "all") {
    where.status = status;
  }

  const items = await prisma.items.findMany({
    where: where as never,
    include: {
      categories: true,
      locations_items_location_idTolocations: true,
      users: true,
    },
    orderBy: { updated_at: "desc" },
  });

  return items.map((item) => ({
    id: item.id,
    title: item.title,
    description: item.description,
    price: item.price ? Number(item.price) : 0,
    estimated_value: item.estimated_value ? Number(item.estimated_value) : null,
    msrp_price: item.msrp_price ? Number(item.msrp_price) : null,
    list_price: item.list_price ? Number(item.list_price) : null,
    sold_price: item.sold_price ? Number(item.sold_price) : null,
    medusa_product_id: item.medusa_product_id ?? null,
    image_url: item.image_url,
    rating: item.rating ? Number(item.rating) : 5.0,
    rating_count: item.rating_count ?? 1,
    asset_tag: item.asset_tag,
    serial_number: item.serial_number,
    model_name: item.model_name,
    model_number: item.model_number,
    manufacturer: item.manufacturer,
    status: item.status ?? "available",
    quantity: item.quantity ?? 1,
    location_name: item.locations_items_location_idTolocations?.name ?? null,
    location_id: item.location_id,
    category_name: item.categories?.name ?? null,
    category_slug: item.categories?.slug ?? null,
    assigned_to_name: item.users?.name ?? null,
    last_checkout: item.last_checkout?.toISOString() ?? null,
    last_checkin: item.last_checkin?.toISOString() ?? null,
    purchase_date: item.purchase_date?.toISOString() ?? null,
    purchase_cost: item.purchase_cost ? Number(item.purchase_cost) : null,
  }));
}

// =============================================================================
// GET SINGLE PRODUCT BY ID — feeds the Item Detail page
// =============================================================================
export async function getProductById(id: number): Promise<ProductDetail | null> {
  const item = await prisma.items.findUnique({
    where: { id, deleted_at: null },
    include: {
      categories: true,
      locations_items_location_idTolocations: true,
      locations_items_default_location_idTolocations: true,
      users: true,
      item_images: { orderBy: { display_order: "asc" } },
      action_logs: {
        orderBy: { action_date: "desc" },
        take: 20,
        include: {
          users_action_logs_performed_byTousers: true,
          locations_action_logs_from_location_idTolocations: true,
          locations_action_logs_to_location_idTolocations: true,
        },
      },
    },
  });

  if (!item) return null;

  return {
    id: item.id,
    title: item.title,
    description: item.description,
    price: item.price ? Number(item.price) : 0,
    estimated_value: item.estimated_value ? Number(item.estimated_value) : null,
    msrp_price: item.msrp_price ? Number(item.msrp_price) : null,
    list_price: item.list_price ? Number(item.list_price) : null,
    sold_price: item.sold_price ? Number(item.sold_price) : null,
    medusa_product_id: item.medusa_product_id ?? null,
    image_url: item.image_url,
    rating: item.rating ? Number(item.rating) : 5.0,
    rating_count: item.rating_count ?? 1,
    asset_tag: item.asset_tag,
    serial_number: item.serial_number,
    model_name: item.model_name,
    model_number: item.model_number,
    manufacturer: item.manufacturer,
    status: item.status ?? "available",
    quantity: item.quantity ?? 1,
    location_name: item.locations_items_location_idTolocations?.name ?? null,
    location_id: item.location_id,
    default_location_name:
      item.locations_items_default_location_idTolocations?.name ?? null,
    default_location_id: item.default_location_id,
    category_name: item.categories?.name ?? null,
    category_slug: item.categories?.slug ?? null,
    assigned_to_name: item.users?.name ?? null,
    last_checkout: item.last_checkout?.toISOString() ?? null,
    last_checkin: item.last_checkin?.toISOString() ?? null,
    purchase_date: item.purchase_date?.toISOString() ?? null,
    purchase_cost: item.purchase_cost ? Number(item.purchase_cost) : null,
    notes: item.notes,
    warranty_months: item.warranty_months,
    warranty_expires: item.warranty_expires?.toISOString() ?? null,
    order_number: item.order_number,
    supplier: item.supplier,
    checkout_counter: item.checkout_counter ?? 0,
    cpu_type: item.cpu_type,
    ram_amount: item.ram_amount,
    hard_drive_info: item.hard_drive_info,
    gpu: item.gpu,
    network_info: item.network_info,
    role: item.role,
    storage_detail: item.storage_detail,
    msrp_source: item.msrp_source,
    msrp_lookup_query: item.msrp_lookup_query,
    msrp_last_checked: item.msrp_last_checked?.toISOString() ?? null,
    sold_date: item.sold_date?.toISOString() ?? null,
    listing_url: item.listing_url,
    ai_research_summary: item.ai_research_summary ?? null,
    ai_research_price_low: item.ai_research_price_low ? Number(item.ai_research_price_low) : null,
    ai_research_price_high: item.ai_research_price_high ? Number(item.ai_research_price_high) : null,
    ai_research_price_currency: item.ai_research_price_currency ?? "USD",
    ai_research_sources: Array.isArray(item.ai_research_sources)
      ? (item.ai_research_sources as unknown as ResearchSource[])
      : [],
    ai_research_key_specs:
      item.ai_research_key_specs && typeof item.ai_research_key_specs === "object"
        ? (item.ai_research_key_specs as Record<string, string>)
        : {},
    ai_research_last_checked: item.ai_research_last_checked?.toISOString() ?? null,
    images: item.item_images.map((img) => ({
      id: img.id,
      image_url: img.image_url,
      alt_text: img.alt_text,
      is_primary: img.is_primary ?? false,
      ai_processed: img.ai_processed ?? false,
      ai_description: img.ai_description ?? null,
      ai_main_color: img.ai_main_color ?? null,
      ai_object_type: img.ai_object_type ?? null,
      ai_detected_text: img.ai_detected_text ?? null,
      ai_tags: Array.isArray(img.ai_tags) ? (img.ai_tags as string[]) : [],
    })),
    action_logs: item.action_logs.map((log) => ({
      id: log.id,
      action_type: log.action_type,
      performed_by_name:
        log.users_action_logs_performed_byTousers?.name ?? null,
      from_location_name:
        log.locations_action_logs_from_location_idTolocations?.name ?? null,
      to_location_name:
        log.locations_action_logs_to_location_idTolocations?.name ?? null,
      note: log.note,
      action_date: log.action_date?.toISOString() ?? null,
    })),
    created_at: item.created_at?.toISOString() ?? null,
    updated_at: item.updated_at?.toISOString() ?? null,
  };
}

// =============================================================================
// GET ALL LOCATIONS — feeds the LocationSelector dropdown
// =============================================================================
export async function getLocations(): Promise<Location[]> {
  const locations = await prisma.locations.findMany({
    orderBy: { name: "asc" },
  });

  return locations.map((loc) => ({
    id: loc.id,
    name: loc.name,
    description: loc.description,
    address: loc.address,
    city: loc.city,
    state: loc.state,
  }));
}

// =============================================================================
// GET ALL CATEGORIES — feeds the Header nav
// =============================================================================
export async function getCategories(): Promise<Category[]> {
  const categories = await prisma.categories.findMany({
    include: { _count: { select: { items: true } } },
    orderBy: { display_order: "asc" },
  });

  return categories.map((cat) => ({
    id: cat.id,
    name: cat.name,
    slug: cat.slug,
    description: cat.description,
    item_count: cat._count.items,
  }));
}
