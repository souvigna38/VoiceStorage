import "dotenv/config";
import { Worker, Job } from "bullmq";
import { createRedisConnection } from "../lib/redis";
import { processUnscannedImages } from "./processor";
import { scheduleNightlyScan } from "./scheduler";

// =============================================================================
// AI Vision Worker — BullMQ Consumer
// =============================================================================
// This is a standalone Node.js process (NOT part of Next.js).
// It listens for jobs on the "nightly-ai-scan" queue and processes images
// through the configured external vision provider.
//
// Run:  npm run worker
// =============================================================================

const QUEUE_NAME = "nightly-ai-scan";

async function main() {
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  InvStorage AI Worker — BullMQ Consumer");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Queue:    ${QUEUE_NAME}`);
  console.log(`  Redis:    ${process.env.REDIS_URL || "redis://localhost:6379"}`);
  console.log(
    `  Vision:   OpenRouter (${process.env.OPENROUTER_VISION_MODEL || "not configured"})`
  );
  console.log(`  Database: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":***@") || "not set"}`);
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");

  // Schedule the nightly cron job (idempotent — won't duplicate)
  await scheduleNightlyScan();

  // Create the worker
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      const startTime = Date.now();
      console.log(`\n[Worker] ▶ Processing job: ${job.name} (ID: ${job.id})`);

      try {
        const result = await processUnscannedImages(job);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[Worker] ✅ Job complete in ${elapsed}s — ${result.processed} images processed, ${result.failed} failed`);
        return result;
      } catch (error) {
        console.error(`[Worker] ❌ Job failed:`, error);
        throw error;
      }
    },
    {
      connection: createRedisConnection(),
      concurrency: 1,          // Process one job at a time (AI is heavy)
      limiter: {
        max: 1,
        duration: 1000,        // Max 1 job per second
      },
    }
  );

  // Event handlers
  worker.on("completed", (job) => {
    console.log(`[Worker] ✔ Job ${job.id} (${job.name}) completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[Worker] ✗ Job ${job?.id} (${job?.name}) failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("[Worker] Error:", err.message);
  });

  worker.on("ready", () => {
    console.log("[Worker] 🟢 Ready and listening for jobs...");
    console.log("[Worker]    Nightly scan scheduled for 3:00 AM");
    console.log("[Worker]    Waiting for jobs...\n");
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[Worker] Received ${signal}, shutting down gracefully...`);
    await worker.close();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[Worker] Fatal error:", err);
  process.exit(1);
});
