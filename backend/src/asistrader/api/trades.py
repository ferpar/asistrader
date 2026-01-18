"""Trade API endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from asistrader.db.database import get_db
from asistrader.models.schemas import TradeListResponse, TradeSchema
from asistrader.services.trade_service import get_all_trades

router = APIRouter(prefix="/api/trades", tags=["trades"])


@router.get("", response_model=TradeListResponse)
def list_trades(db: Session = Depends(get_db)) -> TradeListResponse:
    """Get all trades."""
    trades = get_all_trades(db)
    trade_schemas = [
        TradeSchema(
            id=t.id,
            number=t.number,
            ticker=t.ticker,
            status=t.status,
            amount=t.amount,
            units=t.units,
            entry_price=t.entry_price,
            stop_loss=t.stop_loss,
            take_profit=t.take_profit,
            date_planned=t.date_planned,
            date_actual=t.date_actual,
            exit_date=t.exit_date,
            exit_type=t.exit_type,
            exit_price=t.exit_price,
            strategy_id=t.strategy_id,
            strategy_name=t.strategy_rel.name if t.strategy_rel else None,
            risk_abs=t.risk_abs,
            profit_abs=t.profit_abs,
            risk_pct=t.risk_pct,
            profit_pct=t.profit_pct,
            ratio=t.ratio,
        )
        for t in trades
    ]
    return TradeListResponse(trades=trade_schemas, count=len(trade_schemas))
