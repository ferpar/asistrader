import type { TickerIndicators } from '../../domain/radar/types'
import type { Ticker } from '../../domain/ticker/types'
import type { TradeWithMetrics, LiveMetrics } from '../../domain/trade/types'
import { formatPrice } from '../../utils/priceFormat'
import { RadarTradeLine } from './RadarTradeLine'
import styles from './RadarFlatTradeRow.module.css'

interface RadarFlatTradeRowProps {
  indicator: TickerIndicators
  ticker?: Ticker | null
  trade: TradeWithMetrics
  metric: LiveMetrics | undefined
}

export function RadarFlatTradeRow({ indicator, ticker, trade, metric }: RadarFlatTradeRowProps) {
  const fmt = (value: number) => formatPrice(value, ticker?.currency, ticker?.priceHint)
  const tickerName = ticker?.name ?? null
  const currentPrice = indicator.currentPrice

  return (
    <div className={styles.row}>
      <div className={styles.rowHeader}>
        <span className={styles.symbol}>{indicator.symbol}</span>
        {tickerName && <span className={styles.name}>{tickerName}</span>}
        {currentPrice !== null && <span className={styles.price}>{fmt(currentPrice)}</span>}
      </div>
      <RadarTradeLine
        trade={trade}
        metric={metric}
        priceChanges={indicator.priceChanges}
        datedCloses={indicator.datedCloses}
        fmt={fmt}
      />
    </div>
  )
}
