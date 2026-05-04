"""Fund management API endpoints."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from asistrader.auth.dependencies import get_current_user
from asistrader.db.database import get_db
from asistrader.models.db import FundEventType as DBFundEventType, User
from asistrader.services import fx_service

logger = logging.getLogger(__name__)
from asistrader.models.schemas import (
    DepositRequest,
    FundEventListResponse,
    FundEventResponse,
    FundEventSchema,
    ManualBenefitLossRequest,
    RepairCurrenciesResponse,
    RiskSettingsRequest,
    RiskSettingsResponse,
    WithdrawalRequest,
)
from asistrader.services.fund_service import (
    FundError,
    create_benefit,
    create_deposit,
    create_loss,
    create_withdrawal,
    get_base_currency,
    get_fund_events,
    get_risk_pct,
    rebuild_events_from_trades,
    repair_trade_event_currencies,
    update_base_currency,
    update_risk_pct,
    void_event,
)

router = APIRouter(prefix="/api/fund", tags=["fund"])


@router.get("/events", response_model=FundEventListResponse)
def list_events(
    include_voided: bool = Query(False),
    event_type: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FundEventListResponse:
    """List all fund events for the current user. Auto-fills gaps from trade history."""
    # Rebuild any missing events from trade history before returning
    rebuild_events_from_trades(db, current_user.id)

    # Best-effort FX sync. Idempotent — gap detection means this is a no-op
    # after the first run. Wrapped in try/except so a yfinance outage or
    # network error doesn't break the events read.
    try:
        fx_service.ensure_rates_for_user(db, current_user.id)
    except Exception as e:
        logger.warning("FX auto-sync failed during list_events: %s", e)

    db_event_type = None
    if event_type:
        try:
            db_event_type = DBFundEventType(event_type)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid event_type: {event_type}")

    events = get_fund_events(
        db,
        user_id=current_user.id,
        include_voided=include_voided,
        event_type=db_event_type,
    )
    return FundEventListResponse(
        events=[FundEventSchema.model_validate(e) for e in events],
        count=len(events),
    )


@router.post("/deposit", response_model=FundEventResponse, status_code=201)
def deposit(
    request: DepositRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FundEventResponse:
    """Deposit funds."""
    event = create_deposit(
        db,
        user_id=current_user.id,
        amount=request.amount,
        currency=request.currency,
        description=request.description,
        event_date=request.event_date,
    )
    return FundEventResponse(
        event=FundEventSchema.model_validate(event),
        message=f"Deposited {request.amount:.2f} {event.currency}",
    )


@router.post("/withdrawal", response_model=FundEventResponse, status_code=201)
def withdrawal(
    request: WithdrawalRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FundEventResponse:
    """Withdraw funds."""
    try:
        event = create_withdrawal(
            db,
            user_id=current_user.id,
            amount=request.amount,
            currency=request.currency,
            description=request.description,
            event_date=request.event_date,
        )
    except FundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return FundEventResponse(
        event=FundEventSchema.model_validate(event),
        message=f"Withdrew {request.amount:.2f} {event.currency}",
    )


@router.post("/manual-event", response_model=FundEventResponse, status_code=201)
def manual_event(
    request: ManualBenefitLossRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FundEventResponse:
    """Create a manual benefit or loss event."""
    if request.event_type == "benefit":
        event = create_benefit(
            db,
            user_id=current_user.id,
            amount=request.amount,
            currency=request.currency,
            trade_id=request.trade_id,
            description=request.description,
            event_date=request.event_date,
        )
    else:
        event = create_loss(
            db,
            user_id=current_user.id,
            amount=request.amount,
            currency=request.currency,
            trade_id=request.trade_id,
            description=request.description,
            event_date=request.event_date,
        )
    return FundEventResponse(
        event=FundEventSchema.model_validate(event),
        message=f"Created {request.event_type} event for {request.amount:.2f} {event.currency}",
    )


@router.patch("/events/{event_id}/void", response_model=FundEventResponse)
def void_fund_event(
    event_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FundEventResponse:
    """Void a fund event (soft-delete)."""
    try:
        event = void_event(db, event_id=event_id, user_id=current_user.id)
    except FundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return FundEventResponse(
        event=FundEventSchema.model_validate(event),
        message="Event voided",
    )


@router.get("/settings", response_model=RiskSettingsResponse)
def get_settings(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RiskSettingsResponse:
    """Get risk + fund settings."""
    return RiskSettingsResponse(
        risk_pct=get_risk_pct(db, current_user.id),
        base_currency=get_base_currency(db, current_user.id),
    )


@router.post("/repair-currencies", response_model=RepairCurrenciesResponse)
def repair_currencies(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RepairCurrenciesResponse:
    """Repair legacy fund events whose currency was defaulted to USD.

    Syncs trade-linked events to their trade's ticker currency. Idempotent —
    once events are correctly tagged, subsequent calls are no-ops.
    """
    counts = repair_trade_event_currencies(db, user_id=current_user.id)
    return RepairCurrenciesResponse(counts=counts, total=sum(counts.values()))


@router.patch("/settings", response_model=RiskSettingsResponse)
def update_settings(
    request: RiskSettingsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RiskSettingsResponse:
    """Update risk and/or base currency settings."""
    if request.risk_pct is not None:
        update_risk_pct(db, current_user.id, request.risk_pct)
    if request.base_currency is not None:
        update_base_currency(db, current_user.id, request.base_currency.upper())
    return RiskSettingsResponse(
        risk_pct=get_risk_pct(db, current_user.id),
        base_currency=get_base_currency(db, current_user.id),
    )


