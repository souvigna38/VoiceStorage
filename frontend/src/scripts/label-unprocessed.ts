import "dotenv/config";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { execFileSync } from "child_process";
import { Pool } from "pg";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// =============================================================================
// Label Unprocessed — Backfill AI labels for existing item_images
// =============================================================================
// Finds all item_images with ai_processed = false and runs them through
// OpenRouter for content identification. Also generates CLIP embeddings
// for any images missing them.
//
// Usage:  npm run label
// =============================================================================

const CLIP_SERVICE_URL = process.env.CLIP_SERVICE_URL || "http://localhost:8100";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://admin:secure_password@localhost:5432/inventory?schema=public";

function createPrisma(): PrismaClient {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

import type { AiLabel } from "../lib/sanitize";
import {
  analyzeInventoryImage,
  isOpenRouterConfigured,
} from "../lib/ai/openrouter";

async function checkClipHealth(): Promise<boolean> {
  try {
    const resp = await fetch(`${CLIP_SERVICE_URL}/health`);
    return resp.ok;
  } catch {
    return false;
  }
}

/** Rewrite public MinIO URLs to use the internal Docker hostname. */
function internalizeUrl(imageUrl: string): string {
  const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || "storage";
  const MINIO_PORT = process.env.MINIO_PORT || "9000";
  // Replace localhost:9000 or any public host with internal Docker service name
  return imageUrl.replace(/https?:\/\/[^/]+:9000\//, `http://${MINIO_ENDPOINT}:${MINIO_PORT}/`);
}

/** Fetch image from URL and convert HEIC→JPEG if needed. */
async function fetchImageBuffer(imageUrl: string): Promise<Buffer> {
  const url = internalizeUrl(imageUrl);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status}`);
  const buffer = Buffer.from(await resp.arrayBuffer());

  // Detect HEIC magic bytes: offset 4–8 = "ftyp" for HEIC/HEIF containers
  const isHeic =
    buffer.length > 12 &&
    buffer.slice(4, 8).toString("ascii") === "ftyp" &&
    ["heic", "heix", "hevc", "mif1"].includes(buffer.slice(8, 12).toString("ascii"));

  let jpegBuf: Buffer;
  if (isHeic) {
    console.log(`    [HEIC detected — converting to JPEG]`);
    const tmpHeic = path.join(os.tmpdir(), `label_${crypto.randomBytes(4).toString("hex")}.heic`);
    const tmpJpeg = tmpHeic.replace(/\.heic$/, ".jpg");
    try {
      fs.writeFileSync(tmpHeic, buffer);
      // Use execFileSync to prevent shell injection via filenames
      execFileSync("heif-convert", [tmpHeic, tmpJpeg, "-q", "50"], { stdio: "pipe" });
      jpegBuf = fs.readFileSync(tmpJpeg);
    } finally {
      try { fs.unlinkSync(tmpHeic); } catch {}
      try { fs.unlinkSync(tmpJpeg); } catch {}
    }
  } else {
    jpegBuf = buffer;
  }

  return jpegBuf;
}

/** Analyze an image URL through OpenRouter. */
async function analyzeWithOpenRouter(imageUrl: string): Promise<AiLabel | null> {
  try {
    const image = await fetchImageBuffer(imageUrl);
    const result = await analyzeInventoryImage(image);
    return result.label;
  } catch (error) {
    console.warn(`    Error: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/** Generate CLIP embedding from image URL. */
async function getClipEmbedding(imageUrl: string): Promise<number[] | null> {
  try {
    const url = internalizeUrl(imageUrl);
    const resp = await fetch(`${CLIP_SERVICE_URL}/embed-image-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: url }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.embedding as number[];
  } catch {
    return null;
  }
}

async function main() {
  console.log("");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  InvStorage — Label Unprocessed Images");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(
    `  Vision AI: OpenRouter (${process.env.OPENROUTER_VISION_MODEL || "not configured"})`
  );
  console.log(`  CLIP:     ${CLIP_SERVICE_URL}`);
  console.log(`  Database: ${DATABASE_URL.replace(/:[^:@]+@/, ":***@")}`);
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");

  if (!isOpenRouterConfigured()) {
    console.error(
      "[Label] Set OPENROUTER_API_KEY and OPENROUTER_VISION_MODEL before labeling."
    );
    process.exit(1);
  }
  console.log(
    `[Label] OpenRouter configured (${process.env.OPENROUTER_VISION_MODEL})`
  );

  const clipOk = await checkClipHealth();
  if (clipOk) console.log(`[Label] CLIP service ready`);

  const prisma = createPrisma();

  // Find unlabeled images
  const unlabeled = await prisma.item_images.findMany({
    where: { ai_processed: false },
    include: { items: { select: { id: true, title: true } } },
    orderBy: { id: "asc" },
  });

  if (unlabeled.length === 0) {
    console.log("[Label] All images are already labeled. Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  console.log(`[Label] Found ${unlabeled.length} unlabeled image(s)\n`);

  let labeled = 0;
  let vectorized = 0;

  for (let i = 0; i < unlabeled.length; i++) {
    const img = unlabeled[i];
    const itemTitle = img.items?.title || "Unknown";
    console.log(`[${i + 1}/${unlabeled.length}] "${itemTitle}" (image #${img.id})`);
    console.log(`    URL: ${img.image_url.slice(0, 80)}`);

    // Skip if human-corrected (ai_corrected flag set via UI)
    const correctedRows: { ai_corrected: boolean }[] = await prisma.$queryRawUnsafe(
      `SELECT ai_corrected FROM item_images WHERE id = $1`,
      img.id
    );
    if (correctedRows.length > 0 && correctedRows[0].ai_corrected) {
      console.log(`    Skipping — human-corrected (ai_corrected = true)`);
      continue;
    }

    // AI Label
    console.log(`    Analyzing with OpenRouter...`);
    const label = await analyzeWithOpenRouter(img.image_url);
    if (label) {
      // Update item_image
      await prisma.item_images.update({
        where: { id: img.id },
        data: {
          ai_processed: true,
          ai_description: label.short_description,
          ai_main_color: label.main_color,
          ai_object_type: label.object_type,
          ai_detected_text: label.detected_text,
          ai_tags: [label.main_color, label.object_type].filter(Boolean),
          ai_processed_at: new Date(),
        },
      });

      // Update parent item
      if (img.items) {
        const aiTitle = label.object_type
          ? `${label.object_type.charAt(0).toUpperCase() + label.object_type.slice(1)}${label.detected_text ? ` — ${label.detected_text.slice(0, 60)}` : ""}`
          : itemTitle;

        await prisma.items.update({
          where: { id: img.items.id },
          data: {
            title: aiTitle,
            description: label.short_description,
            search_text: [label.main_color, label.object_type, label.detected_text, label.short_description].filter(Boolean).join(" "),
            updated_at: new Date(),
          },
        });
      }

      labeled++;
      console.log(
        `    Label: ${label.object_type} | ${label.main_color} | confidence=${label.confidence_score?.toFixed(2)}`
      );
      console.log(`    Desc:  "${label.short_description?.slice(0, 80)}"`);
    } else {
      console.warn(`    OpenRouter analysis failed`);
    }

    // CLIP embedding backfill (check via raw SQL since Prisma doesn't expose the column)
    if (clipOk) {
      const rows: { has_emb: boolean }[] = await prisma.$queryRawUnsafe(
        `SELECT (embedding IS NOT NULL) as has_emb FROM item_images WHERE id = $1`,
        img.id
      );
      if (rows.length > 0 && !rows[0].has_emb) {
        console.log(`    Generating CLIP embedding...`);
        const embedding = await getClipEmbedding(img.image_url);
        if (embedding) {
          const vectorStr = `[${embedding.join(",")}]`;
          await prisma.$executeRawUnsafe(
            `UPDATE item_images SET embedding = $1::vector WHERE id = $2`,
            vectorStr,
            img.id
          );
          vectorized++;
          console.log(`    Embedding saved (512-dim)`);
        }
      }
    }

    console.log("");
  }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Labeling Complete");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Labeled:    ${labeled}/${unlabeled.length}`);
  console.log(`  Vectorized: ${vectorized} (backfilled)`);
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[Label] Fatal error:", err);
  process.exit(1);
});
