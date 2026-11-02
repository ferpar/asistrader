"""Tests for `asistrader.cli.reset_password`, wired to the in-memory session."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.orm import Session

from asistrader.auth.password import hash_password, verify_password
from asistrader.cli.reset_password import main
from asistrader.models.db import PasswordResetToken, User


@pytest.fixture(autouse=True)
def app_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_URL", "https://app.example.com/")


@pytest.fixture
def locked_out_user(db_session: Session) -> User:
    user = User(email="trader+7@example.com", hashed_password=hash_password("forgotten"))
    db_session.add(user)
    db_session.commit()
    return user


class TestResetPasswordCli:
    def test_prints_a_link_and_stores_only_the_hash(
        self, db_session: Session, locked_out_user: User,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        rc = main([locked_out_user.email], session=db_session)
        assert rc == 0

        output = capsys.readouterr().out
        assert "https://app.example.com/reset-password#token=" in output
        token = output.split("#token=")[1].strip()
        stored = db_session.query(PasswordResetToken).one()
        assert stored.token_hash != token
        assert token not in stored.token_hash

    def test_current_password_keeps_working_until_the_link_is_used(
        self, db_session: Session, locked_out_user: User,
    ) -> None:
        main([locked_out_user.email], session=db_session)

        db_session.refresh(locked_out_user)
        assert verify_password("forgotten", locked_out_user.hashed_password)

    def test_hours_sets_the_expiry(
        self, db_session: Session, locked_out_user: User,
    ) -> None:
        main([locked_out_user.email, "--hours", "2"], session=db_session)

        expires_at = db_session.query(PasswordResetToken).one().expires_at
        remaining = expires_at.replace(tzinfo=timezone.utc) - datetime.now(timezone.utc)
        assert timedelta(hours=1, minutes=59) < remaining <= timedelta(hours=2)

    def test_unknown_email_returns_2(
        self, db_session: Session, capsys: pytest.CaptureFixture[str],
    ) -> None:
        rc = main(["nobody@example.com"], session=db_session)
        assert rc == 2
        assert "no account" in capsys.readouterr().err

    def test_inactive_account_returns_2_without_a_link(
        self, db_session: Session, locked_out_user: User,
    ) -> None:
        locked_out_user.is_active = False
        db_session.commit()

        rc = main([locked_out_user.email], session=db_session)
        assert rc == 2
        assert db_session.query(PasswordResetToken).count() == 0

    def test_missing_app_url_returns_2_without_a_link(
        self, db_session: Session, locked_out_user: User,
        monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
    ) -> None:
        monkeypatch.delenv("APP_URL")

        rc = main([locked_out_user.email], session=db_session)
        assert rc == 2
        assert "APP_URL" in capsys.readouterr().err
        assert db_session.query(PasswordResetToken).count() == 0

    def test_find_lists_matches_and_changes_nothing(
        self, db_session: Session, locked_out_user: User,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        rc = main(["--find", "+7"], session=db_session)
        assert rc == 0
        assert locked_out_user.email in capsys.readouterr().out
        assert db_session.query(PasswordResetToken).count() == 0

    def test_find_handles_accounts_without_a_created_date(
        self, db_session: Session, locked_out_user: User,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        locked_out_user.created_at = None
        db_session.commit()

        rc = main(["--find", "+7"], session=db_session)
        assert rc == 0
        assert "created=unknown" in capsys.readouterr().out

    def test_find_treats_wildcards_literally(
        self, db_session: Session, locked_out_user: User,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        main(["--find", "%"], session=db_session)
        assert "no accounts match" in capsys.readouterr().out
