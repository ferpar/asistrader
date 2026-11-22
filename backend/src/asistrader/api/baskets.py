"""Basket API endpoints.

Every endpoint is scoped to what the authenticated user can see. Writes
(create, rename, delete, copy, add/remove member) only ever touch the user's
own Personal Baskets: Curated Baskets answer 403 to any write, and another
user's Personal Basket answers 404 so its existence never leaks.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from asistrader.auth.dependencies import get_current_user
from asistrader.db.database import get_db
from asistrader.models.db import Basket, User
from asistrader.models.schemas import (
    BasketCopyRequest,
    BasketCreateRequest,
    BasketListResponse,
    BasketMemberAddRequest,
    BasketMemberSchema,
    BasketMembersResponse,
    BasketSchema,
    BasketUpdateRequest,
    BulkMarketDataResponse,
    HoldingPortfolioSchema,
    CloseSeriesSchema,
)
from asistrader.services import basket_service, portfolio_service
from asistrader.services.basket_service import (
    BasketMemberExistsError,
    BasketMemberNotFoundError,
    BasketNameExistsError,
    BasketNotFoundError,
    BasketReadOnlyError,
    IndexSeries,
)
from asistrader.services.ticker_service import TickerValidationError

router = APIRouter(prefix="/api/baskets", tags=["baskets"])


def _columnar(series: IndexSeries) -> dict[str, list]:
    """A Basket Index in the bulk market-data series shape.

    The index is built from adjusted closes, so it is its own adjusted close:
    `adj_close` repeats `close`, letting any consumer of market-data series
    (including the Momentum Score, which reads adjusted closes) take it as is.
    """
    dates, levels = series
    return {"dates": [d.isoformat() for d in dates], "close": levels, "adj_close": levels}


@contextmanager
def _write_errors() -> Iterator[None]:
    """Map Basket write failures to HTTP.

    Unseen Basket or member → 404, Curated → 403, name taken or already a
    member → 409, symbol Yahoo doesn't know → 400.
    """
    try:
        yield
    except (BasketNotFoundError, BasketMemberNotFoundError) as e:
        raise HTTPException(status_code=404, detail=str(e))
    except BasketReadOnlyError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except (BasketMemberExistsError, BasketNameExistsError) as e:
        raise HTTPException(status_code=409, detail=str(e))
    except TickerValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))


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


@router.post("", response_model=BasketSchema, status_code=201)
def create_basket(
    request: BasketCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BasketSchema:
    """Create an empty Personal Basket, visible only to the current user."""
    with _write_errors():
        basket = basket_service.create_personal_basket(
            db, current_user.id, request.name, request.description
        )
    return _schema(basket)


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


@router.patch("/{basket_id}", response_model=BasketSchema)
def update_basket(
    basket_id: int,
    request: BasketUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BasketSchema:
    """Rename a Personal Basket or change its description."""
    with _write_errors():
        basket = basket_service.update_personal_basket(
            db, current_user.id, basket_id, request.model_dump(exclude_unset=True)
        )
    return _schema(basket)


@router.delete("/{basket_id}", status_code=204)
def delete_basket(
    basket_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    """Delete a Personal Basket and its memberships (the tickers stay)."""
    with _write_errors():
        basket_service.delete_personal_basket(db, current_user.id, basket_id)
    return Response(status_code=204)


@router.post("/{basket_id}/copy", response_model=BasketSchema, status_code=201)
def copy_basket(
    basket_id: int,
    request: BasketCopyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BasketSchema:
    """Copy a visible Basket (typically Curated) into a new Personal one."""
    with _write_errors():
        basket = basket_service.copy_basket(db, current_user.id, basket_id, request.name)
    return _schema(basket)


@router.post("/{basket_id}/members", response_model=BasketSchema, status_code=201)
def add_member(
    basket_id: int,
    request: BasketMemberAddRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BasketSchema:
    """Add a member by symbol; an unknown symbol is created and its history loaded."""
    with _write_errors():
        basket = basket_service.add_member(db, current_user.id, basket_id, request.symbol)
    return _schema(basket)


@router.delete("/{basket_id}/members/{symbol}", status_code=204)
def remove_member(
    basket_id: int,
    symbol: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    """Remove a member from a Personal Basket."""
    with _write_errors():
        basket_service.remove_member(db, current_user.id, basket_id, symbol)
    return Response(status_code=204)
