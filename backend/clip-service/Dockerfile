# =============================================================================
# CLIP + Whisper AI Service — Multimodal Vector Search + Voice Transcription
# =============================================================================
# Loads clip-ViT-B-32 and whisper-base on startup. Exposes:
#   POST /embed-text      → text  → 512-dim vector
#   POST /embed-image     → image → 512-dim vector
#   POST /embed-image-url → URL   → 512-dim vector
#   POST /transcribe      → audio → { text: "..." }
#   GET  /health          → service readiness probe
# =============================================================================

FROM python:3.10-slim

# Prevent Python from writing .pyc files and enable unbuffered logging
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Install system deps: curl (healthcheck), ffmpeg (Whisper audio processing)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Step 1: Upgrade pip & build tools ──────────────────────────────────────
# Pin setuptools<72 because openai-whisper uses pkg_resources (removed in 72+)
RUN pip install --no-cache-dir --upgrade pip "setuptools<72" wheel

# Install CPU-only PyTorch explicitly. The default Linux wheel pulls several
# gigabytes of NVIDIA CUDA libraries that cannot be used by Docker on a Mac.
RUN pip install --no-cache-dir \
    "torch==2.5.1+cpu" \
    --index-url https://download.pytorch.org/whl/cpu

# ── Step 2: Install Whisper with --no-build-isolation ─────────────────────
# This forces pip to use the setuptools we just installed (with pkg_resources)
# instead of creating an isolated venv that pulls the latest setuptools.
RUN pip install --no-cache-dir --no-build-isolation openai-whisper==20240930

# ── Step 3: Install remaining Python deps from requirements.txt ───────────
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY main.py .

# Pre-download CLIP model at build time so first boot is fast
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('clip-ViT-B-32')"

# Pre-download Whisper base model at build time (~140MB)
RUN python -c "import whisper; whisper.load_model('base')"

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
