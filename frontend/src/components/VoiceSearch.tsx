"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { MicrophoneIcon, XMarkIcon } from "@heroicons/react/24/solid";
import {
  MagnifyingGlassIcon,
  SignalIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import Image from "next/image";
import { processVoiceCommand } from "@/actions/voice";
import type { VoiceSearchResult } from "@/actions/voice";

// =============================================================================
// VoiceSearch — The "Star Trek" Floating Action Button
// =============================================================================
// Press & hold the mic → record → release → transcribe → show results.
// Designed to work as a PWA on iPhone (save to Home Screen).
// =============================================================================

type VoiceState =
  | "idle"          // Default — mic button visible
  | "listening"     // Recording audio (pulse animation)
  | "processing"    // Sending to Whisper + searching
  | "results"       // Showing search results
  | "error";        // Something went wrong

export default function VoiceSearch() {
  const router = useRouter();
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<VoiceSearchResult | null>(null);
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);

  // Audio recording refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Clean up media stream on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Start recording
  // ---------------------------------------------------------------------------
  const startRecording = useCallback(async () => {
    try {
      setError("");
      setState("listening");
      setIsOverlayOpen(true);
      chunksRef.current = [];

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,   // Whisper prefers 16kHz
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      // Determine best supported MIME type
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "audio/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        // Stop all tracks to release mic
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        // Process the recording
        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size > 0) {
          handleAudioBlob(blob, mimeType);
        } else {
          setError("No audio captured — try speaking louder");
          setState("error");
        }
      };

      recorder.start(100); // Collect data every 100ms
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Microphone access denied";
      if (msg.includes("Permission") || msg.includes("NotAllowed")) {
        setError("Microphone permission denied. Please allow access in your browser settings.");
      } else {
        setError(msg);
      }
      setState("error");
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Stop recording
  // ---------------------------------------------------------------------------
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      setState("processing");
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Send audio to backend
  // ---------------------------------------------------------------------------
  const handleAudioBlob = async (blob: Blob, mimeType: string) => {
    setState("processing");

    try {
      const ext = mimeType.includes("mp4") ? "mp4" : "webm";
      const formData = new FormData();
      formData.append("audio", blob, `voice_command.${ext}`);

      const voiceResult = await processVoiceCommand(formData);
      setResult(voiceResult);
      setState("results");
      speak(voiceResult.answer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Voice search failed";
      setError(msg);
      setState("error");
    }
  };

  // Read the assistant's answer aloud (browser TTS — free, on-device).
  const speak = (text?: string) => {
    if (!text) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      window.speechSynthesis.speak(utterance);
    } catch {
      // TTS is best-effort; ignore failures.
    }
  };

  // ---------------------------------------------------------------------------
  // Close overlay
  // ---------------------------------------------------------------------------
  const closeOverlay = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsOverlayOpen(false);
    setState("idle");
    setResult(null);
    setError("");
  };

  // ---------------------------------------------------------------------------
  // Navigate to item
  // ---------------------------------------------------------------------------
  const goToItem = (id: number) => {
    closeOverlay();
    router.push(`/item/${id}`);
  };

  // ---------------------------------------------------------------------------
  // Full search with transcript
  // ---------------------------------------------------------------------------
  const fullSearch = () => {
    if (result?.results.query) {
      closeOverlay();
      router.push(`/?q=${encodeURIComponent(result.results.query)}`);
    }
  };

  // Total results count
  const totalResults =
    (result?.results.textResults.length ?? 0) +
    (result?.results.vectorResults.length ?? 0);

  // Deduplicate: merge text + vector results by item_id
  const mergedResults = result
    ? getMergedResults(result)
    : [];

  return (
    <>
      {/* ═══════════ Floating Action Button ═══════════ */}
      {!isOverlayOpen && (
        <button
          onMouseDown={startRecording}
          onMouseUp={stopRecording}
          onMouseLeave={stopRecording}
          onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
          onTouchEnd={(e) => { e.preventDefault(); stopRecording(); }}
          className="fixed bottom-6 right-6 z-50 w-16 h-16 rounded-full bg-gradient-to-br from-[#febd69] to-[#f3a847] shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all duration-150 border-2 border-[#131921]/20"
          title="Press & hold to speak"
          aria-label={
            state === "idle"
              ? "Voice search — press and hold to speak"
              : state === "listening"
                ? "Recording — release to search"
                : state === "processing"
                  ? "Processing your voice command"
                  : "Voice search — press and hold to speak"
          }
        >
          <MicrophoneIcon className="h-7 w-7 text-[#131921]" />
        </button>
      )}

      {/* ═══════════ Full-screen Overlay ═══════════ */}
      {isOverlayOpen && (
        <div className="fixed inset-0 z-[100] bg-[#131921]/95 backdrop-blur-sm flex flex-col" role="dialog" aria-modal="true" aria-label="Voice search">
          {/* Announcer for screen readers */}
          <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {state === "listening" && "Recording. Release to search."}
            {state === "processing" && "Processing your voice command."}
            {state === "error" && "Voice search error."}
            {state === "results" && "Voice search results ready."}
          </div>
          {/* Close button */}
          <button
            onClick={closeOverlay}
            className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 transition"
            aria-label="Close voice search"
          >
            <XMarkIcon className="h-6 w-6 text-white" />
          </button>

          {/* ─── LISTENING STATE ─── */}
          {state === "listening" && (
            <div className="flex-1 flex flex-col items-center justify-center px-6">
              {/* Pulse rings */}
              <div className="relative">
                <div className="absolute inset-0 w-32 h-32 rounded-full bg-[#febd69]/20 animate-ping" />
                <div className="absolute inset-2 w-28 h-28 rounded-full bg-[#febd69]/30 animate-pulse" />
                <button
                  type="button"
                  className="relative w-32 h-32 rounded-full bg-gradient-to-br from-[#febd69] to-[#f3a847] flex items-center justify-center shadow-2xl cursor-pointer border-0"
                  onMouseUp={stopRecording}
                  onTouchEnd={(e) => { e.preventDefault(); stopRecording(); }}
                  aria-label="Recording in progress. Release to search."
                >
                  <MicrophoneIcon className="h-14 w-14 text-[#131921] animate-pulse" />
                </button>
              </div>
              <p className="mt-8 text-white text-xl font-light tracking-wide">
                Listening...
              </p>
              <p className="mt-2 text-white/50 text-sm">
                Release to search
              </p>

              {/* Waveform bars */}
              <div className="flex items-end gap-1 mt-6 h-8">
                {[...Array(12)].map((_, i) => (
                  <div
                    key={i}
                    className="w-1 bg-[#febd69] rounded-full animate-pulse"
                    style={{
                      height: `${Math.random() * 24 + 8}px`,
                      animationDelay: `${i * 0.08}s`,
                      animationDuration: `${0.4 + Math.random() * 0.4}s`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ─── PROCESSING STATE ─── */}
          {state === "processing" && (
            <div className="flex-1 flex flex-col items-center justify-center px-6">
              <div className="relative w-24 h-24">
                <div className="absolute inset-0 rounded-full border-4 border-[#febd69]/30" />
                <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-[#febd69] animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <SignalIcon className="h-10 w-10 text-[#febd69]" />
                </div>
              </div>
              <p className="mt-8 text-white text-xl font-light tracking-wide">
                Processing...
              </p>
              <p className="mt-2 text-white/50 text-sm">
                Transcribing voice → Searching inventory
              </p>
            </div>
          )}

          {/* ─── ERROR STATE ─── */}
          {state === "error" && (
            <div className="flex-1 flex flex-col items-center justify-center px-6">
              <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center">
                <ExclamationTriangleIcon className="h-10 w-10 text-red-400" />
              </div>
              <p className="mt-6 text-red-400 text-lg font-medium text-center">
                {error || "Something went wrong"}
              </p>
              <button
                onClick={() => { setState("idle"); setIsOverlayOpen(false); }}
                className="mt-6 px-6 py-2 bg-white/10 rounded-full text-white hover:bg-white/20 transition"
              >
                Try Again
              </button>
            </div>
          )}

          {/* ─── RESULTS STATE ─── */}
          {state === "results" && result && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Transcript header */}
              <div className="px-6 pt-16 pb-4 border-b border-white/10">
                <div className="flex items-center gap-2 text-[#febd69] text-xs uppercase tracking-wider mb-2">
                  <MicrophoneIcon className="h-3 w-3" />
                  Voice Command ({result.transcriptionTime}s)
                </div>
                <p className="text-white text-2xl font-light">
                  &ldquo;{result.transcript}&rdquo;
                </p>
                {result.results.query !== result.transcript && (
                  <p className="text-white/40 text-sm mt-1">
                    Searching: <span className="text-[#febd69]">{result.results.query}</span>
                  </p>
                )}
                <div className="flex items-center gap-4 mt-3">
                  <span className="text-white/50 text-sm">
                    {totalResults} result{totalResults !== 1 ? "s" : ""} found
                  </span>
                  {result.results.vectorResults.length > 0 && (
                    <span className="text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full">
                      🧬 {result.results.vectorResults.length} visual match{result.results.vectorResults.length !== 1 ? "es" : ""}
                    </span>
                  )}
                </div>
              </div>

              {/* Assistant answer (conversational layer) */}
              {result.answer && (
                <div className="px-6 pt-4">
                  <div className="flex items-start gap-3 rounded-xl bg-[#febd69]/10 border border-[#febd69]/30 px-4 py-3">
                    <SignalIcon className="h-5 w-5 text-[#febd69] flex-shrink-0 mt-0.5" />
                    <p className="text-white text-base leading-relaxed">{result.answer}</p>
                  </div>
                </div>
              )}

              {/* Results list */}
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {mergedResults.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <MagnifyingGlassIcon className="h-12 w-12 text-white/20 mb-4" />
                    <p className="text-white/50 text-lg">No items found</p>
                    <p className="text-white/30 text-sm mt-1">
                      Try saying something more specific
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {mergedResults.map((item) => (
                      <button
                        key={`${item.source}-${item.id}`}
                        onClick={() => goToItem(item.id)}
                        className="w-full flex items-center gap-4 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition text-left"
                      >
                        {/* Thumbnail */}
                        <div className="w-16 h-16 rounded-lg bg-white/10 flex-shrink-0 overflow-hidden relative">
                          {item.image_url ? (
                            <Image
                              src={item.image_url}
                              alt={item.title || "Item"}
                              fill
                              className="object-cover"
                              sizes="64px"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-white/30 text-xs">
                              No img
                            </div>
                          )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-medium truncate">
                            {item.title}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            {item.manufacturer && (
                              <span className="text-white/40 text-xs truncate">
                                {item.manufacturer}
                              </span>
                            )}
                            {item.asset_tag && (
                              <span className="text-[#febd69] text-xs font-mono">
                                {item.asset_tag}
                              </span>
                            )}
                          </div>
                          {item.location_name && (
                            <p className="text-white/30 text-xs mt-0.5">
                              📍 {item.location_name}
                            </p>
                          )}
                        </div>

                        {/* Match indicator */}
                        <div className="flex-shrink-0">
                          {item.source === "vector" && (
                            <span className="text-xs bg-purple-500/30 text-purple-300 px-2 py-1 rounded-full">
                              {Math.round(item.similarity * 100)}%
                            </span>
                          )}
                          {item.source === "text" && (
                            <span className="text-xs bg-blue-500/30 text-blue-300 px-2 py-1 rounded-full">
                              text
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Bottom actions */}
              <div className="px-6 py-4 border-t border-white/10 flex gap-3">
                <button
                  onClick={fullSearch}
                  className="flex-1 py-3 bg-[#febd69] text-[#131921] rounded-full font-bold text-sm hover:bg-[#f3a847] transition flex items-center justify-center gap-2"
                >
                  <MagnifyingGlassIcon className="h-4 w-4" />
                  Full Search
                </button>
                <button
                  onClick={() => {
                    setResult(null);
                    setState("idle");
                    startRecording();
                  }}
                  className="py-3 px-6 bg-white/10 text-white rounded-full font-bold text-sm hover:bg-white/20 transition flex items-center gap-2"
                >
                  <MicrophoneIcon className="h-4 w-4" />
                  Again
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// =============================================================================
// Merge text + vector results, deduplicate by item ID
// =============================================================================
interface MergedItem {
  id: number;
  title: string;
  image_url: string | null;
  asset_tag: string | null;
  manufacturer: string | null;
  location_name: string | null;
  source: "text" | "vector" | "both";
  similarity: number;
}

function getMergedResults(result: VoiceSearchResult): MergedItem[] {
  const map = new Map<number, MergedItem>();

  // Add vector results first (higher priority — visual matches)
  for (const vr of result.results.vectorResults) {
    map.set(vr.item_id, {
      id: vr.item_id,
      title: vr.title,
      image_url: vr.image_url,
      asset_tag: vr.asset_tag,
      manufacturer: vr.manufacturer,
      location_name: null,
      source: "vector",
      similarity: vr.similarity,
    });
  }

  // Add text results
  for (const tr of result.results.textResults) {
    if (map.has(tr.id)) {
      // Item already in vector results — mark as "both"
      map.get(tr.id)!.source = "both";
      map.get(tr.id)!.location_name = tr.location_name;
    } else {
      map.set(tr.id, {
        id: tr.id,
        title: tr.title,
        image_url: tr.image_url,
        asset_tag: tr.asset_tag,
        manufacturer: tr.manufacturer,
        location_name: tr.location_name,
        source: "text",
        similarity: 0,
      });
    }
  }

  // Sort: "both" first, then "vector" by similarity, then "text"
  return Array.from(map.values()).sort((a, b) => {
    if (a.source === "both" && b.source !== "both") return -1;
    if (b.source === "both" && a.source !== "both") return 1;
    if (a.source === "vector" && b.source === "text") return -1;
    if (b.source === "vector" && a.source === "text") return 1;
    return b.similarity - a.similarity;
  });
}
