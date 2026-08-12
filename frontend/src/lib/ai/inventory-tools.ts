// =============================================================================
// Inventory Tool Layer — allowlisted, READ-ONLY tools for the LLM
// =============================================================================
// The conversational model never receives database credentials and never
// writes SQL. It may only request one of the fixed tools below. This module
// owns every query, clamps all inputs, and returns compact JSON-serializable
// results. Anything not in TOOL_HANDLERS is rejected.
//
// SAFETY CONTRACT:
//   - No mutations. Every handler is a SELECT-style read.
//   - No raw string-built SQL. Prisma / parameterized queries only.
//   - Inputs are validated and limits are clamped before use.
// =============================================================================

import { prisma } from "@/lib/prisma";
import { getProductById } from "@/actions/inventory/queries";
import { hybridSearch } from "@/actions/inventory/search";

const MAX_LIMIT = 20;
const DEFAULT_LIMIT = 8;

function clampLimit(value: unknown, fallback = DEFAULT_LIMIT): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.trunc(n), MAX_LIMIT);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// A compact item card the UI can render. Kept small on purpose so we never
// dump the whole database into the model context.
export interface ToolItemCard {
  id: number;
  title: string;
  image_url: string | null;
  location_name: string | null;
  manufacturer: string | null;
  asset_tag: string | null;
  status: string | null;
  similarity?: number;
}

// Result envelope — handlers never throw to the model; they return errors.
export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  // Items surfaced by this call, for the UI to render as cards.
  items?: ToolItemCard[];
}

// -----------------------------------------------------------------------------
// Tool schemas (OpenAI/OpenRouter "tools" format)
// -----------------------------------------------------------------------------
export const INVENTORY_TOOLS = [
  {
    type: "function",
    function: {
      name: "search_inventory",
      description:
        "Search the personal inventory by meaning or keywords (hybrid text + visual/semantic search). Use for questions like 'find my red sweater' or 'where is my badminton gear'. Returns matching items with their current location.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Natural search phrase describing the item(s).",
          },
          limit: {
            type: "integer",
            description: `Max results (1-${MAX_LIMIT}). Default ${DEFAULT_LIMIT}.`,
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_item",
      description:
        "Get full details for one inventory item by its numeric id, including location, status, category, specs, and notes.",
      parameters: {
        type: "object",
        properties: {
          item_id: { type: "integer", description: "The item's numeric id." },
        },
        required: ["item_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "locate_item",
      description:
        "Find where an item is currently stored. Returns the single best-matching item and its location name.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Name/description of the item to locate." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_items_at_location",
      description:
        "List the items currently stored at a named location (e.g. 'Garage', 'Van', 'Office'). Matches the location name case-insensitively.",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "Location name to look up." },
          limit: {
            type: "integer",
            description: `Max items (1-${MAX_LIMIT}). Default ${DEFAULT_LIMIT}.`,
          },
        },
        required: ["location"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_locations",
      description:
        "List all known storage locations by name. Useful before listing items at a location.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "inventory_summary",
      description:
        "Get aggregate counts for the whole inventory: total item count, breakdown by status, and item counts per location. Use for 'how many …' style questions.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "recent_item_activity",
      description:
        "List the most recent inventory movements/actions (transfers, checkouts, check-ins) with item name and from/to locations.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            description: `Max log entries (1-${MAX_LIMIT}). Default ${DEFAULT_LIMIT}.`,
          },
        },
      },
    },
  },
] as const;

// -----------------------------------------------------------------------------
// Handlers
// -----------------------------------------------------------------------------

function mergeSearchToCards(results: Awaited<ReturnType<typeof hybridSearch>>): ToolItemCard[] {
  const map = new Map<number, ToolItemCard>();

  for (const v of results.vectorResults) {
    map.set(v.item_id, {
      id: v.item_id,
      title: v.title,
      image_url: v.image_url,
      location_name: null,
      manufacturer: v.manufacturer,
      asset_tag: v.asset_tag,
      status: null,
      similarity: v.similarity,
    });
  }
  for (const t of results.textResults) {
    const existing = map.get(t.id);
    if (existing) {
      existing.location_name = t.location_name;
      existing.status = t.status;
    } else {
      map.set(t.id, {
        id: t.id,
        title: t.title,
        image_url: t.image_url,
        location_name: t.location_name,
        manufacturer: t.manufacturer,
        asset_tag: t.asset_tag,
        status: t.status,
      });
    }
  }

  return Array.from(map.values());
}

async function handleSearchInventory(args: Record<string, unknown>): Promise<ToolResult> {
  const query = asString(args.query);
  if (!query) return { ok: false, error: "query is required" };
  const limit = clampLimit(args.limit);

  const results = await hybridSearch(query, limit);
  const cards = mergeSearchToCards(results).slice(0, limit);

  return {
    ok: true,
    items: cards,
    data: {
      query,
      count: cards.length,
      items: cards.map((c) => ({
        id: c.id,
        title: c.title,
        location: c.location_name,
        manufacturer: c.manufacturer,
        asset_tag: c.asset_tag,
        status: c.status,
        similarity: c.similarity,
      })),
    },
  };
}

async function handleGetItem(args: Record<string, unknown>): Promise<ToolResult> {
  const id = clampIdArg(args.item_id);
  if (id === null) return { ok: false, error: "item_id must be a positive integer" };

  const item = await getProductById(id);
  if (!item) return { ok: false, error: `No item found with id ${id}` };

  const card: ToolItemCard = {
    id: item.id,
    title: item.title,
    image_url: item.image_url,
    location_name: item.location_name,
    manufacturer: item.manufacturer,
    asset_tag: item.asset_tag,
    status: item.status,
  };

  return {
    ok: true,
    items: [card],
    data: {
      id: item.id,
      title: item.title,
      description: item.description,
      location: item.location_name,
      default_location: item.default_location_name,
      status: item.status,
      quantity: item.quantity,
      category: item.category_name,
      manufacturer: item.manufacturer,
      model_name: item.model_name,
      model_number: item.model_number,
      serial_number: item.serial_number,
      asset_tag: item.asset_tag,
      assigned_to: item.assigned_to_name,
      notes: item.notes,
      estimated_value: item.estimated_value,
    },
  };
}

async function handleLocateItem(args: Record<string, unknown>): Promise<ToolResult> {
  const query = asString(args.query);
  if (!query) return { ok: false, error: "query is required" };

  const results = await hybridSearch(query, 5);
  const cards = mergeSearchToCards(results);
  const best = cards[0];

  if (!best) {
    return { ok: true, data: { found: false, query }, items: [] };
  }

  return {
    ok: true,
    items: [best],
    data: {
      found: true,
      query,
      item_id: best.id,
      title: best.title,
      location: best.location_name,
      status: best.status,
    },
  };
}

async function handleListLocations(): Promise<ToolResult> {
  const locations = await prisma.locations.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return {
    ok: true,
    data: { count: locations.length, locations: locations.map((l) => l.name) },
  };
}

async function handleListItemsAtLocation(args: Record<string, unknown>): Promise<ToolResult> {
  const location = asString(args.location);
  if (!location) return { ok: false, error: "location is required" };
  const limit = clampLimit(args.limit);

  const loc = await prisma.locations.findFirst({
    where: { name: { equals: location, mode: "insensitive" } },
    select: { id: true, name: true },
  });

  if (!loc) {
    const all = await prisma.locations.findMany({
      orderBy: { name: "asc" },
      select: { name: true },
    });
    return {
      ok: true,
      data: {
        found: false,
        requested: location,
        known_locations: all.map((l) => l.name),
      },
      items: [],
    };
  }

  const items = await prisma.items.findMany({
    where: { location_id: loc.id, deleted_at: null },
    orderBy: { updated_at: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      image_url: true,
      manufacturer: true,
      asset_tag: true,
      status: true,
    },
  });

  const cards: ToolItemCard[] = items.map((i) => ({
    id: i.id,
    title: i.title,
    image_url: i.image_url,
    location_name: loc.name,
    manufacturer: i.manufacturer,
    asset_tag: i.asset_tag,
    status: i.status,
  }));

  return {
    ok: true,
    items: cards,
    data: {
      found: true,
      location: loc.name,
      count: cards.length,
      items: cards.map((c) => ({ id: c.id, title: c.title, status: c.status })),
    },
  };
}

async function handleInventorySummary(): Promise<ToolResult> {
  const [total, byStatusRaw, byLocationRaw] = await Promise.all([
    prisma.items.count({ where: { deleted_at: null } }),
    prisma.items.groupBy({
      by: ["status"],
      where: { deleted_at: null },
      _count: { _all: true },
    }),
    prisma.items.groupBy({
      by: ["location_id"],
      where: { deleted_at: null },
      _count: { _all: true },
    }),
  ]);

  const byStatus = byStatusRaw.map((row) => ({
    status: row.status ?? "unknown",
    count: row._count._all,
  }));

  // Resolve location names for the per-location counts.
  const locationIds = byLocationRaw
    .map((r) => r.location_id)
    .filter((id): id is number => typeof id === "number");
  const locations = locationIds.length
    ? await prisma.locations.findMany({
        where: { id: { in: locationIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(locations.map((l) => [l.id, l.name]));

  const byLocation = byLocationRaw.map((row) => ({
    location:
      row.location_id === null ? "Unassigned" : nameById.get(row.location_id) ?? "Unknown",
    count: row._count._all,
  }));

  return {
    ok: true,
    data: { total_items: total, by_status: byStatus, by_location: byLocation },
  };
}

async function handleRecentActivity(args: Record<string, unknown>): Promise<ToolResult> {
  const limit = clampLimit(args.limit);

  const logs = await prisma.action_logs.findMany({
    orderBy: { action_date: "desc" },
    take: limit,
    include: {
      items: { select: { id: true, title: true } },
      locations_action_logs_from_location_idTolocations: { select: { name: true } },
      locations_action_logs_to_location_idTolocations: { select: { name: true } },
    },
  });

  return {
    ok: true,
    data: {
      count: logs.length,
      activity: logs.map((log) => ({
        action: log.action_type,
        item_id: log.items?.id ?? null,
        item: log.items?.title ?? null,
        from: log.locations_action_logs_from_location_idTolocations?.name ?? null,
        to: log.locations_action_logs_to_location_idTolocations?.name ?? null,
        note: log.note,
        date: log.action_date?.toISOString() ?? null,
      })),
    },
  };
}

function clampIdArg(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

// -----------------------------------------------------------------------------
// Registry + executor
// -----------------------------------------------------------------------------
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  search_inventory: handleSearchInventory,
  get_item: handleGetItem,
  locate_item: handleLocateItem,
  list_items_at_location: handleListItemsAtLocation,
  list_locations: handleListLocations,
  inventory_summary: handleInventorySummary,
  recent_item_activity: handleRecentActivity,
};

export function isAllowedTool(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(TOOL_HANDLERS, name);
}

/**
 * Execute an allowlisted tool. Never throws — unknown tools, bad arguments and
 * runtime errors are all returned as a structured error the model can read.
 */
export async function executeInventoryTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    return { ok: false, error: `Tool "${name}" is not allowed.` };
  }
  try {
    return await handler(args ?? {});
  } catch (error) {
    console.error(`[inventory-tools] ${name} failed:`, error);
    return { ok: false, error: "Tool execution failed." };
  }
}
