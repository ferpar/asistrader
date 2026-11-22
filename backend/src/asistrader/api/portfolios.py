"""Portfolio API endpoints.

Portfolios are private to their owner: every endpoint is scoped to the
authenticated user, and another user's Portfolio answers 404.
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from asistrader.auth.dependencies import get_current_user
from asistrader.db.database import get_db
from asistrader.models.db import User
from asistrader.models.schemas import (
    PortfolioCreateRequest,
    PortfolioImportRequest,
    PortfolioImportResponse,
    PortfolioImportRowResult,
    PortfolioListResponse,
    PortfolioResponse,
    PortfolioSchema,
    PortfolioSummarySchema,
    PortfolioTransactionCreateRequest,
    PortfolioTransactionListResponse,
    PortfolioTransactionResponse,
    PortfolioTransactionSchema,
    PortfolioUpdateRequest,
)
from asistrader.services import portfolio_import_service, portfolio_service
from asistrader.services.portfolio_computation_service import PortfolioReplayError
from asistrader.services.portfolio_import_service import ImportFileError
from asistrader.services.portfolio_service import (
    PortfolioNameExistsError,
    PortfolioNotFoundError,
    TransactionNotFoundError,
)
from asistrader.services.ticker_service import TickerValidationError

router = APIRouter(prefix="/api/portfolios", tags=["portfolios"])


@router.get("", response_model=PortfolioListResponse)
def list_portfolios(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PortfolioListResponse:
    portfolios = portfolio_service.list_portfolios(db, current_user.id)
    schemas = [PortfolioSchema.model_validate(p) for p in portfolios]
    return PortfolioListResponse(portfolios=schemas, count=len(schemas))


@router.post("", response_model=PortfolioResponse, status_code=201)
def create_portfolio(
    request: PortfolioCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PortfolioResponse:
    try:
        portfolio = portfolio_service.create_portfolio(
            db, current_user.id, request.name, request.currency
        )
    except PortfolioNameExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return PortfolioResponse(
        portfolio=PortfolioSchema.model_validate(portfolio),
        message=f"Portfolio '{portfolio.name}' created",
    )


@router.get("/{portfolio_id}", response_model=PortfolioSchema)
def get_portfolio(
    portfolio_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PortfolioSchema:
    try:
        portfolio = portfolio_service.get_portfolio(db, current_user.id, portfolio_id)
    except PortfolioNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return PortfolioSchema.model_validate(portfolio)


@router.patch("/{portfolio_id}", response_model=PortfolioResponse)
def rename_portfolio(
    portfolio_id: int,
    request: PortfolioUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PortfolioResponse:
    try:
        portfolio = portfolio_service.rename_portfolio(
            db, current_user.id, portfolio_id, request.name
        )
    except PortfolioNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PortfolioNameExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return PortfolioResponse(
        portfolio=PortfolioSchema.model_validate(portfolio),
        message=f"Portfolio renamed to '{portfolio.name}'",
    )


@router.delete("/{portfolio_id}", status_code=204)
def delete_portfolio(
    portfolio_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    try:
        portfolio_service.delete_portfolio(db, current_user.id, portfolio_id)
    except PortfolioNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return Response(status_code=204)


# ── Transactions ──


@router.get("/{portfolio_id}/transactions", response_model=PortfolioTransactionListResponse)
def list_transactions(
    portfolio_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PortfolioTransactionListResponse:
    try:
        transactions = portfolio_service.list_transactions(db, current_user.id, portfolio_id)
    except PortfolioNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    schemas = [PortfolioTransactionSchema.model_validate(t) for t in transactions]
    return PortfolioTransactionListResponse(transactions=schemas, count=len(schemas))


@router.post(
    "/{portfolio_id}/transactions",
    response_model=PortfolioTransactionResponse,
    status_code=201,
)
def create_transaction(
    portfolio_id: int,
    request: PortfolioTransactionCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PortfolioTransactionResponse:
    if request.date > date.today():
        raise HTTPException(status_code=422, detail="A Transaction can't be in the future")
    try:
        transaction = portfolio_service.create_buy(
            db,
            current_user.id,
            portfolio_id,
            on_date=request.date,
            ticker=request.ticker,
            units=request.units,
            price=request.price,
            fees=request.fees,
            fx_rate=request.fx_rate,
        )
    except PortfolioNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except TickerValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PortfolioReplayError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return PortfolioTransactionResponse(
        transaction=PortfolioTransactionSchema.model_validate(transaction),
        message=f"Buy of {transaction.ticker} recorded",
    )


@router.post(
    "/{portfolio_id}/transactions/import", response_model=PortfolioImportResponse
)
def import_transactions(
    portfolio_id: int,
    request: PortfolioImportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PortfolioImportResponse:
    """Import Buys from CSV text. Each row succeeds or fails on its own: valid
    rows are recorded, failing rows are reported with a reason."""
    try:
        results = portfolio_import_service.import_csv(
            db, current_user.id, portfolio_id, request.csv
        )
    except PortfolioNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ImportFileError as e:
        raise HTTPException(status_code=422, detail=str(e))
    rows = [
        PortfolioImportRowResult(
            row=r.row,
            status=r.status,
            transaction=(
                PortfolioTransactionSchema.model_validate(r.transaction)
                if r.transaction is not None
                else None
            ),
            error=r.error,
        )
        for r in results
    ]
    created = sum(1 for r in rows if r.status == "created")
    return PortfolioImportResponse(
        results=rows, created=created, failed=len(rows) - created
    )


@router.delete("/{portfolio_id}/transactions/{transaction_id}", status_code=204)
def delete_transaction(
    portfolio_id: int,
    transaction_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    try:
        portfolio_service.delete_transaction(
            db, current_user.id, portfolio_id, transaction_id
        )
    except (PortfolioNotFoundError, TransactionNotFoundError) as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PortfolioReplayError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return Response(status_code=204)


# ── Summary ──


@router.get("/{portfolio_id}/summary", response_model=PortfolioSummarySchema)
def get_summary(
    portfolio_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PortfolioSummarySchema:
    """Invested, Portfolio Value, Unrealized Gain and Holdings as of today."""
    try:
        summary = portfolio_service.get_summary(db, current_user.id, portfolio_id)
    except PortfolioNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PortfolioReplayError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return PortfolioSummarySchema.model_validate(summary)
