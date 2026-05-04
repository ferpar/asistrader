"""FX rate API endpoints."""

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from asistrader.auth.dependencies import get_current_user
from asistrader.db.database import get_db
from asistrader.models.db import FxRate, Ticker, Trade, User, UserFundSettings
from asistrader.models.schemas import (
    FxRateSchema,
    FxRatesResponse,
    FxSyncRequest,
    FxSyncResponse,
)
from asistrader.services import fx_service

router = APIRouter(prefix="/api/fx", tags=["fx"])


def _get_user_base_currency(db: Session, user_id: int) -> str:
    settings = (
        db.query(UserFundSettings).filter(UserFundSettings.user_id == user_id).first()
    )
    return settings.base_currency if settings else "USD"


def _user_currencies(db: Session, user_id: int) -> list[str]:
    """Distinct currencies of every ticker the user has traded, plus their base."""
    rows = (
        db.query(Ticker.currency)
        .join(Trade, Trade.ticker == Ticker.symbol)
        .filter(Trade.user_id == user_id, Ticker.currency.isnot(None))
        .distinct()
        .all()
    )
    currencies = {row[0] for row in rows if row[0]}
    currencies.add(_get_user_base_currency(db, user_id))
    return sorted(currencies)


@router.get("/rates", response_model=FxRatesResponse)
def get_fx_rates(
    currencies: str = Query(..., description="Comma-separated ISO currency codes"),
    from_date: date | None = Query(None, alias="from"),
    to_date: date | None = Query(None, alias="to"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> FxRatesResponse:
    """Return stored FX rate history for the requested currencies.

    Reads only — no yfinance call. To populate gaps, hit `POST /api/fx/sync`.
    """
    requested = [c.strip().upper() for c in currencies.split(",") if c.strip()]
    out: dict[str, list[FxRateSchema]] = {}
    for currency in requested:
        if currency == "USD":
            out[currency] = []
            continue
        query = db.query(FxRate).filter(FxRate.currency == currency)
        if from_date is not None:
            query = query.filter(FxRate.date >= from_date)
        if to_date is not None:
            query = query.filter(FxRate.date <= to_date)
        rows = query.order_by(FxRate.date).all()
        out[currency] = [FxRateSchema.model_validate(r) for r in rows]
    return FxRatesResponse(rates=out)


@router.post("/sync", response_model=FxSyncResponse)
def sync_fx_rates(
    request: FxSyncRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> FxSyncResponse:
    """Fill gaps in FX rate history.

    If `currencies` is omitted, syncs the user's ticker currencies + base.
    """
    if request.currencies is None:
        currencies = _user_currencies(db, current_user.id)
    else:
        currencies = [c.strip().upper() for c in request.currencies if c.strip()]

    result = fx_service.sync_fx_all(db, currencies, request.start_date)
    return FxSyncResponse(**result)
