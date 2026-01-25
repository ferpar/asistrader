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
    stop_loss: float,
    take_profit: float,
    units: int,
    date_planned: date,
    strategy_id: int | None = None,
    user_id: int | None = None,
    paper_trade: bool = False,
) -> Trade:
    """Create a new trade with status=PLAN."""
    amount = entry_price * units
    trade = Trade(
        ticker=ticker,
        entry_price=entry_price,
        stop_loss=stop_loss,
        take_profit=take_profit,
        units=units,
        amount=amount,
        date_planned=date_planned,
        strategy_id=strategy_id,
        user_id=user_id,
        status=TradeStatus.PLAN,
        paper_trade=paper_trade,
    )
    db.add(trade)
    db.commit()
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
