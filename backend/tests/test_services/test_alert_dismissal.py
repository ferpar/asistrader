"""Tests for the alert dismissal blacklist (annotate_dismissals).

A dismissed alert is identified by its signature (trade_id, hit_date,
alert_kind, level_key). `annotate_dismissals` flags matching alerts so the
frontend can hide them while still offering them for review.
"""

from datetime import date

from sqlalchemy.orm import Session

from asistrader.models.db import AlertDismissal, AlertKind, User
from asistrader.models.schemas import (
    EntryAlert,
    EntryHitType,
    LayeredAlert,
    SLTPAlert,
    SLTPHitType,
)
from asistrader.services.sltp_detection_service import annotate_dismissals


def _sltp_alert(trade_id: int = 1, hit_date: date = date(2025, 1, 20)) -> SLTPAlert:
    return SLTPAlert(
        trade_id=trade_id, ticker="TEST", hit_type=SLTPHitType.SL,
        hit_date=hit_date, hit_price=95.0, auto_detect=False,
        auto_closed=False,
    )


def _entry_alert(trade_id: int = 1, hit_date: date = date(2025, 1, 20)) -> EntryAlert:
    return EntryAlert(
        trade_id=trade_id, ticker="TEST", hit_type=EntryHitType.ENTRY,
        hit_date=hit_date, entry_price=100.0, auto_detect=False,
        auto_opened=False,
    )


def _layered_alert(trade_id: int = 1) -> LayeredAlert:
    return LayeredAlert(
        trade_id=trade_id, ticker="TEST", level_type="tp", level_index=1,
        hit_date=date(2025, 1, 20), hit_price=110.0, units_closed=50,
        remaining_units=50, auto_detect=False, auto_processed=False,
    )


def _dismiss(
    db: Session, user: User, *, trade_id: int, alert_kind: AlertKind,
    level_key: str, hit_date: date = date(2025, 1, 20),
) -> None:
    db.add(
        AlertDismissal(
            user_id=user.id, trade_id=trade_id, ticker="TEST",
            hit_date=hit_date, alert_kind=alert_kind, level_key=level_key,
        )
    )
    db.commit()


def test_unmatched_alert_is_not_dismissed(db_session: Session, sample_user: User) -> None:
    alert = _sltp_alert()
    annotate_dismissals(db_session, sample_user.id, [], [alert], [])
    assert alert.dismissed is False
    # The signature fields are still populated for the frontend.
    assert alert.alert_kind == "sltp"
    assert alert.level_key == "sl"


def test_matching_dismissal_flags_the_alert(
    db_session: Session, sample_user: User
) -> None:
    _dismiss(
        db_session, sample_user, trade_id=1,
        alert_kind=AlertKind.SLTP, level_key="sl",
    )
    alert = _sltp_alert()
    annotate_dismissals(db_session, sample_user.id, [], [alert], [])
    assert alert.dismissed is True


def test_dismissal_is_level_specific(db_session: Session, sample_user: User) -> None:
    # A dismissal for the TP level must not silence the SL alert.
    _dismiss(
        db_session, sample_user, trade_id=1,
        alert_kind=AlertKind.SLTP, level_key="tp",
    )
    alert = _sltp_alert()  # level_key resolves to "sl"
    annotate_dismissals(db_session, sample_user.id, [], [alert], [])
    assert alert.dismissed is False


def test_dismissal_is_date_specific(db_session: Session, sample_user: User) -> None:
    # A dismissal for a different hit date does not match a fresh hit.
    _dismiss(
        db_session, sample_user, trade_id=1, alert_kind=AlertKind.SLTP,
        level_key="sl", hit_date=date(2025, 1, 10),
    )
    alert = _sltp_alert(hit_date=date(2025, 1, 20))
    annotate_dismissals(db_session, sample_user.id, [], [alert], [])
    assert alert.dismissed is False


def test_dismissal_is_scoped_to_the_user(
    db_session: Session, sample_user: User
) -> None:
    other = User(email="other@example.com", hashed_password="x")
    db_session.add(other)
    db_session.commit()
    _dismiss(
        db_session, other, trade_id=1,
        alert_kind=AlertKind.SLTP, level_key="sl",
    )
    alert = _sltp_alert()
    annotate_dismissals(db_session, sample_user.id, [], [alert], [])
    assert alert.dismissed is False


def test_entry_alert_signature(db_session: Session, sample_user: User) -> None:
    _dismiss(
        db_session, sample_user, trade_id=1,
        alert_kind=AlertKind.ENTRY, level_key="entry",
    )
    alert = _entry_alert()
    annotate_dismissals(db_session, sample_user.id, [alert], [], [])
    assert alert.alert_kind == "entry"
    assert alert.level_key == "entry"
    assert alert.dismissed is True


def test_layered_alert_level_key_includes_type_and_index(
    db_session: Session, sample_user: User
) -> None:
    alert = _layered_alert()
    annotate_dismissals(db_session, sample_user.id, [], [], [alert])
    assert alert.alert_kind == "layered"
    assert alert.level_key == "tp:1"
    assert alert.dismissed is False

    _dismiss(
        db_session, sample_user, trade_id=1,
        alert_kind=AlertKind.LAYERED, level_key="tp:1",
    )
    alert2 = _layered_alert()
    annotate_dismissals(db_session, sample_user.id, [], [], [alert2])
    assert alert2.dismissed is True
