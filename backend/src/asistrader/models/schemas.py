"""Pydantic schemas for API request/response validation."""

from datetime import date
from enum import Enum

from pydantic import BaseModel


class TradeStatus(str, Enum):
    """Trade status enum."""

    PLAN = "plan"
    OPEN = "open"
    CLOSE = "close"


class ExitType(str, Enum):
    """Exit type enum."""

    SL = "sl"
    TP = "tp"


class Bias(str, Enum):
    """Ticker bias enum."""

    LONG = "long"
    SHORT = "short"
    NEUTRAL = "neutral"


class Beta(str, Enum):
    """Ticker beta/volatility enum."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class StrategySchema(BaseModel):
    """Schema for strategy data."""

    id: int
    name: str
    pe_method: str | None = None
    sl_method: str | None = None
    tp_method: str | None = None
    description: str | None = None

    model_config = {"from_attributes": True}


class TickerSchema(BaseModel):
    """Schema for ticker data."""

    symbol: str
    name: str | None = None
    probability: float | None = None
    trend_mean_growth: float | None = None
    trend_std_deviation: float | None = None
    bias: Bias | None = None
    horizon: str | None = None
    beta: Beta | None = None
    strategy_id: int | None = None

    model_config = {"from_attributes": True}


class TradeSchema(BaseModel):
    """Schema for trade data."""

    id: int
    number: int | None = None
    ticker: str
    status: TradeStatus
    amount: float
    units: int

    # Entry
    entry_price: float
    stop_loss: float
    take_profit: float
    date_planned: date
    date_actual: date | None = None

    # Exit
    exit_date: date | None = None
    exit_type: ExitType | None = None
    exit_price: float | None = None

    # Strategy
    strategy_id: int | None = None
    strategy_name: str | None = None

    # Calculated fields
    risk_abs: float
    profit_abs: float

    model_config = {"from_attributes": True}


class TradeListResponse(BaseModel):
    """Response schema for trade list endpoint."""

    trades: list[TradeSchema]
    count: int
