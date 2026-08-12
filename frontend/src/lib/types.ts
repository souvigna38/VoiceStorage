// Serialized types for client components (Prisma Decimal → number, Date → string)
export interface ProductItem {
  id: number;
  title: string;
  description: string | null;
  price: number;                    // Purchase price (original cost)
  estimated_value: number | null;   // Current estimated market value
  msrp_price: number | null;        // Manufacturer's suggested retail price
  list_price: number | null;        // Asking price if listed for sale
  sold_price: number | null;        // Actual sale price
  medusa_product_id: string | null; // Linked Medusa product (if listed for sale)
  image_url: string | null;
  rating: number;
  rating_count: number;
  asset_tag: string | null;
  serial_number: string | null;
  model_name: string | null;
  model_number: string | null;
  manufacturer: string | null;
  status: string;
  quantity: number;
  location_name: string | null;
  location_id: number | null;
  category_name: string | null;
  category_slug: string | null;
  assigned_to_name: string | null;
  last_checkout: string | null;
  last_checkin: string | null;
  purchase_date: string | null;
  purchase_cost: number | null;
}

export interface Location {
  id: number;
  name: string;
  description: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  item_count?: number;
}

export interface ActionLogEntry {
  id: number;
  action_type: string;
  performed_by_name: string | null;
  from_location_name: string | null;
  to_location_name: string | null;
  note: string | null;
  action_date: string | null;
}

export interface ResearchSource {
  title: string;
  url: string;
  source: string;
  price: number | null;
}

export interface ProductDetail extends ProductItem {
  notes: string | null;
  warranty_months: number | null;
  warranty_expires: string | null;
  order_number: string | null;
  supplier: string | null;
  checkout_counter: number;
  default_location_name: string | null;
  default_location_id: number | null;
  cpu_type: string | null;
  ram_amount: string | null;
  hard_drive_info: string | null;
  gpu: string | null;
  network_info: string | null;
  role: string | null;
  storage_detail: string | null;
  msrp_source: string | null;
  msrp_lookup_query: string | null;
  msrp_last_checked: string | null;
  sold_date: string | null;
  listing_url: string | null;
  ai_research_summary: string | null;
  ai_research_price_low: number | null;
  ai_research_price_high: number | null;
  ai_research_price_currency: string | null;
  ai_research_sources: ResearchSource[];
  ai_research_key_specs: Record<string, string>;
  ai_research_last_checked: string | null;
  images: {
    id: number;
    image_url: string;
    alt_text: string | null;
    is_primary: boolean;
    ai_processed: boolean;
    ai_description: string | null;
    ai_main_color: string | null;
    ai_object_type: string | null;
    ai_detected_text: string | null;
    ai_tags: string[];
  }[];
  action_logs: ActionLogEntry[];
  created_at: string | null;
  updated_at: string | null;
}

// Semantic (vector) search result — item + similarity score
export interface SemanticSearchResult {
  item_id: number;
  image_id: number;
  image_url: string;
  title: string;
  asset_tag: string | null;
  manufacturer: string | null;
  model_name: string | null;
  distance: number;       // cosine distance (lower = more similar)
  similarity: number;     // 1 - distance (higher = more similar)
}

// Hybrid search combines text + vector results
export interface HybridSearchResults {
  textResults: ProductItem[];
  vectorResults: SemanticSearchResult[];
  query: string;
}
