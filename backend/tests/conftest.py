"""Pytest configuration and fixtures."""

from collections.abc import Generator
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from asistrader.auth.jwt import create_access_token
from asistrader.auth.password import hash_password
from asistrader.db.database import get_db
from asistrader.main import app
from asistrader.models.db import Base, Bias, MarketData, Strategy, Ticker, Trade, TradeStatus, User

# Use in-memory SQLite for tests
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    """Create a fresh database session for each test."""
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client(db_session: Session) -> Generator[TestClient, None, None]:
    """Create a test client with database dependency override."""

    def override_get_db() -> Generator[Session, None, None]:
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def sample_strategy(db_session: Session) -> Strategy:
    """Create a sample strategy."""
    strategy = Strategy(
        id=1,
        name="Swing_82",
        pe_method="Breakout above resistance",
        sl_method="Below recent swing low",
        tp_method="2R target",
        description="Swing trading strategy with 82% win rate",
    )
    db_session.add(strategy)
    db_session.commit()
    return strategy


@pytest.fixture
def sample_ticker(db_session: Session, sample_strategy: Strategy) -> Ticker:
    """Create a sample ticker."""
    ticker = Ticker(
        symbol="ASML",
        name="ASML Holding N.V.",
        probability=0.75,
        trend_mean_growth=0.12,
        trend_std_deviation=0.05,
        bias=Bias.LONG,
        horizon="swing",
        strategy_id=sample_strategy.id,
    )
    db_session.add(ticker)
    db_session.commit()
    return ticker


@pytest.fixture
def sample_trade(
    db_session: Session, sample_ticker: Ticker, sample_strategy: Strategy, sample_user: User
) -> Trade:
    """Create a sample trade."""
    trade = Trade(
        id=1,
        number=1,
        ticker=sample_ticker.symbol,
        status=TradeStatus.OPEN,
        amount=1000.0,
        units=10,
        entry_price=100.0,
        stop_loss=95.0,
        take_profit=115.0,
        date_planned=date(2025, 1, 15),
        date_actual=date(2025, 1, 16),
        strategy_id=sample_strategy.id,
        user_id=sample_user.id,
    )
    db_session.add(trade)
    db_session.commit()
    return trade


@pytest.fixture
def sample_market_data(db_session: Session, sample_ticker: Ticker) -> list[MarketData]:
    """Create sample market data."""
    data = [
        MarketData(
            ticker=sample_ticker.symbol,
            date=date(2024, 1, 2),
            open=100.0,
            high=105.0,
            low=99.0,
            close=104.0,
            volume=1000000.0,
        ),
        MarketData(
            ticker=sample_ticker.symbol,
            date=date(2024, 1, 3),
            open=104.0,
            high=108.0,
            low=103.0,
            close=107.0,
            volume=1200000.0,
        ),
        MarketData(
            ticker=sample_ticker.symbol,
            date=date(2024, 1, 4),
            open=107.0,
            high=110.0,
            low=106.0,
            close=109.0,
            volume=1100000.0,
        ),
    ]
    db_session.add_all(data)
    db_session.commit()
    return data


@pytest.fixture
def sample_user(db_session: Session) -> User:
    """Create a sample user for authentication tests."""
    user = User(
        id=1,
        email="test@example.com",
        hashed_password=hash_password("testpassword123"),
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def auth_headers(sample_user: User) -> dict[str, str]:
    """Create authentication headers with a valid access token."""
    token = create_access_token(sample_user.id, sample_user.email)
    return {"Authorization": f"Bearer {token}"}
