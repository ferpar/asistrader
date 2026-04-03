"""Fund management business logic service."""

from datetime import date, datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from asistrader.models.db import FundEvent, FundEventType, UserFundSettings


DEFAULT_RISK_PCT = 0.02


class FundError(Exception):
    """Raised when a fund operation fails validation."""

    pass


# ── Queries ──


def get_fund_events(
    db: Session,
    user_id: int,
    include_voided: bool = False,
    event_type: FundEventType | None = None,
) -> list[FundEvent]:
    """Get fund events for a user with optional filters."""
    query = db.query(FundEvent).filter(FundEvent.user_id == user_id)
    if not include_voided:
        query = query.filter(FundEvent.voided == False)  # noqa: E712
    if event_type is not None:
        query = query.filter(FundEvent.event_type == event_type)
    return query.order_by(FundEvent.event_date.desc(), FundEvent.created_at.desc()).all()


def get_risk_pct(db: Session, user_id: int) -> float:
    """Get user's risk_pct setting (default 0.02)."""
    settings = db.query(UserFundSettings).filter(UserFundSettings.user_id == user_id).first()
    if settings is None:
        return DEFAULT_RISK_PCT
    return settings.risk_pct


def compute_balance(
    db: Session,
    user_id: int,
) -> dict:
    """
    Compute balance summary from events.

    Returns dict with keys: equity, committed, available, max_per_trade, risk_pct
    """
    query = db.query(
        FundEvent.event_type,
        func.sum(FundEvent.amount).label("total"),
    ).filter(
        FundEvent.user_id == user_id,
        FundEvent.voided == False,  # noqa: E712
    )

    query = query.group_by(FundEvent.event_type)
    results = {row.event_type: row.total or 0.0 for row in query.all()}

    deposits = results.get(FundEventType.DEPOSIT, 0.0)
    withdrawals = results.get(FundEventType.WITHDRAWAL, 0.0)
    benefits = results.get(FundEventType.BENEFIT, 0.0)
    losses = results.get(FundEventType.LOSS, 0.0)
    reserves = results.get(FundEventType.RESERVE, 0.0)

    risk_pct = get_risk_pct(db, user_id)
    equity = deposits - withdrawals + benefits - losses
    committed = reserves
    available = equity - committed
    max_per_trade = equity * risk_pct

    return {
        "equity": equity,
        "committed": committed,
        "available": available,
        "max_per_trade": max_per_trade,
        "risk_pct": risk_pct,
    }


# ── Commands ──


def create_deposit(
    db: Session,
    user_id: int,
    amount: float,
    description: str | None = None,
    event_date: date | None = None,
) -> FundEvent:
    """Create a deposit event."""
    event = FundEvent(
        user_id=user_id,
        event_type=FundEventType.DEPOSIT,
        amount=amount,
        description=description,
        event_date=event_date or date.today(),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def create_withdrawal(
    db: Session,
    user_id: int,
    amount: float,
    description: str | None = None,
    event_date: date | None = None,
) -> FundEvent:
    """Create a withdrawal event. Raises FundError if amount > available."""
    balance = compute_balance(db, user_id)
    if amount > balance["available"]:
        raise FundError(
            f"Insufficient funds. Available: {balance['available']:.2f}, requested: {amount:.2f}"
        )
    event = FundEvent(
        user_id=user_id,
        event_type=FundEventType.WITHDRAWAL,
        amount=amount,
        description=description,
        event_date=event_date or date.today(),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def create_reserve(
    db: Session,
    user_id: int,
    trade_id: int,
    amount: float,
    auto_detect: bool = False,
) -> FundEvent:
    """Create a reserve event linked to a trade."""
    event = FundEvent(
        user_id=user_id,
        event_type=FundEventType.RESERVE,
        amount=amount,
        trade_id=trade_id,
        auto_detect=auto_detect,
        description=f"Reserve for trade #{trade_id}",
        event_date=date.today(),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def void_reserve_for_trade(db: Session, user_id: int, trade_id: int) -> FundEvent | None:
    """Void the active reserve event for a given trade. Returns the voided event."""
    event = (
        db.query(FundEvent)
        .filter(
            FundEvent.user_id == user_id,
            FundEvent.trade_id == trade_id,
            FundEvent.event_type == FundEventType.RESERVE,
            FundEvent.voided == False,  # noqa: E712
        )
        .first()
    )
    if event is None:
        return None
    event.voided = True
    event.voided_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(event)
    return event


def create_benefit(
    db: Session,
    user_id: int,
    amount: float,
    trade_id: int | None = None,
    auto_detect: bool = False,
    description: str | None = None,
    event_date: date | None = None,
) -> FundEvent:
    """Create a benefit (profit) event."""
    event = FundEvent(
        user_id=user_id,
        event_type=FundEventType.BENEFIT,
        amount=amount,
        trade_id=trade_id,
        auto_detect=auto_detect,
        description=description or (f"Profit from trade #{trade_id}" if trade_id else None),
        event_date=event_date or date.today(),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def create_loss(
    db: Session,
    user_id: int,
    amount: float,
    trade_id: int | None = None,
    auto_detect: bool = False,
    description: str | None = None,
    event_date: date | None = None,
) -> FundEvent:
    """Create a loss event."""
    event = FundEvent(
        user_id=user_id,
        event_type=FundEventType.LOSS,
        amount=amount,
        trade_id=trade_id,
        auto_detect=auto_detect,
        description=description or (f"Loss from trade #{trade_id}" if trade_id else None),
        event_date=event_date or date.today(),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def void_event(db: Session, event_id: int, user_id: int) -> FundEvent:
    """Void a fund event (soft-delete). Raises FundError if already voided or not found."""
    event = (
        db.query(FundEvent)
        .filter(FundEvent.id == event_id, FundEvent.user_id == user_id)
        .first()
    )
    if event is None:
        raise FundError(f"Fund event with id {event_id} not found")
    if event.event_type not in (FundEventType.DEPOSIT, FundEventType.WITHDRAWAL):
        raise FundError("Only deposit and withdrawal events can be voided manually")
    if event.voided:
        raise FundError(f"Fund event with id {event_id} is already voided")
    event.voided = True
    event.voided_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(event)
    return event


def update_risk_pct(db: Session, user_id: int, risk_pct: float) -> float:
    """Update user's risk_pct. Creates UserFundSettings if not exists."""
    settings = db.query(UserFundSettings).filter(UserFundSettings.user_id == user_id).first()
    if settings is None:
        settings = UserFundSettings(user_id=user_id, risk_pct=risk_pct)
        db.add(settings)
    else:
        settings.risk_pct = risk_pct
    db.commit()
    return risk_pct


# ── Risk Check ──


def check_trade_allowed(
    db: Session,
    user_id: int,
    trade_amount: float,
) -> None:
    """
    Check if a trade is allowed given risk limits and available funds.

    Raises FundError if:
    - trade_amount > max_per_trade (equity * risk_pct)
    - trade_amount > available (equity - committed)
    """
    balance = compute_balance(db, user_id)

    if balance["equity"] <= 0:
        raise FundError("No funds available. Please deposit funds first.")

    if trade_amount > balance["max_per_trade"]:
        raise FundError(
            f"Trade amount {trade_amount:.2f} exceeds max per trade "
            f"{balance['max_per_trade']:.2f} ({balance['risk_pct'] * 100:.1f}% of equity {balance['equity']:.2f})"
        )

    if trade_amount > balance["available"]:
        raise FundError(
            f"Trade amount {trade_amount:.2f} exceeds available funds {balance['available']:.2f}"
        )


# ── Trade Close Helper ──


def rebuild_events_from_trades(db: Session, user_id: int) -> dict:
    """
    Rebuild fund events from trade history, only filling gaps.

    For each trade that has no fund events, creates the appropriate events
    based on the trade's current status:
    - PLAN → no events (funds not yet committed)
    - ORDERED/OPEN → reserve (non-voided)
    - CLOSE → voided reserve + benefit or loss
    - CANCELED → voided reserve

    Returns a summary dict with counts.
    """
    from asistrader.models.db import Trade, TradeStatus

    trades = db.query(Trade).filter(Trade.user_id == user_id).all()

    # Find trades that already have fund events
    existing_trade_ids = set(
        row[0]
        for row in db.query(FundEvent.trade_id)
        .filter(
            FundEvent.user_id == user_id,
            FundEvent.trade_id.isnot(None),
        )
        .distinct()
        .all()
    )

    created = 0
    skipped = 0

    for trade in trades:
        if trade.id in existing_trade_ids:
            skipped += 1
            continue

        # PLAN trades have no fund events (funds not yet committed)
        if trade.status == TradeStatus.PLAN:
            skipped += 1
            continue

        # Create reserve event for ordered/open/close/canceled trades
        reserve = FundEvent(
            user_id=user_id,
            event_type=FundEventType.RESERVE,
            amount=trade.amount,
            trade_id=trade.id,
            auto_detect=trade.auto_detect,
            description=f"Reserve for trade #{trade.id} (rebuilt)",
            event_date=trade.date_actual or trade.date_planned,
        )
        db.add(reserve)
        created += 1

        if trade.status == TradeStatus.CLOSE:
            # Void the reserve
            reserve.voided = True
            reserve.voided_at = datetime.now(timezone.utc)

            # Create benefit or loss
            if trade.exit_price is not None:
                pnl = (trade.exit_price - trade.entry_price) * trade.units
                pnl_event = FundEvent(
                    user_id=user_id,
                    event_type=FundEventType.BENEFIT if pnl >= 0 else FundEventType.LOSS,
                    amount=abs(pnl),
                    trade_id=trade.id,
                    auto_detect=trade.auto_detect,
                    description=f"{'Profit' if pnl >= 0 else 'Loss'} from trade #{trade.id} (rebuilt)",
                    event_date=trade.exit_date or trade.date_planned,
                )
                db.add(pnl_event)
                created += 1

        elif trade.status == TradeStatus.CANCELED:
            # Void the reserve
            reserve.voided = True
            reserve.voided_at = datetime.now(timezone.utc)

    db.commit()

    return {
        "trades_processed": len(trades),
        "events_created": created,
        "trades_skipped": skipped,
    }


def handle_trade_close(db: Session, trade) -> None:
    """Void reserve and create benefit/loss for a closed trade."""
    if trade.user_id is None:
        return
    void_reserve_for_trade(db, trade.user_id, trade.id)
    pnl = (trade.exit_price - trade.entry_price) * trade.units
    if pnl >= 0:
        create_benefit(
            db, trade.user_id, abs(pnl),
            trade_id=trade.id, auto_detect=trade.auto_detect,
        )
    else:
        create_loss(
            db, trade.user_id, abs(pnl),
            trade_id=trade.id, auto_detect=trade.auto_detect,
        )
