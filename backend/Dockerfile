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

# Worker count. Left at 1 by default because each worker is a full copy of the
# process and this app carries pandas + yfinance (~500MB resident); on a 2GB
# host, raising this without also raising the memory will OOM. Bump WEB_CONCURRENCY
# once the box has headroom — it is the single biggest lever on how many slow
# requests can be in flight before everything queues behind them.
ENV WEB_CONCURRENCY=1

# Run migrations, ensure default strategies exist (idempotent), then start.
# Demo data (tickers/trades) is seeded separately via scripts/seed_data.py, not here.
CMD ["sh", "-c", "alembic upgrade head && python -m asistrader.db.seed_strategies && uvicorn asistrader.main:app --host 0.0.0.0 --port 8005 --workers ${WEB_CONCURRENCY}"]
