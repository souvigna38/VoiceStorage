"use client";

import { useState } from "react";
import { MagnifyingGlassCircleIcon, LinkIcon, CurrencyDollarIcon } from "@heroicons/react/24/solid";
import type { ProductDetail, ResearchSource } from "@/lib/types";

export default function ItemResearch({ product }: { product: ProductDetail }) {
  const [isResearching, setIsResearching] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    error?: string;
    message?: string;
  } | null>(null);

  const handleResearch = async () => {
    setIsResearching(true);
    setResult(null);
    try {
      const resp = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: product.id }),
      });
      const data = await resp.json();
      setResult(data);
      if (data.success) {
        window.location.reload();
      }
    } catch (err) {
      setResult({
        success: false,
        error: err instanceof Error ? err.message : "Research failed",
      });
    } finally {
      setIsResearching(false);
    }
  };

  const hasResearch = Boolean(
    product.ai_research_summary || product.ai_research_price_low != null
  );
  const sources: ResearchSource[] = product.ai_research_sources ?? [];

  return (
    <div className="border-t border-gray-100 p-6 md:p-8">
      <h2 className="text-lg font-bold text-[#0f1111] mb-4 flex items-center gap-2">
        <MagnifyingGlassCircleIcon className="h-5 w-5 text-blue-500" />
        <span>AI Research</span>
        {hasResearch && (
          <span className="text-xs font-normal bg-blue-100 text-blue-700 px-2.5 py-0.5 rounded-full ml-2">
            Researched
          </span>
        )}
        <button
          onClick={handleResearch}
          disabled={isResearching}
          className="ml-auto flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-full transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          title="Research this item on the web"
        >
          {isResearching ? (
            <>
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Researching...
            </>
          ) : hasResearch ? (
            <>Re-research</>
          ) : (
            <>Research this item</>
          )}
        </button>
      </h2>

      {result && !result.success && (
        <div className="mb-4 px-4 py-2.5 rounded-lg bg-red-50 text-red-700 border border-red-200 text-sm">
          {result.error || result.message || "Research failed"}
        </div>
      )}

      {hasResearch ? (
        <div className="bg-gradient-to-br from-blue-50/50 via-white to-cyan-50/50 border border-blue-100 rounded-lg p-5 space-y-4">
          {/* Summary */}
          {product.ai_research_summary && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-blue-400 mb-1.5">
                Product Summary
              </p>
              <p className="text-sm text-gray-700 leading-relaxed">
                {product.ai_research_summary}
              </p>
            </div>
          )}

          {/* Key specs from research */}
          {product.ai_research_key_specs &&
            Object.keys(product.ai_research_key_specs).length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-blue-400 mb-2">
                  Key Specs (AI)
                </p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(product.ai_research_key_specs).map(([key, val]) => (
                    <span
                      key={key}
                      className="inline-flex items-center px-2.5 py-1 bg-white border border-blue-200 rounded-full text-xs font-medium text-gray-700 shadow-sm"
                    >
                      <span className="text-blue-400 mr-1">{key}:</span>
                      {val}
                    </span>
                  ))}
                </div>
              </div>
            )}

          {/* Price range */}
          {product.ai_research_price_low != null && product.ai_research_price_high != null && (
            <div className="flex items-center gap-3">
              <CurrencyDollarIcon className="h-5 w-5 text-green-500 flex-shrink-0" />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-green-500">
                  Estimated Market Range
                </p>
                <p className="text-lg font-semibold text-[#0f1111]">
                  {product.ai_research_price_currency || "$"}
                  {product.ai_research_price_low.toFixed(2)}
                  {" – "}
                  {product.ai_research_price_currency || "$"}
                  {product.ai_research_price_high.toFixed(2)}
                </p>
              </div>
            </div>
          )}

          {/* Sources */}
          {sources.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-blue-400 mb-2">
                Sources ({sources.length})
              </p>
              <div className="space-y-1.5">
                {sources.slice(0, 5).map((src, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <LinkIcon className="h-3.5 w-3.5 text-gray-400 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <a
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline truncate block"
                      >
                        {src.title || src.source}
                      </a>
                      <span className="text-gray-400">
                        {src.source}
                        {src.price != null && ` · $${src.price.toFixed(2)}`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Last checked */}
          {product.ai_research_last_checked && (
            <p className="text-[10px] text-gray-400">
              Last researched:{" "}
              {new Date(product.ai_research_last_checked).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          )}
        </div>
      ) : (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-5 text-center">
          <p className="text-sm text-gray-500">
            No research yet. Click <strong>Research this item</strong> to generate
            a detailed description and price estimate using AI.
          </p>
        </div>
      )}
    </div>
  );
}
