"""Ticker API endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from asistrader.db.database import get_db
from asistrader.models.schemas import TickerListResponse, TickerSchema
from asistrader.services.ticker_service import get_all_tickers

router = APIRouter(prefix="/api/tickers", tags=["tickers"])


@router.get("", response_model=TickerListResponse)
def list_tickers(db: Session = Depends(get_db)) -> TickerListResponse:
    """Get all tickers."""
    tickers = get_all_tickers(db)
    ticker_schemas = [
        TickerSchema(
            symbol=t.symbol,
            name=t.name,
            probability=t.probability,
            trend_mean_growth=t.trend_mean_growth,
            trend_std_deviation=t.trend_std_deviation,
            bias=t.bias,
            horizon=t.horizon,
            beta=t.beta,
            strategy_id=t.strategy_id,
        )
        for t in tickers
    ]
    return TickerListResponse(tickers=ticker_schemas, count=len(ticker_schemas))
