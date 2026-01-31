import { Decimal } from '../../shared/Decimal'
import type { TradeWithMetrics, PriceData } from '../types'

export function buildTrade(overrides?: Partial<TradeWithMetrics>): TradeWithMetrics {
  return {
    id: 1,
    number: 1,
    ticker: 'AAPL',
    status: 'open',
    amount: Decimal.from(1500),
    units: 10,
    entryPrice: Decimal.from(150),
    stopLoss: Decimal.from(140),
    takeProfit: Decimal.from(170),
    datePlanned: new Date('2025-01-10'),
    dateActual: new Date('2025-01-11'),
    exitDate: null,
    exitType: null,
    exitPrice: null,
    paperTrade: false,
    isLayered: false,
    remainingUnits: null,
    exitLevels: [],
    strategyId: null,
    strategyName: null,
    riskAbs: Decimal.from(-100),
    profitAbs: Decimal.from(200),
    riskPct: Decimal.from(-0.0667),
    profitPct: Decimal.from(0.1333),
    ratio: Decimal.from(2.0),
    ...overrides,
  }
}

export function buildPriceData(overrides?: Partial<PriceData>): PriceData {
  return {
    price: Decimal.from(155),
    currency: 'USD',
    valid: true,
    ...overrides,
  }
}
