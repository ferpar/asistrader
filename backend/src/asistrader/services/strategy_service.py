"""Strategy business logic service."""

from sqlalchemy.orm import Session

from asistrader.models.db import Strategy, Trade


class StrategyNotFoundError(Exception):
    """Raised when a strategy is not found."""

    pass


class StrategyNameExistsError(Exception):
    """Raised when trying to create/update a strategy with a name that already exists."""

    pass


class StrategyInUseError(Exception):
    """Raised when trying to delete a strategy that has associated trades."""

    pass


def get_all_strategies(db: Session) -> list[Strategy]:
    """Get all strategies from the database ordered by name."""
    return db.query(Strategy).order_by(Strategy.name).all()


def get_strategy_by_id(db: Session, strategy_id: int) -> Strategy | None:
    """Get a single strategy by ID."""
    return db.query(Strategy).filter(Strategy.id == strategy_id).first()


def create_strategy(
    db: Session,
    name: str,
    pe_method: str | None = None,
    sl_method: str | None = None,
    tp_method: str | None = None,
    description: str | None = None,
) -> Strategy:
    """Create a new strategy.

    Args:
        db: Database session
        name: Strategy name (must be unique)
        pe_method: Price entry method
        sl_method: Stop loss method
        tp_method: Take profit method
        description: Strategy description

    Returns:
        The created Strategy object

    Raises:
        StrategyNameExistsError: If a strategy with the same name already exists
    """
    name = name.strip()

    # Check if strategy name already exists
    existing = db.query(Strategy).filter(Strategy.name == name).first()
    if existing:
        raise StrategyNameExistsError(f"Strategy with name '{name}' already exists")

    # Create the strategy
    strategy = Strategy(
        name=name,
        pe_method=pe_method,
        sl_method=sl_method,
        tp_method=tp_method,
        description=description,
    )
    db.add(strategy)
    db.commit()
    db.refresh(strategy)

    return strategy


def update_strategy(
    db: Session,
    strategy_id: int,
    name: str | None = None,
    pe_method: str | None = None,
    sl_method: str | None = None,
    tp_method: str | None = None,
    description: str | None = None,
) -> Strategy:
    """Update an existing strategy.

    Args:
        db: Database session
        strategy_id: ID of the strategy to update
        name: New name (optional, must be unique if provided)
        pe_method: New price entry method (optional)
        sl_method: New stop loss method (optional)
        tp_method: New take profit method (optional)
        description: New description (optional)

    Returns:
        The updated Strategy object

    Raises:
        StrategyNotFoundError: If the strategy doesn't exist
        StrategyNameExistsError: If the new name already exists for another strategy
    """
    strategy = get_strategy_by_id(db, strategy_id)
    if not strategy:
        raise StrategyNotFoundError(f"Strategy with ID {strategy_id} not found")

    # If name is being changed, check for uniqueness
    if name is not None:
        name = name.strip()
        existing = db.query(Strategy).filter(Strategy.name == name, Strategy.id != strategy_id).first()
        if existing:
            raise StrategyNameExistsError(f"Strategy with name '{name}' already exists")
        strategy.name = name

    # Update other fields if provided
    if pe_method is not None:
        strategy.pe_method = pe_method
    if sl_method is not None:
        strategy.sl_method = sl_method
    if tp_method is not None:
        strategy.tp_method = tp_method
    if description is not None:
        strategy.description = description

    db.commit()
    db.refresh(strategy)

    return strategy


def delete_strategy(db: Session, strategy_id: int) -> None:
    """Delete a strategy.

    Args:
        db: Database session
        strategy_id: ID of the strategy to delete

    Raises:
        StrategyNotFoundError: If the strategy doesn't exist
        StrategyInUseError: If the strategy has associated trades
    """
    strategy = get_strategy_by_id(db, strategy_id)
    if not strategy:
        raise StrategyNotFoundError(f"Strategy with ID {strategy_id} not found")

    # Check if strategy has trades
    trade_count = db.query(Trade).filter(Trade.strategy_id == strategy_id).count()
    if trade_count > 0:
        raise StrategyInUseError(
            f"Cannot delete strategy '{strategy.name}': it has {trade_count} associated trade(s)"
        )

    db.delete(strategy)
    db.commit()
