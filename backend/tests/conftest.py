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
from asistrader.models.db import (
    Base,
    Bias,
    ExitLevel,
    ExitLevelStatus,
    ExitLevelType,
    MarketData,
    Strategy,
    Ticker,
    Trade,
    TradeStatus,
    User,
)

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
    """Create a sample trade with exit levels."""
    trade = Trade(
        id=1,
        number=1,
        ticker=sample_ticker.symbol,
        status=TradeStatus.OPEN,
        amount=1000.0,
        units=10,
        entry_price=100.0,
        date_planned=date(2025, 1, 15),
        date_actual=date(2025, 1, 16),
        strategy_id=sample_strategy.id,
        user_id=sample_user.id,
        remaining_units=10,
    )
    db_session.add(trade)
    db_session.commit()

    # Add exit levels (SL=95, TP=115)
    exit_levels = [
        ExitLevel(
            trade_id=trade.id,
            level_type=ExitLevelType.SL,
            price=95.0,
            units_pct=1.0,
            order_index=1,
            status=ExitLevelStatus.PENDING,
            move_sl_to_breakeven=False,
        ),
        ExitLevel(
            trade_id=trade.id,
            level_type=ExitLevelType.TP,
            price=115.0,
            units_pct=1.0,
            order_index=1,
            status=ExitLevelStatus.PENDING,
            move_sl_to_breakeven=False,
        ),
    ]
    db_session.add_all(exit_levels)
    db_session.commit()
    db_session.refresh(trade)
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


# --- Layered Trade Fixtures ---


@pytest.fixture
def sample_layered_trade(
    db_session: Session, sample_ticker: Ticker, sample_strategy: Strategy, sample_user: User
) -> Trade:
    """Create a layered trade with basic exit levels (for testing level replacement)."""
    trade = Trade(
        ticker=sample_ticker.symbol,
        status=TradeStatus.OPEN,
        amount=10000.0,
        units=100,
        entry_price=100.0,
        date_planned=date(2025, 1, 15),
        date_actual=date(2025, 1, 16),
        strategy_id=sample_strategy.id,
        user_id=sample_user.id,
        is_layered=True,
        remaining_units=100,
    )
    db_session.add(trade)
    db_session.commit()

    # Add basic exit levels (SL=95, TP=110)
    exit_levels = [
        ExitLevel(
            trade_id=trade.id,
            level_type=ExitLevelType.SL,
            price=95.0,
            units_pct=1.0,
            order_index=1,
            status=ExitLevelStatus.PENDING,
            move_sl_to_breakeven=False,
        ),
        ExitLevel(
            trade_id=trade.id,
            level_type=ExitLevelType.TP,
            price=110.0,
            units_pct=1.0,
            order_index=1,
            status=ExitLevelStatus.PENDING,
            move_sl_to_breakeven=False,
        ),
    ]
    db_session.add_all(exit_levels)
    db_session.commit()
    db_session.refresh(trade)
    return trade


@pytest.fixture
def sample_layered_trade_with_levels(
    db_session: Session, sample_ticker: Ticker, sample_strategy: Strategy, sample_user: User
) -> Trade:
    """Create a layered trade with TP and SL levels."""
    trade = Trade(
        ticker=sample_ticker.symbol,
        status=TradeStatus.OPEN,
        amount=10000.0,
        units=100,
        entry_price=100.0,
        date_planned=date(2025, 1, 15),
        date_actual=date(2025, 1, 16),
        strategy_id=sample_strategy.id,
        user_id=sample_user.id,
        is_layered=True,
        remaining_units=100,
    )
    db_session.add(trade)
    db_session.commit()

    # Add TP levels: 50% at 110, 30% at 120, 20% at 130
    tp_levels = [
        ExitLevel(
            trade_id=trade.id,
            level_type=ExitLevelType.TP,
            price=110.0,
            units_pct=0.5,
            order_index=1,
            status=ExitLevelStatus.PENDING,
            move_sl_to_breakeven=False,
        ),
        ExitLevel(
            trade_id=trade.id,
            level_type=ExitLevelType.TP,
            price=120.0,
            units_pct=0.3,
            order_index=2,
            status=ExitLevelStatus.PENDING,
            move_sl_to_breakeven=False,
        ),
        ExitLevel(
            trade_id=trade.id,
            level_type=ExitLevelType.TP,
            price=130.0,
            units_pct=0.2,
            order_index=3,
            status=ExitLevelStatus.PENDING,
            move_sl_to_breakeven=False,
        ),
    ]
    # Add SL level: 100% at 95
    sl_level = ExitLevel(
        trade_id=trade.id,
        level_type=ExitLevelType.SL,
        price=95.0,
        units_pct=1.0,
        order_index=1,
        status=ExitLevelStatus.PENDING,
        move_sl_to_breakeven=False,
    )
    db_session.add_all(tp_levels)
    db_session.add(sl_level)
    db_session.commit()
    db_session.refresh(trade)
    return trade


@pytest.fixture
def sample_layered_long_trade(
    db_session: Session, sample_ticker: Ticker, sample_strategy: Strategy, sample_user: User
) -> Trade:
    """Create a long layered trade with exit levels (SL < entry)."""
    trade = Trade(
        ticker=sample_ticker.symbol,
        status=TradeStatus.OPEN,
        amount=10000.0,
        units=100,
        entry_price=100.0,
        date_planned=date(2025, 1, 15),
        date_actual=date(2025, 1, 16),
        strategy_id=sample_strategy.id,
        user_id=sample_user.id,
        is_layered=True,
        remaining_units=100,
    )
    db_session.add(trade)
    db_session.commit()

    # Add TP levels
    tp_levels = [
        ExitLevel(
            trade_id=trade.id,
            level_type=ExitLevelType.TP,
            price=110.0,
            units_pct=0.5,
            order_index=1,
            status=ExitLevelStatus.PENDING,
            move_sl_to_breakeven=False,
        ),
        ExitLevel(
            trade_id=trade.id,
            level_type=ExitLevelType.TP,
            price=120.0,
            units_pct=0.3,
            order_index=2,
            status=ExitLevelStatus.PENDING,
            move_sl_to_breakeven=False,
        ),
        ExitLevel(
            trade_id=trade.id,
            level_type=ExitLevelType.TP,
            price=130.0,
            units_pct=0.2,
            order_index=3,
            status=ExitLevelStatus.PENDING,
            move_sl_to_breakeven=False,
        ),
    ]
    # Add SL level
    sl_level = ExitLevel(
        trade_id=trade.id,
        level_type=ExitLevelType.SL,
        price=95.0,
        units_pct=1.0,
        order_index=1,
        status=ExitLevelStatus.PENDING,
        move_sl_to_breakeven=False,
    )
    db_session.add_all(tp_levels)
    db_session.add(sl_level)
    db_session.commit()
    db_session.refresh(trade)
    return trade


@pytest.fixture
def sample_layered_short_trade(
    db_session: Session, sample_ticker: Ticker, sample_strategy: Strategy, sample_user: User
) -> Trade:
    """Create a short layered trade with exit levels (SL > entry)."""
    trade = Trade(
        ticker=sample_ticker.symbol,
        status=TradeStatus.OPEN,
        amount=10000.0,
        units=100,
        entry_price=100.0,
        date_planned=date(2025, 1, 15),
        date_actual=date(2025, 1, 16),
        strategy_id=sample_strategy.id,
        user_id=sample_user.id,
        is_layered=True,
        remaining_units=100,
    )
    db_session.add(trade)
    db_session.commit()

    # Add TP levels (below entry for short)
    tp_levels = [
        ExitLevel(
            trade_id=trade.id,
            level_type=ExitLevelType.TP,
            price=90.0,
            units_pct=0.5,
            order_index=1,
            status=ExitLevelStatus.PENDING,
            move_sl_to_breakeven=False,
        ),
        ExitLevel(
            trade_id=trade.id,
            level_type=ExitLevelType.TP,
            price=85.0,
            units_pct=0.3,
            order_index=2,
            status=ExitLevelStatus.PENDING,
            move_sl_to_breakeven=False,
        ),
        ExitLevel(
            trade_id=trade.id,
            level_type=ExitLevelType.TP,
            price=80.0,
            units_pct=0.2,
            order_index=3,
            status=ExitLevelStatus.PENDING,
            move_sl_to_breakeven=False,
        ),
    ]
    # Add SL level (above entry for short)
    sl_level = ExitLevel(
        trade_id=trade.id,
        level_type=ExitLevelType.SL,
        price=105.0,
        units_pct=1.0,
        order_index=1,
        status=ExitLevelStatus.PENDING,
        move_sl_to_breakeven=False,
    )
    db_session.add_all(tp_levels)
    db_session.add(sl_level)
    db_session.commit()
    db_session.refresh(trade)
    return trade


@pytest.fixture
def sample_layered_long_trade_multi_sl(
    db_session: Session, sample_ticker: Ticker, sample_strategy: Strategy, sample_user: User
) -> Trade:
    """Create a long layered trade with multiple SL levels."""
    trade = Trade(
        ticker=sample_ticker.symbol,
        status=TradeStatus.OPEN,
        amount=10000.0,
        units=100,
        entry_price=100.0,
        date_planned=date(2025, 1, 15),
        date_actual=date(2025, 1, 16),
        strategy_id=sample_strategy.id,
        user_id=sample_user.id,
        is_layered=True,
        remaining_units=100,
    )
    db_session.add(trade)
    db_session.commit()

    # Add TP level
    tp_level = ExitLevel(
        trade_id=trade.id,
        level_type=ExitLevelType.TP,
        price=110.0,
        units_pct=1.0,
        order_index=1,
        status=ExitLevelStatus.PENDING,
        move_sl_to_breakeven=False,
    )
    # Add multiple SL levels
    sl_levels = [
        ExitLevel(
            trade_id=trade.id,
            level_type=ExitLevelType.SL,
            price=95.0,
            units_pct=0.6,
            order_index=1,
            status=ExitLevelStatus.PENDING,
            move_sl_to_breakeven=False,
        ),
        ExitLevel(
            trade_id=trade.id,
            level_type=ExitLevelType.SL,
            price=90.0,
            units_pct=0.4,
            order_index=2,
            status=ExitLevelStatus.PENDING,
            move_sl_to_breakeven=False,
        ),
    ]
    db_session.add(tp_level)
    db_session.add_all(sl_levels)
    db_session.commit()
    db_session.refresh(trade)
    return trade


@pytest.fixture
def sample_layered_trade_with_be(
    db_session: Session, sample_ticker: Ticker, sample_strategy: Strategy, sample_user: User
) -> Trade:
    """Create a layered trade with move_sl_to_breakeven enabled on TP1."""
    trade = Trade(
        ticker=sample_ticker.symbol,
        status=TradeStatus.OPEN,
        amount=10000.0,
        units=100,
        entry_price=100.0,
        date_planned=date(2025, 1, 15),
        date_actual=date(2025, 1, 16),
        strategy_id=sample_strategy.id,
        user_id=sample_user.id,
        is_layered=True,
        remaining_units=100,
    )
    db_session.add(trade)
    db_session.commit()

    # Add TP levels with move_sl_to_breakeven on TP1
    tp_levels = [
        ExitLevel(
            trade_id=trade.id,
            level_type=ExitLevelType.TP,
            price=110.0,
            units_pct=0.5,
            order_index=1,
            status=ExitLevelStatus.PENDING,
            move_sl_to_breakeven=True,  # Enabled!
        ),
        ExitLevel(
            trade_id=trade.id,
            level_type=ExitLevelType.TP,
            price=120.0,
            units_pct=0.3,
            order_index=2,
            status=ExitLevelStatus.PENDING,
            move_sl_to_breakeven=False,
        ),
        ExitLevel(
            trade_id=trade.id,
            level_type=ExitLevelType.TP,
            price=130.0,
            units_pct=0.2,
            order_index=3,
            status=ExitLevelStatus.PENDING,
            move_sl_to_breakeven=False,
        ),
    ]
    # Add SL level
    sl_level = ExitLevel(
        trade_id=trade.id,
        level_type=ExitLevelType.SL,
        price=95.0,
        units_pct=1.0,
        order_index=1,
        status=ExitLevelStatus.PENDING,
        move_sl_to_breakeven=False,
    )
    db_session.add_all(tp_levels)
    db_session.add(sl_level)
    db_session.commit()
    db_session.refresh(trade)
    return trade


@pytest.fixture
def sample_paper_trade(
    db_session: Session, sample_ticker: Ticker, sample_strategy: Strategy, sample_user: User
) -> Trade:
    """Create a simple paper trade (not layered)."""
    trade = Trade(
        ticker=sample_ticker.symbol,
        status=TradeStatus.OPEN,
        amount=10000.0,
        units=100,
        entry_price=100.0,
        date_planned=date(2025, 1, 15),
        date_actual=date(2025, 1, 16),
        strategy_id=sample_strategy.id,
        user_id=sample_user.id,
        paper_trade=True,
        is_layered=False,
        remaining_units=100,
    )
    db_session.add(trade)
    db_session.commit()

    # Add exit levels (SL=95, TP=115)
    exit_levels = [
        ExitLevel(
            trade_id=trade.id,
            level_type=ExitLevelType.SL,
            price=95.0,
            units_pct=1.0,
            order_index=1,
            status=ExitLevelStatus.PENDING,
            move_sl_to_breakeven=False,
        ),
        ExitLevel(
            trade_id=trade.id,
            level_type=ExitLevelType.TP,
            price=115.0,
            units_pct=1.0,
            order_index=1,
            status=ExitLevelStatus.PENDING,
            move_sl_to_breakeven=False,
        ),
    ]
    db_session.add_all(exit_levels)
    db_session.commit()
    db_session.refresh(trade)
    return trade


# --- Market Data Fixtures for Layered Trades ---


@pytest.fixture
def market_data_tp1_hit(db_session: Session, sample_ticker: Ticker) -> list[MarketData]:
    """Market data where price reaches TP1 (110) but not TP2 (120)."""
    data = [
        MarketData(
            ticker=sample_ticker.symbol,
            date=date(2025, 1, 17),
            open=100.0,
            high=112.0,  # Above TP1 (110), below TP2 (120)
            low=99.0,
            close=111.0,
            volume=1000000.0,
        ),
    ]
    db_session.add_all(data)
    db_session.commit()
    return data


@pytest.fixture
def market_data_tp1_hit_short(db_session: Session, sample_ticker: Ticker) -> list[MarketData]:
    """Market data where price reaches TP1 (90) for short trade."""
    data = [
        MarketData(
            ticker=sample_ticker.symbol,
            date=date(2025, 1, 17),
            open=100.0,
            high=101.0,
            low=88.0,  # Below TP1 (90) for short
            close=89.0,
            volume=1000000.0,
        ),
    ]
    db_session.add_all(data)
    db_session.commit()
    return data


@pytest.fixture
def market_data_multi_tp_hit(db_session: Session, sample_ticker: Ticker) -> list[MarketData]:
    """Market data where price reaches TP1 and TP2 on same day."""
    data = [
        MarketData(
            ticker=sample_ticker.symbol,
            date=date(2025, 1, 17),
            open=100.0,
            high=125.0,  # Above both TP1 (110) and TP2 (120), below TP3 (130)
            low=99.0,
            close=123.0,
            volume=1000000.0,
        ),
    ]
    db_session.add_all(data)
    db_session.commit()
    return data


@pytest.fixture
def market_data_all_tp_hit(db_session: Session, sample_ticker: Ticker) -> list[MarketData]:
    """Market data where price reaches all TP levels."""
    data = [
        MarketData(
            ticker=sample_ticker.symbol,
            date=date(2025, 1, 17),
            open=100.0,
            high=135.0,  # Above all TP levels (110, 120, 130)
            low=99.0,
            close=132.0,
            volume=1000000.0,
        ),
    ]
    db_session.add_all(data)
    db_session.commit()
    return data


@pytest.fixture
def market_data_flat(db_session: Session, sample_ticker: Ticker) -> list[MarketData]:
    """Market data where price stays flat (no hits)."""
    data = [
        MarketData(
            ticker=sample_ticker.symbol,
            date=date(2025, 1, 17),
            open=100.0,
            high=105.0,  # Below TP1 (110), above SL (95)
            low=98.0,
            close=102.0,
            volume=1000000.0,
        ),
    ]
    db_session.add_all(data)
    db_session.commit()
    return data


@pytest.fixture
def market_data_sl_hit(db_session: Session, sample_ticker: Ticker) -> list[MarketData]:
    """Market data where price hits SL for long trade."""
    data = [
        MarketData(
            ticker=sample_ticker.symbol,
            date=date(2025, 1, 17),
            open=100.0,
            high=101.0,
            low=93.0,  # Below SL (95)
            close=94.0,
            volume=1000000.0,
        ),
    ]
    db_session.add_all(data)
    db_session.commit()
    return data


@pytest.fixture
def market_data_sl_hit_short(db_session: Session, sample_ticker: Ticker) -> list[MarketData]:
    """Market data where price hits SL for short trade."""
    data = [
        MarketData(
            ticker=sample_ticker.symbol,
            date=date(2025, 1, 17),
            open=100.0,
            high=107.0,  # Above SL (105) for short
            low=99.0,
            close=106.0,
            volume=1000000.0,
        ),
    ]
    db_session.add_all(data)
    db_session.commit()
    return data


@pytest.fixture
def market_data_crash(db_session: Session, sample_ticker: Ticker) -> list[MarketData]:
    """Market data with a big crash hitting multiple SL levels."""
    data = [
        MarketData(
            ticker=sample_ticker.symbol,
            date=date(2025, 1, 17),
            open=100.0,
            high=101.0,
            low=85.0,  # Below both SL1 (95) and SL2 (90)
            close=86.0,
            volume=2000000.0,
        ),
    ]
    db_session.add_all(data)
    db_session.commit()
    return data


@pytest.fixture
def market_data_tp_hit_simple(db_session: Session, sample_ticker: Ticker) -> list[MarketData]:
    """Market data where TP is hit for simple (non-layered) trade."""
    data = [
        MarketData(
            ticker=sample_ticker.symbol,
            date=date(2025, 1, 17),
            open=100.0,
            high=120.0,  # Above TP (115)
            low=99.0,
            close=118.0,
            volume=1000000.0,
        ),
    ]
    db_session.add_all(data)
    db_session.commit()
    return data
