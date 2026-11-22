"""Process memory observability."""

import logging
import os

from starlette.types import ASGIApp, Receive, Scope, Send

logger = logging.getLogger(__name__)

# ── Which requests raise the high-water mark ──
#
# The backend's footprint ratchets: Python and glibc keep freed memory around
# for reuse instead of handing it back to the kernel, so the process settles at
# the high-water mark of its heaviest request and never comes back down. The
# droplet showed ~500MB resident plus ~335MB swapped after 16 days, against a
# ~145MB floor at import. To fix the right code paths we first need to know
# which requests push that mark up, so MemoryLogMiddleware logs any request
# whose memory grew by more than MEMORY_LOG_THRESHOLD_MB (default 20).
#
# Growth is measured as resident + swapped, so a request isn't credited with
# "freeing" memory the kernel merely paged out. With concurrent requests the
# delta of one can include another's allocations — treat a single line as a
# hint and a path that keeps showing up as the signal.

STATUS_PATH = "/proc/self/status"


def _threshold_kb() -> int:
    try:
        return int(os.environ["MEMORY_LOG_THRESHOLD_MB"]) * 1024
    except (KeyError, ValueError):
        return 20 * 1024


def read_memory_kb(path: str = STATUS_PATH) -> tuple[int, int] | None:
    """Return (resident_kb, swapped_kb) for this process, or None off Linux."""
    try:
        with open(path) as f:
            fields = dict(line.split(":", 1) for line in f if ":" in line)
        return int(fields["VmRSS"].split()[0]), int(fields["VmSwap"].split()[0])
    except (OSError, KeyError, ValueError):
        return None


class MemoryLogMiddleware:
    """Log HTTP requests that grew the process's memory past a threshold."""

    def __init__(self, app: ASGIApp, threshold_kb: int | None = None) -> None:
        self.app = app
        self.threshold_kb = _threshold_kb() if threshold_kb is None else threshold_kb

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        before = read_memory_kb()
        try:
            await self.app(scope, receive, send)
        finally:
            if before is not None:
                after = read_memory_kb()
                if after is not None:
                    self._report(scope, before, after)

    def _report(self, scope: Scope, before: tuple[int, int], after: tuple[int, int]) -> None:
        grown = sum(after) - sum(before)
        if grown < self.threshold_kb:
            return
        # Path only, never the query string: it can carry tokens.
        logger.warning(
            "Memory grew %+.1fMB on %s %s (rss=%.0fMB swap=%.0fMB)",
            grown / 1024,
            scope.get("method", ""),
            scope.get("path", ""),
            after[0] / 1024,
            after[1] / 1024,
        )
