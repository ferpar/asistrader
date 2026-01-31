"""Exit level service for layered SL/TP management."""

from datetime import date

from sqlalchemy.orm import Session

from asistrader.models.db import ExitLevel, ExitLevelStatus, ExitLevelType, ExitType, Trade, TradeStatus


class ExitLevelValidationError(Exception):
    """Raised when exit level validation fails."""

    pass


def create_exit_levels(
    db: Session,
    trade_id: int,
    levels_data: list[dict],
) -> list[ExitLevel]:
    """
    Create exit levels for a trade.

    Args:
        db: Database session
        trade_id: ID of the trade to attach levels to
        levels_data: List of dicts with level_type, price, units_pct, move_sl_to_breakeven

    Returns:
        List of created ExitLevel objects

    Raises:
        ExitLevelValidationError: If levels don't sum to 100% per type
    """
    # Validate percentages sum to 100% for each type
    tp_levels = [l for l in levels_data if l["level_type"] == "tp"]
    sl_levels = [l for l in levels_data if l["level_type"] == "sl"]

    if tp_levels:
        tp_sum = sum(l["units_pct"] for l in tp_levels)
        if abs(tp_sum - 1.0) > 0.001:
            raise ExitLevelValidationError(
                f"Take Profit levels must sum to 100%, got {tp_sum * 100:.1f}%"
            )

    if sl_levels:
        sl_sum = sum(l["units_pct"] for l in sl_levels)
        if abs(sl_sum - 1.0) > 0.001:
            raise ExitLevelValidationError(
                f"Stop Loss levels must sum to 100%, got {sl_sum * 100:.1f}%"
            )

    # Create levels with proper order_index
    created_levels: list[ExitLevel] = []

    # Track order_index per type
    tp_index = 0
    sl_index = 0

    for level_data in levels_data:
        level_type = ExitLevelType(level_data["level_type"])
        if level_type == ExitLevelType.TP:
            tp_index += 1
            order_index = tp_index
        else:
            sl_index += 1
            order_index = sl_index

        level = ExitLevel(
            trade_id=trade_id,
            level_type=level_type,
            price=level_data["price"],
            units_pct=level_data["units_pct"],
            order_index=order_index,
            status=ExitLevelStatus.PENDING,
            move_sl_to_breakeven=level_data.get("move_sl_to_breakeven", False),
        )
        db.add(level)
        created_levels.append(level)

    db.commit()
    for level in created_levels:
        db.refresh(level)

    return created_levels


def mark_level_hit(
    db: Session,
    level_id: int,
    hit_date: date,
    units_closed: int,
) -> ExitLevel:
    """
    Mark an exit level as hit.

    Args:
        db: Database session
        level_id: ID of the level to mark
        hit_date: Date when the level was hit
        units_closed: Number of units closed by this level

    Returns:
        Updated ExitLevel object

    Raises:
        ExitLevelValidationError: If level is already hit or doesn't exist
    """
    level = db.query(ExitLevel).filter(ExitLevel.id == level_id).first()

    if not level:
        raise ExitLevelValidationError(f"Exit level with id {level_id} not found")

    if level.status == ExitLevelStatus.HIT:
        raise ExitLevelValidationError(f"Exit level {level_id} is already hit")

    if level.status == ExitLevelStatus.CANCELLED:
        raise ExitLevelValidationError(f"Exit level {level_id} is cancelled")

    level.status = ExitLevelStatus.HIT
    level.hit_date = hit_date
    level.units_closed = units_closed

    db.commit()
    db.refresh(level)
    return level


def cancel_remaining_levels(db: Session, trade_id: int) -> list[ExitLevel]:
    """
    Cancel all pending exit levels for a trade.

    Used when a trade is manually closed.

    Args:
        db: Database session
        trade_id: ID of the trade

    Returns:
        List of cancelled levels
    """
    levels = (
        db.query(ExitLevel)
        .filter(
            ExitLevel.trade_id == trade_id,
            ExitLevel.status == ExitLevelStatus.PENDING,
        )
        .all()
    )

    for level in levels:
        level.status = ExitLevelStatus.CANCELLED

    db.commit()
    return levels


def get_pending_levels(
    db: Session,
    trade_id: int,
    level_type: ExitLevelType | None = None,
) -> list[ExitLevel]:
    """
    Get all pending exit levels for a trade.

    Args:
        db: Database session
        trade_id: ID of the trade
        level_type: Optional filter by level type

    Returns:
        List of pending levels ordered by order_index
    """
    query = db.query(ExitLevel).filter(
        ExitLevel.trade_id == trade_id,
        ExitLevel.status == ExitLevelStatus.PENDING,
    )

    if level_type:
        query = query.filter(ExitLevel.level_type == level_type)

    return query.order_by(ExitLevel.order_index).all()


def get_hit_levels(db: Session, trade_id: int) -> list[ExitLevel]:
    """
    Get all hit exit levels for a trade.

    Args:
        db: Database session
        trade_id: ID of the trade

    Returns:
        List of hit levels
    """
    return (
        db.query(ExitLevel)
        .filter(
            ExitLevel.trade_id == trade_id,
            ExitLevel.status == ExitLevelStatus.HIT,
        )
        .order_by(ExitLevel.hit_date)
        .all()
    )


def replace_exit_levels(
    db: Session,
    trade_id: int,
    levels_data: list[dict] | None,
) -> tuple[list[ExitLevel], bool]:
    """
    Replace all PENDING exit levels for a trade.

    Args:
        db: Database session
        trade_id: ID of the trade
        levels_data: New levels data, or None to remove layered mode

    Returns:
        Tuple of (created levels, is_layered)
    """
    # Delete existing PENDING levels (preserve HIT levels for history)
    db.query(ExitLevel).filter(
        ExitLevel.trade_id == trade_id,
        ExitLevel.status == ExitLevelStatus.PENDING,
    ).delete()

    if not levels_data or len(levels_data) == 0:
        db.commit()
        return [], False

    # Create new levels using existing create_exit_levels function
    created = create_exit_levels(db, trade_id, levels_data)
    return created, True


def apply_manual_level_hit(
    db: Session,
    trade: Trade,
    level: ExitLevel,
    hit_date: date,
    hit_price: float | None = None,
) -> Trade:
    """
    Manually mark an exit level as hit and update the trade.

    Args:
        db: Database session
        trade: The trade owning the level
        level: The exit level to mark as hit
        hit_date: Date the level was hit
        hit_price: Optional override for actual hit price

    Returns:
        Updated Trade object
    """
    # Calculate units closed
    units_closed = round(trade.units * level.units_pct)

    # Mark level as hit
    mark_level_hit(db, level.id, hit_date, units_closed)

    # Override price if provided
    if hit_price is not None:
        level.price = hit_price

    # Decrement remaining units
    if trade.remaining_units is None:
        trade.remaining_units = trade.units
    trade.remaining_units -= units_closed

    # Move SL to breakeven if configured and level is TP
    if level.move_sl_to_breakeven and level.level_type == ExitLevelType.TP:
        for sl_level in trade.exit_levels:
            if sl_level.level_type == ExitLevelType.SL and sl_level.status == ExitLevelStatus.PENDING:
                sl_level.price = trade.entry_price

    # Check if trade should be fully closed
    if trade.remaining_units is not None and trade.remaining_units <= 0:
        trade.status = TradeStatus.CLOSE
        # Calculate weighted exit price from all hit levels
        hit_levels = [l for l in trade.exit_levels if l.status == ExitLevelStatus.HIT]
        if hit_levels:
            total_closed = sum(l.units_closed or 0 for l in hit_levels)
            if total_closed > 0:
                weighted_price = sum(
                    (l.price * (l.units_closed or 0)) for l in hit_levels
                ) / total_closed
                trade.exit_price = weighted_price
            trade.exit_date = max(l.hit_date for l in hit_levels if l.hit_date)
            # Determine exit type based on majority
            tp_units = sum(l.units_closed or 0 for l in hit_levels if l.level_type == ExitLevelType.TP)
            sl_units = sum(l.units_closed or 0 for l in hit_levels if l.level_type == ExitLevelType.SL)
            trade.exit_type = ExitType.TP if tp_units >= sl_units else ExitType.SL
        # Cancel remaining pending levels
        cancel_remaining_levels(db, trade.id)

    db.commit()
    db.refresh(trade)
    return trade


def revert_level_hit(
    db: Session,
    trade: Trade,
    level: ExitLevel,
) -> Trade:
    """
    Revert a hit exit level back to pending.

    Args:
        db: Database session
        trade: The trade owning the level
        level: The exit level to revert

    Returns:
        Updated Trade object

    Raises:
        ExitLevelValidationError: If level is not hit or trade is not open
    """
    if level.status != ExitLevelStatus.HIT:
        raise ExitLevelValidationError(
            f"Cannot revert level {level.id}: status is '{level.status.value}', expected 'hit'"
        )

    if trade.status != TradeStatus.OPEN:
        raise ExitLevelValidationError(
            f"Cannot revert level on trade {trade.id}: trade status is '{trade.status.value}', expected 'open'"
        )

    # Restore remaining units
    units_to_restore = level.units_closed or 0
    if trade.remaining_units is None:
        trade.remaining_units = units_to_restore
    else:
        trade.remaining_units += units_to_restore

    # Reset level to pending
    level.status = ExitLevelStatus.PENDING
    level.hit_date = None
    level.units_closed = None

    db.commit()
    db.refresh(trade)
    return trade
