"""Trade business logic service."""

from datetime import date

from sqlalchemy.orm import Session, joinedload

from asistrader.models.db import Trade, TradeStatus


def get_all_trades(db: Session, user_id: int | None = None) -> list[Trade]:
    """Get all trades from the database, optionally filtered by user."""
    query = db.query(Trade).options(joinedload(Trade.strategy_rel))
    if user_id is not None:
        query = query.filter(Trade.user_id == user_id)
    return query.all()


def get_trade_by_id(db: Session, trade_id: int, user_id: int | None = None) -> Trade | None:
    """Get a single trade by ID, optionally filtered by user."""
    query = db.query(Trade).filter(Trade.id == trade_id)
    if user_id is not None:
        query = query.filter(Trade.user_id == user_id)
    return query.first()


def create_trade(
    db: Session,
    ticker: str,
    entry_price: float,
    units: int,
    date_planned: date,
    stop_loss: float | None = None,
    take_profit: float | None = None,
    strategy_id: int | None = None,
    user_id: int | None = None,
    paper_trade: bool = False,
    exit_levels: list[dict] | None = None,
) -> Trade:
    """
    Create a new trade with status=PLAN.

    All trades get exit_levels. If exit_levels are not provided, they're created
    from stop_loss and take_profit values.

    Args:
        db: Database session
        ticker: Ticker symbol
        entry_price: Entry price
        units: Number of units
        date_planned: Planned date
        stop_loss: Stop loss price (required if no exit_levels)
        take_profit: Take profit price (required if no exit_levels)
        strategy_id: Optional strategy ID
        user_id: Optional user ID
        paper_trade: Whether this is a paper trade
        exit_levels: Optional list of exit level dicts for layered trades

    Raises:
        ValueError: If neither exit_levels nor both stop_loss/take_profit provided
    """
    from asistrader.services.exit_level_service import create_exit_levels

    # Must have either exit_levels or stop_loss+take_profit
    if not exit_levels and (stop_loss is None or take_profit is None):
        raise ValueError("Must provide either exit_levels or both stop_loss and take_profit")

    # If no custom exit levels, create simple ones from SL/TP
    if not exit_levels:
        exit_levels = [
            {"level_type": "sl", "price": stop_loss, "units_pct": 1.0},
            {"level_type": "tp", "price": take_profit, "units_pct": 1.0},
        ]

    # More than 1 SL + 1 TP = layered (UI hint)
    is_layered = len(exit_levels) > 2

    amount = entry_price * units

    trade = Trade(
        ticker=ticker,
        entry_price=entry_price,
        units=units,
        amount=amount,
        date_planned=date_planned,
        strategy_id=strategy_id,
        user_id=user_id,
        status=TradeStatus.PLAN,
        paper_trade=paper_trade,
        is_layered=is_layered,
        remaining_units=units,
    )
    db.add(trade)
    db.commit()
    db.refresh(trade)

    # Always create exit levels
    create_exit_levels(db, trade.id, exit_levels)
    db.refresh(trade)

    return trade


class TradeUpdateError(Exception):
    """Raised when a trade update fails validation."""

    pass


def update_trade(db: Session, trade_id: int, **updates) -> Trade:
    """
    Update a trade with the given updates.

    Handles status transitions:
    - plan → open: sets date_actual if not provided
    - open → close: requires exit_price, exit_type, exit_date

    Also handles exit_levels update for layered trades.
    """
    trade = get_trade_by_id(db, trade_id)
    if not trade:
        raise TradeUpdateError(f"Trade with id {trade_id} not found")

    # Check for status transition
    new_status = updates.get("status")
    if new_status:
        current_status = trade.status

        # Validate status transitions
        if current_status == TradeStatus.PLAN and new_status == TradeStatus.OPEN:
            # plan → open: auto-set date_actual if not provided
            if "date_actual" not in updates or updates["date_actual"] is None:
                updates["date_actual"] = date.today()

        elif current_status == TradeStatus.OPEN and new_status == TradeStatus.CLOSE:
            # open → close: require exit fields
            exit_price = updates.get("exit_price") or trade.exit_price
            exit_type = updates.get("exit_type") or trade.exit_type
            exit_date = updates.get("exit_date") or trade.exit_date

            if not exit_price:
                raise TradeUpdateError("exit_price is required when closing a trade")
            if not exit_type:
                raise TradeUpdateError("exit_type is required when closing a trade")
            if not exit_date:
                updates["exit_date"] = date.today()

        elif current_status == TradeStatus.PLAN and new_status == TradeStatus.CLOSE:
            raise TradeUpdateError("Cannot close a trade that is not open. Open it first.")

        elif current_status == TradeStatus.CLOSE:
            raise TradeUpdateError("Cannot change status of a closed trade")

    # Handle exit_levels update
    exit_levels = updates.pop("exit_levels", None)
    if exit_levels is not None:
        from asistrader.services.exit_level_service import replace_exit_levels

        _, is_layered = replace_exit_levels(db, trade_id, exit_levels)
        trade.is_layered = is_layered
        if is_layered:
            trade.remaining_units = trade.units

    # Skip stop_loss and take_profit - they are computed properties now
    # Updates to SL/TP must go through exit_levels
    updates.pop("stop_loss", None)
    updates.pop("take_profit", None)

    # Apply updates
    for key, value in updates.items():
        if value is not None and hasattr(trade, key):
            setattr(trade, key, value)

    # Recalculate amount if entry_price or units changed
    if "entry_price" in updates or "units" in updates:
        trade.amount = trade.entry_price * trade.units

    db.commit()
    db.refresh(trade)
    return trade
