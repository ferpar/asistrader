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
  /** Slice of profitBase attributable to FX moves; 0 when currency == base. */
  fxDriftBase: number
}

/** Aggregated IRR for a ticker (all its trades) or the whole portfolio. */
export interface GroupIrr {
  label: string
  tickerName: string | null
  /** Native currency of the ticker; null for the portfolio summary. */
  currency: string | null
  tradeCount: number
  investmentBase: number
  profitBase: number
  returnPct: number
  avgHoldingDays: number
  tir: number
  xirr: number | null
  fxDriftBase: number
}

export interface ScopeBlock {
  transactions: TradeIrr[]
  /** Per-ticker aggregation over every trade (the "mixed" view). */
  byTicker: GroupIrr[]
  /** Per-ticker aggregation over winning trades only. */
  byTickerWinners: GroupIrr[]
  /** Per-ticker aggregation over losing trades only. */
  byTickerLosers: GroupIrr[]
  /** Portfolio aggregation over every trade. */
  portfolio: GroupIrr | null
  /** Portfolio aggregation over winning trades only. */
  portfolioWinners: GroupIrr | null
  /** Portfolio aggregation over losing trades only. */
  portfolioLosers: GroupIrr | null
}

/** Mixed / winners / losers view governing a scope's summary, by-ticker and
 *  by-transaction breakdowns. */
export type TickerView = 'mixed' | 'winners' | 'losers'

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

/** One status bucket in the active-trade composition snapshot. */
export interface PipelineSlice {
  /** "Plan" | "Ordered" | "Open". */
  label: string
  tradeCount: number
  /** Share of total active by trade count, 0..1. */
  countPct: number
  /** Intended/committed capital in base ccy (open = current mark when known). */
  capitalBase: number
  /** Share of total active by capital, 0..1. */
  capitalPct: number
}

/** Snapshot of how active trades are distributed across plan → ordered → open. */
export interface Pipeline {
  totalCount: number
  totalCapitalBase: number
  /** Always in [plan, ordered, open] order. */
  slices: PipelineSlice[]
  /** Headline ratios; null when open bucket is empty (ratio undefined). */
  orderedToOpenCount: number | null
  orderedToOpenCapital: number | null
}

export interface IrrAnalysis {
  baseCurrency: string
  pipeline: Pipeline
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
  fx_drift_base: number
}

export interface GroupIrrDto {
  label: string
  ticker_name: string | null
  currency: string | null
  trade_count: number
  investment_base: number
  profit_base: number
  return_pct: number
  avg_holding_days: number
  tir: number
  xirr: number | null
  fx_drift_base: number
}

export interface ScopeBlockDto {
  transactions: TradeIrrDto[]
  by_ticker: GroupIrrDto[]
  by_ticker_winners: GroupIrrDto[]
  by_ticker_losers: GroupIrrDto[]
  portfolio: GroupIrrDto | null
  portfolio_winners: GroupIrrDto | null
  portfolio_losers: GroupIrrDto | null
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

export interface PipelineSliceDto {
  label: string
  trade_count: number
  count_pct: number
  capital_base: number
  capital_pct: number
}

export interface PipelineDto {
  total_count: number
  total_capital_base: number
  slices: PipelineSliceDto[]
  ordered_to_open_count: number | null
  ordered_to_open_capital: number | null
}

export interface IrrAnalysisDto {
  base_currency: string
  pipeline: PipelineDto
  realized: ScopeBlockDto
  unrealized: ScopeBlockDto
  daily: {
    mixed: DailyPointDto[]
    winners: DailyPointDto[]
    losers: DailyPointDto[]
  }
}
