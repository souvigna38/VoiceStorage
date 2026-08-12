import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { researchItem, isResearchConfigured } from "@/lib/ai/item-research";

// POST /api/research — Research a single item (LLM product knowledge)
// Body: { itemId: number }

export async function POST(request: Request) {
  const authErr = requireAuth(request);
  if (authErr) return authErr;

  try {
    const body = await request.json();
    const { itemId } = body;

    if (!itemId || typeof itemId !== "number" || !Number.isInteger(itemId) || itemId <= 0) {
      return NextResponse.json(
        { success: false, error: "Valid positive integer itemId required" },
        { status: 400 }
      );
    }

    if (!isResearchConfigured()) {
      return NextResponse.json(
        {
          success: false,
          error: "Research requires OPENROUTER_API_KEY and OPENROUTER_CHAT_MODEL in .env",
        },
        { status: 400 }
      );
    }

    const item = await prisma.items.findUnique({
      where: { id: itemId },
      include: { categories: true },
    });

    if (!item) {
      return NextResponse.json({ success: false, error: "Item not found" }, { status: 404 });
    }

    const result = await researchItem({
      id: item.id,
      title: item.title,
      manufacturer: item.manufacturer,
      model_name: item.model_name,
      model_number: item.model_number,
      description: item.description,
      category_name: item.categories?.name ?? null,
      serial_number: item.serial_number,
      cpu_type: item.cpu_type,
      ram_amount: item.ram_amount,
      hard_drive_info: item.hard_drive_info,
      gpu: item.gpu,
    });

    // Always mark as checked so we don't retry on every load
    await prisma.items.update({
      where: { id: itemId },
      data: {
        ai_research_summary: result.summary,
        ai_research_price_low: result.price_low,
        ai_research_price_high: result.price_high,
        ai_research_price_currency: result.price_currency,
        ai_research_sources: result.sources as unknown as never,
        ai_research_key_specs: result.key_specs as unknown as never,
        ai_research_last_checked: new Date(),
        updated_at: new Date(),
      },
    });

    if (!result.ok) {
      return NextResponse.json({
        success: false,
        error: result.error,
        query: result.query,
      });
    }

    return NextResponse.json({
      success: true,
      query: result.query,
      summary: result.summary,
      price_low: result.price_low,
      price_high: result.price_high,
      price_currency: result.price_currency,
      key_specs: result.key_specs,
      sources: result.sources,
      model: result.model,
    });
  } catch (error) {
    console.error("[research] Error:", error);
    return NextResponse.json(
      { success: false, error: "Item research failed" },
      { status: 500 }
    );
  }
}
