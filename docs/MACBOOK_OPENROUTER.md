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
   OPENROUTER_CHAT_MODEL=google/gemini-2.5-flash
   ```

4. Replace every `change-*` password in the file.

The key is injected only into the frontend server and background worker. It is
not exposed through a `NEXT_PUBLIC_` variable. Never commit `.env.macbook`.

Both models are configurable because OpenRouter availability and pricing can
change. The **vision** model labels photos; the **chat** model powers
conversational voice search and must support tool calling. Leave
`OPENROUTER_CHAT_MODEL` blank to disable the conversational layer — voice search
then falls back to plain hybrid (text + CLIP) search.

## Conversational voice search

The voice button records audio, transcribes it with Whisper, then sends the
transcript to the OpenRouter **chat** model. The model can only call a fixed set
of **read-only** inventory tools — it never receives database credentials and
never writes SQL:

| Tool | Purpose |
|---|---|
| `search_inventory` | Hybrid text + semantic item search |
| `get_item` | Full details for one item id |
| `locate_item` | Best-match item and its location |
| `list_items_at_location` | Items stored at a named location |
| `list_locations` | All known location names |
| `inventory_summary` | Counts by status and location |
| `recent_item_activity` | Recent transfers / check-ins / check-outs |

The model returns a short spoken-style answer that the browser reads aloud with
on-device speech synthesis, plus item cards below it. If OpenRouter is
unconfigured or errors, the app falls back to plain hybrid search automatically.

Try asking:

- "Where is my badminton gear?"
- "How many laptops do I have?"
- "What's in the garage?"
- "What did I move recently?"

### Optional session auth

Set `INVSTORAGE_API_KEY` to require a session for the conversational and voice
server actions. When set, the browser must present the value as the
`invstorage_session` cookie. Leave it blank for local/dev use (auth bypassed,
matching the existing API-route behavior).

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

