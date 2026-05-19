"""API tests for radar presets."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from asistrader.auth.jwt import create_access_token
from asistrader.auth.password import hash_password
from asistrader.models.db import User

SAMPLE_CONFIG = {
    "ticker": {"rsiZone": "oversold"},
    "sort": {"key": "rsi", "dir": "asc"},
}


def _create(client: TestClient, headers: dict[str, str], name: str, config: dict) -> dict:
    response = client.post(
        "/api/radar/presets",
        headers=headers,
        json={"name": name, "config": config},
    )
    assert response.status_code == 201, response.text
    return response.json()["preset"]


def test_create_and_list_preset(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    preset = _create(client, auth_headers, "Oversold hunt", SAMPLE_CONFIG)
    assert preset["name"] == "Oversold hunt"
    assert preset["config"] == SAMPLE_CONFIG

    response = client.get("/api/radar/presets", headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["presets"][0]["config"] == SAMPLE_CONFIG


def test_config_stored_verbatim(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """The backend treats config as an opaque blob — unknown keys survive."""
    odd_config = {"ticker": {"futureSetting": "xyz"}, "brandNewScope": {"a": 1}}
    preset = _create(client, auth_headers, "Forward compat", odd_config)
    assert preset["config"] == odd_config


def test_empty_config_allowed(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """A preset capturing nothing but defaults is still valid."""
    response = client.post(
        "/api/radar/presets", headers=auth_headers, json={"name": "All defaults"}
    )
    assert response.status_code == 201
    assert response.json()["preset"]["config"] == {}


def test_duplicate_name_rejected(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    _create(client, auth_headers, "Dupe", SAMPLE_CONFIG)
    response = client.post(
        "/api/radar/presets", headers=auth_headers, json={"name": "Dupe", "config": {}}
    )
    assert response.status_code == 409


def test_update_rename_and_config(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    preset = _create(client, auth_headers, "Old name", SAMPLE_CONFIG)
    new_config = {"flatView": True}
    response = client.put(
        f"/api/radar/presets/{preset['id']}",
        headers=auth_headers,
        json={"name": "New name", "config": new_config},
    )
    assert response.status_code == 200
    updated = response.json()["preset"]
    assert updated["name"] == "New name"
    assert updated["config"] == new_config


def test_update_missing_returns_404(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.put(
        "/api/radar/presets/9999", headers=auth_headers, json={"name": "x"}
    )
    assert response.status_code == 404


def test_delete_preset(client: TestClient, auth_headers: dict[str, str]) -> None:
    preset = _create(client, auth_headers, "Doomed", SAMPLE_CONFIG)
    response = client.delete(
        f"/api/radar/presets/{preset['id']}", headers=auth_headers
    )
    assert response.status_code == 204
    assert client.get("/api/radar/presets", headers=auth_headers).json()["count"] == 0


def test_delete_missing_returns_404(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.delete("/api/radar/presets/9999", headers=auth_headers)
    assert response.status_code == 404


def test_requires_authentication(client: TestClient) -> None:
    assert client.get("/api/radar/presets").status_code == 401


def test_presets_are_user_scoped(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    """One user never sees, edits, or deletes another user's presets."""
    _create(client, auth_headers, "Mine", SAMPLE_CONFIG)

    other = User(
        email="other@example.com",
        hashed_password=hash_password("password123"),
        is_active=True,
    )
    db_session.add(other)
    db_session.commit()
    other_headers = {
        "Authorization": f"Bearer {create_access_token(other.id, other.email)}"
    }

    # The other user has an isolated, empty list...
    assert client.get("/api/radar/presets", headers=other_headers).json()["count"] == 0
    # ...and can reuse the same name without colliding.
    other_preset = _create(client, other_headers, "Mine", {"flatView": True})

    # Neither can mutate the other's preset.
    mine = client.get("/api/radar/presets", headers=auth_headers).json()["presets"][0]
    assert client.delete(
        f"/api/radar/presets/{mine['id']}", headers=other_headers
    ).status_code == 404
    assert client.put(
        f"/api/radar/presets/{other_preset['id']}",
        headers=auth_headers,
        json={"name": "hijacked"},
    ).status_code == 404
