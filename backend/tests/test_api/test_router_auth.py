"""Shared-data routers require a logged-in user on every endpoint.

market-data, strategies, tickers and benchmarks used to be reachable without
a token — anyone who could reach /api could delete strategies or trigger
Yahoo syncs. The guard is a router-level dependency, so these tests sweep
every route the routers register: an endpoint added later is covered too.
"""

import re

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from asistrader.main import app

GUARDED_PREFIXES = ("/api/market-data", "/api/strategies", "/api/tickers", "/api/benchmarks")


def _guarded_endpoints() -> list[tuple[str, str]]:
    endpoints = []
    for route in app.routes:
        if isinstance(route, APIRoute) and route.path.startswith(GUARDED_PREFIXES):
            # Any value satisfies a path parameter: the guard runs before it's used.
            path = re.sub(r"\{[^}]+\}", "1", route.path)
            endpoints.extend((method, path) for method in sorted(route.methods))
    return endpoints


ENDPOINTS = _guarded_endpoints()


def test_every_guarded_router_is_swept() -> None:
    for prefix in GUARDED_PREFIXES:
        assert any(path.startswith(prefix) for _, path in ENDPOINTS), prefix


@pytest.mark.parametrize(("method", "path"), ENDPOINTS)
def test_rejects_requests_without_a_token(client: TestClient, method: str, path: str) -> None:
    response = client.request(method, path)
    assert response.status_code == 401


@pytest.mark.parametrize(("method", "path"), ENDPOINTS)
def test_rejects_an_invalid_token(client: TestClient, method: str, path: str) -> None:
    response = client.request(method, path, headers={"Authorization": "Bearer not-a-jwt"})
    assert response.status_code == 401


def test_accepts_a_valid_token(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.get("/api/strategies", headers=auth_headers)
    assert response.status_code == 200
