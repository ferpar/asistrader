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

/** A dated Buy/Sell/Split. Price and fees are in the instrument's currency.
 * A Split has no units, price or FX rate, only `splitRatio`. */
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
  /** New units per old unit (2 for a 2-for-1 split); set only on Splits. */
  splitRatio: Decimal | null
}

/** A Buy, Sell or Split as entered by the user, to record or to replace one.
 * A Split multiplies the units of every open Lot of the ticker by `splitRatio`
 * and leaves their cost unchanged. */
export type TransactionInput =
  | {
      kind: 'buy' | 'sell'
      date: string
      ticker: string
      units: number
      price: number
      fees: number
      fxRate?: number
    }
  | { kind: 'split'; date: string; ticker: string; splitRatio: number }

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
}
