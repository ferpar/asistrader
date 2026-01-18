"""Trade business logic service."""

from sqlalchemy.orm import Session, joinedload

from asistrader.models.db import Trade


def get_all_trades(db: Session) -> list[Trade]:
    """Get all trades from the database."""
    return db.query(Trade).options(joinedload(Trade.strategy_rel)).all()


def get_trade_by_id(db: Session, trade_id: int) -> Trade | None:
    """Get a single trade by ID."""
    return db.query(Trade).filter(Trade.id == trade_id).first()
