"""Baskets inside Portfolios: the summary lists, per Holding, the Baskets
visible to the requesting user that contain it.

Visible means Curated Baskets plus the user's own Personal ones; another
user's Personal Baskets never show. Baskets, tickers, Portfolios and
Transactions are seeded directly.
"""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from asistrader.auth.password import hash_password
from asistrader.models.db import Basket, BasketMember, Portfolio, PortfolioTransaction, Ticker, User


def _ticker(db: Session, symbol: str) -> None:
    if db.get(Ticker, symbol) is None:
        db.add(Ticker(symbol=symbol, currency="USD"))
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


def _portfolio(db: Session, owner: User, buys: list[str]) -> Portfolio:
    """A USD Portfolio with one Buy of each symbol (FX rate entered, so no FX rows needed)."""
    portfolio = Portfolio(user_id=owner.id, name="Broker", currency="USD")
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


def _holding_baskets(
    client: TestClient, headers: dict[str, str], portfolio_id: int
) -> dict[str, list[dict]]:
    response = client.get(f"/api/portfolios/{portfolio_id}/summary", headers=headers)
    assert response.status_code == 200, response.text
    return {h["ticker"]: h["baskets"] for h in response.json()["holdings"]}


def test_each_holding_lists_the_curated_baskets_that_contain_it(
    client: TestClient, db_session: Session, sample_user: User, auth_headers: dict[str, str]
) -> None:
    tech = _basket(db_session, "Tech & AI", ["NVDA", "MSFT"])
    chips = _basket(db_session, "Semiconductors", ["NVDA", "AMD"])
    portfolio = _portfolio(db_session, sample_user, ["NVDA", "MSFT", "KO"])

    baskets = _holding_baskets(client, auth_headers, portfolio.id)

    assert baskets["NVDA"] == [
        {"id": chips.id, "name": "Semiconductors", "kind": "curated"},
        {"id": tech.id, "name": "Tech & AI", "kind": "curated"},
    ]
    assert baskets["MSFT"] == [{"id": tech.id, "name": "Tech & AI", "kind": "curated"}]
    assert baskets["KO"] == []


def test_the_users_own_personal_baskets_count_and_follow_the_curated_ones(
    client: TestClient, db_session: Session, sample_user: User, auth_headers: dict[str, str]
) -> None:
    mine = _basket(db_session, "A picks", ["NVDA"], owner=sample_user)
    tech = _basket(db_session, "Tech & AI", ["NVDA"])
    portfolio = _portfolio(db_session, sample_user, ["NVDA"])

    baskets = _holding_baskets(client, auth_headers, portfolio.id)

    assert baskets["NVDA"] == [
        {"id": tech.id, "name": "Tech & AI", "kind": "curated"},
        {"id": mine.id, "name": "A picks", "kind": "personal"},
    ]


def test_another_users_personal_baskets_never_show(
    client: TestClient,
    db_session: Session,
    sample_user: User,
    other_user: User,
    auth_headers: dict[str, str],
) -> None:
    _basket(db_session, "Their picks", ["NVDA", "MSFT"], owner=other_user)
    portfolio = _portfolio(db_session, sample_user, ["NVDA", "MSFT"])

    baskets = _holding_baskets(client, auth_headers, portfolio.id)

    assert baskets == {"NVDA": [], "MSFT": []}
