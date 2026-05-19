"""Radar preset business logic service.

All operations are scoped to a single user — a preset is only ever visible
to, and mutable by, the user who created it.
"""

from typing import Any

from sqlalchemy.orm import Session

from asistrader.models.db import RadarPreset


class RadarPresetNotFoundError(Exception):
    """Raised when a radar preset is not found for the given user."""

    pass


class RadarPresetNameExistsError(Exception):
    """Raised when a preset name already exists for the user."""

    pass


def get_user_presets(db: Session, user_id: int) -> list[RadarPreset]:
    """Get all radar presets for a user, ordered by name."""
    return (
        db.query(RadarPreset)
        .filter(RadarPreset.user_id == user_id)
        .order_by(RadarPreset.name)
        .all()
    )


def get_user_preset(db: Session, user_id: int, preset_id: int) -> RadarPreset | None:
    """Get a single radar preset owned by the user."""
    return (
        db.query(RadarPreset)
        .filter(RadarPreset.id == preset_id, RadarPreset.user_id == user_id)
        .first()
    )


def create_preset(
    db: Session,
    user_id: int,
    name: str,
    config: dict[str, Any],
) -> RadarPreset:
    """Create a new radar preset for the user.

    Raises:
        RadarPresetNameExistsError: If the user already has a preset with this name.
    """
    name = name.strip()

    existing = (
        db.query(RadarPreset)
        .filter(RadarPreset.user_id == user_id, RadarPreset.name == name)
        .first()
    )
    if existing:
        raise RadarPresetNameExistsError(f"A preset named '{name}' already exists")

    preset = RadarPreset(user_id=user_id, name=name, config=config)
    db.add(preset)
    db.commit()
    db.refresh(preset)

    return preset


def update_preset(
    db: Session,
    user_id: int,
    preset_id: int,
    name: str | None = None,
    config: dict[str, Any] | None = None,
) -> RadarPreset:
    """Rename a preset and/or overwrite its config.

    Raises:
        RadarPresetNotFoundError: If the preset doesn't exist for this user.
        RadarPresetNameExistsError: If the new name collides with another preset.
    """
    preset = get_user_preset(db, user_id, preset_id)
    if not preset:
        raise RadarPresetNotFoundError(f"Radar preset with ID {preset_id} not found")

    if name is not None:
        name = name.strip()
        existing = (
            db.query(RadarPreset)
            .filter(
                RadarPreset.user_id == user_id,
                RadarPreset.name == name,
                RadarPreset.id != preset_id,
            )
            .first()
        )
        if existing:
            raise RadarPresetNameExistsError(f"A preset named '{name}' already exists")
        preset.name = name

    if config is not None:
        preset.config = config

    db.commit()
    db.refresh(preset)

    return preset


def delete_preset(db: Session, user_id: int, preset_id: int) -> None:
    """Delete a radar preset owned by the user.

    Raises:
        RadarPresetNotFoundError: If the preset doesn't exist for this user.
    """
    preset = get_user_preset(db, user_id, preset_id)
    if not preset:
        raise RadarPresetNotFoundError(f"Radar preset with ID {preset_id} not found")

    db.delete(preset)
    db.commit()
