"""JWT token creation and validation utilities."""

import os
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

# Configuration from environment variables with defaults
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-secret-key-change-in-production")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
JWT_ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
JWT_REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("JWT_REFRESH_TOKEN_EXPIRE_DAYS", "7"))


class TokenError(Exception):
    """Raised when token validation fails."""

    pass


def create_access_token(user_id: int, email: str) -> str:
    """Create a JWT access token."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "user_id": user_id,
        "email": email,
        "type": "access",
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: int) -> tuple[str, datetime]:
    """Create a JWT refresh token. Returns (token, expires_at)."""
    expire = datetime.now(timezone.utc) + timedelta(days=JWT_REFRESH_TOKEN_EXPIRE_DAYS)
    payload = {
        "user_id": user_id,
        "type": "refresh",
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    token = jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)
    return token, expire


def decode_access_token(token: str) -> dict:
    """
    Decode and validate an access token.

    Returns the token payload if valid.
    Raises TokenError if invalid or expired.
    """
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise TokenError("Invalid token type")
        return payload
    except JWTError as e:
        raise TokenError(f"Invalid token: {e}")


def decode_refresh_token(token: str) -> dict:
    """
    Decode and validate a refresh token.

    Returns the token payload if valid.
    Raises TokenError if invalid or expired.
    """
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise TokenError("Invalid token type")
        return payload
    except JWTError as e:
        raise TokenError(f"Invalid token: {e}")
