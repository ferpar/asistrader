import { Decimal } from '../shared/Decimal'
import { parseDateOnly } from '../../utils/dateOnly'
import type {
  PortfolioDTO,
  PortfolioHistoryDTO,
  PortfolioHoldingDTO,
  PortfolioImportResponseDTO,
  PortfolioImportRowResultDTO,
  PortfolioSummaryDTO,
  PortfolioTransactionDTO,
} from '../../types/portfolio'
import type {
  Holding,
  ImportResult,
  ImportRowResult,
  Portfolio,
  PortfolioHistory,
  PortfolioSummary,
  PortfolioTransaction,
} from './types'

const decimalOrNull = (value: number | null): Decimal | null =>
  value === null ? null : Decimal.from(value)

export function mapPortfolio(dto: PortfolioDTO): Portfolio {
  return {
    id: dto.id,
    name: dto.name,
    currency: dto.currency,
    createdAt: new Date(dto.created_at),
    updatedAt: new Date(dto.updated_at),
  }
}

export function mapTransaction(dto: PortfolioTransactionDTO): PortfolioTransaction {
  return {
    id: dto.id,
    kind: dto.kind,
    date: parseDateOnly(dto.date),
    ticker: dto.ticker,
    units: decimalOrNull(dto.units),
    price: decimalOrNull(dto.price),
    fees: Decimal.from(dto.fees),
    fxRate: decimalOrNull(dto.fx_rate),
    splitRatio: decimalOrNull(dto.split_ratio ?? null),
  }
}

function mapImportRow(dto: PortfolioImportRowResultDTO): ImportRowResult {
  if (dto.status === 'created' && dto.transaction) {
    return { row: dto.row, status: 'created', transaction: mapTransaction(dto.transaction) }
  }
  return { row: dto.row, status: 'error', error: dto.error ?? 'Not imported' }
}

export function mapImportResult(dto: PortfolioImportResponseDTO): ImportResult {
  return { rows: dto.results.map(mapImportRow), created: dto.created, failed: dto.failed }
}

/** Pivot the columnar wire shape into one row per day. */
export function mapHistory(dto: PortfolioHistoryDTO): PortfolioHistory {
  return {
    currency: dto.currency,
    rows: dto.dates.map((date, i) => ({
      date,
      invested: dto.invested[i],
      portfolioValue: dto.portfolio_value[i],
      unrealizedGain: dto.unrealized_gain[i],
      unrealizedGainPct: dto.unrealized_gain_pct[i],
      realizedGain: dto.realized_gain[i],
      totalGain: dto.total_gain[i],
      weightedDaysOpen: dto.weighted_days_open[i],
      performanceIndex: dto.performance_index[i],
    })),
  }
}

function mapHolding(dto: PortfolioHoldingDTO): Holding {
  return {
    ticker: dto.ticker,
    name: dto.name,
    currency: dto.currency,
    units: Decimal.from(dto.units),
    cost: Decimal.from(dto.cost),
    value: Decimal.from(dto.value),
    weight: dto.weight,
    unrealizedGain: Decimal.from(dto.unrealized_gain),
    unrealizedGainPct: dto.unrealized_gain_pct,
    lastPrice: Decimal.from(dto.last_price),
    lastPriceDate: parseDateOnly(dto.last_price_date),
    baskets: dto.baskets,
  }
}

export function mapSummary(dto: PortfolioSummaryDTO): PortfolioSummary {
  return {
    currency: dto.currency,
    asOf: parseDateOnly(dto.as_of),
    invested: Decimal.from(dto.invested),
    portfolioValue: Decimal.from(dto.portfolio_value),
    unrealizedGain: Decimal.from(dto.unrealized_gain),
    unrealizedGainPct: dto.unrealized_gain_pct,
    realizedGain: Decimal.from(dto.realized_gain),
    totalGain: Decimal.from(dto.total_gain),
    holdings: dto.holdings.map(mapHolding),
    weightedDaysOpen: dto.weighted_days_open,
    simpleTir: dto.simple_tir,
    xirr: dto.xirr,
  }
}
