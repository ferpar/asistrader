"""Trade API endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from asistrader.db.database import get_db
from asistrader.models.db import Trade
from asistrader.models.schemas import (
    TradeCreateRequest,
    TradeListResponse,
    TradeResponse,
    TradeSchema,
    TradeUpdateRequest,
)
from asistrader.services.ticker_service import get_ticker_by_symbol
from asistrader.services.trade_service import (
    TradeUpdateError,
    create_trade,
    get_all_trades,
    update_trade,
)

router = APIRouter(prefix="/api/trades", tags=["trades"])


def _trade_to_schema(t: Trade) -> TradeSchema:
    """Convert a Trade ORM model to a TradeSchema."""
    return TradeSchema(
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


@router.get("", response_model=TradeListResponse)
def list_trades(db: Session = Depends(get_db)) -> TradeListResponse:
    """Get all trades."""
    trades = get_all_trades(db)
    trade_schemas = [_trade_to_schema(t) for t in trades]
    return TradeListResponse(trades=trade_schemas, count=len(trade_schemas))


@router.post("", response_model=TradeResponse, status_code=201)
def create_new_trade(
    request: TradeCreateRequest, db: Session = Depends(get_db)
) -> TradeResponse:
    """Create a new trade."""
    # Validate ticker exists
    ticker = get_ticker_by_symbol(db, request.ticker)
    if not ticker:
        raise HTTPException(status_code=400, detail=f"Ticker '{request.ticker}' not found")

    trade = create_trade(
        db=db,
        ticker=request.ticker,
        entry_price=request.entry_price,
        stop_loss=request.stop_loss,
        take_profit=request.take_profit,
        units=request.units,
        date_planned=request.date_planned,
        strategy_id=request.strategy_id,
    )

    return TradeResponse(trade=_trade_to_schema(trade), message="Trade created successfully")


@router.patch("/{trade_id}", response_model=TradeResponse)
def update_existing_trade(
    trade_id: int, request: TradeUpdateRequest, db: Session = Depends(get_db)
) -> TradeResponse:
    """Update an existing trade."""
    # Convert request to dict, excluding None values
    updates = request.model_dump(exclude_none=True)

    try:
        trade = update_trade(db, trade_id, **updates)
    except TradeUpdateError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return TradeResponse(trade=_trade_to_schema(trade), message="Trade updated successfully")
