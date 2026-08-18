"""The worker threadpool must stay within the connection pool's ceiling.

Every route is a sync `def`, so in-flight requests occupy worker threads. If
more threads can run than there are DB connections, the surplus blocks on the
connection pool — which is exactly how a burst of slow requests produced
"QueuePool limit of size 5 overflow 10 reached" on /me and /login in
production.
"""

import asyncio
import importlib

import anyio.to_thread
import pytest
from fastapi.testclient import TestClient

from asistrader import main
from asistrader.db.database import MAX_OVERFLOW, POOL_SIZE


def test_threadpool_stays_under_the_connection_ceiling() -> None:
    """The invariant that keeps queueing in one predictable place."""
    assert main.THREADPOOL_SIZE < POOL_SIZE + MAX_OVERFLOW


def test_threadpool_is_not_left_at_the_anyio_default() -> None:
    """40 is anyio's default and is what we are deliberately moving away from."""
    assert main.THREADPOOL_SIZE != 40
    assert main.THREADPOOL_SIZE >= 8, "too small to serve concurrent requests"


def test_lifespan_applies_the_limit() -> None:
    """Setting the module constant is useless unless the limiter picks it up.

    The limiter is per-event-loop, so this is read from inside a running loop
    rather than at module scope.
    """

    async def observe() -> float:
        async with main.lifespan(main.app):
            return anyio.to_thread.current_default_thread_limiter().total_tokens

    assert asyncio.run(observe()) == float(main.THREADPOOL_SIZE)


def test_app_actually_runs_that_lifespan() -> None:
    """Guards the wiring: the hook above is only useful if the app starts it.

    An async route reads the limiter on the event loop, which is where the
    per-loop value actually lives.
    """
    observed: list[float] = []

    async def probe() -> dict[str, float]:
        observed.append(anyio.to_thread.current_default_thread_limiter().total_tokens)
        return {"tokens": observed[-1]}

    main.app.add_api_route("/__threadpool_probe", probe, methods=["GET"])
    try:
        with TestClient(main.app) as running:
            assert running.get("/__threadpool_probe").status_code == 200
    finally:
        main.app.router.routes = [
            r for r in main.app.router.routes
            if getattr(r, "path", None) != "/__threadpool_probe"
        ]

    assert observed == [float(main.THREADPOOL_SIZE)], (
        "the app started without applying the threadpool limit"
    )


@pytest.mark.parametrize(
    "raw,expected_valid",
    [("12", 12), ("", None), ("not-a-number", None)],
)
def test_size_is_env_overridable_and_tolerates_junk(
    monkeypatch: pytest.MonkeyPatch, raw: str, expected_valid: int | None
) -> None:
    """A malformed env var must fall back, not crash the app at import."""
    monkeypatch.setenv("WEB_THREADPOOL_SIZE", raw)
    reloaded = importlib.reload(main)
    try:
        if expected_valid is not None:
            assert reloaded.THREADPOOL_SIZE == expected_valid
        else:
            assert reloaded.THREADPOOL_SIZE >= 8
    finally:
        monkeypatch.delenv("WEB_THREADPOOL_SIZE", raising=False)
        importlib.reload(main)
