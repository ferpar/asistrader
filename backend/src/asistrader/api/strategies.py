"""Strategy API endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from dataclasses import asdict

from asistrader.db.database import get_db
from asistrader.models.schemas import (
    StrategyCreateRequest,
    StrategyDraftRequest,
    StrategyDraftResponse,
    StrategyEngineListResponse,
    StrategyEngineSchema,
    StrategyListResponse,
    StrategyResponse,
    StrategySchema,
    StrategyUpdateRequest,
)
from asistrader.services.strategies.draft_service import draft_trade
from asistrader.services.strategies.engines import list_engines
from asistrader.services.strategy_service import (
    StrategyInUseError,
    StrategyNameExistsError,
    StrategyNotFoundError,
    create_strategy,
    delete_strategy,
    get_all_strategies,
    get_strategy_by_id,
    update_strategy,
)

router = APIRouter(prefix="/api/strategies", tags=["strategies"])


@router.get("", response_model=StrategyListResponse)
def list_strategies(db: Session = Depends(get_db)) -> StrategyListResponse:
    """Get all strategies."""
    strategies = get_all_strategies(db)
    strategy_schemas = [StrategySchema.model_validate(s) for s in strategies]
    return StrategyListResponse(strategies=strategy_schemas, count=len(strategy_schemas))


@router.get("/engines", response_model=StrategyEngineListResponse)
def list_strategy_engines() -> StrategyEngineListResponse:
    """The code-defined catalog of automated-strategy engines + their param schemas.

    Defined before `/{strategy_id}` so the literal path isn't captured as an id.
    """
    engines = [
        StrategyEngineSchema(
            id=e.id,
            label=e.label,
            description=e.description,
            fields=[asdict(f) for f in e.fields],
        )
        for e in list_engines()
    ]
    return StrategyEngineListResponse(engines=engines)


@router.get("/{strategy_id}", response_model=StrategyResponse)
def get_strategy(strategy_id: int, db: Session = Depends(get_db)) -> StrategyResponse:
    """Get a single strategy by ID."""
    strategy = get_strategy_by_id(db, strategy_id)
    if not strategy:
        raise HTTPException(status_code=404, detail=f"Strategy with ID {strategy_id} not found")

    strategy_schema = StrategySchema.model_validate(strategy)
    return StrategyResponse(strategy=strategy_schema, message="Strategy retrieved successfully")


@router.post("", response_model=StrategyResponse, status_code=201)
def create_new_strategy(
    request: StrategyCreateRequest,
    db: Session = Depends(get_db),
) -> StrategyResponse:
    """Create a new strategy."""
    try:
        strategy = create_strategy(
            db,
            name=request.name,
            pe_method=request.pe_method,
            sl_method=request.sl_method,
            tp_method=request.tp_method,
            description=request.description,
            automated=request.automated,
            params=request.params,
        )
        strategy_schema = StrategySchema.model_validate(strategy)
        return StrategyResponse(
            strategy=strategy_schema,
            message=f"Strategy '{strategy.name}' created successfully",
        )
    except StrategyNameExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.put("/{strategy_id}", response_model=StrategyResponse)
def update_existing_strategy(
    strategy_id: int,
    request: StrategyUpdateRequest,
    db: Session = Depends(get_db),
) -> StrategyResponse:
    """Update an existing strategy."""
    try:
        strategy = update_strategy(
            db,
            strategy_id,
            name=request.name,
            pe_method=request.pe_method,
            sl_method=request.sl_method,
            tp_method=request.tp_method,
            description=request.description,
            automated=request.automated,
            params=request.params,
        )
        strategy_schema = StrategySchema.model_validate(strategy)
        return StrategyResponse(
            strategy=strategy_schema,
            message=f"Strategy '{strategy.name}' updated successfully",
        )
    except StrategyNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except StrategyNameExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post("/{strategy_id}/draft", response_model=StrategyDraftResponse)
def draft_trade_for_ticker(
    strategy_id: int,
    request: StrategyDraftRequest,
    db: Session = Depends(get_db),
) -> StrategyDraftResponse:
    """Draft a trade for `request.ticker` using an automated strategy.

    Runs (or reuses a cached) historical sweep and returns the regular/
    aggressive/conservative presets with drafted entry/SL/TP, or a low-confidence
    verdict. Kept sync: Starlette runs it in a threadpool so the CPU-bound sweep
    doesn't block the event loop.
    """
    strategy = get_strategy_by_id(db, strategy_id)
    if not strategy:
        raise HTTPException(status_code=404, detail=f"Strategy with ID {strategy_id} not found")
    if not strategy.automated:
        raise HTTPException(
            status_code=400,
            detail=f"Strategy '{strategy.name}' is not automated; cannot draft a trade.",
        )

    payload = draft_trade(db, strategy, request.model_dump(mode="json", exclude_none=True))
    return StrategyDraftResponse.model_validate(payload)


@router.delete("/{strategy_id}", status_code=204)
def delete_existing_strategy(
    strategy_id: int,
    db: Session = Depends(get_db),
) -> Response:
    """Delete a strategy."""
    try:
        delete_strategy(db, strategy_id)
        return Response(status_code=204)
    except StrategyNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except StrategyInUseError as e:
        raise HTTPException(status_code=409, detail=str(e))
