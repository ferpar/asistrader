"""Pydantic schemas for API request/response validation."""

from datetime import date
from enum import Enum
from typing import Literal

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
    risk_pct: float
    profit_pct: float
    ratio: float

    model_config = {"from_attributes": True}


class TradeListResponse(BaseModel):
    """Response schema for trade list endpoint."""

    trades: list[TradeSchema]
    count: int


class FetchMarketDataRequest(BaseModel):
    """Request schema for fetching market data."""

    start_date: date
    end_date: date


class ExtendMarketDataRequest(BaseModel):
    """Request schema for extending market data series."""

    direction: Literal["forward", "backward"]
    target_date: date


class MarketDataSchema(BaseModel):
    """Schema for market data."""

    id: int
    ticker: str
    date: date
    open: float | None = None
    high: float | None = None
    low: float | None = None
    close: float | None = None
    volume: float | None = None

    model_config = {"from_attributes": True}


class MarketDataListResponse(BaseModel):
    """Response schema for market data list endpoint."""

    data: list[MarketDataSchema]
    count: int
    earliest_date: date | None = None
    latest_date: date | None = None


class BulkFetchRequest(BaseModel):
    """Request schema for bulk fetching market data."""

    start_date: date
    end_date: date
    symbols: list[str] | None = None


class BulkFetchResponse(BaseModel):
    """Response schema for bulk fetch operation."""

    results: dict[str, int]
    total_rows: int
    errors: dict[str, str]


class BulkExtendRequest(BaseModel):
    """Request schema for bulk extending market data."""

    direction: Literal["forward", "backward"]
    target_date: date
    symbols: list[str] | None = None


class BulkExtendResponse(BaseModel):
    """Response schema for bulk extend operation."""

    results: dict[str, int]
    total_rows: int
    errors: dict[str, str]


class SyncRequest(BaseModel):
    """Request schema for syncing market data."""

    start_date: date
    symbols: list[str] | None = None  # None = all tickers


class SyncResponse(BaseModel):
    """Response schema for sync operation."""

    results: dict[str, int]  # symbol -> rows fetched
    total_rows: int
    skipped: list[str]  # symbols that already had complete data
    errors: dict[str, str]
