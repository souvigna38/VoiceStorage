# VoiceStorage MacBook + OpenRouter Test Guide

This profile tests VoiceStorage on one Intel MacBook without downloading or
running a local vision LLM. Inventory data stays in local Docker volumes.
Selected, resized inventory photographs are sent to OpenRouter for analysis.

## Services included

- Next.js inventory application
- PostgreSQL + pgvector
- Redis and the BullMQ AI worker
- MinIO image storage
- CLIP semantic search service
- Vault snapshot database and daily snapshot job

The profile intentionally leaves out Ollama, Medusa, n8n, OpenClaw, ERPNext,
NocoDB, and the data-lake services. They remain available in the original
`docker-compose.yml`.

## Configure OpenRouter

1. Create an API key in your OpenRouter account.
2. Copy the template:

   ```bash
   cp .env.macbook.example .env.macbook
   ```

3. Edit `.env.macbook` and set:

   ```dotenv
   OPENROUTER_API_KEY=your-private-key
   OPENROUTER_VISION_MODEL=google/gemini-2.5-flash
   ```

4. Replace every `change-*` password in the file.

The key is injected only into the frontend server and background worker. It is
not exposed through a `NEXT_PUBLIC_` variable. Never commit `.env.macbook`.

The model is configurable because OpenRouter model availability and pricing can
change. Choose a current vision-capable model if the example model is no longer
available.

## Start the test stack

From the VoiceStorage project root:

```bash
mkdir -p photo-inbox/processed
./scripts/start-macbook.sh
```

The first CLIP build downloads model files and can take several minutes. The
main application does not wait for CLIP to finish warming.

Open:

- VoiceStorage: <http://localhost:3100>
- MinIO console: <http://localhost:9101>

Check status and logs:

```bash
docker compose --env-file .env.macbook -f docker-compose.macbook.yml ps
docker compose --env-file .env.macbook -f docker-compose.macbook.yml logs -f frontend ai-worker
```

## Test photo ingestion

1. Put one test image in `photo-inbox/`.
2. Open <http://localhost:3100>.
3. Select **Ingest**.
4. Review the new item and correct any inaccurate AI fields.
5. Check logs for the OpenRouter model, token count, and reported cost:

   ```bash
   docker compose --env-file .env.macbook -f docker-compose.macbook.yml logs frontend ai-worker
   ```

The application resizes and converts images to WebP before sending base64 image
data to OpenRouter. Original files remain local.

## Privacy and cost controls

- Inventory images and visible labels may contain personal information or
  serial numbers. OpenRouter processing is external cloud processing.
- Begin with non-sensitive test photographs.
- Set account-level spending limits in OpenRouter.
- The ingest path analyzes only the primary image in a grouped set.
- Every response is validated before storage. Invalid responses fail rather
  than writing placeholder AI fields.

## Stop or reset

Stop while retaining data:

```bash
./scripts/stop-macbook.sh
```

Delete the test environment and all its Docker volumes:

```bash
docker compose --env-file .env.macbook -f docker-compose.macbook.yml down -v
```

The `-v` command is destructive. Create a backup first if the test data matters.

