"""Basket members API: each member with the user's Portfolios that hold it.

Held-in information comes from the user's current Holdings (the replay of
their Transactions), and never from another user's Portfolios. Baskets,
tickers, Portfolios and Transactions are seeded directly.
"""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from asistrader.auth.jwt import create_access_token
from asistrader.auth.password import hash_password
from asistrader.models.db import Basket, BasketMember, Portfolio, PortfolioTransaction, Ticker, User


def _ticker(db: Session, symbol: str, name: str | None = None) -> None:
    if db.get(Ticker, symbol) is None:
        db.add(Ticker(symbol=symbol, name=name, currency="USD"))
        db.commit()


def _basket(db: Session, name: str, members: list[str], *, owner: User | None = None) -> Basket:
    for symbol in members:
        _ticker(db, symbol)
    basket = Basket(
        kind="personal" if owner else "curated",
        owner_user_id=owner.id if owner else None,
        name=name,
        slug=None if owner else name.lower().replace(" ", "-"),
        members=[BasketMember(ticker=s) for s in members],
    )
    db.add(basket)
    db.commit()
    return basket


def _portfolio(db: Session, owner: User, name: str, buys: list[str]) -> Portfolio:
    """A USD Portfolio with one Buy of each symbol (FX rate entered, so no FX rows needed)."""
    portfolio = Portfolio(user_id=owner.id, name=name, currency="USD")
    db.add(portfolio)
    db.flush()
    for symbol in buys:
        _ticker(db, symbol)
        db.add(
            PortfolioTransaction(
                portfolio_id=portfolio.id,
                kind="buy",
                date=date(2025, 1, 6),
                ticker=symbol,
                units=10,
                price=100,
                fees=0,
                fx_rate=1,
            )
        )
    db.commit()
    return portfolio


@pytest.fixture
def other_user(db_session: Session) -> User:
    user = User(email="other@example.com", hashed_password=hash_password("password123"), is_active=True)
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def other_headers(other_user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(other_user.id, other_user.email)}"}


def _members(client: TestClient, headers: dict[str, str], basket_id: int) -> dict[str, dict]:
    response = client.get(f"/api/baskets/{basket_id}/members", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["count"] == len(body["members"])
    return {m["symbol"]: m for m in body["members"]}


def test_lists_every_member_with_its_name(
    client: TestClient, db_session: Session, auth_headers: dict[str, str]
) -> None:
    _ticker(db_session, "NVDA", "NVIDIA Corporation")
    basket = _basket(db_session, "Tech & AI", ["NVDA", "MSFT"])

    members = _members(client, auth_headers, basket.id)

    assert set(members) == {"NVDA", "MSFT"}
    assert members["NVDA"]["name"] == "NVIDIA Corporation"
    assert members["MSFT"]["held_in"] == []


def test_a_member_lists_every_portfolio_of_the_user_that_holds_it(
    client: TestClient, db_session: Session, sample_user: User, auth_headers: dict[str, str]
) -> None:
    basket = _basket(db_session, "Tech & AI", ["NVDA", "MSFT", "AMD"])
    broker_a = _portfolio(db_session, sample_user, "Broker A", ["NVDA", "MSFT"])
    broker_b = _portfolio(db_session, sample_user, "Broker B", ["NVDA", "AAPL"])

    members = _members(client, auth_headers, basket.id)

    assert members["NVDA"]["held_in"] == [
        {"id": broker_a.id, "name": "Broker A"},
        {"id": broker_b.id, "name": "Broker B"},
    ]
    assert members["MSFT"]["held_in"] == [{"id": broker_a.id, "name": "Broker A"}]
    assert members["AMD"]["held_in"] == []


def test_only_current_holdings_count_so_a_sold_out_member_is_not_held(
    client: TestClient, db_session: Session, sample_user: User, auth_headers: dict[str, str]
) -> None:
    basket = _basket(db_session, "Tech & AI", ["NVDA", "MSFT"])
    broker = _portfolio(db_session, sample_user, "Broker A", ["NVDA", "MSFT"])
    for symbol, units in (("NVDA", 10), ("MSFT", 4)):  # NVDA sold out, MSFT partly sold
        db_session.add(
            PortfolioTransaction(
                portfolio_id=broker.id,
                kind="sell",
                date=date(2025, 2, 3),
                ticker=symbol,
                units=units,
                price=120,
                fees=0,
                fx_rate=1,
            )
        )
    db_session.commit()

    members = _members(client, auth_headers, basket.id)

    assert members["NVDA"]["held_in"] == []
    assert members["MSFT"]["held_in"] == [{"id": broker.id, "name": "Broker A"}]


def test_another_users_portfolios_never_show_as_held_in(
    client: TestClient,
    db_session: Session,
    sample_user: User,
    auth_headers: dict[str, str],
    other_user: User,
    other_headers: dict[str, str],
) -> None:
    basket = _basket(db_session, "Tech & AI", ["NVDA"])
    mine = _portfolio(db_session, sample_user, "Broker A", ["NVDA"])
    theirs = _portfolio(db_session, other_user, "Their broker", ["NVDA"])

    assert _members(client, auth_headers, basket.id)["NVDA"]["held_in"] == [
        {"id": mine.id, "name": "Broker A"}
    ]
    assert _members(client, other_headers, basket.id)["NVDA"]["held_in"] == [
        {"id": theirs.id, "name": "Their broker"}
    ]


def test_members_of_another_users_personal_basket_are_not_found(
    client: TestClient, db_session: Session, auth_headers: dict[str, str], other_user: User
) -> None:
    theirs = _basket(db_session, "Their picks", ["NVDA"], owner=other_user)

    response = client.get(f"/api/baskets/{theirs.id}/members", headers=auth_headers)

    assert response.status_code == 404


def test_members_of_an_unknown_basket_are_not_found(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    assert client.get("/api/baskets/999/members", headers=auth_headers).status_code == 404
