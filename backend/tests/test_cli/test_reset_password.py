"""Tests for `asistrader.cli.reset_password`, wired to the in-memory session."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.orm import Session

from asistrader.auth.password import hash_password, verify_password
from asistrader.cli.reset_password import main
from asistrader.models.db import RefreshToken, User


@pytest.fixture
def locked_out_user(db_session: Session) -> User:
    user = User(email="trader+7@example.com", hashed_password=hash_password("forgotten"))
    db_session.add(user)
    db_session.commit()
    db_session.add(RefreshToken(
        user_id=user.id,
        token="existing-token",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))
    db_session.commit()
    return user


def _printed_password(output: str) -> str:
    return output.split("New password: ")[1].strip()


class TestResetPasswordCli:
    def test_generated_password_replaces_the_old_one(
        self, db_session: Session, locked_out_user: User,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        rc = main([locked_out_user.email], session=db_session)
        assert rc == 0

        db_session.refresh(locked_out_user)
        new_password = _printed_password(capsys.readouterr().out)
        assert verify_password(new_password, locked_out_user.hashed_password)
        assert not verify_password("forgotten", locked_out_user.hashed_password)

    def test_explicit_password_is_used(
        self, db_session: Session, locked_out_user: User,
    ) -> None:
        rc = main(
            [locked_out_user.email, "--password", "chosen-password"],
            session=db_session,
        )
        assert rc == 0

        db_session.refresh(locked_out_user)
        assert verify_password("chosen-password", locked_out_user.hashed_password)

    def test_existing_sessions_are_revoked(
        self, db_session: Session, locked_out_user: User,
    ) -> None:
        main([locked_out_user.email], session=db_session)

        token = db_session.query(RefreshToken).filter_by(token="existing-token").one()
        db_session.refresh(token)
        assert token.revoked is True

    def test_unknown_email_returns_2(
        self, db_session: Session, capsys: pytest.CaptureFixture[str],
    ) -> None:
        rc = main(["nobody@example.com"], session=db_session)
        assert rc == 2
        assert "no account" in capsys.readouterr().err

    def test_short_password_is_rejected_without_changes(
        self, db_session: Session, locked_out_user: User,
    ) -> None:
        rc = main([locked_out_user.email, "--password", "short"], session=db_session)
        assert rc == 2

        db_session.refresh(locked_out_user)
        assert verify_password("forgotten", locked_out_user.hashed_password)

    def test_find_lists_matches_and_changes_nothing(
        self, db_session: Session, locked_out_user: User,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        rc = main(["--find", "+7"], session=db_session)
        assert rc == 0
        assert locked_out_user.email in capsys.readouterr().out

        db_session.refresh(locked_out_user)
        assert verify_password("forgotten", locked_out_user.hashed_password)

    def test_find_treats_wildcards_literally(
        self, db_session: Session, locked_out_user: User,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        main(["--find", "%"], session=db_session)
        assert "no accounts match" in capsys.readouterr().out
