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

# Run migrations and start the application
CMD ["sh", "-c", "alembic upgrade head && uvicorn asistrader.main:app --host 0.0.0.0 --port 8005"]
