import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { execFileSync } from "child_process";
import { Pool } from "pg";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as Minio from "minio";
import { groupPhotos, type PhotoGroup } from "./group-photos";

// =============================================================================
// Photo Inbox Ingest Script — with Visual Similarity Grouping
// =============================================================================
//
// Pipeline:
//   1. Scan inbox, deduplicate by SHA-256 hash
//   2. Group visually similar photos using CLIP embeddings (group-photos.ts)
//      Multiple photos of the same item → 1 inventory entry with 1–2 images
//   3. For each group:
//      a. Upload selected photos to MinIO (HEIC→JPEG conversion)
//      b. Create 1 inventory item, attach 1–2 item_images
//      c. Store CLIP embedding from the grouping step
//      d. AI-label through OpenRouter (primary photo only)
//   4. Move ALL photos (selected + extras) to processed/
//
// Usage:
//   npm run ingest              # Full pipeline
//   npm run ingest:dry          # Preview (dry run)
// =============================================================================

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const HOME = process.env.HOME || "/Users/spm1";
const PHOTO_INBOX =
  process.env.PHOTO_INBOX || path.join(HOME, "Downloads", "PInventoryInbox");
const PROCESSED_DIR = path.join(PHOTO_INBOX, "processed");

const CLIP_SERVICE_URL =
  process.env.CLIP_SERVICE_URL || "http://localhost:8100";

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || "localhost";
const MINIO_PORT = parseInt(process.env.MINIO_PORT || "9000", 10);
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || "minioadmin";
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || "minioadmin123";
const MINIO_BUCKET = process.env.MINIO_BUCKET || "inventory";
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === "true";
// Public host for building image URLs (browsers access this)
// In Docker: MINIO_ENDPOINT=storage (internal), MINIO_PUBLIC_HOST=localhost (browser)
const MINIO_PUBLIC_HOST = process.env.MINIO_PUBLIC_HOST || MINIO_ENDPOINT;
const MINIO_PUBLIC_PORT = parseInt(process.env.MINIO_PUBLIC_PORT || String(MINIO_PORT), 10);

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://admin:secure_password@localhost:5432/inventory?schema=public";

const IMAGE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp",
  ".heic", ".heif", ".tiff", ".tif", ".bmp",
]);

const NEEDS_CONVERSION = new Set([".heic", ".heif", ".tiff", ".tif", ".bmp"]);

// Similarity threshold for grouping (env-configurable)
const GROUP_THRESHOLD = parseFloat(
  process.env.GROUP_THRESHOLD || "0.85"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function createPrisma(): PrismaClient {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

function createMinioClient(): Minio.Client {
  return new Minio.Client({
    endPoint: MINIO_ENDPOINT,
    port: MINIO_PORT,
    useSSL: MINIO_USE_SSL,
    accessKey: MINIO_ACCESS_KEY,
    secretKey: MINIO_SECRET_KEY,
  });
}

/** Compute SHA-256 hash of a file's contents. */
function hashFile(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Build a set of content hashes from the processed/ directory.
 */
function getProcessedHashes(): Set<string> {
  const hashes = new Set<string>();
  if (!fs.existsSync(PROCESSED_DIR)) return hashes;
  const files = fs.readdirSync(PROCESSED_DIR);
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext) || f.startsWith(".")) continue;
    hashes.add(hashFile(path.join(PROCESSED_DIR, f)));
  }
  return hashes;
}

/** Scan inbox for image files. */
function scanInbox(): string[] {
  if (!fs.existsSync(PHOTO_INBOX)) {
    console.error(`[Ingest] photo-inbox directory not found: ${PHOTO_INBOX}`);
    process.exit(1);
  }
  return fs
    .readdirSync(PHOTO_INBOX)
    .filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return IMAGE_EXTENSIONS.has(ext) && !f.startsWith(".");
    })
    .map((f) => path.join(PHOTO_INBOX, f))
    .sort();
}

/** Deduplicate by SHA-256 hash. */
function deduplicatePhotos(photos: string[]): {
  unique: string[];
  duplicates: { file: string; reason: string }[];
} {
  const processedHashes = getProcessedHashes();
  const batchHashes = new Map<string, string>();
  const unique: string[] = [];
  const duplicates: { file: string; reason: string }[] = [];

  for (const filePath of photos) {
    const filename = path.basename(filePath);
    const hash = hashFile(filePath);
    if (processedHashes.has(hash)) {
      duplicates.push({ file: filename, reason: "already processed" });
    } else if (batchHashes.has(hash)) {
      duplicates.push({ file: filename, reason: `same as ${batchHashes.get(hash)}` });
    } else {
      batchHashes.set(hash, filename);
      unique.push(filePath);
    }
  }
  return { unique, duplicates };
}

function generateObjectKey(filename: string): string {
  const hash = crypto.randomBytes(8).toString("hex");
  const date = new Date().toISOString().slice(0, 10);
  // Always store as .jpg since we convert HEIC→JPEG
  return `photos/${date}/${hash}.jpg`;
}

function getMinioUrl(objectKey: string): string {
  const protocol = MINIO_USE_SSL ? "https" : "http";
  return `${protocol}://${MINIO_PUBLIC_HOST}:${MINIO_PUBLIC_PORT}/${MINIO_BUCKET}/${objectKey}`;
}

function filenameToTitle(filename: string): string {
  const base = path.basename(filename, path.extname(filename));
  const cleaned = base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return `Photo Inbox: ${cleaned}`;
}

/** Convert HEIC/HEIF → JPEG using macOS sips. */
function convertToJpegIfNeeded(filePath: string): {
  jpegPath: string;
  needsCleanup: boolean;
} {
  const ext = path.extname(filePath).toLowerCase();
  if (!NEEDS_CONVERSION.has(ext)) {
    return { jpegPath: filePath, needsCleanup: false };
  }
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `ingest_${crypto.randomBytes(6).toString("hex")}.jpg`);
  try {
    // Try macOS sips first, then Linux heif-convert (Docker/Alpine)
    // Use execFileSync to prevent shell injection via filenames
    try {
      execFileSync("sips", ["-s", "format", "jpeg", filePath, "--out", tmpFile], { stdio: "pipe" });
    } catch {
      execFileSync("heif-convert", [filePath, tmpFile, "-q", "50"], { stdio: "pipe" });
    }
    return { jpegPath: tmpFile, needsCleanup: true };
  } catch {
    return { jpegPath: filePath, needsCleanup: false };
  }
}

// ---------------------------------------------------------------------------
// MinIO
// ---------------------------------------------------------------------------
async function ensureBucket(minio: Minio.Client): Promise<void> {
  const exists = await minio.bucketExists(MINIO_BUCKET);
  if (!exists) {
    await minio.makeBucket(MINIO_BUCKET);
    console.log(`[Ingest] Created MinIO bucket: ${MINIO_BUCKET}`);
    const policy = {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: ["*"] },
          Action: ["s3:GetObject"],
          Resource: [`arn:aws:s3:::${MINIO_BUCKET}/*`],
        },
      ],
    };
    await minio.setBucketPolicy(MINIO_BUCKET, JSON.stringify(policy));
  }
}

async function uploadToMinio(
  minio: Minio.Client,
  filePath: string
): Promise<{ url: string; objectKey: string }> {
  // Convert to JPEG for browser compatibility
  const ext = path.extname(filePath).toLowerCase();
  let uploadPath = filePath;
  let uploadCleanup = false;
  if (NEEDS_CONVERSION.has(ext)) {
    const conv = convertToJpegIfNeeded(filePath);
    uploadPath = conv.jpegPath;
    uploadCleanup = conv.needsCleanup;
  }

  const objectKey = generateObjectKey(path.basename(filePath));
  const fileStream = fs.createReadStream(uploadPath);
  const stat = fs.statSync(uploadPath);

  await minio.putObject(MINIO_BUCKET, objectKey, fileStream, stat.size, {
    "Content-Type": "image/jpeg",
  });

  if (uploadCleanup && fs.existsSync(uploadPath)) {
    fs.unlinkSync(uploadPath);
  }

  return { url: getMinioUrl(objectKey), objectKey };
}

// ---------------------------------------------------------------------------
// CLIP embedding (used when grouper already provided one)
// ---------------------------------------------------------------------------
async function getClipEmbedding(filePath: string): Promise<number[] | null> {
  const { jpegPath, needsCleanup } = convertToJpegIfNeeded(filePath);
  try {
    const fileBuffer = fs.readFileSync(jpegPath);
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: "image/jpeg" });
    formData.append("file", blob, path.basename(jpegPath));

    const resp = await fetch(`${CLIP_SERVICE_URL}/embed-image`, {
      method: "POST",
      body: formData,
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const embedding: number[] = data.embedding;
    if (!Array.isArray(embedding) || embedding.length !== 512) return null;
    return embedding;
  } catch {
    return null;
  } finally {
    if (needsCleanup && fs.existsSync(jpegPath)) fs.unlinkSync(jpegPath);
  }
}

async function saveEmbedding(
  prisma: PrismaClient,
  imageId: number,
  embedding: number[]
): Promise<void> {
  const vectorStr = `[${embedding.join(",")}]`;
  await prisma.$executeRawUnsafe(
    `UPDATE item_images SET embedding = $1::vector WHERE id = $2`,
    vectorStr,
    imageId
  );
}

// ---------------------------------------------------------------------------
// AI Labeling — OpenRouter multimodal API
// ---------------------------------------------------------------------------
import type { AiLabel } from "../lib/sanitize";
import {
  analyzeInventoryImage,
  isOpenRouterConfigured,
} from "../lib/ai/openrouter";

async function analyzeWithOpenRouter(filePath: string): Promise<AiLabel | null> {
  const { jpegPath, needsCleanup } = convertToJpegIfNeeded(filePath);
  try {
    const imageBuffer = fs.readFileSync(jpegPath);
    const result = await analyzeInventoryImage(imageBuffer);
    return result.label;
  } catch (error) {
    console.warn(
      `    OpenRouter analysis failed: ${
        error instanceof Error ? error.message : error
      }`
    );
    return null;
  } finally {
    if (needsCleanup && fs.existsSync(jpegPath)) fs.unlinkSync(jpegPath);
  }
}

async function saveAiLabels(
  prisma: PrismaClient,
  itemId: number,
  imageId: number,
  label: AiLabel
): Promise<void> {
  await prisma.item_images.update({
    where: { id: imageId },
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

  const aiTitle = label.object_type
    ? `${label.object_type.charAt(0).toUpperCase() + label.object_type.slice(1)}${
        label.detected_text ? ` — ${label.detected_text.slice(0, 60)}` : ""
      }`
    : null;

  await prisma.items.update({
    where: { id: itemId },
    data: {
      ...(aiTitle ? { title: aiTitle } : {}),
      description: label.short_description,
      search_text: [
        label.main_color,
        label.object_type,
        label.detected_text,
        label.short_description,
      ]
        .filter(Boolean)
        .join(" "),
      updated_at: new Date(),
    },
  });
}

// ---------------------------------------------------------------------------
// File movement
// ---------------------------------------------------------------------------
function moveToProcessed(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const filename = path.basename(filePath);
  let destPath = path.join(PROCESSED_DIR, filename);
  if (fs.existsSync(destPath)) {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    let counter = 1;
    while (fs.existsSync(destPath)) {
      destPath = path.join(PROCESSED_DIR, `${base}_${counter}${ext}`);
      counter++;
    }
  }
  fs.renameSync(filePath, destPath);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  console.log("");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  InvStorage Photo Inbox — Ingest & Vectorize (v2 — Grouped)");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Inbox:     ${PHOTO_INBOX}`);
  console.log(`  MinIO:     ${MINIO_ENDPOINT}:${MINIO_PORT}/${MINIO_BUCKET}`);
  console.log(`  CLIP:      ${CLIP_SERVICE_URL}`);
  console.log(
    `  Vision AI: OpenRouter (${
      process.env.OPENROUTER_VISION_MODEL || "not configured"
    })`
  );
  console.log(`  Threshold: ${GROUP_THRESHOLD} (cosine similarity for grouping)`);
  console.log(`  Database:  ${DATABASE_URL.replace(/:[^:@]+@/, ":***@")}`);
  if (dryRun) console.log(`  Mode:      DRY RUN (no changes)`);
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");

  // 1. Scan inbox
  const allPhotos = scanInbox();
  if (allPhotos.length === 0) {
    console.log("[Ingest] No photos found in inbox. Nothing to do.");
    console.log(`[Ingest] Drop images into: ${PHOTO_INBOX}`);
    return;
  }

  // 2. SHA-256 dedup
  console.log(`[Ingest] Scanning ${allPhotos.length} photo(s) for exact duplicates...`);
  const { unique: photos, duplicates } = deduplicatePhotos(allPhotos);

  if (duplicates.length > 0) {
    console.log(`[Ingest] Skipping ${duplicates.length} exact duplicate(s):`);
    for (const d of duplicates) console.log(`  SKIP ${d.file} (${d.reason})`);
    if (!dryRun) {
      if (!fs.existsSync(PROCESSED_DIR)) fs.mkdirSync(PROCESSED_DIR, { recursive: true });
      for (const d of duplicates) {
        const srcPath = path.join(PHOTO_INBOX, d.file);
        if (fs.existsSync(srcPath)) moveToProcessed(srcPath);
      }
    }
    console.log("");
  }

  if (photos.length === 0) {
    console.log("[Ingest] All photos were duplicates. Nothing new to process.");
    return;
  }

  console.log(`[Ingest] ${photos.length} unique photo(s) to process.\n`);

  // 3. Visual similarity grouping via CLIP
  console.log("─── Phase 1: Visual Similarity Grouping ──────────────────────");
  console.log("");
  const groupResult = await groupPhotos({
    threshold: GROUP_THRESHOLD,
    verbose: true,
  });

  if (dryRun) {
    console.log("[Ingest] Dry run complete. No changes made.");
    console.log(`[Ingest] Found ${groupResult.totalPhotos} photos → ${groupResult.totalGroups} groups`);
    return;
  }

  if (groupResult.groups.length === 0) {
    console.log("[Ingest] No groups to process.");
    return;
  }

  // 4. Initialize services
  const prisma = createPrisma();
  const minio = createMinioClient();

  const visionAvailable = isOpenRouterConfigured();
  if (visionAvailable) {
    console.log(
      `[Ingest] OpenRouter configured (model: ${process.env.OPENROUTER_VISION_MODEL}) — AI labeling enabled`
    );
  } else {
    console.warn(
      `[Ingest] OpenRouter not configured — set OPENROUTER_API_KEY and OPENROUTER_VISION_MODEL to enable AI labels\n`
    );
  }

  try {
    await ensureBucket(minio);
  } catch (error) {
    console.error(`[Ingest] Cannot connect to MinIO at ${MINIO_ENDPOINT}:${MINIO_PORT}`);
    console.error(`[Ingest] Start with: cd backend && docker compose up -d storage`);
    await prisma.$disconnect();
    process.exit(1);
  }

  if (!fs.existsSync(PROCESSED_DIR)) fs.mkdirSync(PROCESSED_DIR, { recursive: true });

  // 5. Process each group
  console.log("");
  console.log("─── Phase 2: Ingest Groups ───────────────────────────────────");
  console.log("");

  let itemsCreated = 0;
  let imagesUploaded = 0;
  let vectorized = 0;
  let labeled = 0;
  let failed = 0;

  for (let gi = 0; gi < groupResult.groups.length; gi++) {
    const group = groupResult.groups[gi];
    const primaryFile = group.selected[0];
    const primaryName = path.basename(primaryFile);
    const groupSize = group.all.length;

    console.log(
      `[${gi + 1}/${groupResult.groups.length}] Group: ${primaryName}` +
        (groupSize > 1 ? ` (+${groupSize - 1} similar)` : "")
    );

    try {
      // A. Upload selected photos to MinIO
      const uploadedImages: { url: string; objectKey: string; filePath: string }[] = [];
      for (const filePath of group.selected) {
        const fname = path.basename(filePath);
        console.log(`    Uploading ${fname} to MinIO...`);
        const result = await uploadToMinio(minio, filePath);
        uploadedImages.push({ ...result, filePath });
        console.log(`    Stored: ${result.objectKey}`);
        imagesUploaded++;
      }

      // B. Create 1 inventory item (using primary photo)
      const title = filenameToTitle(primaryName);
      const allNames = group.all.map((f) => path.basename(f));
      const notes = [
        `Original: ${primaryName}`,
        groupSize > 1 ? `Grouped ${groupSize} similar photos: ${allNames.join(", ")}` : null,
        `Ingested: ${new Date().toISOString()}`,
      ]
        .filter(Boolean)
        .join("\n");

      const item = await prisma.items.create({
        data: {
          title,
          description: `Ingested from photo inbox on ${new Date().toLocaleDateString()}`,
          image_url: uploadedImages[0].url,
          status: "available",
          notes,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
      console.log(`    Created item #${item.id}: "${title}" (${groupSize} photo group)`);
      itemsCreated++;

      // C. Create item_image records (1–2 per group)
      const imageRecords: { id: number; filePath: string; isPrimary: boolean }[] = [];
      for (let ii = 0; ii < uploadedImages.length; ii++) {
        const img = uploadedImages[ii];
        const isPrimary = ii === 0;
        const itemImage = await prisma.item_images.create({
          data: {
            item_id: item.id,
            image_url: img.url,
            alt_text: path.basename(img.filePath),
            is_primary: isPrimary,
            display_order: ii,
            ai_processed: false,
            created_at: new Date(),
          },
        });
        imageRecords.push({ id: itemImage.id, filePath: img.filePath, isPrimary });
      }

      // D. Save CLIP embeddings
      // The grouper already computed embeddings — use them if available
      if (group.embedding && imageRecords.length > 0) {
        // Primary image gets the group embedding
        await saveEmbedding(prisma, imageRecords[0].id, group.embedding);
        console.log(`    Embedding saved for primary image (from grouper)`);
        vectorized++;

        // Secondary image: get its own embedding
        if (imageRecords.length > 1) {
          console.log(`    Getting CLIP embedding for secondary image...`);
          const secEmbed = await getClipEmbedding(imageRecords[1].filePath);
          if (secEmbed) {
            await saveEmbedding(prisma, imageRecords[1].id, secEmbed);
            vectorized++;
          }
        }
      } else if (groupResult.clipAvailable) {
        // Grouper didn't provide embedding — get one now
        for (const rec of imageRecords) {
          const embed = await getClipEmbedding(rec.filePath);
          if (embed) {
            await saveEmbedding(prisma, rec.id, embed);
            vectorized++;
          }
        }
      }

      // E. AI label through OpenRouter (primary photo only — controls cost)
      if (visionAvailable) {
        console.log(`    Analyzing with OpenRouter...`);
        const aiLabel = await analyzeWithOpenRouter(primaryFile);
        if (aiLabel) {
          await saveAiLabels(prisma, item.id, imageRecords[0].id, aiLabel);
          labeled++;
          console.log(
            `    Label: ${aiLabel.object_type} | ${aiLabel.main_color} | confidence=${aiLabel.confidence_score?.toFixed(2)} | "${aiLabel.short_description?.slice(0, 70)}"`
          );
        } else {
          console.warn(`    AI labeling failed (will retry via nightly worker)`);
        }
      }

      // F. Move ALL photos in this group to processed/
      for (const filePath of group.all) {
        moveToProcessed(filePath);
      }
      console.log(
        `    Moved ${group.all.length} photo(s) to processed/` +
          (group.extras.length > 0
            ? ` (${group.extras.length} extra${group.extras.length > 1 ? "s" : ""} de-duped)`
            : "")
      );
    } catch (error) {
      console.error(`    FAILED: ${error instanceof Error ? error.message : error}`);
      failed++;
    }

    console.log("");
  }

  // 6. Summary
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Ingest Complete (v2 — Grouped)");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Photos scanned:   ${groupResult.totalPhotos}`);
  console.log(`  Groups formed:    ${groupResult.totalGroups}`);
  console.log(`  Items created:    ${itemsCreated}`);
  console.log(`  Images uploaded:  ${imagesUploaded}`);
  console.log(`  Vectorized:       ${vectorized}`);
  console.log(`  AI Labeled:       ${labeled}`);
  if (failed > 0) console.log(`  Failed:           ${failed}`);
  if (groupResult.totalPhotos > imagesUploaded) {
    console.log(
      `  De-duped extras:  ${groupResult.totalPhotos - imagesUploaded} (similar photos merged)`
    );
  }
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");

  await prisma.$disconnect();
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
main().catch((err) => {
  console.error("[Ingest] Fatal error:", err);
  process.exit(1);
});
