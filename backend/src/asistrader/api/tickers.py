"""Ticker API endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from asistrader.db.database import get_db
from asistrader.models.schemas import (
    TickerCreateRequest,
    TickerCreateResponse,
    TickerListResponse,
    TickerSchema,
    TickerSearchResponse,
    TickerSuggestion,
)
from asistrader.services.ticker_service import (
    TickerExistsError,
    TickerValidationError,
    create_ticker,
    get_all_tickers,
    get_existing_symbols,
)
from asistrader.services.yahoo_search_service import search_yahoo_tickers

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


@router.get("/search", response_model=TickerSearchResponse)
def search_tickers(
    q: str = Query(..., min_length=1, description="Search query"),
    db: Session = Depends(get_db),
) -> TickerSearchResponse:
    """Search Yahoo Finance for ticker suggestions, filtering out existing tickers."""
    # Get existing symbols to filter them out
    existing_symbols = get_existing_symbols(db)

    # Search Yahoo Finance
    yahoo_results = search_yahoo_tickers(q)

    # Filter out existing tickers
    suggestions = [
        TickerSuggestion(
            symbol=result["symbol"],
            name=result["name"],
            exchange=result["exchange"],
            type=result["type"],
        )
        for result in yahoo_results
        if result["symbol"] not in existing_symbols
    ]

    return TickerSearchResponse(suggestions=suggestions, query=q)


@router.post("", response_model=TickerCreateResponse, status_code=201)
def create_new_ticker(
    request: TickerCreateRequest,
    db: Session = Depends(get_db),
) -> TickerCreateResponse:
    """Validate via yfinance and create a new ticker."""
    try:
        ticker = create_ticker(db, request.symbol)
        ticker_schema = TickerSchema(
            symbol=ticker.symbol,
            name=ticker.name,
            probability=ticker.probability,
            trend_mean_growth=ticker.trend_mean_growth,
            trend_std_deviation=ticker.trend_std_deviation,
            bias=ticker.bias,
            horizon=ticker.horizon,
            beta=ticker.beta,
            strategy_id=ticker.strategy_id,
        )
        return TickerCreateResponse(
            ticker=ticker_schema,
            message=f"Ticker {ticker.symbol} created successfully",
        )
    except TickerExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except TickerValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
