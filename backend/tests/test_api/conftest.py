"""Shared fixtures for API-level tests."""

from __future__ import annotations

import pytest

from asistrader.services.strategies import draft_service


@pytest.fixture(autouse=True)
def offline_live_price(monkeypatch):
    """Keep the draft endpoint offline and deterministic.

    `draft_trade` re-anchors preset prices on a live quote (`get_current_price`,
    a yfinance round-trip). Default that to "no quote available" so drafts stay
    anchored on the last stored close and tests never touch the network. Tests
    that exercise the live re-anchoring override this via `monkeypatch`.
    """
    monkeypatch.setattr(
        draft_service,
        "get_current_price",
        lambda symbol: {"price": None, "currency": None, "valid": False},
    )
