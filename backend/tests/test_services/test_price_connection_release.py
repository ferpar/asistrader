"""The batch-price path must not hold a DB connection across its network calls.

This is what exhausted the pool in production: enough concurrent /prices
requests, each sitting on a yfinance round-trip with a checked-out connection,
and every other endpoint — including the auth dependency behind /me and
/login — blocked until it timed out with
"QueuePool limit of size 5 overflow 10 reached".
"""

from unittest.mock import patch

from sqlalchemy.orm import Session

from asistrader.models.db import Ticker
from asistrader.services import ticker_service


def test_connection_is_released_before_yfinance_is_called(
    db_session: Session,
) -> None:
    """By the time the network call happens, the session must hold no
    connection — i.e. it is back in the pool and usable by other requests."""
    db_session.add(Ticker(symbol="AAPL", currency="USD"))
    db_session.commit()
    ticker_service._clear_price_cache()

    held_during_fetch: list[bool] = []

    def record_and_return(symbols, currencies):
        # `in_transaction()` is True exactly while a connection is checked out.
        held_during_fetch.append(db_session.in_transaction())
        return {s: {"price": 1.0, "currency": "USD", "valid": True} for s in symbols}

    with patch.object(ticker_service, "_fetch_chunk", side_effect=record_and_return):
        ticker_service.get_batch_prices(["AAPL"], db=db_session)

    assert held_during_fetch == [False], (
        "a DB connection was still checked out while waiting on yfinance"
    )


def test_currencies_still_come_from_the_database(db_session: Session) -> None:
    """Releasing the connection must not cost us the currency lookup."""
    db_session.add(Ticker(symbol="MTS.MC", currency="EUR"))
    db_session.commit()
    ticker_service._clear_price_cache()

    seen: dict = {}

    def capture(symbols, currencies):
        seen.update(currencies)
        return {s: {"price": 1.0, "currency": currencies.get(s), "valid": True} for s in symbols}

    with patch.object(ticker_service, "_fetch_chunk", side_effect=capture):
        result = ticker_service.get_batch_prices(["MTS.MC"], db=db_session)

    assert seen == {"MTS.MC": "EUR"}
    assert result["MTS.MC"]["currency"] == "EUR"


def test_works_without_a_session(db_session: Session) -> None:
    """The db-less path is unaffected."""
    ticker_service._clear_price_cache()
    with patch.object(
        ticker_service,
        "_fetch_chunk",
        side_effect=lambda symbols, currencies: {
            s: {"price": 2.0, "currency": None, "valid": True} for s in symbols
        },
    ):
        result = ticker_service.get_batch_prices(["NVDA"], db=None)

    assert result["NVDA"]["price"] == 2.0
