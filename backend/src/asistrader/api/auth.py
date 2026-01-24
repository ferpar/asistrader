"""Authentication API endpoints."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from asistrader.auth.dependencies import get_current_user
from asistrader.db.database import get_db
from asistrader.models.db import User
from asistrader.models.schemas import (
    AccessTokenResponse,
    AuthResponse,
    LogoutRequest,
    MessageResponse,
    RefreshTokenRequest,
    TokenResponse,
    UserLoginRequest,
    UserRegisterRequest,
    UserSchema,
)
from asistrader.services.auth_service import (
    InvalidCredentialsError,
    InvalidRefreshTokenError,
    UserExistsError,
    authenticate_user,
    create_tokens,
    refresh_access_token,
    register_user,
    revoke_refresh_token,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(request: UserRegisterRequest, db: Session = Depends(get_db)) -> AuthResponse:
    """
    Register a new user.

    Returns the user info and authentication tokens.
    """
    try:
        user = register_user(db, request.email, request.password)
    except UserExistsError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))

    access_token, refresh_token = create_tokens(db, user)

    return AuthResponse(
        user=UserSchema.model_validate(user),
        tokens=TokenResponse(
            access_token=access_token,
            refresh_token=refresh_token,
        ),
    )


@router.post("/login", response_model=AuthResponse)
def login(request: UserLoginRequest, db: Session = Depends(get_db)) -> AuthResponse:
    """
    Authenticate a user and return tokens.

    Returns the user info and authentication tokens.
    """
    try:
        user = authenticate_user(db, request.email, request.password)
    except InvalidCredentialsError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token, refresh_token = create_tokens(db, user)

    return AuthResponse(
        user=UserSchema.model_validate(user),
        tokens=TokenResponse(
            access_token=access_token,
            refresh_token=refresh_token,
        ),
    )


@router.post("/refresh", response_model=AccessTokenResponse)
def refresh(request: RefreshTokenRequest, db: Session = Depends(get_db)) -> AccessTokenResponse:
    """
    Refresh an access token using a valid refresh token.

    Returns a new access token.
    """
    try:
        access_token = refresh_access_token(db, request.refresh_token)
    except InvalidRefreshTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
            headers={"WWW-Authenticate": "Bearer"},
        )

    return AccessTokenResponse(access_token=access_token)


@router.post("/logout", response_model=MessageResponse)
def logout(request: LogoutRequest, db: Session = Depends(get_db)) -> MessageResponse:
    """
    Logout by revoking the refresh token.

    The access token will remain valid until it expires.
    """
    revoked = revoke_refresh_token(db, request.refresh_token)

    if revoked:
        return MessageResponse(message="Successfully logged out")
    else:
        return MessageResponse(message="Token not found or already revoked")


@router.get("/me", response_model=UserSchema)
def get_me(current_user: User = Depends(get_current_user)) -> UserSchema:
    """
    Get the current authenticated user's info.

    Requires a valid access token in the Authorization header.
    """
    return UserSchema.model_validate(current_user)
