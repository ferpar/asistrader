import { Decimal } from '../shared/Decimal'
import type { TradeWithMetrics, PriceData, LiveMetrics } from './types'

export function computeMetrics(
  activeTrades: TradeWithMetrics[],
  prices: Record<string, PriceData>,
): Record<number, LiveMetrics> {
  const result: Record<number, LiveMetrics> = {}

  for (const trade of activeTrades) {
    const priceData = prices[trade.ticker.toUpperCase()]
    const currentPrice = priceData?.valid ? priceData.price : null

    if (currentPrice === null) {
      result[trade.id] = {
        currentPrice: null,
        distanceToSL: null,
        distanceToTP: null,
        distanceToPE: null,
        unrealizedPnL: null,
        unrealizedPnLPct: null,
      }
      continue
    }

    const distanceToSL = currentPrice.minus(trade.stopLoss).div(currentPrice)
    const distanceToTP = trade.takeProfit.minus(currentPrice).div(currentPrice)
    const distanceToPE = currentPrice.minus(trade.entryPrice).div(trade.entryPrice)

    const units = Decimal.from(trade.units)
    const unrealizedPnL = currentPrice.minus(trade.entryPrice).times(units)
    const unrealizedPnLPct = currentPrice.minus(trade.entryPrice).div(trade.entryPrice)

    result[trade.id] = {
      currentPrice,
      distanceToSL,
      distanceToTP,
      distanceToPE,
      unrealizedPnL,
      unrealizedPnLPct,
    }
  }

  return result
}
