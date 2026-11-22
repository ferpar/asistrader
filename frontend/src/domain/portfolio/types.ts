import type { Decimal } from '../shared/Decimal'
import type { BasketKind } from '../basket/types'

/** A named collection of long-term Holdings, separate from Trades (ADR 0001). */
export interface Portfolio {
  id: number
  name: string
  /** Fixed at creation; every figure of the Portfolio is expressed in it. */
  currency: string
  createdAt: Date
  updatedAt: Date
}

export type TransactionKind = 'buy' | 'sell'

/** A dated Buy or Sell, with the units and price as entered (splits are
 * applied automatically by the backend). Price and fees are in the
 * instrument's currency. */
export interface PortfolioTransaction {
  id: number
  kind: TransactionKind
  date: Date
  ticker: string
  units: Decimal
  price: Decimal
  fees: Decimal
  /** Instrument → Portfolio currency rate entered by the user, if any. */
  fxRate: Decimal | null
}

/** A Buy or Sell as entered by the user, to record or to replace one. */
export interface TransactionInput {
  kind: TransactionKind
  date: string
  ticker: string
  units: number
  price: number
  fees: number
  fxRate?: number
}

/** What happened to one CSV data row; `row` is its line number (header = 1). */
export type ImportRowResult =
  | { row: number; status: 'created'; transaction: PortfolioTransaction }
  | { row: number; status: 'error'; error: string }
  /** Would have been recorded, but another row failed, so nothing was. */
  | { row: number; status: 'valid' }

/** Outcome of a CSV import, all or nothing: every row is created, or none is
 * and `failed` rows carry their reason. */
export interface ImportResult {
  rows: ImportRowResult[]
  created: number
  failed: number
}

/**
 * One business day of a Portfolio's history, money in Portfolio currency.
 * Plain numbers rather than Decimal: these rows feed charts, not arithmetic.
 */
export interface PortfolioHistoryRow {
  /** ISO date (YYYY-MM-DD). */
  date: string
  invested: number
  portfolioValue: number
  unrealizedGain: number
  unrealizedGainPct: number | null
  /** Cumulative up to and including this day. */
  realizedGain: number
  totalGain: number
  /** Calendar days; null when no Lots remain. */
  weightedDaysOpen: number | null
  /**
   * Time-weighted Performance Index: 100 on the first Transaction's day, each
   * day's return net of that day's Buys and Sells; flat while nothing is held.
   */
  performanceIndex: number
}

/** A Portfolio's daily history: one row per business day from its first Transaction. */
export interface PortfolioHistory {
  currency: string
  rows: PortfolioHistoryRow[]
}

/** An Asset Class a ticker can be assigned to by override. */
export type AssetClassChoice = 'domestic_stock' | 'international_stock' | 'etf'

/**
 * How a Holding is grouped: override, else ETF, else Domestic / International
 * Stock by listing country vs the user's Home Market. `unclassified` when the
 * ticker's metadata is unknown and no override is set.
 */
export type AssetClass = AssetClassChoice | 'unclassified'

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  domestic_stock: 'Domestic Stock',
  international_stock: 'International Stock',
  etf: 'ETF',
  unclassified: 'Unclassified',
}

/** Subtotals of the Holdings in one Asset Class; money in Portfolio currency. */
export interface AssetClassSubtotal {
  assetClass: AssetClass
  count: number
  invested: Decimal
  portfolioValue: Decimal
  unrealizedGain: Decimal
  unrealizedGainPct: number | null
  /** Over the class's Lots; null without Lots. */
  weightedDaysOpen: number | null
  /** Share of Portfolio Value. */
  weight: number | null
  tickers: string[]
}

/** One instrument's Holding; money in Portfolio currency except `lastPrice`. */
export interface Holding {
  ticker: string
  name: string | null
  currency: string
  units: Decimal
  cost: Decimal
  value: Decimal
  weight: number | null
  unrealizedGain: Decimal
  unrealizedGainPct: number | null
  lastPrice: Decimal
  lastPriceDate: Date
  assetClass: AssetClass
  /** The ticker's global override, when set. */
  assetClassOverride: AssetClassChoice | null
  /** Cost-weighted age of this Holding's Lots in calendar days. */
  weightedDaysOpen: number | null
  /** The Baskets visible to the user that contain this instrument, curated first. */
  baskets: HoldingBasket[]
}

/** A Basket a Holding's instrument belongs to (links to its detail page). */
export interface HoldingBasket {
  id: number
  name: string
  kind: BasketKind
}

export interface PortfolioSummary {
  currency: string
  asOf: Date
  invested: Decimal
  portfolioValue: Decimal
  unrealizedGain: Decimal
  unrealizedGainPct: number | null
  /** Accumulated result of Sells: net proceeds minus the consumed Lots' cost. */
  realizedGain: Decimal
  /** Unrealized Gain plus Realized Gain. */
  totalGain: Decimal
  holdings: Holding[]
  /** Calendar-day age of the remaining Lots, weighted by cost; null without Lots. */
  weightedDaysOpen: number | null
  /** Relative Unrealized Gain annualised linearly over Weighted Days Open (fraction). */
  simpleTir: number | null
  /** Annualised money-weighted return over Transaction cash flows (fraction). */
  xirr: number | null
  /** Holdings grouped by Asset Class: one subtotal per non-empty class, in
   *  the order Domestic Stock, International Stock, ETF, Unclassified. */
  assetClasses: AssetClassSubtotal[]
}
