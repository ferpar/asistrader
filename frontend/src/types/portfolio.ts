/** Wire shapes of the /api/portfolios endpoints (snake_case, as the backend sends them). */

export interface PortfolioDTO {
  id: number
  name: string
  currency: string
  created_at: string
  updated_at: string
}

export interface PortfolioListResponseDTO {
  portfolios: PortfolioDTO[]
  count: number
}

export interface PortfolioResponseDTO {
  portfolio: PortfolioDTO
  message: string
}

export interface PortfolioCreateRequest {
  name: string
  currency?: string
}

export type TransactionKindDTO = 'buy' | 'sell' | 'split'

export interface PortfolioTransactionDTO {
  id: number
  kind: TransactionKindDTO
  date: string
  ticker: string
  units: number | null
  price: number | null
  fees: number
  fx_rate: number | null
  split_ratio: number | null
  created_at: string
}

export interface PortfolioTransactionListResponseDTO {
  transactions: PortfolioTransactionDTO[]
  count: number
}

export interface PortfolioTransactionResponseDTO {
  transaction: PortfolioTransactionDTO
  message: string
}

/** Body of POST (create) and PUT (replace) of a Buy, Sell or Split. */
export type TransactionRequest =
  | {
      kind: 'buy' | 'sell'
      date: string
      ticker: string
      units: number
      price: number
      fees: number
      fx_rate?: number
    }
  | { kind: 'split'; date: string; ticker: string; split_ratio: number }

/** Daily rows as parallel columns: `column[i]` is the figure at the close of `dates[i]`. */
export interface PortfolioHistoryDTO {
  currency: string
  dates: string[]
  invested: number[]
  portfolio_value: number[]
  unrealized_gain: number[]
  unrealized_gain_pct: (number | null)[]
  realized_gain: number[]
  total_gain: number[]
  weighted_days_open: (number | null)[]
}

export interface PortfolioImportRequest {
  csv: string
}

export interface PortfolioImportRowResultDTO {
  row: number
  status: 'created' | 'error'
  transaction: PortfolioTransactionDTO | null
  error: string | null
}

export interface PortfolioImportResponseDTO {
  results: PortfolioImportRowResultDTO[]
  created: number
  failed: number
}

export interface PortfolioHoldingDTO {
  ticker: string
  name: string | null
  currency: string
  units: number
  cost: number
  value: number
  weight: number | null
  unrealized_gain: number
  unrealized_gain_pct: number | null
  last_price: number
  last_price_date: string
  asset_class: AssetClassDTO
  asset_class_override: AssetClassChoiceDTO | null
  weighted_days_open: number | null
}

export type AssetClassChoiceDTO = 'domestic_stock' | 'international_stock' | 'etf'
export type AssetClassDTO = AssetClassChoiceDTO | 'unclassified'

export interface PortfolioAssetClassDTO {
  asset_class: AssetClassDTO
  count: number
  invested: number
  portfolio_value: number
  unrealized_gain: number
  unrealized_gain_pct: number | null
  weighted_days_open: number | null
  weight: number | null
  tickers: string[]
}

export interface PortfolioSummaryDTO {
  currency: string
  as_of: string
  invested: number
  portfolio_value: number
  unrealized_gain: number
  unrealized_gain_pct: number | null
  realized_gain: number
  total_gain: number
  holdings: PortfolioHoldingDTO[]
  weighted_days_open: number | null
  simple_tir: number | null
  xirr: number | null
  asset_classes: PortfolioAssetClassDTO[]
}
