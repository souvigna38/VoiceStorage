"use server";

import { hybridSearch } from "@/actions/inventory";
import { conversationalSearch } from "@/actions/chat";
import type { HybridSearchResults } from "@/lib/types";

// =============================================================================
// VOICE SEARCH — The "Star Trek" Voice Loop
// =============================================================================
// Flow: Audio blob → Whisper (transcribe) → OpenRouter conversational answer
//       (allowlisted read-only tools) + CLIP/Prisma hybrid search for cards.
// =============================================================================

const CLIP_SERVICE_URL = process.env.CLIP_SERVICE_URL || "http://localhost:8100";

export interface VoiceSearchResult {
  transcript: string;
  language: string;
  transcriptionTime: number;
  results: HybridSearchResults;
  /** Natural-language answer from the conversational layer, if available. */
  answer?: string;
}

/**
 * processVoiceCommand
 *
 * Accepts an audio blob from the browser's MediaRecorder API,
 * sends it to Whisper for transcription, then runs a hybrid
 * (text + vector) search across the inventory.
 */
export async function processVoiceCommand(
  formData: FormData
): Promise<VoiceSearchResult> {
  const audioFile = formData.get("audio") as File | null;

  if (!audioFile || audioFile.size === 0) {
    throw new Error("No audio data received");
  }

  // ─── Step 1: Transcribe via Whisper ─────────────────────────────────
  const whisperForm = new FormData();
  whisperForm.append("file", audioFile, audioFile.name || "recording.webm");

  const transcribeResp = await fetch(`${CLIP_SERVICE_URL}/transcribe`, {
    method: "POST",
    body: whisperForm,
  });

  if (!transcribeResp.ok) {
    const errText = await transcribeResp.text();
    console.error("[Voice] Whisper error:", errText);
    throw new Error(`Transcription failed: ${transcribeResp.status}`);
  }

  const transcription = await transcribeResp.json();
  const transcript: string = transcription.text?.trim() || "";

  if (!transcript) {
    throw new Error("Could not understand audio — please try again");
  }

  console.log(`[Voice] Whisper transcript: "${transcript}" (${transcription.duration}s)`);

  // ─── Step 2: Clean the command ──────────────────────────────────────
  // Strip common voice prefixes: "Computer, find...", "locate the..."
  const cleaned = cleanVoiceCommand(transcript);
  console.log(`[Voice] Cleaned query: "${cleaned}"`);

  // ─── Step 3: Conversational answer + hybrid search (parallel) ───────
  // The conversational layer uses the full transcript for context; the hybrid
  // search uses the cleaned keywords to power the result cards. Both run in
  // parallel so the UI has an answer and cards even if one path degrades.
  const [results, conversation] = await Promise.all([
    hybridSearch(cleaned, 10),
    conversationalSearch(transcript).catch((err) => {
      console.error("[Voice] Conversational layer failed:", err);
      return null;
    }),
  ]);

  return {
    transcript,
    language: transcription.language || "en",
    transcriptionTime: transcription.duration || 0,
    results,
    answer: conversation?.answer,
  };
}

/**
 * Strip common Star Trek / assistant prefixes from the transcript.
 * "Computer, locate the red sweater" → "red sweater"
 * "Find my Cisco server" → "Cisco server"
 * "Where is the network switch" → "network switch"
 */
function cleanVoiceCommand(text: string): string {
  let cleaned = text;

  // Remove leading wake words / command prefixes
  const prefixes = [
    /^(hey\s+)?(computer|inventory|inv\s*track)[,.]?\s*/i,
    /^(please\s+)?(find|locate|search|look\s+for|show\s+me|where\s+is|where\s+are)\s+(the\s+|my\s+|a\s+)?/i,
    /^(can\s+you\s+)?(find|locate|search|show)\s+(me\s+)?(the\s+|my\s+|a\s+)?/i,
  ];

  for (const prefix of prefixes) {
    cleaned = cleaned.replace(prefix, "");
  }

  return cleaned.trim() || text.trim();
}
