// =============================================================================
// Item Research — LLM-powered product descriptions & price estimates
// =============================================================================
//
// Pipeline:
//   1. Build a product query from item metadata (manufacturer, model, title).
//   2. Ask the OpenRouter chat model to describe the product from its training
//      knowledge — what it is, key specs, and an estimated current price range.
//   3. The LLM returns structured JSON: summary, price_low, price_high, key_specs.
//   4. Persist to items.ai_research_* columns.
//
// No external web search needed. The model (Gemini 2.5 Flash) has broad product
// knowledge from its training data. Price ranges are estimates, not live data.
//
// Cost: 1 OpenRouter call per item. Temperature 0.3 for factual consistency.
// =============================================================================

const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const OPENROUTER_CHAT_MODEL = process.env.OPENROUTER_CHAT_MODEL || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_TIMEOUT_MS = Number.parseInt(
  process.env.OPENROUTER_CHAT_TIMEOUT_MS || process.env.OPENROUTER_TIMEOUT_MS || "45000",
  10
);

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ItemResearchInput {
  id: number;
  title: string;
  manufacturer: string | null;
  model_name: string | null;
  model_number: string | null;
  description: string | null;
  category_name: string | null;
  serial_number: string | null;
  cpu_type: string | null;
  ram_amount: string | null;
  hard_drive_info: string | null;
  gpu: string | null;
}

export interface ResearchSource {
  title: string;
  url: string;
  source: string;
  price: number | null;
}

export interface ResearchResult {
  ok: boolean;
  query: string;
  summary: string | null;
  price_low: number | null;
  price_high: number | null;
  price_currency: string;
  sources: ResearchSource[];
  key_specs: Record<string, string>;
  model: string | null;
  error?: string;
}

export function buildResearchQuery(item: ItemResearchInput): string {
  const parts: string[] = [];

  if (item.manufacturer) parts.push(item.manufacturer);
  if (item.model_name) parts.push(item.model_name);
  if (item.model_number && !parts.some((p) => p.includes(item.model_number!))) {
    parts.push(item.model_number);
  }

  if (parts.length === 0) {
    const cleaned = item.title
      .replace(/^Photo Inbox:\s*/i, "")
      .replace(/^IMG\s*\d+/i, "")
      .replace(/\s*—\s*/g, " ")
      .replace(/^"|"$/g, "")
      .trim();
    if (cleaned.length > 3) parts.push(cleaned);
  }

  return parts.join(" ").trim();
}

// -----------------------------------------------------------------------------
// LLM — generate rich description from its product knowledge
// -----------------------------------------------------------------------------

const RESEARCH_PROMPT = `You are a product research assistant for a personal inventory system.
Given an inventory item's metadata, use your product knowledge to write a concise but informative
description and estimate a current market price range.

Return ONLY a JSON object with exactly these fields:
{
  "summary": "2-4 sentences describing what this product is, its key features, and notable specs. Factual tone, no marketing fluff.",
  "price_low": 0,
  "price_high": 0,
  "price_currency": "USD",
  "key_specs": { "spec_name": "value", ... }
}

Rules:
- Use your training knowledge about the product. Be specific about what it is and what it does.
- If you don't recognize the product, describe what you can infer from the metadata (category, manufacturer, model) and note that it may be a niche or custom item.
- price_low / price_high: your best estimate of the current market range (used and new) in USD. Use 0 for both if you truly have no idea.
- key_specs: provide 3-8 relevant specifications (e.g. "Release Year", "Processor", "Memory", "Display", "Connectivity", "Weight", "Power Consumption"). Only include specs you're reasonably confident about. Omit specs that don't apply.
- Keep summary under 500 characters.
- Do NOT make up model numbers or serial numbers. Stick to what the metadata tells you plus general product knowledge.`;

interface LlmResearchResponse {
  summary: string;
  price_low: number;
  price_high: number;
  price_currency: string;
  key_specs: Record<string, string>;
}

async function synthesizeResearch(
  item: ItemResearchInput
): Promise<{ data: LlmResearchResponse; model: string } | { error: string }> {
  if (!OPENROUTER_API_KEY || !OPENROUTER_CHAT_MODEL) {
    return { error: "OpenRouter chat model not configured (OPENROUTER_API_KEY / OPENROUTER_CHAT_MODEL)" };
  }

  const itemContext = [
    `ITEM METADATA:`,
    `  Title: ${item.title}`,
    item.manufacturer ? `  Manufacturer: ${item.manufacturer}` : "",
    item.model_name ? `  Model: ${item.model_name}` : "",
    item.model_number ? `  Model Number: ${item.model_number}` : "",
    item.category_name ? `  Category: ${item.category_name}` : "",
    item.description ? `  Existing AI description: ${item.description}` : "",
    item.cpu_type ? `  CPU: ${item.cpu_type}` : "",
    item.ram_amount ? `  RAM: ${item.ram_amount}` : "",
    item.hard_drive_info ? `  Storage: ${item.hard_drive_info}` : "",
    item.gpu ? `  GPU: ${item.gpu}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);

  try {
    const resp = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3100",
        "X-OpenRouter-Title": process.env.OPENROUTER_APP_NAME || "VoiceStorage",
      },
      body: JSON.stringify({
        model: OPENROUTER_CHAT_MODEL,
        temperature: 0.3,
        max_tokens: 700,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: RESEARCH_PROMPT },
          { role: "user", content: itemContext },
        ],
      }),
    });

    const rawText = await resp.text();
    let parsed: {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
      usage?: { total_tokens?: number; cost?: number };
    };
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return { error: `OpenRouter returned non-JSON (HTTP ${resp.status})` };
    }

    if (!resp.ok) {
      return { error: parsed.error?.message || `OpenRouter HTTP ${resp.status}` };
    }

    const content = parsed.choices?.[0]?.message?.content ?? "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { error: "LLM response did not contain JSON" };
    }

    const llmData = JSON.parse(jsonMatch[0]) as Partial<LlmResearchResponse>;

    if (parsed.usage) {
      console.info(
        `[research] model=${OPENROUTER_CHAT_MODEL} tokens=${parsed.usage.total_tokens ?? "?"} cost=${parsed.usage.cost ?? "?"}`
      );
    }

    return {
      data: {
        summary: String(llmData.summary ?? "").trim(),
        price_low: Number(llmData.price_low) || 0,
        price_high: Number(llmData.price_high) || 0,
        price_currency: String(llmData.price_currency ?? "USD").trim(),
        key_specs:
          llmData.key_specs && typeof llmData.key_specs === "object" ? llmData.key_specs : {},
      },
      model: OPENROUTER_CHAT_MODEL,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "LLM synthesis failed" };
  } finally {
    clearTimeout(timeout);
  }
}

// -----------------------------------------------------------------------------
// Main entry point
// -----------------------------------------------------------------------------

export function isResearchConfigured(): boolean {
  return Boolean(OPENROUTER_API_KEY && OPENROUTER_CHAT_MODEL);
}

export async function researchItem(item: ItemResearchInput): Promise<ResearchResult> {
  const query = buildResearchQuery(item);

  if (!query) {
    return {
      ok: false,
      query: "",
      summary: null,
      price_low: null,
      price_high: null,
      price_currency: "USD",
      sources: [],
      key_specs: {},
      model: null,
      error: "Not enough item metadata to build a research query.",
    };
  }

  const synthesis = await synthesizeResearch(item);

  if ("error" in synthesis) {
    return {
      ok: false,
      query,
      summary: null,
      price_low: null,
      price_high: null,
      price_currency: "USD",
      sources: [],
      key_specs: {},
      model: null,
      error: synthesis.error,
    };
  }

  return {
    ok: true,
    query,
    summary: synthesis.data.summary || null,
    price_low: synthesis.data.price_low > 0 ? synthesis.data.price_low : null,
    price_high: synthesis.data.price_high > 0 ? synthesis.data.price_high : null,
    price_currency: synthesis.data.price_currency,
    sources: [],
    key_specs: synthesis.data.key_specs,
    model: synthesis.model,
  };
}
