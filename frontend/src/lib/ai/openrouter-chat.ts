// =============================================================================
// OpenRouter Conversational Layer — inventory Q&A via tool calling
// =============================================================================
// Runs a bounded tool-calling loop against OpenRouter. The model may only call
// the allowlisted, read-only tools defined in inventory-tools.ts. It never
// receives DB credentials and never generates SQL. Server-side only.
// =============================================================================

import {
  INVENTORY_TOOLS,
  executeInventoryTool,
  type ToolItemCard,
} from "./inventory-tools";

const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const OPENROUTER_CHAT_MODEL = process.env.OPENROUTER_CHAT_MODEL || "";
const OPENROUTER_TIMEOUT_MS = Number.parseInt(
  process.env.OPENROUTER_CHAT_TIMEOUT_MS || process.env.OPENROUTER_TIMEOUT_MS || "45000",
  10
);
const MAX_TOOL_ROUNDS = Number.parseInt(process.env.OPENROUTER_MAX_TOOL_ROUNDS || "5", 10);
const MAX_COMPLETION_TOKENS = Number.parseInt(
  process.env.OPENROUTER_CHAT_MAX_TOKENS || "700",
  10
);

const SYSTEM_PROMPT = `You are the voice assistant for a personal physical inventory system.
Your job is to answer questions about where the user's belongings are, what they own, and recent movements.

RULES:
- Always use the provided tools to look up real data. Never guess or invent items, locations, counts, or IDs.
- If a tool returns no results, say so plainly. Do not fabricate a location.
- Never mention SQL, databases, tables, or internal IDs unless the user explicitly asks for an item id.
- Keep answers short and spoken-friendly (1-3 sentences). This will be read aloud.
- When you state where something is, name the item and its location clearly.
- If the user's request is ambiguous, make a reasonable search attempt rather than asking a clarifying question, then briefly note the assumption.`;

export function isOpenRouterChatConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim() && OPENROUTER_CHAT_MODEL.trim());
}

interface ToolCall {
  id: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface OpenRouterChatResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
  error?: { message?: string };
}

export interface ConversationalResult {
  answer: string;
  items: ToolItemCard[];
  model: string;
  toolsUsed: string[];
  usage?: OpenRouterChatResponse["usage"];
}

function requireConfig(): { apiKey: string; model: string } {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model = OPENROUTER_CHAT_MODEL.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");
  if (!model) throw new Error("OPENROUTER_CHAT_MODEL is not configured");
  return { apiKey, model };
}

function parseToolArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function callOpenRouter(
  apiKey: string,
  model: string,
  messages: ChatMessage[]
): Promise<OpenRouterChatResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3100",
        "X-OpenRouter-Title": process.env.OPENROUTER_APP_NAME || "VoiceStorage",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: MAX_COMPLETION_TOKENS,
        tools: INVENTORY_TOOLS,
        tool_choice: "auto",
        messages,
      }),
    });

    const rawText = await response.text();
    let data: OpenRouterChatResponse;
    try {
      data = JSON.parse(rawText) as OpenRouterChatResponse;
    } catch {
      throw new Error(
        `OpenRouter returned non-JSON HTTP ${response.status}: ${rawText.slice(0, 300)}`
      );
    }
    if (!response.ok) {
      throw new Error(
        `OpenRouter HTTP ${response.status}: ${data.error?.message || rawText.slice(0, 300)}`
      );
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Answer an inventory question conversationally using allowlisted read-only
 * tools. Throws if OpenRouter is unreachable/misconfigured — callers should
 * fall back to plain search.
 */
export async function chatWithInventoryTools(
  userMessage: string
): Promise<ConversationalResult> {
  const { apiKey, model } = requireConfig();

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  const collectedItems = new Map<number, ToolItemCard>();
  const toolsUsed: string[] = [];
  let lastUsage: OpenRouterChatResponse["usage"];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const data = await callOpenRouter(apiKey, model, messages);
    lastUsage = data.usage ?? lastUsage;

    const choice = data.choices?.[0];
    const message = choice?.message;
    const toolCalls = message?.tool_calls ?? [];

    if (message) {
      messages.push({
        role: "assistant",
        content: message.content ?? null,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      });
    }

    // No tool calls → the model produced its final answer.
    if (!toolCalls.length) {
      const answer = (message?.content ?? "").trim();
      logUsage(model, lastUsage);
      return {
        answer: answer || "I couldn't find anything matching that.",
        items: Array.from(collectedItems.values()),
        model,
        toolsUsed,
        usage: lastUsage,
      };
    }

    // Execute each requested tool and feed results back.
    for (const call of toolCalls) {
      const name = call.function?.name ?? "";
      const args = parseToolArgs(call.function?.arguments);
      toolsUsed.push(name);

      const result = await executeInventoryTool(name, args);
      for (const item of result.items ?? []) {
        collectedItems.set(item.id, item);
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name,
        content: JSON.stringify(result.ok ? result.data : { error: result.error }),
      });
    }
  }

  // Ran out of rounds — ask for a final answer with no further tools.
  logUsage(model, lastUsage);
  return {
    answer:
      "I gathered some results but couldn't fully resolve your request. Here are the closest matches.",
    items: Array.from(collectedItems.values()),
    model,
    toolsUsed,
    usage: lastUsage,
  };
}

function logUsage(model: string, usage?: OpenRouterChatResponse["usage"]) {
  if (!usage) return;
  console.info(
    `[OpenRouter/chat] model=${model} tokens=${usage.total_tokens ?? "?"} cost=${usage.cost ?? "?"}`
  );
}
