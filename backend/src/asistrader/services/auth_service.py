"""Authentication business logic service."""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from asistrader.auth.jwt import (
    TokenError,
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
)
from asistrader.auth.password import hash_password, verify_password
from asistrader.models.db import RefreshToken, User


class UserExistsError(Exception):
    """Raised when attempting to register with an existing email."""

    pass


class InvalidCredentialsError(Exception):
    """Raised when login credentials are invalid."""

    pass


class InvalidRefreshTokenError(Exception):
    """Raised when refresh token is invalid, expired, or revoked."""

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
