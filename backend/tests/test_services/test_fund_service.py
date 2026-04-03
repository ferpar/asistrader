"""Tests for the fund service."""

import pytest
from sqlalchemy.orm import Session

from asistrader.models.db import FundEvent, FundEventType, Ticker, Trade, TradeStatus, User
from asistrader.services.fund_service import (
    FundError,
    check_trade_allowed,
    compute_balance,
    create_benefit,
    create_deposit,
    create_loss,
    create_reserve,
    create_withdrawal,
    rebuild_events_from_trades,
    get_risk_pct,
    update_risk_pct,
    void_event,
    void_reserve_for_trade,
)


def test_deposit_creates_event(db_session: Session, sample_user: User) -> None:
    """Test deposit creates a fund event."""
    event = create_deposit(db_session, sample_user.id, 10000.0, "Initial deposit")
    assert event.event_type == FundEventType.DEPOSIT
    assert event.amount == 10000.0
    assert event.user_id == sample_user.id
    assert event.description == "Initial deposit"
    assert event.voided is False


def test_withdrawal_creates_event(db_session: Session, sample_user: User) -> None:
    """Test withdrawal creates a fund event."""
    create_deposit(db_session, sample_user.id, 10000.0)
    event = create_withdrawal(db_session, sample_user.id, 3000.0, "Cash out")
    assert event.event_type == FundEventType.WITHDRAWAL
    assert event.amount == 3000.0


def test_withdrawal_exceeds_available_raises(db_session: Session, sample_user: User) -> None:
    """Test withdrawal exceeding available funds raises error."""
    create_deposit(db_session, sample_user.id, 1000.0)
    with pytest.raises(FundError, match="Insufficient funds"):
        create_withdrawal(db_session, sample_user.id, 1500.0)


def test_compute_balance_basic(db_session: Session, sample_user: User) -> None:
    """Test basic balance computation with deposits only."""
    create_deposit(db_session, sample_user.id, 10000.0)
    balance = compute_balance(db_session, sample_user.id)
    assert balance["equity"] == 10000.0
    assert balance["committed"] == 0.0
    assert balance["available"] == 10000.0


def test_compute_balance_with_reserves(db_session: Session, sample_user: User) -> None:
    """Test balance with reserves (committed funds)."""
    create_deposit(db_session, sample_user.id, 10000.0)
    create_reserve(db_session, sample_user.id, trade_id=1, amount=2000.0)
    balance = compute_balance(db_session, sample_user.id)
    assert balance["equity"] == 10000.0
    assert balance["committed"] == 2000.0
    assert balance["available"] == 8000.0


def test_compute_balance_with_benefit_loss(db_session: Session, sample_user: User) -> None:
    """Test balance with benefit and loss events."""
    create_deposit(db_session, sample_user.id, 10000.0)
    create_benefit(db_session, sample_user.id, 500.0)
    create_loss(db_session, sample_user.id, 200.0)
    balance = compute_balance(db_session, sample_user.id)
    assert balance["equity"] == 10300.0  # 10000 + 500 - 200


def test_voided_events_excluded(db_session: Session, sample_user: User) -> None:
    """Test that voided events are excluded from balance."""
    event = create_deposit(db_session, sample_user.id, 10000.0)
    void_event(db_session, event.id, sample_user.id)
    balance = compute_balance(db_session, sample_user.id)
    assert balance["equity"] == 0.0


def test_auto_detect_events_included_in_balance(db_session: Session, sample_user: User) -> None:
    """Test that auto_detect events are included in the balance like any other event."""
    create_deposit(db_session, sample_user.id, 10000.0)
    event = FundEvent(
        user_id=sample_user.id,
        event_type=FundEventType.RESERVE,
        amount=500.0,
        auto_detect=True,
        trade_id=1,
    )
    db_session.add(event)
    db_session.commit()

    balance = compute_balance(db_session, sample_user.id)
    assert balance["committed"] == 500.0


def test_check_trade_allowed_passes(db_session: Session, sample_user: User) -> None:
    """Test risk check passes for valid trade."""
    create_deposit(db_session, sample_user.id, 10000.0)
    # Default risk_pct=0.02, max_per_trade=200
    check_trade_allowed(db_session, sample_user.id, 200.0)  # Should not raise


def test_check_trade_allowed_exceeds_max_per_trade(
    db_session: Session, sample_user: User
) -> None:
    """Test risk check blocks trade exceeding max per trade."""
    create_deposit(db_session, sample_user.id, 10000.0)
    # Default risk_pct=0.02, max_per_trade=200
    with pytest.raises(FundError, match="exceeds max per trade"):
        check_trade_allowed(db_session, sample_user.id, 300.0)


def test_check_trade_allowed_exceeds_available(
    db_session: Session, sample_user: User
) -> None:
    """Test risk check blocks trade exceeding available funds."""
    create_deposit(db_session, sample_user.id, 1000.0)
    update_risk_pct(db_session, sample_user.id, 0.5)  # 50% so max_per_trade=500
    create_reserve(db_session, sample_user.id, trade_id=1, amount=900.0)
    # available = 1000 - 900 = 100
    with pytest.raises(FundError, match="exceeds available funds"):
        check_trade_allowed(db_session, sample_user.id, 200.0)


def test_check_trade_allowed_no_funds(db_session: Session, sample_user: User) -> None:
    """Test risk check blocks trade when no funds."""
    with pytest.raises(FundError, match="No funds available"):
        check_trade_allowed(db_session, sample_user.id, 100.0)


def test_void_reserve_for_trade(db_session: Session, sample_user: User) -> None:
    """Test voiding a reserve event for a trade."""
    create_deposit(db_session, sample_user.id, 10000.0)
    create_reserve(db_session, sample_user.id, trade_id=42, amount=1000.0)
    voided = void_reserve_for_trade(db_session, sample_user.id, trade_id=42)
    assert voided is not None
    assert voided.voided is True
    assert voided.voided_at is not None

    balance = compute_balance(db_session, sample_user.id)
    assert balance["committed"] == 0.0


def test_void_event_already_voided(db_session: Session, sample_user: User) -> None:
    """Test voiding an already voided event raises error."""
    event = create_deposit(db_session, sample_user.id, 1000.0)
    void_event(db_session, event.id, sample_user.id)
    with pytest.raises(FundError, match="already voided"):
        void_event(db_session, event.id, sample_user.id)


def test_void_trade_linked_event_blocked(db_session: Session, sample_user: User) -> None:
    """Test that voiding a trade-linked event (reserve/benefit/loss) is blocked."""
    reserve = create_reserve(db_session, sample_user.id, trade_id=1, amount=1000.0)
    with pytest.raises(FundError, match="Only deposit and withdrawal"):
        void_event(db_session, reserve.id, sample_user.id)

    benefit = create_benefit(db_session, sample_user.id, 500.0)
    with pytest.raises(FundError, match="Only deposit and withdrawal"):
        void_event(db_session, benefit.id, sample_user.id)


def test_risk_pct_default(db_session: Session, sample_user: User) -> None:
    """Test default risk_pct is 0.02."""
    assert get_risk_pct(db_session, sample_user.id) == 0.02


def test_update_risk_pct(db_session: Session, sample_user: User) -> None:
    """Test updating risk_pct."""
    update_risk_pct(db_session, sample_user.id, 0.05)
    assert get_risk_pct(db_session, sample_user.id) == 0.05
    # Update again
    update_risk_pct(db_session, sample_user.id, 0.01)
    assert get_risk_pct(db_session, sample_user.id) == 0.01


def test_max_per_trade_with_custom_risk_pct(
    db_session: Session, sample_user: User
) -> None:
    """Test max_per_trade uses custom risk_pct."""
    create_deposit(db_session, sample_user.id, 10000.0)
    update_risk_pct(db_session, sample_user.id, 0.05)
    balance = compute_balance(db_session, sample_user.id)
    assert balance["max_per_trade"] == 500.0  # 10000 * 0.05


# --- Rebuild tests ---


def _create_raw_trade(
    db_session: Session, ticker: Ticker, user: User,
    status: TradeStatus, exit_price: float | None = None,
) -> Trade:
    """Create a trade directly (bypassing fund hooks) for rebuild tests."""
    from datetime import date as d

    trade = Trade(
        ticker=ticker.symbol,
        status=status,
        amount=1000.0,
        units=10,
        entry_price=100.0,
        date_planned=d(2025, 1, 15),
        user_id=user.id,
        remaining_units=10,
        exit_price=exit_price,
        exit_date=d(2025, 2, 1) if exit_price else None,
    )
    db_session.add(trade)
    db_session.commit()
    return trade


def test_rebuild_creates_reserve_for_open_trade(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Rebuild creates a reserve event for an open trade."""
    trade = _create_raw_trade(db_session, sample_ticker, sample_user, TradeStatus.OPEN)
    result = rebuild_events_from_trades(db_session, sample_user.id)
    assert result["events_created"] == 1
    assert result["trades_skipped"] == 0

    events = db_session.query(FundEvent).filter(FundEvent.trade_id == trade.id).all()
    assert len(events) == 1
    assert events[0].event_type == FundEventType.RESERVE
    assert events[0].voided is False


def test_rebuild_creates_voided_reserve_and_benefit_for_closed_trade(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Rebuild creates voided reserve + benefit for a profitable closed trade."""
    trade = _create_raw_trade(
        db_session, sample_ticker, sample_user, TradeStatus.CLOSE, exit_price=110.0
    )
    result = rebuild_events_from_trades(db_session, sample_user.id)
    assert result["events_created"] == 2  # reserve + benefit

    events = db_session.query(FundEvent).filter(FundEvent.trade_id == trade.id).all()
    reserve = [e for e in events if e.event_type == FundEventType.RESERVE][0]
    benefit = [e for e in events if e.event_type == FundEventType.BENEFIT][0]
    assert reserve.voided is True
    assert benefit.amount == 100.0  # (110 - 100) * 10


def test_rebuild_creates_voided_reserve_and_loss_for_losing_trade(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Rebuild creates voided reserve + loss for a losing closed trade."""
    trade = _create_raw_trade(
        db_session, sample_ticker, sample_user, TradeStatus.CLOSE, exit_price=95.0
    )
    rebuild_events_from_trades(db_session, sample_user.id)

    events = db_session.query(FundEvent).filter(FundEvent.trade_id == trade.id).all()
    loss = [e for e in events if e.event_type == FundEventType.LOSS][0]
    assert loss.amount == 50.0  # (100 - 95) * 10


def test_rebuild_skips_trades_with_existing_events(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Rebuild skips trades that already have fund events."""
    trade = _create_raw_trade(db_session, sample_ticker, sample_user, TradeStatus.OPEN)
    create_reserve(db_session, sample_user.id, trade.id, 1000.0)

    result = rebuild_events_from_trades(db_session, sample_user.id)
    assert result["trades_skipped"] == 1
    assert result["events_created"] == 0


def test_rebuild_handles_canceled_trade(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Rebuild creates a voided reserve for a canceled trade."""
    trade = _create_raw_trade(db_session, sample_ticker, sample_user, TradeStatus.CANCELED)
    rebuild_events_from_trades(db_session, sample_user.id)

    events = db_session.query(FundEvent).filter(FundEvent.trade_id == trade.id).all()
    assert len(events) == 1
    assert events[0].event_type == FundEventType.RESERVE
    assert events[0].voided is True
