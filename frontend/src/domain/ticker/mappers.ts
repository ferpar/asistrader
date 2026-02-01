import type { TickerDTO } from '../../types/ticker'
import type { Ticker } from './types'
import { Decimal } from '../shared/Decimal'

export function mapTicker(dto: TickerDTO): Ticker {
  return {
    symbol: dto.symbol,
    name: dto.name,
    probability: dto.probability !== null ? Decimal.from(dto.probability) : null,
    trendMeanGrowth: dto.trend_mean_growth,
    trendStdDeviation: dto.trend_std_deviation,
    bias: dto.bias,
    horizon: dto.horizon,
    beta: dto.beta,
    strategyId: dto.strategy_id,
  }
}
