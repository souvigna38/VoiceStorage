// =============================================================================
// Input sanitization — prevents stored XSS and prompt injection output abuse
// =============================================================================

/** Normalized shape returned by the configured inventory vision provider. */
export interface AiLabel {
  main_color: string;
  object_type: string;
  detected_text: string;
  short_description: string;
  confidence_score?: number;
}

/**
 * Strip HTML tags, control characters, and enforce a length limit.
 * Keeps printable ASCII and common Latin-1 Supplement characters.
 */
function stripHtml(s: string | undefined | null, maxLen: number): string {
  if (!s || typeof s !== "string") return "";
  return s
    .replace(/<[^>]*>/g, "")              // Remove HTML tags
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, " ")  // Remove control chars / non-printable
    .replace(/\s+/g, " ")                 // Collapse whitespace
    .trim()
    .slice(0, maxLen);
}

/**
 * Sanitize AI model output before storing in the database.
 * Strips HTML, enforces length limits, and ensures string types.
 */
export function sanitizeAiLabel(raw: AiLabel): AiLabel {
  const confidence = Number(raw.confidence_score);
  return {
    main_color: stripHtml(raw.main_color, 50) || "unknown",
    object_type: stripHtml(raw.object_type, 100) || "unknown",
    detected_text: stripHtml(raw.detected_text, 500) || "",
    short_description: stripHtml(raw.short_description, 500) || "",
    confidence_score: Number.isFinite(confidence)
      ? Math.min(1, Math.max(0, confidence))
      : 0,
  };
}

/**
 * Sanitize user-supplied free text before forwarding to external APIs
 * (Medusa, n8n, marketplaces). Strips HTML and enforces a length limit.
 */
export function sanitizeUserText(
  s: string | undefined | null,
  maxLen: number = 2000
): string {
  if (!s || typeof s !== "string") return "";
  return s.replace(/<[^>]*>/g, "").trim().slice(0, maxLen);
}
