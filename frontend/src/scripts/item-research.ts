import "dotenv/config";
import { Pool } from "pg";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { researchItem, isResearchConfigured } from "../lib/ai/item-research";

// =============================================================================
// Item Research Script — Web Search + LLM Synthesis
// =============================================================================
//
// Researches each inventory item using SerpAPI (Google Shopping + Organic) and
// the OpenRouter chat model to produce a rich description + price range.
//
// Usage:
//   npm run research                   # Process all items missing research
//   npm run research -- --item 42      # Research a specific item
//   npm run research -- --force        # Re-research even if already done
//   npm run research -- --dry-run      # Preview queries without searching
//
// Requires: SERPAPI_KEY + OPENROUTER_API_KEY + OPENROUTER_CHAT_MODEL in .env
// =============================================================================

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://admin:secure_password@localhost:5432/inventory?schema=public";

const BATCH_LIMIT = 20;
const DELAY_MS = 1500;

function createPrisma(): PrismaClient {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  const itemArg = args.find((a) => a === "--item");
  const specificItemId = itemArg
    ? parseInt(args[args.indexOf(itemArg) + 1], 10)
    : null;

  console.log("");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  VoiceStorage Item Research — Web Search + AI Synthesis");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  SerpAPI:     ${process.env.SERPAPI_KEY ? "✓ configured" : "✗ NOT SET"}`);
  console.log(`  OpenRouter:  ${isResearchConfigured() ? "✓ configured" : "✗ NOT SET"}`);
  console.log(`  Database:    ${DATABASE_URL.replace(/:[^:@]+@/, ":***@")}`);
  console.log(`  Batch limit: ${BATCH_LIMIT}`);
  if (specificItemId) console.log(`  Item:        #${specificItemId}`);
  if (force) console.log(`  Mode:        FORCE (re-research all)`);
  if (dryRun) console.log(`  Mode:        DRY RUN (no changes)`);
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");

  if (!isResearchConfigured()) {
    console.error("[research] Missing configuration.");
    console.error("[research] Need: SERPAPI_KEY, OPENROUTER_API_KEY, OPENROUTER_CHAT_MODEL");
    console.error("");
  }

  const prisma = createPrisma();

  const where: Record<string, unknown> = { deleted_at: null };

  if (specificItemId) {
    where.id = specificItemId;
  } else if (!force) {
    where.ai_research_last_checked = null;
  }

  const items = await prisma.items.findMany({
    where: where as never,
    include: { categories: true },
    orderBy: { id: "asc" },
    take: BATCH_LIMIT,
  });

  if (items.length === 0) {
    console.log("[research] No items need research.");
    console.log("[research] Use --force to re-research all items.");
    await prisma.$disconnect();
    return;
  }

  console.log(`[research] Processing ${items.length} item(s)...\n`);

  let updated = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    console.log(`[${i + 1}/${items.length}] #${item.id}: ${item.title}`);

    if (dryRun || !isResearchConfigured()) {
      const input = {
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
      };
      const { buildResearchQuery } = await import("../lib/ai/item-research");
      const query = buildResearchQuery(input);
      console.log(`  Query: "${query}"`);
      console.log(`  ${dryRun ? "Dry run" : "Not configured"}: would research\n`);
      skipped++;
      continue;
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

    if (result.ok) {
      console.log(`  ✓ Summary: ${result.summary?.slice(0, 100) ?? "(empty)"}...`);
      if (result.price_low != null && result.price_high != null) {
        console.log(`  ✓ Price range: $${result.price_low.toFixed(2)} – $${result.price_high.toFixed(2)}`);
      }
      console.log(`  ✓ Sources: ${result.sources.length} web results`);

      await prisma.items.update({
        where: { id: item.id },
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
      updated++;
    } else {
      console.log(`  ✗ ${result.error}`);

      await prisma.items.update({
        where: { id: item.id },
        data: {
          ai_research_last_checked: new Date(),
          updated_at: new Date(),
        },
      });
      failed++;
    }

    console.log("");

    if (i < items.length - 1) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Item Research Complete");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Processed: ${items.length}`);
  console.log(`  Updated:   ${updated}`);
  console.log(`  Failed:    ${failed}`);
  console.log(`  Skipped:   ${skipped}`);
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[research] Fatal error:", err);
  process.exit(1);
});
