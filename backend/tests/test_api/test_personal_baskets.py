"""Personal Baskets API: create, rename, delete, copy and member changes.

Personal Baskets are visible and editable only by their owner (another user
gets 404, so existence never leaks). Curated Baskets stay read-only for
everyone (403 on any write). Baskets and tickers are seeded directly;
yfinance is mocked when adding a symbol AsisTrader doesn't know yet.
"""

from datetime import date
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from asistrader.auth.jwt import create_access_token
from asistrader.auth.password import hash_password
from asistrader.models.db import Basket, BasketMember, Ticker, User


def _ticker(db: Session, symbol: str) -> None:
    if db.get(Ticker, symbol) is None:
        db.add(Ticker(symbol=symbol))
        db.commit()


def _curated(db: Session, name: str, slug: str, members: list[str]) -> int:
    for symbol in members:
        _ticker(db, symbol)
    basket = Basket(
        kind="curated", name=name, slug=slug, members=[BasketMember(ticker=s) for s in members]
    )
    db.add(basket)
    db.commit()
    return basket.id


@pytest.fixture
def other_headers(db_session: Session) -> dict[str, str]:
    user = User(email="other@example.com", hashed_password=hash_password("password123"), is_active=True)
    db_session.add(user)
    db_session.commit()
    return {"Authorization": f"Bearer {create_access_token(user.id, user.email)}"}


def _create(client: TestClient, headers: dict[str, str], name: str = "My picks") -> dict:
    response = client.post("/api/baskets", json={"name": name}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


# --- Create / visibility ----------------------------------------------------


def test_created_personal_basket_is_listed_for_its_owner_only(
    client: TestClient, auth_headers: dict[str, str], other_headers: dict[str, str]
) -> None:
    basket = _create(client, auth_headers, "My picks")

    assert basket["kind"] == "personal"
    assert basket["name"] == "My picks"
    assert basket["members"] == []
    assert basket["slug"] is None
    own = client.get("/api/baskets", headers=auth_headers).json()["baskets"]
    assert [b["name"] for b in own] == ["My picks"]
    others = client.get("/api/baskets", headers=other_headers).json()["baskets"]
    assert others == []
    assert client.get(f"/api/baskets/{basket['id']}", headers=other_headers).status_code == 404


# --- Rename / delete --------------------------------------------------------


def test_owner_renames_a_personal_basket_and_other_users_get_404(
    client: TestClient, auth_headers: dict[str, str], other_headers: dict[str, str]
) -> None:
    basket = _create(client, auth_headers, "My picks")

    renamed = client.patch(
        f"/api/baskets/{basket['id']}", json={"name": "Core picks"}, headers=auth_headers
    )
    hijack = client.patch(
        f"/api/baskets/{basket['id']}", json={"name": "Mine now"}, headers=other_headers
    )

    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Core picks"
    assert hijack.status_code == 404
    assert client.get(f"/api/baskets/{basket['id']}", headers=auth_headers).json()["name"] == "Core picks"


def test_owner_deletes_a_personal_basket_and_other_users_get_404(
    client: TestClient, auth_headers: dict[str, str], other_headers: dict[str, str]
) -> None:
    basket = _create(client, auth_headers, "My picks")

    assert client.delete(f"/api/baskets/{basket['id']}", headers=other_headers).status_code == 404
    assert client.get(f"/api/baskets/{basket['id']}", headers=auth_headers).status_code == 200

    assert client.delete(f"/api/baskets/{basket['id']}", headers=auth_headers).status_code == 204
    assert client.get(f"/api/baskets/{basket['id']}", headers=auth_headers).status_code == 404
    assert client.get("/api/baskets", headers=auth_headers).json()["count"] == 0


# --- Names ------------------------------------------------------------------


def test_personal_basket_names_are_unique_per_owner(
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    other_headers: dict[str, str],
) -> None:
    first = _create(client, auth_headers, "My picks")
    other = _create(client, auth_headers, "Other")
    curated = _curated(db_session, "Tech & AI", "tech-ai", ["NVDA"])

    duplicate = client.post("/api/baskets", json={"name": "my picks "}, headers=auth_headers)
    rename_clash = client.patch(
        f"/api/baskets/{other['id']}", json={"name": "My Picks"}, headers=auth_headers
    )
    copy_once = client.post(f"/api/baskets/{curated}/copy", json={}, headers=auth_headers)
    copy_clash = client.post(f"/api/baskets/{curated}/copy", json={}, headers=auth_headers)

    assert duplicate.status_code == 409
    assert rename_clash.status_code == 409
    assert copy_once.status_code == 201
    assert copy_clash.status_code == 409
    # Renaming to its own name and another user's same name are both fine.
    assert client.patch(
        f"/api/baskets/{first['id']}", json={"name": "My picks"}, headers=auth_headers
    ).status_code == 200
    assert client.post("/api/baskets", json={"name": "My picks"}, headers=other_headers).status_code == 201
    # A Personal Basket may share a Curated Basket's name; the ranking marks the kind.
    assert client.post("/api/baskets", json={"name": "Tech & AI"}, headers=auth_headers).status_code == 201


def test_blank_names_are_rejected(client: TestClient, auth_headers: dict[str, str]) -> None:
    basket = _create(client, auth_headers, "My picks")

    assert client.post("/api/baskets", json={"name": "   "}, headers=auth_headers).status_code == 422
    assert client.patch(
        f"/api/baskets/{basket['id']}", json={"name": " "}, headers=auth_headers
    ).status_code == 422


# --- Curated Baskets are read-only ------------------------------------------


def test_curated_baskets_cannot_be_renamed_or_deleted(
    client: TestClient, db_session: Session, auth_headers: dict[str, str]
) -> None:
    curated = _curated(db_session, "Tech & AI", "tech-ai", ["NVDA", "MSFT"])

    rename = client.patch(f"/api/baskets/{curated}", json={"name": "Mine"}, headers=auth_headers)
    delete = client.delete(f"/api/baskets/{curated}", headers=auth_headers)

    assert rename.status_code == 403
    assert "read-only" in rename.json()["detail"]
    assert delete.status_code == 403
    basket = client.get(f"/api/baskets/{curated}", headers=auth_headers).json()
    assert basket["name"] == "Tech & AI"
    assert basket["members"] == ["MSFT", "NVDA"]


# --- Copy -------------------------------------------------------------------


def test_copying_a_curated_basket_makes_a_personal_one_with_the_same_members(
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    other_headers: dict[str, str],
) -> None:
    curated = _curated(db_session, "Tech & AI", "tech-ai", ["NVDA", "MSFT"])

    response = client.post(f"/api/baskets/{curated}/copy", json={}, headers=auth_headers)

    assert response.status_code == 201
    copy = response.json()
    assert copy["id"] != curated
    assert copy["kind"] == "personal"
    assert copy["name"] == "Tech & AI (copy)"
    assert copy["slug"] is None
    assert copy["members"] == ["MSFT", "NVDA"]
    assert client.get(f"/api/baskets/{copy['id']}", headers=other_headers).status_code == 404


def test_a_copy_can_be_named_and_is_independent_of_the_original(
    client: TestClient, db_session: Session, auth_headers: dict[str, str]
) -> None:
    curated = _curated(db_session, "Tech & AI", "tech-ai", ["NVDA", "MSFT"])

    copy = client.post(
        f"/api/baskets/{curated}/copy", json={"name": "My tech"}, headers=auth_headers
    ).json()
    client.delete(f"/api/baskets/{copy['id']}/members/NVDA", headers=auth_headers)

    assert copy["name"] == "My tech"
    assert client.get(f"/api/baskets/{copy['id']}", headers=auth_headers).json()["members"] == ["MSFT"]
    assert client.get(f"/api/baskets/{curated}", headers=auth_headers).json()["members"] == ["MSFT", "NVDA"]


def test_another_users_personal_basket_cannot_be_copied(
    client: TestClient, auth_headers: dict[str, str], other_headers: dict[str, str]
) -> None:
    basket = _create(client, auth_headers, "My picks")

    response = client.post(f"/api/baskets/{basket['id']}/copy", json={}, headers=other_headers)

    assert response.status_code == 404


# --- Members ----------------------------------------------------------------


def _copy(client: TestClient, headers: dict[str, str], basket_id: int) -> dict:
    return client.post(f"/api/baskets/{basket_id}/copy", json={}, headers=headers).json()


def test_owner_removes_a_member(
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    other_headers: dict[str, str],
) -> None:
    copy = _copy(client, auth_headers, _curated(db_session, "Tech & AI", "tech-ai", ["NVDA", "MSFT"]))
    url = f"/api/baskets/{copy['id']}/members/NVDA"

    assert client.delete(url, headers=other_headers).status_code == 404
    assert client.delete(url, headers=auth_headers).status_code == 204
    assert client.delete(url, headers=auth_headers).status_code == 404
    assert client.get(f"/api/baskets/{copy['id']}", headers=auth_headers).json()["members"] == ["MSFT"]
    # The ticker itself stays: it's global, only the membership went.
    assert db_session.get(Ticker, "NVDA") is not None


def test_curated_basket_members_cannot_be_changed(
    client: TestClient, db_session: Session, auth_headers: dict[str, str]
) -> None:
    curated = _curated(db_session, "Tech & AI", "tech-ai", ["NVDA", "MSFT"])
    _ticker(db_session, "AAPL")

    remove = client.delete(f"/api/baskets/{curated}/members/NVDA", headers=auth_headers)
    add = client.post(f"/api/baskets/{curated}/members", json={"symbol": "AAPL"}, headers=auth_headers)

    assert remove.status_code == 403
    assert add.status_code == 403
    assert client.get(f"/api/baskets/{curated}", headers=auth_headers).json()["members"] == ["MSFT", "NVDA"]


def test_owner_adds_a_known_ticker_by_symbol(
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    other_headers: dict[str, str],
) -> None:
    _ticker(db_session, "AAPL")
    basket = _create(client, auth_headers)
    url = f"/api/baskets/{basket['id']}/members"

    added = client.post(url, json={"symbol": " aapl "}, headers=auth_headers)
    again = client.post(url, json={"symbol": "AAPL"}, headers=auth_headers)
    hijack = client.post(url, json={"symbol": "AAPL"}, headers=other_headers)

    assert added.status_code == 201
    assert added.json()["members"] == ["AAPL"]
    assert again.status_code == 409
    assert hijack.status_code == 404
    assert client.get(f"/api/baskets/{basket['id']}", headers=auth_headers).json()["members"] == ["AAPL"]


def _yf_ticker(info: dict) -> MagicMock:
    mock = MagicMock()
    mock.info = info
    return mock


@patch("asistrader.services.market_data_service.fetch_from_yfinance")
@patch("asistrader.services.ticker_service.yf.Ticker")
def test_adding_an_unknown_symbol_creates_the_ticker_and_loads_its_history(
    mock_yf_ticker: MagicMock,
    mock_md_fetch: MagicMock,
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    mock_yf_ticker.return_value = _yf_ticker(
        {"quoteType": "EQUITY", "currency": "EUR", "shortName": "Rheinmetall", "priceHint": 2}
    )
    mock_md_fetch.return_value = pd.DataFrame(
        {"Open": [600.0, 610.0], "High": [600.0, 610.0], "Low": [600.0, 610.0],
         "Close": [600.0, 610.0], "Adj Close": [598.0, 608.0], "Volume": [0, 0]},
        index=pd.DatetimeIndex([date(2026, 11, 19), date(2026, 11, 20)]),
    )
    basket = _create(client, auth_headers, "Defence")

    response = client.post(
        f"/api/baskets/{basket['id']}/members", json={"symbol": "rhm.de"}, headers=auth_headers
    )

    assert response.status_code == 201
    assert response.json()["members"] == ["RHM.DE"]
    assert mock_md_fetch.call_args.args[0] == "RHM.DE"
    tickers = client.get("/api/tickers", headers=auth_headers).json()["tickers"]
    rhm = next(t for t in tickers if t["symbol"] == "RHM.DE")
    assert rhm["name"] == "Rheinmetall"
    assert rhm["currency"] == "EUR"
    index = client.get(f"/api/baskets/{basket['id']}/index", headers=auth_headers).json()
    assert index["dates"] == ["2026-11-19", "2026-11-20"]
    assert index["close"][-1] == pytest.approx(100 * 608.0 / 598.0)


@patch("asistrader.services.ticker_service.yf.Ticker")
def test_adding_a_symbol_yahoo_does_not_know_is_rejected_with_a_reason(
    mock_yf_ticker: MagicMock, client: TestClient, auth_headers: dict[str, str]
) -> None:
    mock_yf_ticker.return_value = _yf_ticker({})
    basket = _create(client, auth_headers)

    response = client.post(
        f"/api/baskets/{basket['id']}/members", json={"symbol": "NOPE"}, headers=auth_headers
    )

    assert response.status_code == 400
    assert "NOPE" in response.json()["detail"]
    assert client.get(f"/api/baskets/{basket['id']}", headers=auth_headers).json()["members"] == []
    symbols = [t["symbol"] for t in client.get("/api/tickers", headers=auth_headers).json()["tickers"]]
    assert "NOPE" not in symbols
