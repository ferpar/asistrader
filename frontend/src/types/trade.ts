export type TradeStatus = 'plan' | 'open' | 'close'
export type ExitType = 'sl' | 'tp'
export type ExtendedFilter = 'all' | 'plan' | 'open' | 'close' | 'winners' | 'losers'
export type Bias = 'long' | 'short' | 'neutral'
export type Beta = 'low' | 'medium' | 'high'

export interface Strategy {
  id: number
  name: string
  pe_method: string | null
  sl_method: string | null
  tp_method: string | null
  description: string | null
}

export interface StrategyCreateRequest {
  name: string
  pe_method?: string | null
  sl_method?: string | null
  tp_method?: string | null
  description?: string | null
}

export interface StrategyUpdateRequest {
  name?: string | null
  pe_method?: string | null
  sl_method?: string | null
  tp_method?: string | null
  description?: string | null
}

export interface StrategyListResponse {
  strategies: Strategy[]
  count: number
}

export interface StrategyResponse {
  strategy: Strategy
  message: string
}

export interface Ticker {
  symbol: string
  name: string | null
  probability: number | null
  trend_mean_growth: number | null
  trend_std_deviation: number | null
  bias: Bias | null
  horizon: string | null
  beta: Beta | null
  strategy_id: number | null
}

export interface TickerListResponse {
  tickers: Ticker[]
  count: number
}

export interface TickerSuggestion {
  symbol: string
  name: string | null
  exchange: string | null
  type: string | null // "equity", "etf", etc.
}

export interface TickerSearchResponse {
  suggestions: TickerSuggestion[]
  query: string
}

export interface TickerCreateRequest {
  symbol: string
}

export interface TickerCreateResponse {
  ticker: Ticker
  message: string
}

export interface TickerPriceResponse {
  symbol: string
  price: number | null
  currency: string | null
  valid: boolean
}

export interface Trade {
  id: number
  number: number | null
  ticker: string
  status: TradeStatus
  amount: number
  units: number
  entry_price: number
  stop_loss: number
  take_profit: number
  date_planned: string
  date_actual: string | null
  exit_date: string | null
  exit_type: ExitType | null
  exit_price: number | null
  paper_trade: boolean
  strategy_id: number | null
  strategy_name: string | null
  risk_abs: number
  profit_abs: number
  risk_pct: number
  profit_pct: number
  ratio: number
}

export interface TradeListResponse {
  trades: Trade[]
  count: number
}

export interface TradeCreateRequest {
  ticker: string
  entry_price: number
  stop_loss: number
  take_profit: number
  units: number
  date_planned: string
  strategy_id?: number | null
  paper_trade?: boolean
}

export interface TradeUpdateRequest {
  entry_price?: number
  stop_loss?: number
  take_profit?: number
  units?: number
  status?: TradeStatus
  date_actual?: string
  exit_date?: string
  exit_price?: number
  exit_type?: ExitType
  strategy_id?: number | null
}

export interface TradeResponse {
  trade: Trade
  message: string
}

export interface PriceData {
  price: number | null
  currency: string | null
  valid: boolean
}

export interface BatchPriceRequest {
  symbols: string[]
}

export interface BatchPriceResponse {
  prices: Record<string, PriceData>
}

export interface LiveMetrics {
  currentPrice: number | null
  distanceToSL: number | null   // percentage
  distanceToTP: number | null   // percentage
  distanceToPE: number | null   // percentage from entry price
  unrealizedPnL: number | null  // absolute
  unrealizedPnLPct: number | null
}

export type TradeDirection = 'long' | 'short'

export interface ValidationError {
  field: string
  message: string
}

export interface ValidationResult {
  isValid: boolean
  errors: ValidationError[]
  direction: TradeDirection | null
}

// SL/TP Detection types
export type SLTPHitType = 'sl' | 'tp' | 'both'

export interface SLTPAlert {
  trade_id: number
  ticker: string
  hit_type: SLTPHitType
  hit_date: string
  hit_price: number
  paper_trade: boolean
  auto_closed: boolean
  message: string
}

export interface SLTPDetectionResponse {
  alerts: SLTPAlert[]
  auto_closed_count: number
  conflict_count: number
}
