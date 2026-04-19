"""Benchmark API endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from asistrader.db.database import get_db
from asistrader.models.schemas import (
    BenchmarkCreateRequest,
    BenchmarkCreateResponse,
    BenchmarkListResponse,
    BenchmarkMarketDataSchema,
    BenchmarkSchema,
    BenchmarkSearchResponse,
    BenchmarkSyncRequest,
    BenchmarkSyncResponse,
    BulkBenchmarkDataRequest,
    BulkBenchmarkDataResponse,
    TickerSuggestion,
)
from asistrader.services import benchmark_service
from asistrader.services.benchmark_service import (
    BenchmarkExistsError,
    BenchmarkValidationError,
)
from asistrader.services.yahoo_search_service import search_yahoo_tickers

router = APIRouter(prefix="/api/benchmarks", tags=["benchmarks"])


@router.get("", response_model=BenchmarkListResponse)
def list_benchmarks(db: Session = Depends(get_db)) -> BenchmarkListResponse:
    """List all stored benchmarks."""
    benchmarks = benchmark_service.get_all_benchmarks(db)
    return BenchmarkListResponse(
        benchmarks=[BenchmarkSchema.model_validate(b) for b in benchmarks],
        count=len(benchmarks),
    )


@router.get("/search", response_model=BenchmarkSearchResponse)
def search_benchmarks(
    q: str = Query(..., min_length=1, description="Search query"),
    db: Session = Depends(get_db),
) -> BenchmarkSearchResponse:
    """Search Yahoo Finance for index suggestions."""
    existing = {b.symbol for b in benchmark_service.get_all_benchmarks(db)}
    yahoo_results = search_yahoo_tickers(q, allowed_types=("index",))
    suggestions = [
        TickerSuggestion(
            symbol=r["symbol"],
            name=r["name"],
            exchange=r["exchange"],
            type=r["type"],
        )
        for r in yahoo_results
        if r["symbol"] not in existing
    ]
    return BenchmarkSearchResponse(suggestions=suggestions, query=q)


@router.post("", response_model=BenchmarkCreateResponse, status_code=201)
def create_new_benchmark(
    request: BenchmarkCreateRequest,
    db: Session = Depends(get_db),
) -> BenchmarkCreateResponse:
    """Validate via yfinance and create a new benchmark."""
    try:
        benchmark = benchmark_service.create_benchmark(db, request.symbol)
    except BenchmarkExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except BenchmarkValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return BenchmarkCreateResponse(
        benchmark=BenchmarkSchema.model_validate(benchmark),
        message=f"Benchmark {benchmark.symbol} created successfully",
    )


@router.delete("/{symbol}", status_code=204)
def delete_benchmark_endpoint(
    symbol: str,
    db: Session = Depends(get_db),
) -> None:
    """Delete a benchmark and its market data."""
    deleted = benchmark_service.delete_benchmark(db, symbol.upper())
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Benchmark {symbol} not found")


@router.post("/sync-all", response_model=BenchmarkSyncResponse)
def sync_all_benchmarks(
    request: BenchmarkSyncRequest,
    db: Session = Depends(get_db),
) -> BenchmarkSyncResponse:
    """Sync benchmarks from start_date to today, filling only missing gaps."""
    result = benchmark_service.sync_all(db, request.start_date, request.symbols)
    return BenchmarkSyncResponse(
        results=result["results"],
        total_rows=result["total_rows"],
        skipped=result["skipped"],
        errors=result["errors"],
    )


@router.post("/bulk", response_model=BulkBenchmarkDataResponse)
def get_bulk_benchmark_data(
    request: BulkBenchmarkDataRequest,
    db: Session = Depends(get_db),
) -> BulkBenchmarkDataResponse:
    """Get stored benchmark OHLCV for multiple symbols in a single request."""
    data: dict[str, list[BenchmarkMarketDataSchema]] = {}
    errors: dict[str, str] = {}

    for symbol in request.symbols:
        try:
            rows = benchmark_service.get_benchmark_market_data(
                db, symbol, start_date=request.start_date
            )
            data[symbol] = [BenchmarkMarketDataSchema.model_validate(r) for r in rows]
        except Exception as e:
            errors[symbol] = str(e)

    return BulkBenchmarkDataResponse(data=data, errors=errors)
