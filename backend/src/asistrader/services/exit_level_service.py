"""Exit level service for layered SL/TP management."""

from datetime import date

from sqlalchemy.orm import Session

from asistrader.models.db import ExitLevel, ExitLevelStatus, ExitLevelType, Trade


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
