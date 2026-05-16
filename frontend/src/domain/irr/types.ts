/** Domain types for the Drivers / IRR analysis. */

export type IrrScope = 'realized' | 'unrealized'
export type DailyView = 'mixed' | 'winners' | 'losers'

/** Per-transaction IRR metrics. */
export interface TradeIrr {
  tradeId: number
  ticker: string
  tickerName: string | null
  currency: string
  status: string
  dateOrdered: string | null
  exitDate: string | null
  holdingDays: number
  investmentNative: number
  profitNative: number
  investmentBase: number
  profitBase: number
  returnPct: number
  /** Simple linear annualized return: returnPct / holdingDays * 365. */
  tir: number
  /** True compound (money-weighted) IRR. Null when off the chart / undefined. */
  xirr: number | null
  isWinner: boolean
}

/** Aggregated IRR for a ticker (all its trades) or the whole portfolio. */
export interface GroupIrr {
  label: string
  tickerName: string | null
  tradeCount: number
  investmentBase: number
  profitBase: number
  returnPct: number
  avgHoldingDays: number
  tir: number
  xirr: number | null
}

export interface ScopeBlock {
  transactions: TradeIrr[]
  byTicker: GroupIrr[]
  portfolio: GroupIrr | null
}

/** One calendar day of closed-trade activity. */
export interface DailyPoint {
  date: string
  tradeCount: number
  investmentBase: number
  profitBase: number
  returnPct: number
  avgHoldingDays: number
  /** Annualized daily TIR. */
  tir: number
  /** Enhanced metric — populated for the 'mixed' view only. */
  enhancedReturnPct: number | null
  enhancedTir: number | null
  idlePoolBase: number | null
  idleTradeCount: number | null
}

export interface DailyBlock {
  mixed: DailyPoint[]
  winners: DailyPoint[]
  losers: DailyPoint[]
}

export interface IrrAnalysis {
  baseCurrency: string
  realized: ScopeBlock
  unrealized: ScopeBlock
  daily: DailyBlock
}

// ── Wire DTOs (snake_case, as returned by the backend) ──

export interface TradeIrrDto {
  trade_id: number
  ticker: string
  ticker_name: string | null
  currency: string
  status: string
  date_ordered: string | null
  exit_date: string | null
  holding_days: number
  investment_native: number
  profit_native: number
  investment_base: number
  profit_base: number
  return_pct: number
  tir: number
  xirr: number | null
  is_winner: boolean
}

export interface GroupIrrDto {
  label: string
  ticker_name: string | null
  trade_count: number
  investment_base: number
  profit_base: number
  return_pct: number
  avg_holding_days: number
  tir: number
  xirr: number | null
}

export interface ScopeBlockDto {
  transactions: TradeIrrDto[]
  by_ticker: GroupIrrDto[]
  portfolio: GroupIrrDto | null
}

export interface DailyPointDto {
  date: string
  trade_count: number
  investment_base: number
  profit_base: number
  return_pct: number
  avg_holding_days: number
  tir: number
  enhanced_return_pct: number | null
  enhanced_tir: number | null
  idle_pool_base: number | null
  idle_trade_count: number | null
}

export interface IrrAnalysisDto {
  base_currency: string
  realized: ScopeBlockDto
  unrealized: ScopeBlockDto
  daily: {
    mixed: DailyPointDto[]
    winners: DailyPointDto[]
    losers: DailyPointDto[]
  }
}
