"""Tests for the one-time password reset flow."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from asistrader.auth.password import hash_password, verify_password
from asistrader.models.db import PasswordResetToken, RefreshToken, User
from asistrader.services.auth_service import create_password_reset_token

NEW_PASSWORD = "brand-new-password"


@pytest.fixture
def user(db_session: Session) -> User:
    user = User(email="trader+7@example.com", hashed_password=hash_password("forgotten"))
    db_session.add(user)
    db_session.commit()
    return user


def _reset(client: TestClient, token: str, password: str = NEW_PASSWORD):
    return client.post(
        "/api/auth/reset-password", json={"token": token, "new_password": password}
    )


def _password_is(db: Session, user: User, password: str) -> bool:
    db.refresh(user)
    return verify_password(password, user.hashed_password)


class TestResetPassword:
    def test_sets_the_new_password_and_retires_the_old_one(
        self, client: TestClient, db_session: Session, user: User,
    ) -> None:
        response = _reset(client, create_password_reset_token(db_session, user))

        assert response.status_code == 200
        assert _password_is(db_session, user, NEW_PASSWORD)
        assert not _password_is(db_session, user, "forgotten")
        login = client.post(
            "/api/auth/login", json={"email": user.email, "password": NEW_PASSWORD}
        )
        assert login.status_code == 200

    def test_revokes_existing_sessions(
        self, client: TestClient, db_session: Session, user: User,
    ) -> None:
        db_session.add(RefreshToken(
            user_id=user.id,
            token="existing-token",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        ))
        db_session.commit()

        _reset(client, create_password_reset_token(db_session, user))

        session = db_session.query(RefreshToken).filter_by(token="existing-token").one()
        db_session.refresh(session)
        assert session.revoked is True

    def test_token_only_works_once(
        self, client: TestClient, db_session: Session, user: User,
    ) -> None:
        token = create_password_reset_token(db_session, user)
        _reset(client, token)

        response = _reset(client, token, "another-password")

        assert response.status_code == 400
        assert _password_is(db_session, user, NEW_PASSWORD)

    def test_new_link_cancels_the_previous_one(
        self, client: TestClient, db_session: Session, user: User,
    ) -> None:
        superseded = create_password_reset_token(db_session, user)
        current = create_password_reset_token(db_session, user)

        assert _reset(client, superseded).status_code == 400
        assert _password_is(db_session, user, "forgotten")
        assert _reset(client, current).status_code == 200

    def test_expired_token_is_rejected(
        self, client: TestClient, db_session: Session, user: User,
    ) -> None:
        token = create_password_reset_token(db_session, user)
        stored = db_session.query(PasswordResetToken).one()
        stored.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db_session.commit()

        assert _reset(client, token).status_code == 400
        assert _password_is(db_session, user, "forgotten")

    def test_inactive_user_is_rejected_and_token_is_not_spent(
        self, client: TestClient, db_session: Session, user: User,
    ) -> None:
        token = create_password_reset_token(db_session, user)
        user.is_active = False
        db_session.commit()

        assert _reset(client, token).status_code == 400
        assert _password_is(db_session, user, "forgotten")
        assert db_session.query(PasswordResetToken).one().used_at is None

    def test_all_token_failures_look_the_same(
        self, client: TestClient, db_session: Session, user: User,
    ) -> None:
        used = create_password_reset_token(db_session, user)
        _reset(client, used)

        unknown_response = _reset(client, "not-a-real-token")
        used_response = _reset(client, used)

        assert unknown_response.status_code == used_response.status_code == 400
        assert unknown_response.json() == used_response.json()

    @pytest.mark.parametrize("password", ["short", "x" * 73])
    def test_password_length_is_enforced_and_token_survives(
        self, client: TestClient, db_session: Session, user: User, password: str,
    ) -> None:
        token = create_password_reset_token(db_session, user)

        assert _reset(client, token, password).status_code == 422
        assert _reset(client, token).status_code == 200
