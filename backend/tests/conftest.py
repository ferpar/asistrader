"""Pytest configuration and fixtures."""

from collections.abc import Generator
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from asistrader.db.database import get_db
from asistrader.main import app
from asistrader.models.db import Base, Ticker, Trade, TradeStatus

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
def sample_ticker(db_session: Session) -> Ticker:
    """Create a sample ticker."""
    ticker = Ticker(
        symbol="ASML",
        name="ASML Holding N.V.",
        ai_success_probability=0.75,
        trend_mean_growth=0.12,
        trend_std_deviation=0.05,
    )
    db_session.add(ticker)
    db_session.commit()
    return ticker


@pytest.fixture
def sample_trade(db_session: Session, sample_ticker: Ticker) -> Trade:
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
    )
    db_session.add(trade)
    db_session.commit()
    return trade
