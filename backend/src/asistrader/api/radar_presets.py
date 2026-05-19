"""Radar preset API endpoints.

Saved, named radar view configurations. Every endpoint is scoped to the
authenticated user — presets are private and never shared.
"""

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from asistrader.auth.dependencies import get_current_user
from asistrader.db.database import get_db
from asistrader.models.db import User
from asistrader.models.schemas import (
    RadarPresetCreateRequest,
    RadarPresetListResponse,
    RadarPresetResponse,
    RadarPresetSchema,
    RadarPresetUpdateRequest,
)
from asistrader.services.radar_preset_service import (
    RadarPresetNameExistsError,
    RadarPresetNotFoundError,
    create_preset,
    delete_preset,
    get_user_presets,
    update_preset,
)

router = APIRouter(prefix="/api/radar/presets", tags=["radar-presets"])


@router.get("", response_model=RadarPresetListResponse)
def list_presets(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RadarPresetListResponse:
    """Get all radar presets for the current user."""
    presets = get_user_presets(db, current_user.id)
    schemas = [RadarPresetSchema.model_validate(p) for p in presets]
    return RadarPresetListResponse(presets=schemas, count=len(schemas))


@router.post("", response_model=RadarPresetResponse, status_code=201)
def create_new_preset(
    request: RadarPresetCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RadarPresetResponse:
    """Create a new radar preset."""
    try:
        preset = create_preset(
            db,
            user_id=current_user.id,
            name=request.name,
            config=request.config,
        )
    except RadarPresetNameExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))

    return RadarPresetResponse(
        preset=RadarPresetSchema.model_validate(preset),
        message=f"Preset '{preset.name}' created successfully",
    )


@router.put("/{preset_id}", response_model=RadarPresetResponse)
def update_existing_preset(
    preset_id: int,
    request: RadarPresetUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RadarPresetResponse:
    """Rename a preset and/or overwrite its config."""
    try:
        preset = update_preset(
            db,
            user_id=current_user.id,
            preset_id=preset_id,
            name=request.name,
            config=request.config,
        )
    except RadarPresetNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RadarPresetNameExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))

    return RadarPresetResponse(
        preset=RadarPresetSchema.model_validate(preset),
        message=f"Preset '{preset.name}' updated successfully",
    )


@router.delete("/{preset_id}", status_code=204)
def delete_existing_preset(
    preset_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    """Delete a radar preset."""
    try:
        delete_preset(db, current_user.id, preset_id)
    except RadarPresetNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return Response(status_code=204)
