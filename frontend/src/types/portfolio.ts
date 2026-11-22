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

export interface BuyRequest {
  kind: 'buy'
  date: string
  ticker: string
  units: number
  price: number
  fees: number
  fx_rate?: number
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
}

export interface PortfolioSummaryDTO {
  currency: string
  as_of: string
  invested: number
  portfolio_value: number
  unrealized_gain: number
  unrealized_gain_pct: number | null
  holdings: PortfolioHoldingDTO[]
}
