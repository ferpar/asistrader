import { Trade, LiveMetrics, PriceData } from '../../types/trade'

export function computeMetrics(
  activeTrades: Trade[],
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

    const distanceToSL = (currentPrice - trade.stop_loss) / currentPrice
    const distanceToTP = (trade.take_profit - currentPrice) / currentPrice
    const distanceToPE = (currentPrice - trade.entry_price) / trade.entry_price

    const unrealizedPnL = (currentPrice - trade.entry_price) * trade.units
    const unrealizedPnLPct = (currentPrice - trade.entry_price) / trade.entry_price

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
