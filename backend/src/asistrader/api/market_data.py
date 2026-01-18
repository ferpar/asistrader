"""Market data API endpoints."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from asistrader.db.database import get_db
from asistrader.models.schemas import (
    BulkExtendRequest,
    BulkExtendResponse,
    BulkFetchRequest,
    BulkFetchResponse,
    ExtendMarketDataRequest,
    FetchMarketDataRequest,
    MarketDataListResponse,
    MarketDataSchema,
    SyncRequest,
    SyncResponse,
)
from asistrader.services import market_data_service

router = APIRouter(prefix="/api/market-data", tags=["market-data"])


@router.get("/{symbol}", response_model=MarketDataListResponse)
def get_market_data(
    symbol: str,
    start_date: date | None = Query(None, description="Filter by start date"),
    end_date: date | None = Query(None, description="Filter by end date"),
    db: Session = Depends(get_db),
) -> MarketDataListResponse:
    """Get stored market data for a ticker with optional date range filters."""
    data = market_data_service.get_market_data(db, symbol, start_date, end_date)
    earliest, latest = market_data_service.get_data_bounds(db, symbol)

    return MarketDataListResponse(
        data=[MarketDataSchema.model_validate(d) for d in data],
        count=len(data),
        earliest_date=earliest,
        latest_date=latest,
    )


@router.post("/{symbol}/fetch", response_model=MarketDataListResponse)
def fetch_market_data(
    symbol: str,
    request: FetchMarketDataRequest,
    db: Session = Depends(get_db),
) -> MarketDataListResponse:
    """Fetch market data from yfinance and store it."""
    try:
        count = market_data_service.fetch_and_store(
            db, symbol, request.start_date, request.end_date
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching data: {e}")

    # Return the stored data
    data = market_data_service.get_market_data(
        db, symbol, request.start_date, request.end_date
    )
    earliest, latest = market_data_service.get_data_bounds(db, symbol)

    return MarketDataListResponse(
        data=[MarketDataSchema.model_validate(d) for d in data],
        count=len(data),
        earliest_date=earliest,
        latest_date=latest,
    )


@router.post("/{symbol}/extend", response_model=MarketDataListResponse)
def extend_market_data(
    symbol: str,
    request: ExtendMarketDataRequest,
    db: Session = Depends(get_db),
) -> MarketDataListResponse:
    """Extend market data series forward or backward."""
    try:
        count = market_data_service.extend_series(
            db, symbol, request.direction, request.target_date
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error extending data: {e}")

    # Return all stored data for the ticker
    data = market_data_service.get_market_data(db, symbol)
    earliest, latest = market_data_service.get_data_bounds(db, symbol)

    return MarketDataListResponse(
        data=[MarketDataSchema.model_validate(d) for d in data],
        count=len(data),
        earliest_date=earliest,
        latest_date=latest,
    )


@router.post("/fetch-all", response_model=BulkFetchResponse)
def bulk_fetch_market_data(
    request: BulkFetchRequest,
    db: Session = Depends(get_db),
) -> BulkFetchResponse:
    """Bulk fetch market data for multiple tickers."""
    result = market_data_service.bulk_fetch(
        db, request.start_date, request.end_date, request.symbols
    )

    return BulkFetchResponse(
        results=result["results"],
        total_rows=result["total_rows"],
        errors=result["errors"],
    )


@router.post("/extend-all", response_model=BulkExtendResponse)
def bulk_extend_market_data(
    request: BulkExtendRequest,
    db: Session = Depends(get_db),
) -> BulkExtendResponse:
    """Bulk extend market data series for multiple tickers."""
    result = market_data_service.bulk_extend(
        db, request.direction, request.target_date, request.symbols
    )

    return BulkExtendResponse(
        results=result["results"],
        total_rows=result["total_rows"],
        errors=result["errors"],
    )


@router.post("/sync-all", response_model=SyncResponse)
def sync_all_market_data(
    request: SyncRequest,
    db: Session = Depends(get_db),
) -> SyncResponse:
    """Sync all tickers from start_date to today, only fetching missing data.

    For each ticker:
    - If no data exists: fetches from start_date to today
    - If data exists but doesn't cover start_date: fills backward gap
    - If data exists but doesn't cover today: fills forward gap
    - Skips tickers that already have complete data coverage
    """
    result = market_data_service.sync_all(db, request.start_date, request.symbols)

    return SyncResponse(
        results=result["results"],
        total_rows=result["total_rows"],
        skipped=result["skipped"],
        errors=result["errors"],
    )
