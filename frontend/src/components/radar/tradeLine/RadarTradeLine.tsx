import type { DatedClose, PriceChanges } from '../../../domain/radar/types'
import type { TradeWithMetrics, LiveMetrics } from '../../../domain/trade/types'
import { formatPlanAge, formatOpenAge, formatPlanToOpen } from '../../../utils/trade'
import { getPositionNum } from '../../../utils/tradeLive'
import { computeTradeEta } from '../../../domain/radar/tradeEta'
import { EtaCell } from './EtaCell'
import { TradeActions } from '../../TradeActions'
import styles from '../RadarTickerCard.module.css'

const formatPercentShort = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)

function statusClass(status: TradeWithMetrics['status']): string {
  switch (status) {
    case 'plan': return styles.statusPlan
    case 'ordered': return styles.statusOrdered
    case 'open': return styles.statusOpen
    case 'close': return styles.statusClose
    case 'canceled': return styles.statusCanceled
    default: return ''
  }
}

export interface RadarTradeLineProps {
  trade: TradeWithMetrics
  metric: LiveMetrics | undefined
  priceChanges: PriceChanges
  datedCloses: DatedClose[]
  fmt: (value: number) => string
  leading?: React.ReactNode
}

export function RadarTradeLine({ trade, metric, priceChanges, datedCloses, fmt, leading }: RadarTradeLineProps) {
  const eta = computeTradeEta(trade, metric, priceChanges, datedCloses)
  const positionNum = getPositionNum(metric)
  const peDistNum = metric?.distanceToPE?.toNumber() ?? null
  const pnlNum = metric?.unrealizedPnL?.toNumber() ?? null
  const pnlPctNum = metric?.unrealizedPnLPct?.toNumber() ?? null

  const showPeDist = trade.status === 'plan' || trade.status === 'ordered'
  const showPnl = trade.status === 'open'
  const showPosition = trade.status === 'open'

  const pnlText = showPnl && pnlNum !== null && pnlPctNum !== null
    ? `${fmt(pnlNum)} (${formatPercentShort(pnlPctNum)})`
    : '-'

  const currentPriceNum = metric?.currentPrice?.toNumber() ?? null

  return (
    <div className={styles.tradeRow}>
      {leading}
      <span className={styles.tradeId}>#{trade.number ?? trade.id}</span>
      <span className={`${styles.tradeStatus} ${statusClass(trade.status)}`}>{trade.status}</span>
      <span className={styles.tradeCell}>
        <span className={styles.tradeCellLabel}>Plan Age</span>
        <span>{formatPlanAge(trade)}</span>
      </span>
      <span className={styles.tradeCell}>
        <span className={styles.tradeCellLabel}>Open Age</span>
        <span>{formatOpenAge(trade)}</span>
      </span>
      <span className={styles.tradeCell}>
        <span className={styles.tradeCellLabel}>Plan→Open</span>
        <span>{formatPlanToOpen(trade)}</span>
      </span>
      <span className={styles.tradeCell}>
        <span className={styles.tradeCellLabel}>Position</span>
        <span
          className={
            showPosition && positionNum !== null
              ? (positionNum >= 0 ? styles.distanceNear : styles.distanceDanger)
              : ''
          }
        >
          {showPosition && positionNum !== null ? formatPercentShort(positionNum) : '-'}
        </span>
      </span>
      <span className={styles.tradeCell}>
        <span className={styles.tradeCellLabel}>PE Dist</span>
        <span
          className={
            showPeDist && peDistNum !== null
              ? (peDistNum > 0 ? styles.distanceNear : peDistNum < 0 ? styles.distanceDanger : '')
              : ''
          }
        >
          {showPeDist && peDistNum !== null ? formatPercentShort(peDistNum) : '-'}
        </span>
      </span>
      <span className={styles.tradeCell}>
        <span className={styles.tradeCellLabel}>PnL</span>
        <span className={showPnl && pnlNum !== null ? (pnlNum > 0 ? 'positive' : 'negative') : ''}>
          {pnlText}
        </span>
      </span>
      <EtaCell label="ETA→PE" kind="pe" cell={eta.pe} />
      <EtaCell label="ETA→TP" kind="tp" cell={eta.tp} />
      <EtaCell label="ETA→SL" kind="sl" cell={eta.sl} />
      <span className={styles.tradeActionsCell}>
        <TradeActions trade={trade} currentPrice={currentPriceNum} />
      </span>
    </div>
  )
}
