"""FastAPI application entry point."""

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import anyio.to_thread
from brotli_asgi import BrotliMiddleware
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from asistrader.api.auth import router as auth_router
from asistrader.api.benchmarks import router as benchmarks_router
from asistrader.api.fund import router as fund_router
from asistrader.api.fx import router as fx_router
from asistrader.api.irr import router as irr_router
from asistrader.api.market_data import router as market_data_router
from asistrader.api.radar_presets import router as radar_presets_router
from asistrader.api.strategies import router as strategies_router
from asistrader.api.tickers import router as tickers_router
from asistrader.api.trades import router as trades_router
from asistrader.db.database import MAX_OVERFLOW, POOL_SIZE

# ── Worker threadpool ──
#
# Every route here is a sync `def`, so each in-flight request occupies one
# thread from anyio's default pool. That pool defaults to 40, which is wrong
# for this app in two ways.
#
# First, it doesn't agree with the connection pool: 40 threads can each want a
# DB connection, but only POOL_SIZE + MAX_OVERFLOW exist. The excess piles up
# waiting on the pool — which is how a burst of slow requests turned into
# "QueuePool limit ... reached" on endpoints as ordinary as /me and /login.
# Keeping the thread limit below the connection limit means a request that
# holds a thread can always get a connection, so queueing happens at one known
# place instead of deadlocking on the scarcer resource.
#
# Second, threads multiply glibc's per-arena heap fragmentation (see
# MALLOC_ARENA_MAX in the Dockerfile) — fewer threads, less retained memory.
def _threadpool_size() -> int:
    try:
        return int(os.environ["WEB_THREADPOOL_SIZE"])
    except (KeyError, ValueError):
        # Comfortably under the connection ceiling, well above core count —
        # these threads are waiting on I/O, not computing.
        return max(8, POOL_SIZE + MAX_OVERFLOW - 6)


THREADPOOL_SIZE = _threadpool_size()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Size the worker threadpool. The limiter is per-event-loop, so this has
    to run inside the running loop rather than at import time."""
    anyio.to_thread.current_default_thread_limiter().total_tokens = THREADPOOL_SIZE
    yield


app = FastAPI(
    title="AsisTrader API",
    description="Trading operations management system API",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS configuration for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Compress responses (JSON compresses ~80-90%); skip tiny payloads not worth the CPU.
# Brotli beats gzip on JSON; gzip_fallback keeps clients that don't accept brotli working.
app.add_middleware(BrotliMiddleware, minimum_size=1000, gzip_fallback=True)

app.include_router(auth_router)
app.include_router(fund_router)
app.include_router(trades_router)
app.include_router(tickers_router)
app.include_router(strategies_router)
app.include_router(market_data_router)
app.include_router(benchmarks_router)
app.include_router(fx_router)
app.include_router(irr_router)
app.include_router(radar_presets_router)


@app.get("/health")
def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "healthy"}
