import { observer } from '@legendapp/state/react'
import type { TickerIndicators } from '../../domain/radar/types'
import type { Ticker } from '../../domain/ticker/types'
import type { TradeWithMetrics, LiveMetrics } from '../../domain/trade/types'
import { formatPrice } from '../../utils/priceFormat'
import { RadarTradeLine } from './RadarTradeLine'
import styles from './RadarTickerCard.module.css'

interface RadarTickerCardProps {
  indicators: TickerIndicators
  ticker?: Ticker | null
  trades: TradeWithMetrics[]
  liveMetrics: Record<number, LiveMetrics>
  removable: boolean
  onRemove: (symbol: string) => void
  onNewTrade: (symbol: string) => void
}

const formatPercent = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)

const formatR2 = (value: number) => value.toFixed(2)

function getStructureColor(structure: string | null): string {
  if (!structure) return ''
  if (structure.startsWith('0')) return styles.bullish
  if (structure.startsWith('4')) return styles.bearish
  return ''
}

function countByStatus(trades: TradeWithMetrics[]) {
  let plan = 0, ordered = 0, open = 0, closed = 0
  for (const t of trades) {
    if (t.status === 'plan') plan++
    else if (t.status === 'ordered') ordered++
    else if (t.status === 'open') open++
    else if (t.status === 'close') closed++
  }
  return { plan, ordered, open, closed }
}

export const RadarTickerCard = observer(function RadarTickerCard({
  indicators,
  ticker,
  trades,
  liveMetrics,
  removable,
  onRemove,
  onNewTrade,
}: RadarTickerCardProps) {
  const { symbol, currentPrice, sma, priceChanges, linearRegression, datedCloses, error } = indicators
  const fmt = (value: number) => formatPrice(value, ticker?.currency, ticker?.priceHint)
  const tickerName = ticker?.name ?? null
  const counts = countByStatus(trades)
  const activeTrades = trades.filter((t) => t.status === 'plan' || t.status === 'ordered' || t.status === 'open')

  const header = (
    <div className={styles.cardHeader}>
      <div className={styles.symbolGroup}>
        <span className={styles.symbol}>{symbol}</span>
        {tickerName && <span className={styles.tickerName}>{tickerName}</span>}
        {!error && currentPrice !== null && (
          <span className={styles.price}>{fmt(currentPrice)}</span>
        )}
      </div>
      <div className={styles.headerRight}>
        <div className={styles.tradeCounts} title="plan / ordered / open / closed">
          <span className={`${styles.countChip} ${styles.countPlan}`}>
            <span className={styles.countLabel}>P</span>
            <span className={styles.countValue}>{counts.plan}</span>
          </span>
          <span className={`${styles.countChip} ${styles.countOrdered}`}>
            <span className={styles.countLabel}>Or</span>
            <span className={styles.countValue}>{counts.ordered}</span>
          </span>
          <span className={`${styles.countChip} ${styles.countOpen}`}>
            <span className={styles.countLabel}>Op</span>
            <span className={styles.countValue}>{counts.open}</span>
          </span>
          <span className={`${styles.countChip} ${styles.countClosed}`}>
            <span className={styles.countLabel}>C</span>
            <span className={styles.countValue}>{counts.closed}</span>
          </span>
        </div>
        {removable && (
          <button className={styles.removeBtn} onClick={() => onRemove(symbol)}>&times;</button>
        )}
      </div>
    </div>
  )

  const footer = (
    <div className={styles.cardFooter}>
      <button
        className={`${styles.btnAction} ${styles.btnNewTrade}`}
        onClick={() => onNewTrade(symbol)}
      >
        + New Trade
      </button>
    </div>
  )

  if (error) {
    return (
      <div className={`${styles.card} ${styles.cardError}`}>
        {header}
        <div className={styles.errorMsg}>{error}</div>
        {footer}
      </div>
    )
  }

  return (
    <div className={styles.card}>
      {header}

      <div className={styles.sections}>
        <div className={styles.section}>
          <div className={styles.sectionLabel}>SMA Structure</div>
          <div className={`${styles.structure} ${getStructureColor(sma.structure)}`}>
            {sma.structure ?? '-'}
          </div>
          <div className={styles.emaValues}>
            <span className={styles.emaItem}><span className={styles.emaLabel}>5</span> {sma.sma5 !== null ? fmt(sma.sma5) : '-'}</span>
            <span className={styles.emaItem}><span className={styles.emaLabel}>20</span> {sma.sma20 !== null ? fmt(sma.sma20) : '-'}</span>
            <span className={styles.emaItem}><span className={styles.emaLabel}>50</span> {sma.sma50 !== null ? fmt(sma.sma50) : '-'}</span>
            <span className={styles.emaItem}><span className={styles.emaLabel}>200</span> {sma.sma200 !== null ? fmt(sma.sma200) : '-'}</span>
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionLabel}>Avg Daily Change</div>
          <div className={styles.changeGrid}>
            <div className={styles.changeItem}>
              <span className={styles.changeLabel}>50d</span>
              <span className={priceChanges.avgChange50d !== null && priceChanges.avgChange50d >= 0 ? 'positive' : 'negative'}>
                {priceChanges.avgChange50d !== null ? fmt(priceChanges.avgChange50d) : '-'}
              </span>
              <span className={priceChanges.avgChangePct50d !== null && priceChanges.avgChangePct50d >= 0 ? 'positive' : 'negative'}>
                {priceChanges.avgChangePct50d !== null ? formatPercent(priceChanges.avgChangePct50d) : '-'}
              </span>
            </div>
            <div className={styles.changeItem}>
              <span className={styles.changeLabel}>5d</span>
              <span className={priceChanges.avgChange5d !== null && priceChanges.avgChange5d >= 0 ? 'positive' : 'negative'}>
                {priceChanges.avgChange5d !== null ? fmt(priceChanges.avgChange5d) : '-'}
              </span>
              <span className={priceChanges.avgChangePct5d !== null && priceChanges.avgChangePct5d >= 0 ? 'positive' : 'negative'}>
                {priceChanges.avgChangePct5d !== null ? formatPercent(priceChanges.avgChangePct5d) : '-'}
              </span>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionLabel}>Linear Regression</div>
          <div className={styles.changeGrid}>
            {([
              ['20d', linearRegression.lr20],
              ['50d', linearRegression.lr50],
              ['200d', linearRegression.lr200],
            ] as const).map(([label, lr]) => (
              <div key={label} className={styles.changeItem}>
                <span className={styles.changeLabel}>{label}</span>
                <span className={lr.slope !== null && lr.slope >= 0 ? 'positive' : 'negative'}>
                  {lr.slope !== null ? fmt(lr.slope) : '-'}
                </span>
                <span className={lr.slopePct !== null && lr.slopePct >= 0 ? 'positive' : 'negative'}>
                  {lr.slopePct !== null ? formatPercent(lr.slopePct) : '-'}
                </span>
                <span>R² {lr.r2 !== null ? formatR2(lr.r2) : '-'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {activeTrades.length > 0 && (
        <div className={styles.tradesSection}>
          <div className={styles.sectionLabel}>Active Trades</div>
          <div className={styles.tradesList}>
            {activeTrades.map((t) => (
              <RadarTradeLine
                key={t.id}
                trade={t}
                metric={liveMetrics[t.id]}
                priceChanges={priceChanges}
                datedCloses={datedCloses}
                fmt={fmt}
              />
            ))}
          </div>
        </div>
      )}

      {footer}
    </div>
  )
})
