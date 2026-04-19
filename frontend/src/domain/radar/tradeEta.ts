import type { Decimal } from '../shared/Decimal'
import type { TradeWithMetrics, LiveMetrics } from '../trade/types'
import type { DatedClose, PriceChanges } from './types'
import {
  computeTimelineRange,
  computeDrift,
  formatDriftText,
  type TimelineRange,
  type DriftRange,
} from '../../utils/timelineExpectations'
import { computePriceChangesAsOf } from './indicators'

export type ProjectedState = 'ok' | 'fresh' | 'receding' | 'none'
export type TargetKind = 'pe' | 'tp' | 'sl'

export interface TradeEtaCell {
  dynamic: TimelineRange
  projected: TimelineRange | null
  drift: DriftRange | null
  projectedState: ProjectedState
  badge: string | null
  tooltip: string
}

export interface TradeEta {
  pe: TradeEtaCell | null
  tp: TradeEtaCell | null
  sl: TradeEtaCell | null
}

function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function baselineDate(trade: TradeWithMetrics): Date | null {
  if (trade.status === 'open') return trade.dateActual
  if (trade.status === 'plan' || trade.status === 'ordered') return trade.datePlanned
  return null
}

export function badgeText(state: ProjectedState, drift: DriftRange | null): string | null {
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

function classifyProjectedState(
  projected: TimelineRange | null,
  isFresh: boolean,
): ProjectedState {
  if (isFresh) return 'fresh'
  if (!projected) return 'none'
  if (projected.lo === null && (projected.a === 'receding' || projected.b === 'receding')) {
    return 'receding'
  }
  if (projected.lo === null && projected.a === null && projected.b === null) return 'none'
  return 'ok'
}

function buildCell(
  currentPrice: Decimal,
  target: Decimal,
  priceChanges: PriceChanges,
  projectedChanges: PriceChanges | null,
  baselineKey: string | null,
  isFresh: boolean,
  kind: TargetKind,
  now: Date,
): TradeEtaCell {
  const dynamic = computeTimelineRange(currentPrice, target, priceChanges)
  const projected = projectedChanges
    ? computeTimelineRange(currentPrice, target, projectedChanges)
    : null
  const projectedState = classifyProjectedState(projected, isFresh)
  const drift = projectedState === 'ok' && projected ? computeDrift(dynamic, projected) : null

  const lines: string[] = [`now ${dynamic.text}`]
  if (projectedState === 'ok' && projected) {
    lines.push(`proj ${projected.text}${baselineKey ? ` (from ${baselineKey})` : ''}`)
    if (drift) lines.push(`drift ${formatDriftText(drift)}`)
  }
  const note = interpretation(projectedState, drift, kind)
  if (note) lines.push('', note)

  // `now` is a parameter to keep the function pure/testable; it does not affect
  // `text` content today but is threaded through for future extensions.
  void now

  return {
    dynamic,
    projected,
    drift,
    projectedState,
    badge: badgeText(projectedState, drift),
    tooltip: lines.join('\n'),
  }
}

export function computeTradeEta(
  trade: TradeWithMetrics,
  metric: LiveMetrics | undefined,
  priceChanges: PriceChanges,
  datedCloses: DatedClose[],
  now: Date = new Date(),
): TradeEta {
  const empty: TradeEta = { pe: null, tp: null, sl: null }
  if (!metric?.currentPrice) return empty

  const baseline = baselineDate(trade)
  const today = toIsoDay(now)
  const baselineKey = baseline ? toIsoDay(baseline) : null
  const isFresh = !!baselineKey && !(baselineKey < today)
  const projectedChanges =
    baselineKey && !isFresh ? computePriceChangesAsOf(datedCloses, baselineKey) : null

  const showEtaPe = trade.status === 'plan' || trade.status === 'ordered'
  const showEtaTpSl = trade.status === 'open'

  return {
    pe: showEtaPe
      ? buildCell(metric.currentPrice, trade.entryPrice, priceChanges, projectedChanges, baselineKey, isFresh, 'pe', now)
      : null,
    tp: showEtaTpSl
      ? buildCell(metric.currentPrice, trade.takeProfit, priceChanges, projectedChanges, baselineKey, isFresh, 'tp', now)
      : null,
    sl: showEtaTpSl
      ? buildCell(metric.currentPrice, trade.stopLoss, priceChanges, projectedChanges, baselineKey, isFresh, 'sl', now)
      : null,
  }
}
