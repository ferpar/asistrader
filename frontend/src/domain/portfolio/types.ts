import type { Decimal } from '../shared/Decimal'

/** A named collection of long-term Holdings, separate from Trades (ADR 0001). */
export interface Portfolio {
  id: number
  name: string
  /** Fixed at creation; every figure of the Portfolio is expressed in it. */
  currency: string
  createdAt: Date
  updatedAt: Date
}

export type TransactionKind = 'buy' | 'sell' | 'split'

/** A dated Buy/Sell/Split. Price and fees are in the instrument's currency. */
export interface PortfolioTransaction {
  id: number
  kind: TransactionKind
  date: Date
  ticker: string
  units: Decimal | null
  price: Decimal | null
  fees: Decimal
  /** Instrument → Portfolio currency rate entered by the user, if any. */
  fxRate: Decimal | null
}

export interface NewBuy {
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

/** Outcome of a CSV import: each row is created or fails on its own. */
export interface ImportResult {
  rows: ImportRowResult[]
  created: number
  failed: number
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
}

export interface PortfolioSummary {
  currency: string
  asOf: Date
  invested: Decimal
  portfolioValue: Decimal
  unrealizedGain: Decimal
  unrealizedGainPct: number | null
  holdings: Holding[]
}
