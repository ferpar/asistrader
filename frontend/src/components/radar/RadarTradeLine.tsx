import { Fragment } from 'react'
import type { DatedClose, PriceChanges } from '../../domain/radar/types'
import type { TradeWithMetrics, LiveMetrics } from '../../domain/trade/types'
import { formatPlanAge, formatOpenAge, formatPlanToOpen } from '../../utils/trade'
import { getPositionNum } from '../../utils/tradeLive'
import { computeTimelineRange, computeDrift, formatDriftText } from '../../utils/timelineExpectations'
import type { TimelineRange, DriftRange } from '../../utils/timelineExpectations'
import { computePriceChangesAsOf } from '../../domain/radar/indicators'
import { TimelineOverlapBar } from './TimelineOverlapBar'
import { TradeActions } from '../TradeActions'
import styles from './RadarTickerCard.module.css'
import tooltipStyles from '../../styles/tooltip.module.css'

const formatPercentShort = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)

type ProjectedState = 'ok' | 'fresh' | 'receding' | 'none'
type TargetKind = 'pe' | 'tp' | 'sl'

interface EtaCellData {
  dynamic: TimelineRange
  projected: TimelineRange | null
  drift: DriftRange | null
  projectedState: ProjectedState
  tooltip: string
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

function baselineDate(trade: TradeWithMetrics): Date | null {
  if (trade.status === 'open') return trade.dateActual
  if (trade.status === 'plan' || trade.status === 'ordered') return trade.datePlanned
  return null
}

function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
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

function targetName(kind: TargetKind): string {
  if (kind === 'tp') return 'take profit'
  if (kind === 'sl') return 'stop loss'
  return 'entry'
}

type GuideTone = 'good' | 'bad' | null

interface GuideRow {
  name: string
  desc: string
  tone: GuideTone
}

function guideRows(kind: TargetKind): GuideRow[] {
  if (kind === 'tp') {
    return [
      { name: 'new', desc: 'trade just opened', tone: null },
      { name: '↘ proj', desc: 'baseline trend was away from TP', tone: null },
      { name: 'ahead', desc: 'reaching TP sooner than projected', tone: 'good' },
      { name: 'behind', desc: 'reaching TP later than projected', tone: 'bad' },
      { name: 'on pace', desc: 'dynamic tracks the baseline', tone: null },
    ]
  }
  if (kind === 'sl') {
    return [
      { name: 'new', desc: 'trade just opened', tone: null },
      { name: '↘ proj', desc: 'baseline trend was away from SL', tone: null },
      { name: 'ahead', desc: 'reaching SL sooner than projected', tone: 'bad' },
      { name: 'behind', desc: 'reaching SL later than projected', tone: 'good' },
      { name: 'on pace', desc: 'dynamic tracks the baseline', tone: null },
    ]
  }
  return [
    { name: 'new', desc: 'plan just created', tone: null },
    { name: '↘ proj', desc: 'baseline trend was away from entry', tone: null },
    { name: 'ahead', desc: 'reaching entry sooner than projected', tone: null },
    { name: 'behind', desc: 'reaching entry later than projected', tone: null },
    { name: 'on pace', desc: 'dynamic tracks the baseline', tone: null },
  ]
}

function guideHeading(kind: TargetKind): string {
  if (kind === 'tp') return 'Badge guide — ETA→TP'
  if (kind === 'sl') return 'Badge guide — ETA→SL'
  return 'Badge guide — ETA→entry'
}

function toneClass(tone: GuideTone): string {
  if (tone === 'good') return styles.guideToneGood
  if (tone === 'bad') return styles.guideToneBad
  return styles.guideToneNeutral
}

function BadgeGuideIcon({ label, kind }: { label: string; kind: TargetKind }) {
  const rows = guideRows(kind)
  return (
    <span
      className={`${styles.helpIcon} ${tooltipStyles.richTooltipHost}`}
      tabIndex={0}
      role="img"
      aria-label={`${label} badge guide`}
    >
      ?
      <span className={tooltipStyles.richTooltip} role="tooltip">
        <span className={styles.guideHeading}>{guideHeading(kind)}</span>
        <span className={styles.guideGrid}>
          {rows.map((r) => (
            <Fragment key={r.name}>
              <span className={styles.guideName}>{r.name}</span>
              <span className={styles.guideDesc}>{r.desc}</span>
              <span className={`${styles.guideTone} ${toneClass(r.tone)}`}>
                {r.tone ?? '—'}
              </span>
            </Fragment>
          ))}
        </span>
      </span>
    </span>
  )
}

function interpretation(
  state: ProjectedState,
  drift: DriftRange | null,
  kind: TargetKind,
): string | null {
  const name = targetName(kind)

  if (state === 'fresh') {
    return 'new: trade just opened — no baseline to compare against yet'
  }
  if (state === 'none') {
    return 'no projection: insufficient history to compute baseline averages'
  }
  if (state === 'receding') {
    if (kind === 'tp') return '↘ proj: at open, trend was moving away from TP — unfavorable baseline'
    if (kind === 'sl') return '↘ proj: at open, trend was moving away from SL — favorable baseline'
    return '↘ proj: at open, trend was moving away from entry'
  }
  if (state === 'ok' && drift) {
    if (drift.state === 'on-pace') {
      return `on pace: dynamic and projected ranges overlap — tracking the ${name} estimate from open`
    }
    if (drift.state === 'ahead') {
      if (kind === 'tp') return 'ahead: reaching TP sooner than baseline projected — favorable'
      if (kind === 'sl') return 'ahead: reaching SL sooner than baseline projected — unfavorable'
      return 'ahead: reaching entry sooner than baseline projected'
    }
    if (drift.state === 'behind') {
      if (kind === 'tp') return 'behind: reaching TP later than baseline projected — unfavorable'
      if (kind === 'sl') return 'behind: reaching SL later than baseline projected — favorable'
      return 'behind: reaching entry later than baseline projected'
    }
  }
  return null
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

  const etaFor = (target: typeof trade.entryPrice, kind: TargetKind): EtaCellData | null => {
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
      // covered by interpretation below
    } else if (projectedState === 'none') {
      // covered by interpretation below
    } else if (projected) {
      lines.push(`proj ${projected.text}${baselineKey ? ` (from ${baselineKey})` : ''}`)
      if (drift) lines.push(`drift ${formatDriftText(drift)}`)
    }

    const note = interpretation(projectedState, drift, kind)
    if (note) lines.push('', note)

    return { dynamic, projected, drift, projectedState, tooltip: lines.join('\n') }
  }

  const etaPe = showEtaPe ? etaFor(trade.entryPrice, 'pe') : null
  const etaTp = showEtaTpSl ? etaFor(trade.takeProfit, 'tp') : null
  const etaSl = showEtaTpSl ? etaFor(trade.stopLoss, 'sl') : null

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

  const currentPriceNum = metric?.currentPrice?.toNumber() ?? null

  const pe = renderEta(etaPe, showEtaPe)
  const tp = renderEta(etaTp, showEtaTpSl)
  const sl = renderEta(etaSl, showEtaTpSl)
  const renderLabel = (label: string, kind: TargetKind) => (
    <span className={styles.etaLabelRow}>
      <span className={styles.tradeCellLabel}>{label}</span>
      <BadgeGuideIcon label={label} kind={kind} />
    </span>
  )

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
      <span className={`${styles.tradeCell} ${tooltipStyles.tooltipHost}`} data-tooltip={pe.tooltip}>
        {renderLabel('ETA→PE', 'pe')}
        {pe.body}
      </span>
      <span className={`${styles.tradeCell} ${tooltipStyles.tooltipHost}`} data-tooltip={tp.tooltip}>
        {renderLabel('ETA→TP', 'tp')}
        {tp.body}
      </span>
      <span className={`${styles.tradeCell} ${tooltipStyles.tooltipHost}`} data-tooltip={sl.tooltip}>
        {renderLabel('ETA→SL', 'sl')}
        {sl.body}
      </span>
      <span className={styles.tradeActionsCell}>
        <TradeActions trade={trade} currentPrice={currentPriceNum} />
      </span>
    </div>
  )
}
