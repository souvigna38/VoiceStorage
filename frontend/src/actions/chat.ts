"use server";

// =============================================================================
// Conversational Inventory Search — authenticated server action
// =============================================================================
// Sends a natural-language question to the OpenRouter chat model, which may
// only call the allowlisted read-only inventory tools. Falls back to plain
// hybrid search when OpenRouter is unconfigured or errors, so voice/search
// keeps working regardless.
// =============================================================================

import { assertActionAuthorized } from "@/lib/auth";
import {
  chatWithInventoryTools,
  isOpenRouterChatConfigured,
} from "@/lib/ai/openrouter-chat";
import { hybridSearch } from "@/actions/inventory/search";
import type { ToolItemCard } from "@/lib/ai/inventory-tools";

export interface ConversationalSearchResult {
  answer: string;
  items: ToolItemCard[];
  model: string | null;
  /** true when OpenRouter was unavailable and we returned plain search. */
  usedFallback: boolean;
}

const MAX_MESSAGE_LEN = 500;

export async function conversationalSearch(
  message: string
): Promise<ConversationalSearchResult> {
  await assertActionAuthorized();

  const cleaned = (message || "").trim().slice(0, MAX_MESSAGE_LEN);
  if (!cleaned) {
    return { answer: "I didn't catch that — please try again.", items: [], model: null, usedFallback: true };
  }

  if (isOpenRouterChatConfigured()) {
    try {
      const result = await chatWithInventoryTools(cleaned);
      return {
        answer: result.answer,
        items: result.items,
        model: result.model,
        usedFallback: false,
      };
    } catch (error) {
      console.error("[conversationalSearch] OpenRouter failed, falling back:", error);
    }
  }

  return fallbackSearch(cleaned);
}

/** Plain hybrid search with a templated answer — no LLM involved. */
async function fallbackSearch(query: string): Promise<ConversationalSearchResult> {
  const results = await hybridSearch(query, 8);

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

  const items = Array.from(map.values());
  const top = items[0];
  let answer: string;
  if (!top) {
    answer = `I couldn't find anything matching "${query}".`;
  } else if (top.location_name) {
    answer = `Closest match: ${top.title}, located in ${top.location_name}.`;
  } else {
    answer = `Closest match: ${top.title}.`;
  }

  return { answer, items, model: null, usedFallback: true };
}
