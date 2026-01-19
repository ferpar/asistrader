"""Strategy API endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from asistrader.db.database import get_db
from asistrader.models.schemas import (
    StrategyCreateRequest,
    StrategyListResponse,
    StrategyResponse,
    StrategySchema,
    StrategyUpdateRequest,
)
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
    strategy_schemas = [
        StrategySchema(
            id=s.id,
            name=s.name,
            pe_method=s.pe_method,
            sl_method=s.sl_method,
            tp_method=s.tp_method,
            description=s.description,
        )
        for s in strategies
    ]
    return StrategyListResponse(strategies=strategy_schemas, count=len(strategy_schemas))


@router.get("/{strategy_id}", response_model=StrategyResponse)
def get_strategy(strategy_id: int, db: Session = Depends(get_db)) -> StrategyResponse:
    """Get a single strategy by ID."""
    strategy = get_strategy_by_id(db, strategy_id)
    if not strategy:
        raise HTTPException(status_code=404, detail=f"Strategy with ID {strategy_id} not found")

    strategy_schema = StrategySchema(
        id=strategy.id,
        name=strategy.name,
        pe_method=strategy.pe_method,
        sl_method=strategy.sl_method,
        tp_method=strategy.tp_method,
        description=strategy.description,
    )
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
        )
        strategy_schema = StrategySchema(
            id=strategy.id,
            name=strategy.name,
            pe_method=strategy.pe_method,
            sl_method=strategy.sl_method,
            tp_method=strategy.tp_method,
            description=strategy.description,
        )
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
        )
        strategy_schema = StrategySchema(
            id=strategy.id,
            name=strategy.name,
            pe_method=strategy.pe_method,
            sl_method=strategy.sl_method,
            tp_method=strategy.tp_method,
            description=strategy.description,
        )
        return StrategyResponse(
            strategy=strategy_schema,
            message=f"Strategy '{strategy.name}' updated successfully",
        )
    except StrategyNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except StrategyNameExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))


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
