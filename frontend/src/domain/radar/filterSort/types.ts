import type { TickerIndicators } from '../types'
import type { TradeWithMetrics } from '../../trade/types'

export type StructureCategory = 'any' | 'bullish' | 'bearish' | 'mixed'
export type TrendSignFilter = 'any' | 'up' | 'down'
export type RsiZoneFilter = 'any' | 'overbought' | 'oversold' | 'neutral'
export type DivergenceFilter = 'any' | 'present' | 'bullish' | 'bearish' | 'none'
export type ActivityFilter = 'any' | 'hasOpen' | 'hasPlan' | 'hasActive' | 'hasNone'
export type TradeStatusFilter = 'any' | 'plan' | 'ordered' | 'open'
export type PnlSignFilter = 'any' | 'winning' | 'losing'
export type DriftFilter = 'any' | 'ahead' | 'behind' | 'on-pace'
export type ProximityTarget = 'sl' | 'tp' | 'pe'
export type ProximityFilter = null | { target: ProximityTarget; withinPct: number }

export interface TickerScope {
  structure: StructureCategory
  trendSign: TrendSignFilter
  rsiZone: RsiZoneFilter
  divergence: DivergenceFilter
  activity: ActivityFilter
  search: string
  hideErrored: boolean
}

export interface TradeScope {
  status: TradeStatusFilter
  pnlSign: PnlSignFilter
  drift: DriftFilter
  proximity: ProximityFilter
}

export type SortKey =
  | 'symbol'
  | 'activeCount'
  | 'lrSlope50'
  | 'rsi'
  | 'divergenceStrength'
  | 'closestToSL'
  | 'closestToTP'
  | 'closestToPE'
  | 'biggestWinner'
  | 'biggestLoser'
  | 'worstDriftToTP'
  | 'oldestOpenAge'
  | 'oldestPlanAge'

export type SortDir = 'asc' | 'desc'

export interface RadarViewState {
  ticker: TickerScope
  trade: TradeScope
  sort: { key: SortKey; dir: SortDir }
  flatView: boolean
}

export interface TradeRow {
  trade: TradeWithMetrics
  indicator: TickerIndicators
}

export const DEFAULT_VIEW_STATE: RadarViewState = {
  ticker: {
    structure: 'any',
    trendSign: 'any',
    rsiZone: 'any',
    divergence: 'any',
    activity: 'any',
    search: '',
    hideErrored: false,
  },
  trade: {
    status: 'any',
    pnlSign: 'any',
    drift: 'any',
    proximity: null,
  },
  sort: { key: 'symbol', dir: 'asc' },
  flatView: false,
}

export const SORT_KEY_LABELS: Record<SortKey, string> = {
  symbol: 'Symbol',
  activeCount: 'Active count',
  lrSlope50: 'Trend (LR 50d)',
  rsi: 'RSI',
  divergenceStrength: 'Divergence strength',
  closestToSL: 'Closest to SL',
  closestToTP: 'Closest to TP',
  closestToPE: 'Closest to entry (PE)',
  biggestWinner: 'Biggest winner',
  biggestLoser: 'Biggest loser',
  worstDriftToTP: 'Worst drift to TP',
  oldestOpenAge: 'Oldest open',
  oldestPlanAge: 'Oldest plan',
}

export const SORT_KEY_DEFAULT_DIR: Record<SortKey, SortDir> = {
  symbol: 'asc',
  activeCount: 'desc',
  lrSlope50: 'desc',
  rsi: 'desc',
  divergenceStrength: 'desc',
  closestToSL: 'desc',
  closestToTP: 'desc',
  closestToPE: 'asc',
  biggestWinner: 'desc',
  biggestLoser: 'asc',
  worstDriftToTP: 'desc',
  oldestOpenAge: 'desc',
  oldestPlanAge: 'desc',
}
