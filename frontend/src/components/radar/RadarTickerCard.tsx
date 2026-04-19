import { observer } from '@legendapp/state/react'
import type { TickerIndicators, DatedClose } from '../../domain/radar/types'
import type { Ticker } from '../../domain/ticker/types'
import type { TradeWithMetrics, LiveMetrics } from '../../domain/trade/types'
import { formatPlanAge, formatOpenAge, formatPlanToOpen } from '../../utils/trade'
import { getPositionNum } from '../../utils/tradeLive'
import { formatPrice } from '../../utils/priceFormat'
import { computeTimelineRange, computeDrift, formatDriftText } from '../../utils/timelineExpectations'
import type { TimelineRange, DriftRange } from '../../utils/timelineExpectations'
import type { PriceChanges } from '../../domain/radar/types'
import { computePriceChangesAsOf } from '../../domain/radar/indicators'
import { TimelineOverlapBar } from './TimelineOverlapBar'
import styles from './RadarTickerCard.module.css'
import tooltipStyles from '../../styles/tooltip.module.css'

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

const formatPercentShort = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)

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

interface TradeLineProps {
  trade: TradeWithMetrics
  metric: LiveMetrics | undefined
  priceChanges: PriceChanges
  datedCloses: DatedClose[]
  fmt: (value: number) => string
}

function baselineDate(trade: TradeWithMetrics): Date | null {
  if (trade.status === 'open') return trade.dateActual
  if (trade.status === 'plan' || trade.status === 'ordered') return trade.datePlanned
  return null
}

function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

type ProjectedState = 'ok' | 'fresh' | 'receding' | 'none'

interface EtaCellData {
  dynamic: TimelineRange
  projected: TimelineRange | null
  drift: DriftRange | null
  projectedState: ProjectedState
  tooltip: string
}

function badgeText(state: ProjectedState, drift: DriftRange | null): string | null {
  if (state === 'fresh') return 'new'
  if (state === 'receding') return '↘ proj'
  if (state === 'ok' && drift) {
    if (drift.state === 'ahead') return 'ahead'
    if (drift.state === 'behind') return 'behind'
    return 'on pace'
  }
  return null
}

function TradeLine({ trade, metric, priceChanges, datedCloses, fmt }: TradeLineProps) {
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

  const showEtaPe = trade.status === 'plan' || trade.status === 'ordered'
  const showEtaTpSl = trade.status === 'open'

  const baseline = baselineDate(trade)
  const today = toIsoDay(new Date())
  const baselineKey = baseline ? toIsoDay(baseline) : null
  const isFresh = !!baselineKey && !(baselineKey < today)
  const projectedChanges: PriceChanges | null =
    baselineKey && !isFresh
      ? computePriceChangesAsOf(datedCloses, baselineKey)
      : null

  const etaFor = (target: typeof trade.entryPrice): EtaCellData | null => {
    if (!metric?.currentPrice) return null
    const dynamic = computeTimelineRange(metric.currentPrice, target, priceChanges)
    const projected = projectedChanges
      ? computeTimelineRange(metric.currentPrice, target, projectedChanges)
      : null

    let projectedState: ProjectedState
    if (isFresh) projectedState = 'fresh'
    else if (!projected) projectedState = 'none'
    else if (projected.lo === null && (projected.a === 'receding' || projected.b === 'receding')) projectedState = 'receding'
    else if (projected.lo === null && projected.a === null && projected.b === null) projectedState = 'none'
    else projectedState = 'ok'

    const drift = projectedState === 'ok' && projected ? computeDrift(dynamic, projected) : null

    const lines: string[] = [`now ${dynamic.text}`]
    if (projectedState === 'fresh') {
      lines.push('proj: trade just opened — no baseline drift yet')
    } else if (projectedState === 'none') {
      lines.push('proj: no projection available (insufficient history)')
    } else if (projected) {
      lines.push(`proj ${projected.text}${baselineKey ? ` (from ${baselineKey})` : ''}`)
      if (drift) lines.push(`drift ${formatDriftText(drift)}`)
    }

    return { dynamic, projected, drift, projectedState, tooltip: lines.join('\n') }
  }

  const etaPe = showEtaPe ? etaFor(trade.entryPrice) : null
  const etaTp = showEtaTpSl ? etaFor(trade.takeProfit) : null
  const etaSl = showEtaTpSl ? etaFor(trade.stopLoss) : null

  const renderEta = (data: EtaCellData | null, enabled: boolean) => {
    if (!enabled || !data) {
      return {
        tooltip: undefined as string | undefined,
        body: <span>-</span>,
      }
    }
    const projectedForBar =
      data.projectedState === 'ok' && data.projected && (data.projected.a !== null || data.projected.b !== null)
        ? { a: data.projected.a, b: data.projected.b }
        : null
    const badge = badgeText(data.projectedState, data.drift)
    return {
      tooltip: data.tooltip,
      body: (
        <>
          <span className={styles.etaValueRow}>
            <span>{data.dynamic.text}</span>
            {badge && <span className={styles.etaBadge}>· {badge}</span>}
          </span>
          <TimelineOverlapBar
            dynamic={{ a: data.dynamic.a, b: data.dynamic.b }}
            projected={projectedForBar}
          />
        </>
      ),
    }
  }

  return (
    <div className={styles.tradeRow}>
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
      {(() => {
        const pe = renderEta(etaPe, showEtaPe)
        const tp = renderEta(etaTp, showEtaTpSl)
        const sl = renderEta(etaSl, showEtaTpSl)
        return (
          <>
            <span className={`${styles.tradeCell} ${tooltipStyles.tooltipHost}`} data-tooltip={pe.tooltip}>
              <span className={styles.tradeCellLabel}>ETA→PE</span>
              {pe.body}
            </span>
            <span className={`${styles.tradeCell} ${tooltipStyles.tooltipHost}`} data-tooltip={tp.tooltip}>
              <span className={styles.tradeCellLabel}>ETA→TP</span>
              {tp.body}
            </span>
            <span className={`${styles.tradeCell} ${tooltipStyles.tooltipHost}`} data-tooltip={sl.tooltip}>
              <span className={styles.tradeCellLabel}>ETA→SL</span>
              {sl.body}
            </span>
          </>
        )
      })()}
    </div>
  )
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
  const { symbol, currentPrice, sma, priceChanges, datedCloses, error } = indicators
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
      </div>

      {activeTrades.length > 0 && (
        <div className={styles.tradesSection}>
          <div className={styles.sectionLabel}>Active Trades</div>
          <div className={styles.tradesList}>
            {activeTrades.map((t) => (
              <TradeLine
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
