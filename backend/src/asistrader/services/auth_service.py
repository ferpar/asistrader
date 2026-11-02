"""Authentication business logic service."""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from asistrader.auth.jwt import (
    TokenError,
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
)
from asistrader.auth.password import hash_password, verify_password
from asistrader.models.db import PasswordResetToken, RefreshToken, User


DEFAULT_RESET_TOKEN_HOURS = 24


class UserExistsError(Exception):
    """Raised when attempting to register with an existing email."""

    pass


class InvalidCredentialsError(Exception):
    """Raised when login credentials are invalid."""

    pass


class InvalidRefreshTokenError(Exception):
    """Raised when refresh token is invalid, expired, or revoked."""

    pass


class InvalidResetTokenError(Exception):
    """Raised when a password reset token is unknown, expired, used, or its user is inactive."""

    pass


def get_user_by_email(db: Session, email: str) -> User | None:
    """Get a user by email address."""
    return db.query(User).filter(User.email == email).first()


def get_user_by_id(db: Session, user_id: int) -> User | None:
    """Get a user by ID."""
    return db.query(User).filter(User.id == user_id).first()


def register_user(db: Session, email: str, password: str) -> User:
    """
    Register a new user.

    Raises UserExistsError if email is already taken.
    """
    existing_user = get_user_by_email(db, email)
    if existing_user:
        raise UserExistsError(f"User with email '{email}' already exists")

    hashed = hash_password(password)
    user = User(email=email, hashed_password=hashed)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def authenticate_user(db: Session, email: str, password: str) -> User:
    """
    Authenticate a user by email and password.

    Raises InvalidCredentialsError if credentials are invalid.
    """
    user = get_user_by_email(db, email)
    if not user:
        raise InvalidCredentialsError("Invalid email or password")

    if not verify_password(password, user.hashed_password):
        raise InvalidCredentialsError("Invalid email or password")

    if not user.is_active:
        raise InvalidCredentialsError("User account is inactive")

    return user


def create_tokens(db: Session, user: User) -> tuple[str, str]:
    """
    Create access and refresh tokens for a user.

    Returns (access_token, refresh_token).
    The refresh token is stored in the database.
    """
    access_token = create_access_token(user.id, user.email)
    refresh_token, expires_at = create_refresh_token(user.id)

    # Store refresh token in database
    db_token = RefreshToken(
        user_id=user.id,
        token=refresh_token,
        expires_at=expires_at,
    )
    db.add(db_token)
    db.commit()

    return access_token, refresh_token


def refresh_access_token(db: Session, refresh_token: str) -> str:
    """
    Refresh an access token using a valid refresh token.

    Raises InvalidRefreshTokenError if the refresh token is invalid,
    expired, or revoked.
    """
    # Decode and validate the token
    try:
        payload = decode_refresh_token(refresh_token)
    except TokenError as e:
        raise InvalidRefreshTokenError(str(e))

    user_id = payload.get("user_id")
    if not user_id:
        raise InvalidRefreshTokenError("Invalid token payload")

    # Check if token exists in database and is not revoked
    db_token = (
        db.query(RefreshToken)
        .filter(
            RefreshToken.token == refresh_token,
            RefreshToken.user_id == user_id,
            RefreshToken.revoked == False,  # noqa: E712
        )
        .first()
    )

    if not db_token:
        raise InvalidRefreshTokenError("Refresh token not found or revoked")

    # Check expiration
    if db_token.expires_at < datetime.now(timezone.utc):
        raise InvalidRefreshTokenError("Refresh token expired")

    # Get user
    user = get_user_by_id(db, user_id)
    if not user or not user.is_active:
        raise InvalidRefreshTokenError("User not found or inactive")

    # Create new access token
    access_token = create_access_token(user.id, user.email)
    return access_token


def revoke_refresh_token(db: Session, refresh_token: str) -> bool:
    """
    Revoke a refresh token (logout).

    Returns True if token was found and revoked, False otherwise.
    """
    db_token = (
        db.query(RefreshToken)
        .filter(RefreshToken.token == refresh_token)
        .first()
    )

    if db_token:
        db_token.revoked = True
        db.commit()
        return True

    return False


def set_user_password(db: Session, user: User, password: str) -> int:
    """
    Replace a user's password and sign them out of every device.

    Both changes land in one commit, inside revoke_all_user_tokens.
    Returns the number of refresh tokens revoked.
    """
    user.hashed_password = hash_password(password)
    return revoke_all_user_tokens(db, user.id)


def _hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_password_reset_token(
    db: Session, user: User, hours: int = DEFAULT_RESET_TOKEN_HOURS
) -> str:
    """
    Create a one-time password reset token, cancelling any earlier unused one.

    Returns the raw token. Only its hash is stored, so this is the one chance
    to read it. A fast hash is safe here because the token is 256 random bits.
    """
    now = datetime.now(timezone.utc)
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.used_at.is_(None),
    ).update({"used_at": now})

    token = secrets.token_urlsafe(32)
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=_hash_reset_token(token),
            expires_at=now + timedelta(hours=hours),
        )
    )
    db.commit()
    return token


def consume_password_reset_token(db: Session, token: str, new_password: str) -> None:
    """
    Spend a reset token to set a new password, signing the user out everywhere.

    Raises InvalidResetTokenError if the token can't be used.
    """
    token_hash = _hash_reset_token(token)
    # A conditional update, so two simultaneous requests can't both claim it.
    claimed = (
        db.query(PasswordResetToken)
        .filter(
            PasswordResetToken.token_hash == token_hash,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.expires_at > datetime.now(timezone.utc),
        )
        .update({"used_at": datetime.now(timezone.utc)})
    )
    if not claimed:
        db.rollback()
        raise InvalidResetTokenError("This reset link is invalid or has expired")

    reset_token = (
        db.query(PasswordResetToken)
        .filter(PasswordResetToken.token_hash == token_hash)
        .one()
    )
    user = get_user_by_id(db, reset_token.user_id)
    if not user or not user.is_active:
        db.rollback()
        raise InvalidResetTokenError("This reset link is invalid or has expired")

    set_user_password(db, user, new_password)


def revoke_all_user_tokens(db: Session, user_id: int) -> int:
    """
    Revoke all refresh tokens for a user.

    Returns the number of tokens revoked.
    """
    result = (
        db.query(RefreshToken)
        .filter(
            RefreshToken.user_id == user_id,
            RefreshToken.revoked == False,  # noqa: E712
        )
        .update({"revoked": True})
    )
    db.commit()
    return result
