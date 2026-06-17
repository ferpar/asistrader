"""Pydantic schemas for API request/response validation."""

from datetime import date, datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field


class TradeStatus(str, Enum):
    """Trade status enum."""

    PLAN = "plan"
    ORDERED = "ordered"
    OPEN = "open"
    CLOSE = "close"
    CANCELED = "canceled"


class CancelReason(str, Enum):
    """Cancel reason enum."""

    INPUT_ERROR = "input_error"
    MARKET_CONDITIONS = "market_conditions"
    TICKER_FUNDAMENTALS = "ticker_fundamentals"
    OTHER = "other"


class OrderType(str, Enum):
    """Order type enum."""

    LIMIT = "limit"
    STOP = "stop"
    MARKET = "market"


class TimeInEffect(str, Enum):
    """Time in effect enum for orders."""

    DAY = "day"
    GTC = "gtc"
    GTD = "gtd"


class ExitType(str, Enum):
    """Exit type enum."""

    SL = "sl"
    TP = "tp"


class ExitLevelType(str, Enum):
    """Exit level type enum for layered SL/TP."""

    SL = "sl"
    TP = "tp"


class ExitLevelStatus(str, Enum):
    """Exit level status enum."""

    PENDING = "pending"
    HIT = "hit"
    CANCELLED = "cancelled"


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
    automated: bool = False
    params: dict[str, Any] | None = None

    model_config = {"from_attributes": True}


class StrategyCreateRequest(BaseModel):
    """Request schema for creating a strategy."""

    name: str
    pe_method: str | None = None
    sl_method: str | None = None
    tp_method: str | None = None
    description: str | None = None
    automated: bool = False
    params: dict[str, Any] | None = None


class StrategyUpdateRequest(BaseModel):
    """Request schema for updating a strategy."""

    name: str | None = None
    pe_method: str | None = None
    sl_method: str | None = None
    tp_method: str | None = None
    description: str | None = None
    automated: bool | None = None
    params: dict[str, Any] | None = None


class StrategyListResponse(BaseModel):
    """Response schema for strategy list endpoint."""

    strategies: list[StrategySchema]
    count: int


class StrategyResponse(BaseModel):
    """Response schema for single strategy operations."""

    strategy: StrategySchema
    message: str


class StrategyDraftRequest(BaseModel):
    """Request to draft a trade for a ticker using an automated strategy.

    Any field left unset falls back to the strategy's params, then the engine
    default (PLR 1.5, D1 1, ...).
    """

    ticker: str
    plr: float | None = None
    d1: int | None = None
    side: str | None = None  # "long" | "short"
    order_type: OrderType | None = None
    time_in_effect: TimeInEffect | None = None


class StrategyDraftPreset(BaseModel):
    """One recommended preset with its stats and concrete drafted prices."""

    kind: str  # "regular" | "conservative" | "aggressive"
    d2: int
    win_rate: float | None = None
    expectancy: float | None = None
    expectancy_per_day: float | None = None
    efficiency: float | None = None
    win_rate_ci: tuple[float, float] | None = None
    efficiency_ci: tuple[float, float] | None = None
    n_trials: int
    entry: float
    stop_loss: float
    take_profit: float


class StrategyDraftResponse(BaseModel):
    """Draft recommendation for a ticker, or a low-confidence verdict."""

    confident: bool
    reason: str | None = None
    breakeven_win_rate: float
    fill_rate: float
    ticker: str
    last_bar_date: date | None = None
    speed: float | None = None
    presets: list[StrategyDraftPreset] = []


class RadarPresetSchema(BaseModel):
    """Schema for a saved radar preset.

    `config` is an open sparse partial of the frontend RadarViewState; the
    backend stores and returns it verbatim without inspecting radar keys.
    """

    id: int
    name: str
    config: dict[str, Any]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RadarPresetCreateRequest(BaseModel):
    """Request schema for creating a radar preset."""

    name: str
    config: dict[str, Any] = Field(default_factory=dict)


class RadarPresetUpdateRequest(BaseModel):
    """Request schema for updating a radar preset (rename and/or overwrite config)."""

    name: str | None = None
    config: dict[str, Any] | None = None


class RadarPresetListResponse(BaseModel):
    """Response schema for the radar preset list endpoint."""

    presets: list[RadarPresetSchema]
    count: int


class RadarPresetResponse(BaseModel):
    """Response schema for single radar preset operations."""

    preset: RadarPresetSchema
    message: str


class TickerSchema(BaseModel):
    """Schema for ticker data."""

    symbol: str
    name: str | None = None
    currency: str | None = None
    price_hint: int | None = None
    probability: float | None = None
    trend_mean_growth: float | None = None
    trend_std_deviation: float | None = None
    bias: Bias | None = None
    horizon: str | None = None
    beta: Beta | None = None
    strategy_id: int | None = None

    model_config = {"from_attributes": True}


class TickerListResponse(BaseModel):
    """Response schema for ticker list endpoint."""

    tickers: list[TickerSchema]
    count: int


class TickerSuggestion(BaseModel):
    """Schema for ticker suggestion from Yahoo Finance search."""

    symbol: str
    name: str | None = None
    exchange: str | None = None
    type: str | None = None  # "equity", "etf", etc.


class TickerSearchResponse(BaseModel):
    """Response schema for ticker search endpoint."""

    suggestions: list[TickerSuggestion]
    query: str


class TickerCreateRequest(BaseModel):
    """Request schema for creating a ticker."""

    symbol: str


class TickerCreateResponse(BaseModel):
    """Response schema for ticker creation."""

    ticker: TickerSchema
    message: str


class TickerPriceResponse(BaseModel):
    """Response schema for ticker current price."""

    symbol: str
    price: float | None = None
    currency: str | None = None
    valid: bool


class ExitLevelSchema(BaseModel):
    """Schema for exit level data."""

    id: int
    trade_id: int
    level_type: ExitLevelType
    price: float
    units_pct: float
    order_index: int
    status: ExitLevelStatus
    hit_date: date | None = None
    units_closed: int | None = None
    move_sl_to_breakeven: bool

    model_config = {"from_attributes": True}


class ExitLevelCreateRequest(BaseModel):
    """Request schema for creating an exit level."""

    level_type: Literal["sl", "tp"]
    price: float
    units_pct: float  # 0.0-1.0, must sum to 1.0 for each type
    move_sl_to_breakeven: bool = False


class MarkLevelHitRequest(BaseModel):
    """Request schema for manually marking an exit level as hit."""

    hit_date: date = Field(default_factory=date.today)
    hit_price: float | None = None  # optional override for actual price


class TradeSchema(BaseModel):
    """Schema for trade data."""

    id: int
    number: int | None = None
    ticker: str
    ticker_name: str | None = None
    ticker_currency: str | None = None
    ticker_price_hint: int | None = None
    status: TradeStatus
    amount: float
    units: int

    # Entry
    entry_price: float
    stop_loss: float
    take_profit: float
    date_planned: date
    date_ordered: date | None = None
    date_actual: date | None = None

    # Exit
    exit_date: date | None = None
    exit_type: ExitType | None = None
    exit_price: float | None = None

    # Order details
    order_type: OrderType | None = None
    time_in_effect: TimeInEffect | None = None
    gtd_date: date | None = None

    # Paper trading
    auto_detect: bool

    # Layered SL/TP
    is_layered: bool = False
    remaining_units: int | None = None
    exit_levels: list[ExitLevelSchema] = []

    # Strategy
    strategy_id: int | None = None
    strategy_name: str | None = None
    followed_faithfully: bool | None = None
    strategy_snapshot: dict[str, Any] | None = None

    # Cancellation
    cancel_reason: CancelReason | None = None

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


class TradeCreateRequest(BaseModel):
    """Request schema for creating a trade.

    Must provide either exit_levels OR both stop_loss and take_profit.
    If exit_levels are provided, stop_loss and take_profit are ignored.
    """

    ticker: str
    entry_price: float
    stop_loss: float | None = None  # Optional: creates simple exit_level if no exit_levels
    take_profit: float | None = None  # Optional: creates simple exit_level if no exit_levels
    units: int
    date_planned: date
    strategy_id: int | None = None
    auto_detect: bool = False
    exit_levels: list[ExitLevelCreateRequest] | None = None
    order_type: OrderType | None = None
    time_in_effect: TimeInEffect | None = None
    gtd_date: date | None = None
    # Set when the trade was drafted by an automated strategy.
    followed_faithfully: bool | None = None
    strategy_snapshot: dict[str, Any] | None = None


class TradeUpdateRequest(BaseModel):
    """Request schema for updating a trade.

    SL/TP updates must be done through exit_levels.
    """

    entry_price: float | None = None
    units: int | None = None
    status: TradeStatus | None = None
    date_ordered: date | None = None
    date_actual: date | None = None
    exit_date: date | None = None
    exit_price: float | None = None
    exit_type: ExitType | None = None
    strategy_id: int | None = None
    auto_detect: bool | None = None
    exit_levels: list[ExitLevelCreateRequest] | None = None
    cancel_reason: CancelReason | None = None
    order_type: OrderType | None = None
    time_in_effect: TimeInEffect | None = None
    gtd_date: date | None = None
    followed_faithfully: bool | None = None
    strategy_snapshot: dict[str, Any] | None = None


class TradeResponse(BaseModel):
    """Response schema for single trade operations."""

    trade: TradeSchema
    message: str


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


class BulkMarketDataRequest(BaseModel):
    """Request schema for bulk market data retrieval."""

    symbols: list[str]
    start_date: date


class BulkMarketDataResponse(BaseModel):
    """Response schema for bulk market data retrieval."""

    data: dict[str, list[MarketDataSchema]]
    errors: dict[str, str]


class SyncRequest(BaseModel):
    """Request schema for syncing market data."""

    start_date: date
    symbols: list[str] | None = None  # None = all tickers
    force_refresh: bool = False  # If True, wipe existing rows and re-fetch.


class SyncResponse(BaseModel):
    """Response schema for sync operation."""

    results: dict[str, int]  # symbol -> rows fetched
    total_rows: int
    skipped: list[str]  # symbols that already had complete data
    errors: dict[str, str]
    fx: "FxSyncResponse | None" = None  # populated when ticker sync also refreshed FX


class BenchmarkSchema(BaseModel):
    """Schema for benchmark (non-tradable index) data."""

    symbol: str
    name: str | None = None
    currency: str | None = None

    model_config = {"from_attributes": True}


class BenchmarkListResponse(BaseModel):
    """Response schema for benchmark list endpoint."""

    benchmarks: list[BenchmarkSchema]
    count: int


class BenchmarkCreateRequest(BaseModel):
    """Request schema for creating a benchmark."""

    symbol: str


class BenchmarkCreateResponse(BaseModel):
    """Response schema for benchmark creation."""

    benchmark: BenchmarkSchema
    message: str


class BenchmarkSearchResponse(BaseModel):
    """Response schema for benchmark (index) search."""

    suggestions: list[TickerSuggestion]
    query: str


class BenchmarkMarketDataSchema(BaseModel):
    """Schema for benchmark OHLCV row."""

    id: int
    benchmark: str
    date: date
    open: float | None = None
    high: float | None = None
    low: float | None = None
    close: float | None = None
    volume: float | None = None

    model_config = {"from_attributes": True}


class BulkBenchmarkDataRequest(BaseModel):
    """Request schema for bulk benchmark OHLCV retrieval."""

    symbols: list[str]
    start_date: date


class BulkBenchmarkDataResponse(BaseModel):
    """Response schema for bulk benchmark OHLCV retrieval."""

    data: dict[str, list[BenchmarkMarketDataSchema]]
    errors: dict[str, str]


class BenchmarkSyncRequest(BaseModel):
    """Request schema for syncing benchmark market data."""

    start_date: date
    symbols: list[str] | None = None  # None = all benchmarks


class BenchmarkSyncResponse(BaseModel):
    """Response schema for benchmark sync operation."""

    results: dict[str, int]
    total_rows: int
    skipped: list[str]
    errors: dict[str, str]


class FxRateSchema(BaseModel):
    """Schema for a single FX rate row."""

    currency: str
    date: date
    rate_to_usd: float

    model_config = {"from_attributes": True}


class FxRatesResponse(BaseModel):
    """Response schema for FX rate history lookup."""

    rates: dict[str, list[FxRateSchema]]  # currency -> rows


class FxSyncRequest(BaseModel):
    """Request schema for triggering an FX sync.

    `currencies=None` means: derive from the user's tickers + base currency.
    """

    start_date: date
    currencies: list[str] | None = None


class FxSyncResponse(BaseModel):
    """Response schema for FX sync operation."""

    results: dict[str, int]  # currency -> rows fetched
    total_rows: int
    skipped: list[str]
    errors: dict[str, str]


class BatchPriceRequest(BaseModel):
    """Request schema for batch price lookup."""

    symbols: list[str]


class PriceData(BaseModel):
    """Schema for individual price data."""

    price: float | None = None
    currency: str | None = None
    valid: bool


class BatchPriceResponse(BaseModel):
    """Response schema for batch price lookup."""

    prices: dict[str, PriceData]


# --- Authentication Schemas ---


class UserSchema(BaseModel):
    """Schema for user data."""

    id: int
    email: str
    is_active: bool
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class UserRegisterRequest(BaseModel):
    """Request schema for user registration."""

    email: EmailStr
    password: str


class UserLoginRequest(BaseModel):
    """Request schema for user login."""

    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    """Response schema for authentication tokens."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshTokenRequest(BaseModel):
    """Request schema for token refresh."""

    refresh_token: str


class AccessTokenResponse(BaseModel):
    """Response schema for refreshed access token."""

    access_token: str
    token_type: str = "bearer"


class LogoutRequest(BaseModel):
    """Request schema for logout."""

    refresh_token: str


class AuthResponse(BaseModel):
    """Response schema for auth operations with user and tokens."""

    user: UserSchema
    tokens: TokenResponse


class MessageResponse(BaseModel):
    """Generic message response."""

    message: str


# --- Trade Detection Schemas ---


class SLTPHitType(str, Enum):
    """Type of SL/TP hit."""

    SL = "sl"
    TP = "tp"
    BOTH = "both"


class EntryHitType(str, Enum):
    """Type of entry hit."""

    ENTRY = "entry"


class HitKind(str, Enum):
    """How a level was hit, given we only have daily OHLC bars.

    - intraday:     bar's high/low crossed the level during the session; the
                    realistic fill is the level price (limit/stop order semantics).
    - gap:          bar opened with price already past the level vs the prior
                    bar's close. Order fills at the open, not the level.
    - gap_on_entry: same as gap but on the trade's open day itself — we know
                    the gap happened before any conceivable intraday touch.
    - unverifiable: open-day intraday candidate — the bar's high/low pierces
                    the level but the open did not, so we can't tell whether
                    the touch came before or after the trade actually opened.
    """

    INTRADAY = "intraday"
    GAP = "gap"
    GAP_ON_ENTRY = "gap_on_entry"
    UNVERIFIABLE = "unverifiable"


# Identifying fields for the dismissal blacklist. `alert_kind` + `level_key`
# together with trade_id + hit_date form an alert's signature.


class SLTPAlert(BaseModel):
    """Schema for an SL/TP alert."""

    trade_id: int
    ticker: str
    hit_type: SLTPHitType
    hit_date: date
    hit_price: float
    auto_detect: bool
    auto_closed: bool
    currency: str | None = None
    price_hint: int | None = None
    alert_kind: str = "sltp"
    level_key: str = ""
    dismissed: bool = False
    hit_kind: HitKind = HitKind.INTRADAY
    bar_open: float | None = None
    prev_close: float | None = None
    also_would_have_hit: list[str] = []


class EntryAlert(BaseModel):
    """Schema for an entry price hit alert."""

    trade_id: int
    ticker: str
    hit_type: EntryHitType
    hit_date: date
    entry_price: float
    auto_detect: bool
    auto_opened: bool
    currency: str | None = None
    price_hint: int | None = None
    alert_kind: str = "entry"
    level_key: str = "entry"
    dismissed: bool = False
    hit_kind: HitKind = HitKind.INTRADAY
    bar_open: float | None = None
    prev_close: float | None = None


class LayeredAlert(BaseModel):
    """Schema for a layered exit level hit alert."""

    trade_id: int
    ticker: str
    level_type: str  # "sl" or "tp"
    level_index: int
    hit_date: date
    hit_price: float
    units_closed: int
    remaining_units: int
    auto_detect: bool
    auto_processed: bool
    currency: str | None = None
    price_hint: int | None = None
    alert_kind: str = "layered"
    level_key: str = ""
    dismissed: bool = False
    hit_kind: HitKind = HitKind.INTRADAY
    bar_open: float | None = None
    prev_close: float | None = None
    also_would_have_hit: list[str] = []


class AlertDismissRequest(BaseModel):
    """Request schema for dismissing or restoring a detection alert."""

    trade_id: int
    hit_date: date
    alert_kind: str  # "entry" | "sltp" | "layered"
    level_key: str


class TradeDetectionResponse(BaseModel):
    """Response schema for trade detection endpoint."""

    entry_alerts: list[EntryAlert]
    sltp_alerts: list[SLTPAlert]
    layered_alerts: list[LayeredAlert] = []
    auto_opened_count: int
    auto_closed_count: int
    partial_close_count: int = 0
    conflict_count: int


# --- Fund Management Schemas ---


class FundEventType(str, Enum):
    """Fund event type enum."""

    DEPOSIT = "deposit"
    WITHDRAWAL = "withdrawal"
    RESERVE = "reserve"
    BENEFIT = "benefit"
    LOSS = "loss"


class FundEventSchema(BaseModel):
    """Fund event response schema."""

    id: int
    user_id: int
    event_type: FundEventType
    amount: float
    currency: str
    description: str | None = None
    trade_id: int | None = None
    auto_detect: bool
    voided: bool
    event_date: date
    created_at: datetime

    model_config = {"from_attributes": True}


class FundEventListResponse(BaseModel):
    """Response schema for fund event list endpoint."""

    events: list[FundEventSchema]
    count: int


class DepositRequest(BaseModel):
    """Request schema for depositing funds."""

    amount: float = Field(gt=0)
    currency: str | None = None  # default = user's base
    description: str | None = None
    event_date: date | None = None


class WithdrawalRequest(BaseModel):
    """Request schema for withdrawing funds."""

    amount: float = Field(gt=0)
    currency: str | None = None  # default = user's base
    description: str | None = None
    event_date: date | None = None


class ManualBenefitLossRequest(BaseModel):
    """Request schema for manual benefit/loss events."""

    event_type: Literal["benefit", "loss"]
    amount: float = Field(gt=0)
    currency: str | None = None  # default = user's base
    description: str | None = None
    trade_id: int | None = None
    event_date: date | None = None


class FundEventResponse(BaseModel):
    """Response schema for single fund event operations."""

    event: FundEventSchema
    message: str


class RiskSettingsRequest(BaseModel):
    """Request schema for updating risk / fund settings.

    Both fields are optional so the same endpoint can update either or both.
    """

    risk_pct: float | None = Field(default=None, gt=0, le=1.0)
    base_currency: str | None = None
    detection_margin_pct: float | None = Field(default=None, gt=0, le=0.1)


class RiskSettingsResponse(BaseModel):
    """Response schema for risk / fund settings."""

    risk_pct: float
    base_currency: str
    detection_margin_pct: float


class RepairCurrenciesResponse(BaseModel):
    """Response schema for the repair-currencies endpoint."""

    counts: dict[str, int]  # event_type -> rows repaired
    total: int


# --- Detection trace schemas (mirror sltp_detection_trace.py dataclasses) ---


class LevelCheckSchema(BaseModel):
    """One level evaluated against one bar."""

    key: str
    kind: str           # "sl" | "tp" | "entry"
    side: str           # "long" | "short"
    price: float
    threshold: float
    pierced: bool
    gap: bool


class BarEvalSchema(BaseModel):
    """A single market-data bar as the detector saw it."""

    date: date
    open: float | None
    high: float | None
    low: float | None
    close: float | None
    prev_close: float | None
    checks: list[LevelCheckSchema]
    decision: str       # "skip" | "no_data" | "hit" | "both_hit"
    chosen_keys: list[str]
    reason: str


class ScanTraceSchema(BaseModel):
    """Full scan record for a detection invocation on one trade."""

    kind: str           # "sltp" | "entry" | "layered" | "none"
    trade_id: int | None
    side: str
    margin: float
    scan_from: date | None
    scan_to: date | None
    bars_scanned: int
    bars: list[BarEvalSchema]
    verdict: str
    extras: dict[str, Any] = {}


class DetectionTraceResponse(BaseModel):
    """Wrapper for GET /trades/{id}/detection-trace.

    `what_if` echoes overrides applied for this call so the UI can flag the
    response as a hypothetical and the user can confirm what was actually
    evaluated. Empty when no overrides were supplied.
    """

    trace: ScanTraceSchema
    detector_kind: str  # "sltp" | "entry" | "layered" | "none"
    what_if: dict[str, Any] = {}
