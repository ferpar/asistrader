"""Fund management business logic service."""

import logging
from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from asistrader.models.db import FundEvent, FundEventType, UserFundSettings
from asistrader.services import fx_service


DEFAULT_RISK_PCT = 0.02
DEFAULT_BASE_CURRENCY = "USD"

logger = logging.getLogger(__name__)


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


def get_base_currency(db: Session, user_id: int) -> str:
    """Get user's base/reporting currency (default 'USD')."""
    settings = db.query(UserFundSettings).filter(UserFundSettings.user_id == user_id).first()
    if settings is None:
        return DEFAULT_BASE_CURRENCY
    return settings.base_currency or DEFAULT_BASE_CURRENCY


def update_base_currency(db: Session, user_id: int, base_currency: str) -> str:
    """Update user's base currency. Creates UserFundSettings if not exists."""
    settings = db.query(UserFundSettings).filter(UserFundSettings.user_id == user_id).first()
    if settings is None:
        settings = UserFundSettings(user_id=user_id, base_currency=base_currency)
        db.add(settings)
    else:
        settings.base_currency = base_currency
    db.commit()
    return base_currency


def compute_balance(
    db: Session,
    user_id: int,
) -> dict:
    """
    Compute balance summary from events, in user's base currency.

    Each event is converted from its native currency to the user's base
    currency using the FX rate at its `event_date` (the rate at the
    transition). Used for write-time validation; the frontend has its
    own copy for display.

    Returns dict with keys: equity, committed, available, max_per_trade,
    risk_pct, base_currency.
    """
    base = get_base_currency(db, user_id)
    risk_pct = get_risk_pct(db, user_id)

    events = (
        db.query(FundEvent)
        .filter(FundEvent.user_id == user_id, FundEvent.voided == False)  # noqa: E712
        .all()
    )

    totals: dict[FundEventType, float] = {t: 0.0 for t in FundEventType}
    skipped = 0
    for event in events:
        try:
            amount_in_base = fx_service.convert(
                db, event.amount, event.currency, base, event.event_date
            )
        except fx_service.FxRateUnavailable:
            # Skip the event rather than crash the whole balance read.
            # Matches the frontend's behavior. The event will appear in
            # totals once the user runs the FX sync covering its date.
            skipped += 1
            logger.warning(
                "compute_balance: skipping event id=%s %s on %s (no FX rate for %s)",
                event.id, event.currency, event.event_date, event.currency,
            )
            continue
        totals[event.event_type] = totals.get(event.event_type, 0.0) + amount_in_base

    deposits = totals.get(FundEventType.DEPOSIT, 0.0)
    withdrawals = totals.get(FundEventType.WITHDRAWAL, 0.0)
    benefits = totals.get(FundEventType.BENEFIT, 0.0)
    losses = totals.get(FundEventType.LOSS, 0.0)
    reserves = totals.get(FundEventType.RESERVE, 0.0)

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
        "base_currency": base,
    }


# ── Commands ──


def create_deposit(
    db: Session,
    user_id: int,
    amount: float,
    description: str | None = None,
    event_date: date | None = None,
    currency: str | None = None,
) -> FundEvent:
    """Create a deposit event in the given currency (default = user's base)."""
    event = FundEvent(
        user_id=user_id,
        event_type=FundEventType.DEPOSIT,
        amount=amount,
        currency=currency or get_base_currency(db, user_id),
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
    currency: str | None = None,
) -> FundEvent:
    """Create a withdrawal event. Raises FundError if amount > available."""
    base = get_base_currency(db, user_id)
    ccy = currency or base
    today = date.today()
    balance = compute_balance(db, user_id)
    # available is in base currency; convert the request to base before comparing.
    try:
        requested_in_base = fx_service.convert(db, amount, ccy, base, today)
    except fx_service.FxRateUnavailable as exc:
        raise FundError(
            f"Cannot process withdrawal: FX rate for {ccy}/{base} is not available. "
            f"Run the ticker refresh to sync FX rates, then try again."
        ) from exc
    if requested_in_base > balance["available"]:
        raise FundError(
            f"Insufficient funds. Available: {balance['available']:.2f} {base}, "
            f"requested: {requested_in_base:.2f} {base}"
        )
    event = FundEvent(
        user_id=user_id,
        event_type=FundEventType.WITHDRAWAL,
        amount=amount,
        currency=ccy,
        description=description,
        event_date=event_date or today,
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
    currency: str | None = None,
    event_date: date | None = None,
) -> FundEvent:
    """Create a reserve event linked to a trade.

    `currency` should be the trade's ticker currency. Defaults to the user's
    base currency for safety, but trade-tied callers should always pass it.
    """
    event = FundEvent(
        user_id=user_id,
        event_type=FundEventType.RESERVE,
        amount=amount,
        currency=currency or get_base_currency(db, user_id),
        trade_id=trade_id,
        auto_detect=auto_detect,
        description=f"Reserve for trade #{trade_id}",
        event_date=event_date or date.today(),
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
    currency: str | None = None,
) -> FundEvent:
    """Create a benefit (profit) event in the given currency (default = user's base)."""
    event = FundEvent(
        user_id=user_id,
        event_type=FundEventType.BENEFIT,
        amount=amount,
        currency=currency or get_base_currency(db, user_id),
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
    currency: str | None = None,
) -> FundEvent:
    """Create a loss event in the given currency (default = user's base)."""
    event = FundEvent(
        user_id=user_id,
        event_type=FundEventType.LOSS,
        amount=amount,
        currency=currency or get_base_currency(db, user_id),
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
    trade_currency: str | None = None,
) -> None:
    """
    Check if a trade is allowed given risk limits and available funds.

    `trade_amount` is in `trade_currency` (the ticker's currency). It's
    converted to the user's base currency at today's FX rate before
    comparing against `max_per_trade` and `available` (which are already
    in base).

    Raises FundError if:
    - trade_amount > max_per_trade (equity * risk_pct)
    - trade_amount > available (equity - committed)
    """
    balance = compute_balance(db, user_id)
    base = balance["base_currency"]
    ccy = trade_currency or base
    try:
        amount_in_base = fx_service.convert(db, trade_amount, ccy, base, date.today())
    except fx_service.FxRateUnavailable as exc:
        raise FundError(
            f"Cannot validate trade: FX rate for {ccy}/{base} is not available. "
            f"Run the ticker refresh to sync FX rates, then try again."
        ) from exc

    if balance["equity"] <= 0:
        raise FundError("No funds available. Please deposit funds first.")

    if amount_in_base > balance["max_per_trade"]:
        raise FundError(
            f"Trade amount {amount_in_base:.2f} {base} exceeds max per trade "
            f"{balance['max_per_trade']:.2f} {base} ({balance['risk_pct'] * 100:.1f}% "
            f"of equity {balance['equity']:.2f} {base})"
        )

    if amount_in_base > balance["available"]:
        raise FundError(
            f"Trade amount {amount_in_base:.2f} {base} exceeds available funds "
            f"{balance['available']:.2f} {base}"
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

        ticker_currency = (
            trade.ticker_rel.currency
            if trade.ticker_rel and trade.ticker_rel.currency
            else get_base_currency(db, user_id)
        )

        # Create reserve event for ordered/open/close/canceled trades
        reserve = FundEvent(
            user_id=user_id,
            event_type=FundEventType.RESERVE,
            amount=trade.amount,
            currency=ticker_currency,
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
                    currency=ticker_currency,
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
    """Void reserve and create benefit/loss for a closed trade.

    P&L is computed in the trade's ticker currency; the resulting fund
    event is stored natively, with the FX rate at `exit_date` applied
    later at read time (or at validation time in compute_balance).
    """
    if trade.user_id is None:
        return
    void_reserve_for_trade(db, trade.user_id, trade.id)
    ticker_currency = (
        trade.ticker_rel.currency
        if trade.ticker_rel and trade.ticker_rel.currency
        else get_base_currency(db, trade.user_id)
    )
    pnl = (trade.exit_price - trade.entry_price) * trade.units
    if pnl >= 0:
        create_benefit(
            db, trade.user_id, abs(pnl),
            trade_id=trade.id, auto_detect=trade.auto_detect,
            currency=ticker_currency, event_date=trade.exit_date,
        )
    else:
        create_loss(
            db, trade.user_id, abs(pnl),
            trade_id=trade.id, auto_detect=trade.auto_detect,
            currency=ticker_currency, event_date=trade.exit_date,
        )


def repair_trade_event_currencies(
    db: Session,
    user_id: int | None = None,
) -> dict[str, int]:
    """Sync legacy USD-tagged trade-linked events to their ticker currency.

    Background: pre-migration-015 events have no currency column. After 015
    they default to 'USD' via the column server_default — including events
    on non-USD trades. This function repairs any event still on the legacy
    'USD' tag whose trade's ticker has a non-USD currency.

    Idempotent. Safe to re-run.

    Args:
        db: Database session
        user_id: If provided, repair only this user's events. None = all users.

    Returns:
        dict mapping event_type → number of rows repaired.
    """
    from asistrader.models.db import Ticker, Trade

    query = (
        db.query(FundEvent)
        .join(Trade, FundEvent.trade_id == Trade.id)
        .join(Ticker, Trade.ticker == Ticker.symbol)
        .filter(
            FundEvent.event_type.in_(
                [FundEventType.RESERVE, FundEventType.BENEFIT, FundEventType.LOSS]
            ),
            FundEvent.currency == "USD",
            Ticker.currency.isnot(None),
            Ticker.currency != "USD",
        )
    )
    if user_id is not None:
        query = query.filter(FundEvent.user_id == user_id)

    counts: dict[str, int] = {}
    for event in query.all():
        ticker_currency = event.trade_rel.ticker_rel.currency
        event.currency = ticker_currency
        key = event.event_type.value
        counts[key] = counts.get(key, 0) + 1

    db.commit()
    return counts


def handle_trade_reopen(db: Session, trade) -> None:
    """Reverse handle_trade_close: un-void the reserve and void the benefit/loss."""
    if trade.user_id is None:
        return

    # Un-void the reserve that was voided on close (most recent voided one for this trade).
    reserve = (
        db.query(FundEvent)
        .filter(
            FundEvent.user_id == trade.user_id,
            FundEvent.trade_id == trade.id,
            FundEvent.event_type == FundEventType.RESERVE,
            FundEvent.voided == True,  # noqa: E712
        )
        .order_by(FundEvent.voided_at.desc())
        .first()
    )
    if reserve is not None:
        reserve.voided = False
        reserve.voided_at = None

    # Void the non-voided benefit/loss events created on close for this trade.
    pnl_events = (
        db.query(FundEvent)
        .filter(
            FundEvent.user_id == trade.user_id,
            FundEvent.trade_id == trade.id,
            FundEvent.event_type.in_([FundEventType.BENEFIT, FundEventType.LOSS]),
            FundEvent.voided == False,  # noqa: E712
        )
        .all()
    )
    now = datetime.now(timezone.utc)
    for event in pnl_events:
        event.voided = True
        event.voided_at = now

    db.commit()
