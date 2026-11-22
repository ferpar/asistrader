"""Basket API endpoints.

Read-only for now: Curated Baskets are never editable through the API, and
Personal Basket writes arrive with their own ticket. Every endpoint is scoped
to what the authenticated user can see.
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from asistrader.auth.dependencies import get_current_user
from asistrader.db.database import get_db
from asistrader.models.db import Basket, User
from asistrader.models.schemas import (
    BasketListResponse,
    BasketMemberSchema,
    BasketMembersResponse,
    BasketSchema,
    BulkMarketDataResponse,
    HoldingPortfolioSchema,
    CloseSeriesSchema,
)
from asistrader.services import basket_service, portfolio_service
from asistrader.services.basket_service import BasketNotFoundError, IndexSeries

router = APIRouter(prefix="/api/baskets", tags=["baskets"])


def _columnar(series: IndexSeries) -> dict[str, list]:
    """A Basket Index in the bulk market-data series shape.

    The index is built from adjusted closes, so it is its own adjusted close:
    `adj_close` repeats `close`, letting any consumer of market-data series
    (including the Momentum Score, which reads adjusted closes) take it as is.
    """
    dates, levels = series
    return {"dates": [d.isoformat() for d in dates], "close": levels, "adj_close": levels}


def _schema(basket: Basket) -> BasketSchema:
    return BasketSchema(
        id=basket.id,
        kind=basket.kind,
        name=basket.name,
        description=basket.description,
        slug=basket.slug,
        members=[m.ticker for m in basket.members],
    )


@router.get("", response_model=BasketListResponse)
def list_baskets(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BasketListResponse:
    """Every Basket the user can see: all Curated ones plus their Personal ones."""
    baskets = [_schema(b) for b in basket_service.get_visible_baskets(db, current_user.id)]
    return BasketListResponse(baskets=baskets, count=len(baskets))


# Declared before /{basket_id} so "index" is never parsed as a Basket id.
@router.get("/index", response_model=BulkMarketDataResponse)
def get_bulk_basket_indexes(
    start_date: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JSONResponse:
    """Every visible Basket's index in one call, for the ranking page.

    Same columnar shape as POST /api/market-data/bulk, keyed by Basket id.
    Built as a plain JSONResponse so nothing is re-validated per value;
    `response_model` documents the shape.
    """
    indexes = basket_service.get_visible_basket_indexes(db, current_user.id, start_date)
    data = {str(basket_id): _columnar(series) for basket_id, series in indexes.items()}
    return JSONResponse({"data": data, "errors": {}})


@router.get("/{basket_id}", response_model=BasketSchema)
def get_basket(
    basket_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BasketSchema:
    try:
        return _schema(basket_service.get_visible_basket(db, current_user.id, basket_id))
    except BasketNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{basket_id}/index", response_model=CloseSeriesSchema)
def get_basket_index(
    basket_id: int,
    start_date: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JSONResponse:
    """One Basket's Basket Index, as one series of the bulk market-data shape."""
    try:
        series = basket_service.get_basket_index(db, current_user.id, basket_id, start_date)
    except BasketNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return JSONResponse(_columnar(series))


@router.get("/{basket_id}/members", response_model=BasketMembersResponse)
def get_basket_members(
    basket_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BasketMembersResponse:
    """A Basket's members, each with the user's Portfolios that currently hold it.

    Held-in comes from the user's own Portfolios only (current Holdings, via
    replay); a Basket the user can't see is 404.
    """
    try:
        members = basket_service.get_members(db, current_user.id, basket_id)
    except BasketNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    held = portfolio_service.portfolios_holding(db, current_user.id, {s for s, _ in members})
    items = [
        BasketMemberSchema(
            symbol=symbol,
            name=name,
            held_in=[HoldingPortfolioSchema(id=p.id, name=p.name) for p in held[symbol]],
        )
        for symbol, name in members
    ]
    return BasketMembersResponse(members=items, count=len(items))
