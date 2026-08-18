FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv for fast package management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# Copy dependency files
COPY pyproject.toml .

# Install dependencies
RUN uv pip install --system -e ".[dev]"

# Copy application code
COPY . .

# Install the package
RUN uv pip install --system -e .

# Expose port
EXPOSE 8005

# ── Heap fragmentation ──
#
# glibc creates up to 8 × CPU-count malloc arenas, each reserving up to 64MB of
# heap. Freed memory returns to the arena's free list, not to the kernel, so a
# long-running threaded pandas workload ratchets its footprint up to its
# high-water mark and stays there — production showed a 140MB-at-import process
# holding 2.7GB of mappings after seven weeks, almost all of it swapped out.
# Capping arenas trades a little allocator contention for a far smaller,
# stabler resident set.
ENV MALLOC_ARENA_MAX=2

# Worker count. Left at 1 by default because each worker is a full copy of the
# process and this app carries pandas + yfinance (~500MB resident); on a 2GB
# host, raising this without also raising the memory will OOM. Bump WEB_CONCURRENCY
# once the box has headroom — it is the single biggest lever on how many slow
# requests can be in flight before everything queues behind them.
ENV WEB_CONCURRENCY=1

# Run migrations, ensure default strategies exist (idempotent), then start.
# Demo data (tickers/trades) is seeded separately via scripts/seed_data.py, not here.
CMD ["sh", "-c", "alembic upgrade head && python -m asistrader.db.seed_strategies && uvicorn asistrader.main:app --host 0.0.0.0 --port 8005 --workers ${WEB_CONCURRENCY}"]
