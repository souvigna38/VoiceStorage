import sharp from "sharp";
import { sanitizeAiLabel, type AiLabel } from "../sanitize";

const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const OPENROUTER_VISION_MODEL = process.env.OPENROUTER_VISION_MODEL || "";
const OPENROUTER_TIMEOUT_MS = Number.parseInt(
  process.env.OPENROUTER_TIMEOUT_MS || "60000",
  10
);
const OPENROUTER_MAX_RETRIES = Number.parseInt(
  process.env.OPENROUTER_MAX_RETRIES || "1",
  10
);

const INVENTORY_PROMPT = `Analyze this image for a personal inventory system.
Identify the main physical object, not the background or storage area.
Return ONLY a JSON object with exactly these fields:
{
  "main_color": "dominant object color",
  "object_type": "specific object type",
  "detected_text": "visible branding, model, labels, or serial text",
  "short_description": "one or two factual inventory-catalog sentences",
  "confidence_score": 0.0
}
confidence_score must be a number from 0.0 to 1.0 representing confidence in the
object identification. Do not invent text that is not visible.`;

type OpenRouterMessageContent =
  | string
  | Array<{ type?: string; text?: string }>;

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: OpenRouterMessageContent;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
  error?: { message?: string };
}

export interface VisionAnalysisResult {
  label: AiLabel;
  provider: "openrouter";
  model: string;
  usage?: OpenRouterResponse["usage"];
}

function requireConfiguration(): { apiKey: string; model: string } {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model = OPENROUTER_VISION_MODEL.trim();

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }
  if (!model) {
    throw new Error("OPENROUTER_VISION_MODEL is not configured");
  }

  return { apiKey, model };
}

export function isOpenRouterConfigured(): boolean {
  return Boolean(
    process.env.OPENROUTER_API_KEY?.trim() && OPENROUTER_VISION_MODEL.trim()
  );
}

function extractMessageText(content: OpenRouterMessageContent | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function parseLabel(content: string): AiLabel {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("OpenRouter response did not contain a JSON object");
  }

  const parsed = JSON.parse(jsonMatch[0]) as Partial<AiLabel>;
  const stringFields: Array<keyof Pick<
    AiLabel,
    "main_color" | "object_type" | "detected_text" | "short_description"
  >> = [
    "main_color",
    "object_type",
    "detected_text",
    "short_description",
  ];

  for (const field of stringFields) {
    if (typeof parsed[field] !== "string") {
      throw new Error(`OpenRouter response field "${field}" must be a string`);
    }
  }

  if (
    typeof parsed.confidence_score !== "number" ||
    !Number.isFinite(parsed.confidence_score)
  ) {
    throw new Error(
      'OpenRouter response field "confidence_score" must be a number'
    );
  }

  return sanitizeAiLabel(parsed as AiLabel);
}

async function prepareImage(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize(1600, 1600, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();
}

export async function analyzeInventoryImage(
  image: Buffer
): Promise<VisionAnalysisResult> {
  const { apiKey, model } = requireConfiguration();
  const prepared = await prepareImage(image);
  const imageData = `data:image/webp;base64,${prepared.toString("base64")}`;
  let lastError: unknown;

  for (let attempt = 0; attempt <= OPENROUTER_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);

    try {
      const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer":
            process.env.OPENROUTER_SITE_URL || "http://localhost:3100",
          "X-OpenRouter-Title":
            process.env.OPENROUTER_APP_NAME || "VoiceStorage",
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          max_tokens: 500,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: INVENTORY_PROMPT },
                {
                  type: "image_url",
                  image_url: { url: imageData },
                },
              ],
            },
          ],
        }),
      });

      const rawText = await response.text();
      let data: OpenRouterResponse;
      try {
        data = JSON.parse(rawText) as OpenRouterResponse;
      } catch {
        throw new Error(
          `OpenRouter returned non-JSON HTTP ${response.status}: ${rawText.slice(0, 300)}`
        );
      }

      if (!response.ok) {
        throw new Error(
          `OpenRouter HTTP ${response.status}: ${
            data.error?.message || rawText.slice(0, 300)
          }`
        );
      }

      const content = extractMessageText(data.choices?.[0]?.message?.content);
      const label = parseLabel(content);

      if (data.usage) {
        console.info(
          `[OpenRouter] model=${model} tokens=${data.usage.total_tokens ?? "unknown"} cost=${data.usage.cost ?? "unknown"}`
        );
      }

      return {
        label,
        provider: "openrouter",
        model,
        usage: data.usage,
      };
    } catch (error) {
      lastError = error;
      if (attempt < OPENROUTER_MAX_RETRIES) {
        await new Promise((resolve) =>
          setTimeout(resolve, 750 * (attempt + 1))
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("OpenRouter image analysis failed");
}
