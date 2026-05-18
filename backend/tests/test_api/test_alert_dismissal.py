"""API tests for dismissing and restoring detection alerts."""

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from asistrader.models.db import MarketData, Ticker, Trade


def _seed_sl_hit(db_session: Session, sample_ticker: Ticker) -> None:
    """An OHLC bar after the open day that clearly penetrates SL=95."""
    db_session.add(
        MarketData(
            ticker=sample_ticker.symbol, date=date(2025, 1, 17),
            open=92.0, high=96.0, low=90.0, close=92.0, volume=1_000_000.0,
        )
    )
    db_session.commit()


def _detect(client: TestClient, headers: dict[str, str]) -> dict:
    response = client.post("/api/trades/detect-hits", headers=headers)
    assert response.status_code == 200
    return response.json()


def test_detect_hits_returns_alert_signature(
    client: TestClient, auth_headers: dict[str, str],
    sample_trade: Trade, sample_ticker: Ticker, db_session: Session,
) -> None:
    _seed_sl_hit(db_session, sample_ticker)
    alerts = _detect(client, auth_headers)["sltp_alerts"]
    assert len(alerts) == 1
    alert = alerts[0]
    assert alert["dismissed"] is False
    assert alert["alert_kind"] == "sltp"
    assert alert["level_key"] == "sl"


def test_dismissed_alert_is_flagged_on_next_detect(
    client: TestClient, auth_headers: dict[str, str],
    sample_trade: Trade, sample_ticker: Ticker, db_session: Session,
) -> None:
    _seed_sl_hit(db_session, sample_ticker)
    alert = _detect(client, auth_headers)["sltp_alerts"][0]
    payload = {
        "trade_id": alert["trade_id"],
        "hit_date": alert["hit_date"],
        "alert_kind": alert["alert_kind"],
        "level_key": alert["level_key"],
    }

    dismiss = client.post("/api/trades/alerts/dismiss", json=payload, headers=auth_headers)
    assert dismiss.status_code == 200

    # The alert is still returned, now flagged dismissed.
    flagged = _detect(client, auth_headers)["sltp_alerts"][0]
    assert flagged["dismissed"] is True


def test_restored_alert_reappears_active(
    client: TestClient, auth_headers: dict[str, str],
    sample_trade: Trade, sample_ticker: Ticker, db_session: Session,
) -> None:
    _seed_sl_hit(db_session, sample_ticker)
    alert = _detect(client, auth_headers)["sltp_alerts"][0]
    payload = {
        "trade_id": alert["trade_id"],
        "hit_date": alert["hit_date"],
        "alert_kind": alert["alert_kind"],
        "level_key": alert["level_key"],
    }
    client.post("/api/trades/alerts/dismiss", json=payload, headers=auth_headers)

    restore = client.request(
        "DELETE", "/api/trades/alerts/dismiss", json=payload, headers=auth_headers
    )
    assert restore.status_code == 200
    assert restore.json()["message"] == "Alert restored"

    reactivated = _detect(client, auth_headers)["sltp_alerts"][0]
    assert reactivated["dismissed"] is False


def test_dismiss_is_idempotent(
    client: TestClient, auth_headers: dict[str, str],
    sample_trade: Trade, sample_ticker: Ticker, db_session: Session,
) -> None:
    _seed_sl_hit(db_session, sample_ticker)
    alert = _detect(client, auth_headers)["sltp_alerts"][0]
    payload = {
        "trade_id": alert["trade_id"],
        "hit_date": alert["hit_date"],
        "alert_kind": alert["alert_kind"],
        "level_key": alert["level_key"],
    }
    first = client.post("/api/trades/alerts/dismiss", json=payload, headers=auth_headers)
    second = client.post("/api/trades/alerts/dismiss", json=payload, headers=auth_headers)
    assert first.status_code == 200
    assert second.status_code == 200


def test_dismiss_unknown_trade_returns_404(
    client: TestClient, auth_headers: dict[str, str], sample_user: object,
) -> None:
    response = client.post(
        "/api/trades/alerts/dismiss",
        json={
            "trade_id": 9999, "hit_date": "2025-01-17",
            "alert_kind": "sltp", "level_key": "sl",
        },
        headers=auth_headers,
    )
    assert response.status_code == 404


def test_dismiss_invalid_alert_kind_returns_400(
    client: TestClient, auth_headers: dict[str, str], sample_trade: Trade,
) -> None:
    response = client.post(
        "/api/trades/alerts/dismiss",
        json={
            "trade_id": sample_trade.id, "hit_date": "2025-01-17",
            "alert_kind": "bogus", "level_key": "sl",
        },
        headers=auth_headers,
    )
    assert response.status_code == 400


def test_restore_without_dismissal_is_a_no_op(
    client: TestClient, auth_headers: dict[str, str], sample_trade: Trade,
) -> None:
    response = client.request(
        "DELETE", "/api/trades/alerts/dismiss",
        json={
            "trade_id": sample_trade.id, "hit_date": "2025-01-17",
            "alert_kind": "sltp", "level_key": "sl",
        },
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["message"] == "No matching dismissal found"


def test_dismiss_requires_auth(client: TestClient, sample_trade: Trade) -> None:
    response = client.post(
        "/api/trades/alerts/dismiss",
        json={
            "trade_id": sample_trade.id, "hit_date": "2025-01-17",
            "alert_kind": "sltp", "level_key": "sl",
        },
    )
    assert response.status_code == 401
