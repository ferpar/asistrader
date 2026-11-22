"""Ticker API endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from asistrader.auth.dependencies import get_current_user
from asistrader.db.database import get_db
from asistrader.models.schemas import (
    BackfillInstrumentMetadataRequest,
    BackfillInstrumentMetadataResponse,
    BatchPriceRequest,
    BatchPriceResponse,
    PriceData,
    TickerCreateRequest,
    TickerCreateResponse,
    TickerListResponse,
    TickerPriceResponse,
    TickerAssetClassRequest,
    TickerResponse,
    TickerSchema,
    TickerSearchResponse,
    TickerSuggestion,
)
from asistrader.services.ticker_service import (
    TickerExistsError,
    TickerNotFoundError,
    TickerValidationError,
    backfill_instrument_metadata,
    create_ticker,
    get_all_tickers,
    get_batch_prices,
    get_current_price,
    get_existing_symbols,
    set_asset_class_override,
)
from asistrader.services.yahoo_search_service import search_yahoo_tickers

router = APIRouter(
    prefix="/api/tickers",
    tags=["tickers"],
    dependencies=[Depends(get_current_user)],
)


@router.get("", response_model=TickerListResponse)
def list_tickers(db: Session = Depends(get_db)) -> TickerListResponse:
    """Get all tickers."""
    tickers = get_all_tickers(db)
    ticker_schemas = [TickerSchema.model_validate(t) for t in tickers]
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
        ticker_schema = TickerSchema.model_validate(ticker)
        return TickerCreateResponse(
            ticker=ticker_schema,
            message=f"Ticker {ticker.symbol} created successfully",
        )
    except TickerExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except TickerValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/backfill-instrument-metadata", response_model=BackfillInstrumentMetadataResponse
)
def backfill_instrument_metadata_endpoint(
    request: BackfillInstrumentMetadataRequest,
    db: Session = Depends(get_db),
) -> BackfillInstrumentMetadataResponse:
    """One-off: fill instrument type and listing country on existing tickers."""
    return BackfillInstrumentMetadataResponse(
        **backfill_instrument_metadata(db, request.symbols)
    )


@router.put("/{symbol}/asset-class", response_model=TickerResponse)
def set_asset_class(
    symbol: str,
    request: TickerAssetClassRequest,
    db: Session = Depends(get_db),
) -> TickerResponse:
    """Override the ticker's Asset Class. Tickers are global, so this applies
    to every user's Holdings of it."""
    try:
        ticker = set_asset_class_override(db, symbol, request.asset_class)
    except TickerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return TickerResponse(
        ticker=TickerSchema.model_validate(ticker),
        message=f"{ticker.symbol} classified as {request.asset_class}",
    )


@router.delete("/{symbol}/asset-class", response_model=TickerResponse)
def clear_asset_class(symbol: str, db: Session = Depends(get_db)) -> TickerResponse:
    """Clear the ticker's Asset Class override so detection applies again."""
    try:
        ticker = set_asset_class_override(db, symbol, None)
    except TickerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return TickerResponse(
        ticker=TickerSchema.model_validate(ticker),
        message=f"{ticker.symbol} Asset Class override cleared",
    )


@router.get("/{symbol}/price", response_model=TickerPriceResponse)
def get_ticker_price(symbol: str) -> TickerPriceResponse:
    """Get current price for a ticker."""
    result = get_current_price(symbol.upper())
    return TickerPriceResponse(
        symbol=symbol.upper(),
        price=result["price"],
        currency=result["currency"],
        valid=result["valid"],
    )


@router.post("/prices", response_model=BatchPriceResponse)
def get_batch_prices_endpoint(
    request: BatchPriceRequest,
    db: Session = Depends(get_db),
) -> BatchPriceResponse:
    """Get current prices for multiple tickers in one yfinance call."""
    results = get_batch_prices(request.symbols, db=db)
    prices = {
        symbol: PriceData(
            price=data["price"],
            currency=data["currency"],
            valid=data["valid"],
        )
        for symbol, data in results.items()
    }
    return BatchPriceResponse(prices=prices)
