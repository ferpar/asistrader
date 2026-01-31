"""Tests for the exit level hit/revert API endpoints."""

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from asistrader.models.db import ExitLevel, ExitLevelStatus, ExitLevelType, Ticker, Trade, TradeStatus, User


class TestMarkExitLevelHit:
    """Tests for PATCH /{trade_id}/exit-levels/{level_id}/hit."""

    def test_mark_tp_level_hit(
        self,
        client: TestClient,
        db_session: Session,
        sample_layered_trade_with_levels: Trade,
        auth_headers: dict[str, str],
    ) -> None:
        """Mark a TP level as hit and verify remaining_units decrements."""
        trade = sample_layered_trade_with_levels
        tp_level = next(
            l for l in trade.exit_levels
            if l.level_type == ExitLevelType.TP and l.order_index == 1
        )

        response = client.patch(
            f"/api/trades/{trade.id}/exit-levels/{tp_level.id}/hit",
            json={"hit_date": "2025-02-01"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()

        # TP1 is 50% of 100 units = 50 units closed
        assert data["trade"]["remaining_units"] == 50
        assert data["trade"]["status"] == "open"

        # Find the hit level in response
        hit_level = next(l for l in data["trade"]["exit_levels"] if l["id"] == tp_level.id)
        assert hit_level["status"] == "hit"
        assert hit_level["hit_date"] == "2025-02-01"
        assert hit_level["units_closed"] == 50

    def test_mark_level_hit_with_price_override(
        self,
        client: TestClient,
        db_session: Session,
        sample_layered_trade_with_levels: Trade,
        auth_headers: dict[str, str],
    ) -> None:
        """Mark a level hit with a custom price override."""
        trade = sample_layered_trade_with_levels
        tp_level = next(
            l for l in trade.exit_levels
            if l.level_type == ExitLevelType.TP and l.order_index == 1
        )

        response = client.patch(
            f"/api/trades/{trade.id}/exit-levels/{tp_level.id}/hit",
            json={"hit_date": "2025-02-01", "hit_price": 112.50},
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()

        hit_level = next(l for l in data["trade"]["exit_levels"] if l["id"] == tp_level.id)
        assert hit_level["price"] == 112.50

    def test_auto_close_when_all_levels_hit(
        self,
        client: TestClient,
        db_session: Session,
        sample_layered_trade_with_levels: Trade,
        auth_headers: dict[str, str],
    ) -> None:
        """When all levels are hit, trade should auto-close."""
        trade = sample_layered_trade_with_levels
        tp_levels = sorted(
            [l for l in trade.exit_levels if l.level_type == ExitLevelType.TP],
            key=lambda l: l.order_index,
        )

        # Hit all 3 TP levels
        for tp_level in tp_levels:
            response = client.patch(
                f"/api/trades/{trade.id}/exit-levels/{tp_level.id}/hit",
                json={"hit_date": "2025-02-01"},
                headers=auth_headers,
            )
            assert response.status_code == 200

        data = response.json()
        assert data["trade"]["status"] == "close"
        assert data["trade"]["remaining_units"] == 0
        assert data["trade"]["exit_type"] == "tp"
        assert data["trade"]["exit_date"] == "2025-02-01"
        # Weighted exit price: (110*50 + 120*30 + 130*20) / 100 = 117.0
        assert data["trade"]["exit_price"] == 117.0

        # SL level should be cancelled
        sl_level = next(l for l in data["trade"]["exit_levels"] if l["level_type"] == "sl")
        assert sl_level["status"] == "cancelled"

    def test_breakeven_move_on_tp_hit(
        self,
        client: TestClient,
        db_session: Session,
        sample_layered_trade_with_be: Trade,
        auth_headers: dict[str, str],
    ) -> None:
        """When a TP level with move_sl_to_breakeven is hit, SL levels should move to entry price."""
        trade = sample_layered_trade_with_be
        tp1 = next(
            l for l in trade.exit_levels
            if l.level_type == ExitLevelType.TP and l.order_index == 1
        )
        assert tp1.move_sl_to_breakeven is True

        response = client.patch(
            f"/api/trades/{trade.id}/exit-levels/{tp1.id}/hit",
            json={"hit_date": "2025-02-01"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()

        # SL level should have moved to entry price (100.0)
        sl_level = next(l for l in data["trade"]["exit_levels"] if l["level_type"] == "sl")
        assert sl_level["price"] == 100.0  # entry price

    def test_reject_non_open_trade(
        self,
        client: TestClient,
        db_session: Session,
        sample_layered_trade_with_levels: Trade,
        auth_headers: dict[str, str],
    ) -> None:
        """Cannot mark level hit on a non-open trade."""
        trade = sample_layered_trade_with_levels
        trade.status = TradeStatus.CLOSE
        db_session.commit()

        tp_level = next(
            l for l in trade.exit_levels
            if l.level_type == ExitLevelType.TP and l.order_index == 1
        )

        response = client.patch(
            f"/api/trades/{trade.id}/exit-levels/{tp_level.id}/hit",
            json={"hit_date": "2025-02-01"},
            headers=auth_headers,
        )
        assert response.status_code == 400
        assert "open" in response.json()["detail"].lower()

    def test_reject_non_pending_level(
        self,
        client: TestClient,
        db_session: Session,
        sample_layered_trade_with_levels: Trade,
        auth_headers: dict[str, str],
    ) -> None:
        """Cannot mark a non-pending level as hit."""
        trade = sample_layered_trade_with_levels
        tp_level = next(
            l for l in trade.exit_levels
            if l.level_type == ExitLevelType.TP and l.order_index == 1
        )
        tp_level.status = ExitLevelStatus.CANCELLED
        db_session.commit()

        response = client.patch(
            f"/api/trades/{trade.id}/exit-levels/{tp_level.id}/hit",
            json={"hit_date": "2025-02-01"},
            headers=auth_headers,
        )
        assert response.status_code == 400
        assert "pending" in response.json()["detail"].lower()

    def test_reject_nonexistent_level(
        self,
        client: TestClient,
        db_session: Session,
        sample_layered_trade_with_levels: Trade,
        auth_headers: dict[str, str],
    ) -> None:
        """Cannot mark a non-existent level."""
        response = client.patch(
            f"/api/trades/{sample_layered_trade_with_levels.id}/exit-levels/9999/hit",
            json={"hit_date": "2025-02-01"},
            headers=auth_headers,
        )
        assert response.status_code == 404


class TestRevertExitLevelHit:
    """Tests for DELETE /{trade_id}/exit-levels/{level_id}/hit."""

    def test_revert_hit_level(
        self,
        client: TestClient,
        db_session: Session,
        sample_layered_trade_with_levels: Trade,
        auth_headers: dict[str, str],
    ) -> None:
        """Revert a hit level back to pending."""
        trade = sample_layered_trade_with_levels
        tp_level = next(
            l for l in trade.exit_levels
            if l.level_type == ExitLevelType.TP and l.order_index == 1
        )

        # First mark it as hit
        client.patch(
            f"/api/trades/{trade.id}/exit-levels/{tp_level.id}/hit",
            json={"hit_date": "2025-02-01"},
            headers=auth_headers,
        )

        # Now revert it
        response = client.delete(
            f"/api/trades/{trade.id}/exit-levels/{tp_level.id}/hit",
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()

        assert data["trade"]["remaining_units"] == 100  # restored
        reverted_level = next(l for l in data["trade"]["exit_levels"] if l["id"] == tp_level.id)
        assert reverted_level["status"] == "pending"
        assert reverted_level["hit_date"] is None
        assert reverted_level["units_closed"] is None

    def test_reject_revert_pending_level(
        self,
        client: TestClient,
        db_session: Session,
        sample_layered_trade_with_levels: Trade,
        auth_headers: dict[str, str],
    ) -> None:
        """Cannot revert a pending level."""
        trade = sample_layered_trade_with_levels
        tp_level = next(
            l for l in trade.exit_levels
            if l.level_type == ExitLevelType.TP and l.order_index == 1
        )

        response = client.delete(
            f"/api/trades/{trade.id}/exit-levels/{tp_level.id}/hit",
            headers=auth_headers,
        )
        assert response.status_code == 400
        assert "hit" in response.json()["detail"].lower()

    def test_reject_revert_on_closed_trade(
        self,
        client: TestClient,
        db_session: Session,
        sample_layered_trade_with_levels: Trade,
        auth_headers: dict[str, str],
    ) -> None:
        """Cannot revert a level on a closed trade."""
        trade = sample_layered_trade_with_levels
        tp_level = next(
            l for l in trade.exit_levels
            if l.level_type == ExitLevelType.TP and l.order_index == 1
        )

        # Mark as hit first
        tp_level.status = ExitLevelStatus.HIT
        tp_level.hit_date = date(2025, 2, 1)
        tp_level.units_closed = 50
        trade.status = TradeStatus.CLOSE
        db_session.commit()

        response = client.delete(
            f"/api/trades/{trade.id}/exit-levels/{tp_level.id}/hit",
            headers=auth_headers,
        )
        assert response.status_code == 400
        assert "open" in response.json()["detail"].lower()
