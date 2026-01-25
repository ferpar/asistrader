"""SQLAlchemy database models."""

from datetime import date, datetime, timezone
from enum import Enum as PyEnum

from sqlalchemy import Boolean, Column, Date, DateTime, Enum, Float, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    """Base class for all models."""

    pass


class TradeStatus(str, PyEnum):
    """Trade status enum."""

    PLAN = "plan"
    OPEN = "open"
    CLOSE = "close"


class ExitType(str, PyEnum):
    """Exit type enum."""

    SL = "sl"
    TP = "tp"


class Bias(str, PyEnum):
    """Ticker bias enum."""

    LONG = "long"
    SHORT = "short"
    NEUTRAL = "neutral"


class Beta(str, PyEnum):
    """Ticker beta/volatility enum."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class User(Base):
    """User model for authentication."""

    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    trades = relationship("Trade", back_populates="user_rel")
    refresh_tokens = relationship("RefreshToken", back_populates="user_rel")


class RefreshToken(Base):
    """Refresh token model for JWT authentication."""

    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    token = Column(String, unique=True, nullable=False, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user_rel = relationship("User", back_populates="refresh_tokens")


class Strategy(Base):
    """Strategy model representing a trading strategy."""

    __tablename__ = "strategies"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False, unique=True)
    pe_method = Column(String, nullable=True)
    sl_method = Column(String, nullable=True)
    tp_method = Column(String, nullable=True)
    description = Column(String, nullable=True)

    # Relationships
    tickers = relationship("Ticker", back_populates="strategy_rel")
    trades = relationship("Trade", back_populates="strategy_rel")


class Ticker(Base):
    """Ticker model representing a stock/asset."""

    __tablename__ = "tickers"

    symbol = Column(String, primary_key=True)
    name = Column(String, nullable=True)
    probability = Column(Float, nullable=True)
    trend_mean_growth = Column(Float, nullable=True)
    trend_std_deviation = Column(Float, nullable=True)
    bias = Column(
        Enum(Bias, values_callable=lambda x: [e.value for e in x]), nullable=True
    )
    horizon = Column(String, nullable=True)
    beta = Column(
        Enum(Beta, values_callable=lambda x: [e.value for e in x]), nullable=True
    )
    strategy_id = Column(Integer, ForeignKey("strategies.id"), nullable=True)

    trades = relationship("Trade", back_populates="ticker_rel")
    strategy_rel = relationship("Strategy", back_populates="tickers")
    market_data = relationship("MarketData", back_populates="ticker_rel", order_by="MarketData.date")


class Trade(Base):
    """Trade model representing a trading operation."""

    __tablename__ = "trades"

    id = Column(Integer, primary_key=True)
    number = Column(Integer, nullable=True)
    ticker = Column(String, ForeignKey("tickers.symbol"))
    status = Column(Enum(TradeStatus), default=TradeStatus.PLAN)
    amount = Column(Float)
    units = Column(Integer)

    # Entry
    entry_price = Column(Float)
    stop_loss = Column(Float)
    take_profit = Column(Float)
    date_planned = Column(Date)
    date_actual = Column(Date, nullable=True)

    # Exit
    exit_date = Column(Date, nullable=True)
    exit_type = Column(Enum(ExitType), nullable=True)
    exit_price = Column(Float, nullable=True)

    # Paper trading
    paper_trade = Column(Boolean, default=False)

    # Strategy
    strategy_id = Column(Integer, ForeignKey("strategies.id"), nullable=True)

    # User (owner)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Relationships
    ticker_rel = relationship("Ticker", back_populates="trades")
    strategy_rel = relationship("Strategy", back_populates="trades")
    user_rel = relationship("User", back_populates="trades")

    @property
    def risk_abs(self) -> float:
        """Calculate absolute risk."""
        if self.stop_loss and self.entry_price and self.units:
            return (self.stop_loss - self.entry_price) * self.units
        return 0.0

    @property
    def profit_abs(self) -> float:
        """Calculate absolute profit potential."""
        if self.take_profit and self.entry_price and self.units:
            return (self.take_profit - self.entry_price) * self.units
        return 0.0

    @property
    def risk_pct(self) -> float:
        """Calculate risk as percentage of amount."""
        if self.amount and self.amount != 0:
            return self.risk_abs / self.amount
        return 0.0

    @property
    def profit_pct(self) -> float:
        """Calculate profit as percentage of amount."""
        if self.amount and self.amount != 0:
            return self.profit_abs / self.amount
        return 0.0

    @property
    def ratio(self) -> float:
        """Calculate reward/risk ratio."""
        if self.risk_abs and self.risk_abs != 0:
            return -self.profit_abs / self.risk_abs
        return 0.0


class MarketData(Base):
    """Market data model representing OHLCV data for a ticker."""

    __tablename__ = "market_data"

    id = Column(Integer, primary_key=True)
    ticker = Column(String, ForeignKey("tickers.symbol"), nullable=False)
    date = Column(Date, nullable=False)
    open = Column(Float, nullable=True)
    high = Column(Float, nullable=True)
    low = Column(Float, nullable=True)
    close = Column(Float, nullable=True)
    volume = Column(Float, nullable=True)

    __table_args__ = (
        UniqueConstraint("ticker", "date", name="uq_market_data_ticker_date"),
        Index("ix_market_data_ticker_date", "ticker", "date"),
    )

    ticker_rel = relationship("Ticker", back_populates="market_data")
