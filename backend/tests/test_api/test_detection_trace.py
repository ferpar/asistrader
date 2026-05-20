"""Tests for `GET /api/trades/{id}/detection-trace`."""

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from asistrader.models.db import ExitLevelType, MarketData, Ticker, Trade, User


def _add_bar(
    db: Session, ticker: Ticker, bar_date: date,
    *, open: float, high: float, low: float, close: float,
) -> None:
    db.add(MarketData(
        ticker=ticker.symbol, date=bar_date,
        open=open, high=high, low=low, close=close, volume=1_000_000.0,
    ))
    db.commit()


class TestDetectionTraceEndpoint:
    def test_404_when_trade_missing(
        self, client: TestClient, auth_headers: dict[str, str]
    ) -> None:
        response = client.get("/api/trades/99999/detection-trace", headers=auth_headers)
        assert response.status_code == 404

    def test_404_for_other_users_trade(
        self,
        client: TestClient,
        db_session: Session,
        sample_trade: Trade,
        sample_user: User,
        auth_headers: dict[str, str],
    ) -> None:
        # Re-assign trade to a different user; current_user should not see it.
        other = User(email="o@x.com", hashed_password="x")
        db_session.add(other)
        db_session.commit()
        sample_trade.user_id = other.id
        db_session.commit()

        response = client.get(
            f"/api/trades/{sample_trade.id}/detection-trace", headers=auth_headers
        )
        assert response.status_code == 404

    def test_simple_sltp_trace_shape(
        self,
        client: TestClient,
        db_session: Session,
        sample_trade: Trade,
        sample_ticker: Ticker,
        auth_headers: dict[str, str],
    ) -> None:
        # sample_trade: long, SL=95, TP=115, date_actual=2025-01-16.
        _add_bar(
            db_session, sample_ticker, date(2025, 1, 17),
            open=100, high=101, low=90, close=92,
        )

        response = client.get(
            f"/api/trades/{sample_trade.id}/detection-trace",
            headers=auth_headers,
        )
        assert response.status_code == 200
        body = response.json()
        assert body["detector_kind"] == "sltp"
        assert body["what_if"] == {}
        trace = body["trace"]
        assert trace["kind"] == "sltp"
        assert trace["side"] == "long"
        assert trace["trade_id"] == sample_trade.id
        assert len(trace["bars"]) == 1
        bar = trace["bars"][0]
        assert bar["date"] == "2025-01-17"
        assert bar["decision"] == "hit"
        assert bar["chosen_keys"] == ["sl"]
        assert "SL hit on 2025-01-17" in trace["verdict"]

    def test_what_if_sl_changes_verdict_and_does_not_persist(
        self,
        client: TestClient,
        db_session: Session,
        sample_trade: Trade,
        sample_ticker: Ticker,
        auth_headers: dict[str, str],
    ) -> None:
        # Bar doesn't touch SL=95 but would touch SL=98.
        _add_bar(
            db_session, sample_ticker, date(2025, 1, 17),
            open=100, high=101, low=97, close=99,
        )

        # Live: no hit
        live = client.get(
            f"/api/trades/{sample_trade.id}/detection-trace", headers=auth_headers,
        ).json()
        assert "no hit" in live["trace"]["verdict"]

        # What-if: hit
        whatif = client.get(
            f"/api/trades/{sample_trade.id}/detection-trace?sl=98",
            headers=auth_headers,
        ).json()
        assert whatif["what_if"] == {"sl": 98.0}
        assert "SL hit" in whatif["trace"]["verdict"]

        # DB unchanged
        db_session.expire_all()
        reloaded = db_session.get(Trade, sample_trade.id)
        sl = next(l for l in reloaded.exit_levels if l.level_type == ExitLevelType.SL)
        assert sl.price == 95.0

    def test_margin_query_param_overrides_user_setting(
        self,
        client: TestClient,
        db_session: Session,
        sample_trade: Trade,
        sample_ticker: Ticker,
        auth_headers: dict[str, str],
    ) -> None:
        # Graze at 94.7 — not a hit with default margin, but is at margin=0.
        _add_bar(
            db_session, sample_ticker, date(2025, 1, 17),
            open=100, high=101, low=94.7, close=95,
        )

        default = client.get(
            f"/api/trades/{sample_trade.id}/detection-trace", headers=auth_headers,
        ).json()
        assert "no hit" in default["trace"]["verdict"]

        zero = client.get(
            f"/api/trades/{sample_trade.id}/detection-trace?margin=0",
            headers=auth_headers,
        ).json()
        assert "SL hit" in zero["trace"]["verdict"]

    def test_layered_trade_routes_to_layered_detector(
        self,
        client: TestClient,
        db_session: Session,
        sample_layered_long_trade: Trade,
        sample_ticker: Ticker,
        auth_headers: dict[str, str],
    ) -> None:
        _add_bar(
            db_session, sample_ticker, date(2025, 1, 17),
            open=100, high=125, low=99, close=124,
        )
        body = client.get(
            f"/api/trades/{sample_layered_long_trade.id}/detection-trace",
            headers=auth_headers,
        ).json()
        assert body["detector_kind"] == "layered"
        bar = body["trace"]["bars"][-1]
        assert set(bar["chosen_keys"]) == {"tp:1", "tp:2"}

    def test_what_if_sl_rejected_when_multiple_sls_not_allowed(
        self,
        client: TestClient,
        sample_layered_long_trade: Trade,
        auth_headers: dict[str, str],
    ) -> None:
        # sample_layered_long_trade has multiple TPs; tp override should 400.
        response = client.get(
            f"/api/trades/{sample_layered_long_trade.id}/detection-trace?tp=200",
            headers=auth_headers,
        )
        assert response.status_code == 400
        assert "exactly one TP" in response.json()["detail"]
