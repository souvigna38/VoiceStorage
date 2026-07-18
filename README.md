# InvStorage — Personal Inventory System (Portable Docker Edition)

A fully self-contained personal inventory management system packaged as a Docker deployment. (Previously referred to as InvTrack.) Track household items, electronics, server hardware, and more with AI-powered image analysis, semantic search, sales management, and workflow automation.

For day-to-day operation, see the **[InvTrack / InvStorage User Guide](docs/USER_GUIDE.md)**.

For the lean VoiceStorage prototype on one Intel MacBook using external AI, see
**[MacBook + OpenRouter Test Guide](docs/MACBOOK_OPENROUTER.md)**.

## Requirements

- **Docker Engine** with the **Compose V2 plugin** (`docker compose`, not only legacy `docker-compose`)
  - **macOS:** [Docker Desktop](https://www.docker.com/products/docker-desktop/)
  - **Ubuntu / Debian:** Install Docker from Docker’s official repo or `sudo apt install docker.io docker-compose-plugin`; enable `sudo systemctl enable --now docker` and add your user to the `docker` group
- **8 GB RAM** minimum for Docker hosts (**16 GB** recommended — CLIP, Ollama, and ERPNext are heavy)
- **~15 GB** free disk for images and volumes (more after ERPNext / models pull)

Verified portability: all app images are **Linux-based** (Alpine / Debian slim). HEIC conversion uses **`libheif`** in the frontend container, so Linux builds match macOS behavior for photo ingest.

### Migrating from InvTrack

- Rename environment variable `INVTRACK_API_KEY` to `INVSTORAGE_API_KEY` (and use cookie `invstorage_session` if you rely on cookie auth).
- Medusa admin login is now `admin@invstorage.local` (password unchanged: `invtrack123`). If your database still has the old email, update the user in Medusa admin or via SQL, or point compose back to the old email temporarily.
- ERPNext: new installs create site `invstorage.local`. If you **already** have a site named `invtrack.local`, keep `FRAPPE_SITE_NAME_HEADER` set to `invtrack.local` in `docker-compose.yml` (or rename the site in Frappe) so nginx routes correctly.
- n8n encryption key string is **unchanged** so existing stored credentials keep working.

## Quick Start

### Clone from GitHub

```bash
git clone https://github.com/souvigna38/invstorage.git
cd invstorage   # or: cd PersonalInventoryPortable if you copied the folder
```

### First-time setup (any OS)

```bash
cp .env.example .env    # optional: set OPENCLAW / keys before compose reads them

chmod +x scripts/setup.sh
./scripts/setup.sh
```

Wait until critical services are healthy (often **1–5 minutes**; ERPNext first boot can take longer):

```bash
docker compose ps
```

Open the app:

- **macOS:** `open http://localhost:3000`
- **Linux:** `xdg-open http://localhost:3000` or browse to `http://localhost:3000` (or use your server’s LAN IP from another machine)

## Web Interfaces

| Service | URL | Credentials |
|---------|-----|-------------|
| **Inventory App** | http://localhost:3000 | — |
| **MinIO Console** | http://localhost:9001 | `minioadmin` / `minioadmin123` |
| **Medusa Admin** | http://localhost:9500/app | `admin@invstorage.local` / `invtrack123` |
| **n8n Workflows** | http://localhost:5678 | Set on first visit |
| **ERPNext** | http://localhost:8090 | `Administrator` / `admin` |
| **NocoDB Data Lake** | http://localhost:8086 | Set on first visit |
| **Ingestion API** | http://localhost:8085/dashboard | — |
| **Database Browser** | http://localhost:8080 | `admin` / `secure_password` / `inventory` |

## Daily Usage

### Start / Stop Services

```bash
./scripts/start.sh    # Start all services
./scripts/stop.sh     # Stop all services (data preserved)
```

### Adding New Items

1. **Via the Web UI** — Click "Add Item" in the app at http://localhost:3000
2. **Via Photo Inbox** — Drop photos into the `photo-inbox/` folder, then click "Ingest" in the app. The AI will analyze the photos and create inventory items automatically.

### Backing Up Your Data

```bash
./scripts/backup.sh   # Creates a timestamped database backup in data/
```

This updates `data/inventory_dump.sql` so the portable package always contains your latest data.

### Searching Items

- **Text search** — Type in the search bar to find items by name, description, or serial number
- **Semantic search** — The CLIP AI service enables "search by meaning" (e.g., search "red electronics" to find red-colored devices)
- **Category/Status filters** — Use the sidebar filters to narrow results

## Architecture

The system runs 22 Docker containers:

| Container | Purpose |
|-----------|---------|
| `db` | PostgreSQL 15 + pgvector (main inventory database) |
| `redis` | Redis for job queues and sessions |
| `storage` | MinIO S3-compatible object storage (item images) |
| `clip-service` | CLIP AI model for text/image vector embeddings |
| `frontend` | Next.js web application |
| `ai-worker` | Background AI image processor (BullMQ) |
| `medusa` | Medusa.js sales/e-commerce backend |
| `n8n` | Workflow automation engine |
| `openclaw` | AI agent gateway ("Photo-to-Cash") |
| `datalake-db` | Central Data Lake (Postgres 16) |
| `ingestion-api` | dlt-powered JSON ingestion API |
| `nocodb` | Spreadsheet UI for the Data Lake |
| `erpnext-*` | ERPNext shadow ERP system (7 containers) |
| `db-ui` | Adminer database browser |

### Port Map

| Port | Service |
|------|---------|
| 3000 | Inventory App (Next.js) |
| 5432 | PostgreSQL |
| 5435 | DataLake PostgreSQL |
| 5678 | n8n |
| 6379 | Redis |
| 8080 | Adminer |
| 8085 | Ingestion API |
| 8086 | NocoDB |
| 8090 | ERPNext |
| 8100 | CLIP Service |
| 9000 | MinIO API |
| 9001 | MinIO Console |
| 9500 | Medusa |
| 18789 | OpenClaw |

## Ubuntu server notes

1. **Install Docker** (example — follow [Docker Engine docs](https://docs.docker.com/engine/install/ubuntu/) for current steps):

   ```bash
   sudo apt-get update
   sudo apt-get install -y ca-certificates curl
   # … add Docker’s apt repo per official docs, then:
   sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
   sudo systemctl enable --now docker
   sudo usermod -aG docker "$USER"   # log out and back in
   ```

2. **Firewall:** if `ufw` is enabled, allow the ports you need (at minimum **3000** for the web UI), or only expose via reverse proxy / Tailscale — see port table below.

3. **Remote access:** bind addresses in `docker-compose.yml` already use `127.0.0.1` for some DB/admin ports; the inventory app is published on **0.0.0.0:3000** by default so LAN access works on Ubuntu.

4. **ARM64:** Most images support `linux/arm64`; ERPNext Frappe images are multi-arch. If a service fails to pull on ARM, check logs with `docker compose logs <service>`.

## Transferring to another machine (Mac or Linux)

1. Clone or copy the project folder
2. Install Docker (Desktop on Mac; Engine + Compose on Linux)
3. On the **old** machine, refresh bundled SQL if you rely on the portable dump:

```bash
./scripts/backup.sh
```

4. On the **new** machine:

```bash
cd invstorage   # project root
./scripts/setup.sh
```

## Troubleshooting

### Docker daemon not reachable

```bash
docker info    # should succeed without sudo after joining group docker
```

- **Ubuntu:** `sudo systemctl start docker` · `sudo usermod -aG docker $USER` (then **log out and back in**)
- **macOS:** start Docker Desktop (`open -a Docker`), wait ~30s, retry

### A service won't start
```bash
docker compose logs <service-name>   # Check logs for errors
docker compose restart <service-name> # Restart just that service
```

### Reset everything (fresh start)
```bash
docker compose down -v    # WARNING: Destroys all data in Docker volumes
./scripts/setup.sh        # Re-initialize from the bundled database dump
```

### ERPNext takes a long time on first start
This is normal. ERPNext needs to create its database and install modules, which can take 3-10 minutes on first startup. Subsequent starts are much faster.

## Pre-loaded Data

This portable package comes with **31 inventory items** already loaded, including:
- Personal electronics (MacBook Pro, iPhone, iPad, Apple Watch, etc.)
- Server hardware (Dell PowerEdge, HP ProLiant, etc.)
- Network equipment (Cisco switches, Ubiquiti access points, etc.)
- Home items (KitchenAid mixer, Dyson vacuum, etc.)

All items have categories, locations, and activity logs pre-configured.
