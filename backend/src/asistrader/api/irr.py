"""IRR / TIR ("Drivers") analysis API endpoints."""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from asistrader.auth.dependencies import get_current_user
from asistrader.db.database import get_db
from asistrader.models.db import User
from asistrader.services import fx_service
from asistrader.services.irr_service import IrrAnalysis, compute_analysis

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/irr", tags=["irr"])


@router.get("/analysis", response_model=IrrAnalysis)
def get_irr_analysis(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> IrrAnalysis:
    """Return the full Drivers payload: realized & unrealized IRR plus the daily series."""
    # Best-effort FX sync so cross-currency conversions have rates. Idempotent;
    # wrapped so a yfinance outage doesn't break the analysis read.
    try:
        fx_service.ensure_rates_for_user(db, current_user.id)
    except Exception as e:
        logger.warning("FX auto-sync failed during get_irr_analysis: %s", e)

    return compute_analysis(db, current_user.id)
