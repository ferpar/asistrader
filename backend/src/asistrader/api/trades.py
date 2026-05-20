"""Trade API endpoints."""

import dataclasses
from datetime import date as date_type

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from asistrader.auth.dependencies import get_current_user
from asistrader.db.database import get_db
from asistrader.models.db import AlertDismissal, AlertKind, ExitLevelType, Trade, TradeStatus, User
from asistrader.services.fund_service import FundError, get_detection_margin
from asistrader.models.schemas import (
    AlertDismissRequest,
    DetectionTraceResponse,
    MarkLevelHitRequest,
    MessageResponse,
    ScanTraceSchema,
    TradeCreateRequest,
    TradeDetectionResponse,
    TradeListResponse,
    TradeResponse,
    TradeSchema,
    TradeUpdateRequest,
)
from asistrader.services import sltp_detection_service
from asistrader.services.sltp_detection_service import (
    DETECTION_MARGIN_PCT,
    detect_entry_hit_with_trace,
    detect_layered_hits_with_trace,
    detect_sltp_hit_with_trace,
)
from asistrader.services.sltp_detection_trace import ScanTrace
from asistrader.services.ticker_service import get_ticker_by_symbol
from asistrader.services.trade_service import (
    TradeUpdateError,
    create_trade,
    get_all_trades,
    get_trade_by_id,
    reopen_trade,
    revert_open_to_ordered,
    update_trade,
)

router = APIRouter(prefix="/api/trades", tags=["trades"])


def _trade_to_schema(t: Trade) -> TradeSchema:
    """Convert a Trade ORM model to a TradeSchema."""
    from asistrader.models.schemas import ExitLevelSchema

    exit_level_schemas = [
        ExitLevelSchema(
            id=level.id,
            trade_id=level.trade_id,
            level_type=level.level_type,
            price=level.price,
            units_pct=level.units_pct,
            order_index=level.order_index,
            status=level.status,
            hit_date=level.hit_date,
            units_closed=level.units_closed,
            move_sl_to_breakeven=level.move_sl_to_breakeven,
        )
        for level in (t.exit_levels or [])
    ]

    return TradeSchema(
        id=t.id,
        number=t.number,
        ticker=t.ticker,
        status=t.status,
        amount=t.amount,
        units=t.units,
        entry_price=t.entry_price,
        stop_loss=t.stop_loss,
        take_profit=t.take_profit,
        date_planned=t.date_planned,
        date_ordered=t.date_ordered,
        date_actual=t.date_actual,
        exit_date=t.exit_date,
        exit_type=t.exit_type,
        exit_price=t.exit_price,
        auto_detect=t.auto_detect or False,
        is_layered=t.is_layered or False,
        remaining_units=t.remaining_units,
        exit_levels=exit_level_schemas,
        strategy_id=t.strategy_id,
        order_type=t.order_type,
        time_in_effect=t.time_in_effect,
        gtd_date=t.gtd_date,
        ticker_name=t.ticker_rel.name if t.ticker_rel else None,
        ticker_currency=t.ticker_rel.currency if t.ticker_rel else None,
        ticker_price_hint=t.ticker_rel.price_hint if t.ticker_rel else None,
        strategy_name=t.strategy_rel.name if t.strategy_rel else None,
        risk_abs=t.risk_abs,
        profit_abs=t.profit_abs,
        risk_pct=t.risk_pct,
        profit_pct=t.profit_pct,
        ratio=t.ratio,
    )


@router.get("", response_model=TradeListResponse)
def list_trades(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TradeListResponse:
    """Get all trades for the current user."""
    trades = get_all_trades(db, user_id=current_user.id)
    trade_schemas = [_trade_to_schema(t) for t in trades]
    return TradeListResponse(trades=trade_schemas, count=len(trade_schemas))


@router.post("", response_model=TradeResponse, status_code=201)
def create_new_trade(
    request: TradeCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TradeResponse:
    """Create a new trade for the current user.

    Must provide either exit_levels OR both stop_loss and take_profit.
    If exit_levels are provided, stop_loss and take_profit are ignored.
    """
    from asistrader.services.exit_level_service import ExitLevelValidationError

    # Validate ticker exists
    ticker = get_ticker_by_symbol(db, request.ticker)
    if not ticker:
        raise HTTPException(status_code=400, detail=f"Ticker '{request.ticker}' not found")

    # Convert exit levels to dict format if provided
    exit_levels_data = None
    if request.exit_levels:
        exit_levels_data = [
            {
                "level_type": level.level_type,
                "price": level.price,
                "units_pct": level.units_pct,
                "move_sl_to_breakeven": level.move_sl_to_breakeven,
            }
            for level in request.exit_levels
        ]

    # Validate: must have either exit_levels or both stop_loss and take_profit
    if not exit_levels_data and (request.stop_loss is None or request.take_profit is None):
        raise HTTPException(
            status_code=400,
            detail="Must provide either exit_levels or both stop_loss and take_profit",
        )

    try:
        trade = create_trade(
            db=db,
            ticker=request.ticker,
            entry_price=request.entry_price,
            units=request.units,
            date_planned=request.date_planned,
            stop_loss=request.stop_loss,
            take_profit=request.take_profit,
            strategy_id=request.strategy_id,
            user_id=current_user.id,
            auto_detect=request.auto_detect,
            exit_levels=exit_levels_data,
            order_type=request.order_type,
            time_in_effect=request.time_in_effect,
            gtd_date=request.gtd_date,
        )
    except (ExitLevelValidationError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))

    return TradeResponse(trade=_trade_to_schema(trade), message="Trade created successfully")


@router.patch("/{trade_id}", response_model=TradeResponse)
def update_existing_trade(
    trade_id: int,
    request: TradeUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TradeResponse:
    """Update an existing trade owned by the current user."""
    # Verify ownership
    existing_trade = get_trade_by_id(db, trade_id, user_id=current_user.id)
    if not existing_trade:
        raise HTTPException(status_code=404, detail=f"Trade with id {trade_id} not found")

    # Convert request to dict, excluding None values
    updates = request.model_dump(exclude_none=True)

    try:
        trade = update_trade(db, trade_id, **updates)
    except (TradeUpdateError, FundError) as e:
        raise HTTPException(status_code=400, detail=str(e))

    return TradeResponse(trade=_trade_to_schema(trade), message="Trade updated successfully")


@router.post("/{trade_id}/reopen", response_model=TradeResponse)
def reopen_closed_trade(
    trade_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TradeResponse:
    """Reopen a closed trade, reversing exit fields and fund events."""
    existing_trade = get_trade_by_id(db, trade_id, user_id=current_user.id)
    if not existing_trade:
        raise HTTPException(status_code=404, detail=f"Trade with id {trade_id} not found")

    try:
        trade = reopen_trade(db, trade_id)
    except TradeUpdateError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return TradeResponse(trade=_trade_to_schema(trade), message="Trade reopened successfully")


@router.post("/{trade_id}/revert-to-ordered", response_model=TradeResponse)
def revert_trade_to_ordered(
    trade_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TradeResponse:
    """Revert an open trade back to ordered status (recovery for auto-trading failures)."""
    existing_trade = get_trade_by_id(db, trade_id, user_id=current_user.id)
    if not existing_trade:
        raise HTTPException(status_code=404, detail=f"Trade with id {trade_id} not found")

    try:
        trade = revert_open_to_ordered(db, trade_id)
    except TradeUpdateError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return TradeResponse(trade=_trade_to_schema(trade), message="Trade reverted to ordered")


@router.post("/detect-hits", response_model=TradeDetectionResponse)
def detect_trade_hits(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TradeDetectionResponse:
    """Detect entry and SL/TP hits for all trades.

    For ORDERED trades: detects entry price hits and auto-opens auto-detect trades.
    For OPEN trades: detects SL/TP hits and auto-closes auto-detect trades.
    For layered trades: processes partial closes when individual levels are hit.
    """
    result = sltp_detection_service.process_all_trades(db, user_id=current_user.id)
    return TradeDetectionResponse(
        entry_alerts=result["entry_alerts"],
        sltp_alerts=result["sltp_alerts"],
        layered_alerts=result["layered_alerts"],
        auto_opened_count=result["auto_opened_count"],
        auto_closed_count=result["auto_closed_count"],
        partial_close_count=result["partial_close_count"],
        conflict_count=result["conflict_count"],
    )


@router.get("/{trade_id}/detection-trace", response_model=DetectionTraceResponse)
def get_detection_trace(
    trade_id: int,
    sl: float | None = Query(default=None),
    tp: float | None = Query(default=None),
    entry: float | None = Query(default=None),
    opened: date_type | None = Query(default=None),
    planned: date_type | None = Query(default=None),
    margin: float | None = Query(default=None, ge=0, le=0.1),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DetectionTraceResponse:
    """Return the full bar-by-bar detection trace for a single trade.

    Routes to the right detector by trade status / is_layered. Any provided
    what-if query params (sl/tp/entry/opened/planned) override the loaded
    trade's fields *in memory* and are then rolled back, so this endpoint
    cannot mutate the database regardless of input.

    Use cases:
      - "Why did this alert pick that date?" — call with no overrides.
      - "Would this still alert if SL were 92?" — call with `sl=92`.
    """
    trade = db.query(Trade).filter(
        Trade.id == trade_id, Trade.user_id == current_user.id
    ).first()
    if trade is None:
        raise HTTPException(status_code=404, detail="Trade not found")

    overrides: dict[str, object] = {}
    try:
        if sl is not None:
            sl_levels = [l for l in trade.exit_levels if l.level_type == ExitLevelType.SL]
            if len(sl_levels) != 1:
                raise HTTPException(
                    status_code=400,
                    detail=f"sl override needs exactly one SL level; trade has {len(sl_levels)}",
                )
            sl_levels[0].price = sl
            overrides["sl"] = sl
        if tp is not None:
            tp_levels = [l for l in trade.exit_levels if l.level_type == ExitLevelType.TP]
            if len(tp_levels) != 1:
                raise HTTPException(
                    status_code=400,
                    detail=f"tp override needs exactly one TP level; trade has {len(tp_levels)}",
                )
            tp_levels[0].price = tp
            overrides["tp"] = tp
        if entry is not None:
            trade.entry_price = entry
            overrides["entry"] = entry
        if opened is not None:
            trade.date_actual = opened
            overrides["opened"] = opened.isoformat()
        if planned is not None:
            trade.date_planned = planned
            overrides["planned"] = planned.isoformat()

        effective_margin = (
            margin if margin is not None
            else get_detection_margin(db, current_user.id)
        )

        trace, detector_kind = _run_traced_detector(db, trade, effective_margin)
        # Use the dataclass -> dict round trip so the Pydantic schema can
        # validate the structure (and reject any drift between the two).
        trace_schema = ScanTraceSchema.model_validate(dataclasses.asdict(trace))
        return DetectionTraceResponse(
            trace=trace_schema,
            detector_kind=detector_kind,
            what_if=overrides,
        )
    finally:
        # Read-only contract: any what-if mutations stay in the in-memory
        # session and are discarded. Identical to the CLI's safety net.
        db.rollback()


def _run_traced_detector(
    db: Session, trade: Trade, margin: float
) -> tuple[ScanTrace, str]:
    """Pick the right `*_with_trace` detector for this trade."""
    if trade.status == TradeStatus.ORDERED:
        _, trace = detect_entry_hit_with_trace(db, trade, margin)
        return trace, "entry"
    if trade.status == TradeStatus.OPEN:
        if trade.is_layered:
            _, trace = detect_layered_hits_with_trace(db, trade, margin)
            return trace, "layered"
        _, trace = detect_sltp_hit_with_trace(db, trade, margin)
        return trace, "sltp"

    side = "long" if (trade.entry_price and trade.stop_loss
                       and trade.stop_loss < trade.entry_price) else "short"
    return ScanTrace(
        kind="none", trade_id=trade.id, side=side, margin=margin,
        scan_from=None, scan_to=None, bars_scanned=0, bars=[],
        verdict=f"not detectable: trade.status={trade.status.value if trade.status else '?'}",
    ), "none"


def _resolve_alert_kind(value: str) -> AlertKind:
    """Parse a request alert_kind string into an AlertKind, or 400."""
    try:
        return AlertKind(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid alert_kind: {value}")


@router.post("/alerts/dismiss", response_model=MessageResponse)
def dismiss_alert(
    request: AlertDismissRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MessageResponse:
    """Dismiss a detection alert so it stays hidden on future check-alerts runs.

    Idempotent: dismissing an already-dismissed alert is a no-op.
    """
    kind = _resolve_alert_kind(request.alert_kind)
    trade = get_trade_by_id(db, request.trade_id, user_id=current_user.id)
    if not trade:
        raise HTTPException(status_code=404, detail=f"Trade with id {request.trade_id} not found")

    existing = (
        db.query(AlertDismissal)
        .filter(
            AlertDismissal.trade_id == request.trade_id,
            AlertDismissal.hit_date == request.hit_date,
            AlertDismissal.alert_kind == kind,
            AlertDismissal.level_key == request.level_key,
        )
        .first()
    )
    if existing is None:
        db.add(
            AlertDismissal(
                user_id=current_user.id,
                trade_id=trade.id,
                ticker=trade.ticker,
                hit_date=request.hit_date,
                alert_kind=kind,
                level_key=request.level_key,
            )
        )
        db.commit()
    return MessageResponse(message="Alert dismissed")


@router.delete("/alerts/dismiss", response_model=MessageResponse)
def restore_alert(
    request: AlertDismissRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MessageResponse:
    """Restore a dismissed alert so it reappears on the next check-alerts run."""
    kind = _resolve_alert_kind(request.alert_kind)
    deleted = (
        db.query(AlertDismissal)
        .filter(
            AlertDismissal.user_id == current_user.id,
            AlertDismissal.trade_id == request.trade_id,
            AlertDismissal.hit_date == request.hit_date,
            AlertDismissal.alert_kind == kind,
            AlertDismissal.level_key == request.level_key,
        )
        .delete()
    )
    db.commit()
    return MessageResponse(
        message="Alert restored" if deleted else "No matching dismissal found"
    )


@router.patch("/{trade_id}/exit-levels/{level_id}/hit", response_model=TradeResponse)
def mark_exit_level_hit(
    trade_id: int,
    level_id: int,
    request: MarkLevelHitRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TradeResponse:
    """Manually mark an exit level as hit."""
    from asistrader.models.db import ExitLevel
    from asistrader.services.exit_level_service import ExitLevelValidationError, apply_manual_level_hit

    # Verify trade ownership
    trade = get_trade_by_id(db, trade_id, user_id=current_user.id)
    if not trade:
        raise HTTPException(status_code=404, detail=f"Trade with id {trade_id} not found")

    # Trade must be open
    if trade.status != "open":
        raise HTTPException(status_code=400, detail="Trade must be open to mark levels as hit")

    # Find the level
    level = db.query(ExitLevel).filter(
        ExitLevel.id == level_id,
        ExitLevel.trade_id == trade_id,
    ).first()
    if not level:
        raise HTTPException(status_code=404, detail=f"Exit level with id {level_id} not found on trade {trade_id}")

    # Level must be pending
    if level.status != "pending":
        raise HTTPException(status_code=400, detail=f"Exit level must be pending, got '{level.status}'")

    try:
        trade = apply_manual_level_hit(db, trade, level, request.hit_date, request.hit_price)
    except ExitLevelValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return TradeResponse(trade=_trade_to_schema(trade), message="Exit level marked as hit")


@router.delete("/{trade_id}/exit-levels/{level_id}/hit", response_model=TradeResponse)
def revert_exit_level_hit(
    trade_id: int,
    level_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TradeResponse:
    """Revert a hit exit level back to pending."""
    from asistrader.models.db import ExitLevel
    from asistrader.services.exit_level_service import ExitLevelValidationError, revert_level_hit

    # Verify trade ownership
    trade = get_trade_by_id(db, trade_id, user_id=current_user.id)
    if not trade:
        raise HTTPException(status_code=404, detail=f"Trade with id {trade_id} not found")

    # Trade must be open
    if trade.status != "open":
        raise HTTPException(status_code=400, detail="Trade must be open to revert level hits")

    # Find the level
    level = db.query(ExitLevel).filter(
        ExitLevel.id == level_id,
        ExitLevel.trade_id == trade_id,
    ).first()
    if not level:
        raise HTTPException(status_code=404, detail=f"Exit level with id {level_id} not found on trade {trade_id}")

    # Level must be hit
    if level.status != "hit":
        raise HTTPException(status_code=400, detail=f"Exit level must be hit to revert, got '{level.status}'")

    try:
        trade = revert_level_hit(db, trade, level)
    except ExitLevelValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return TradeResponse(trade=_trade_to_schema(trade), message="Exit level hit reverted")
