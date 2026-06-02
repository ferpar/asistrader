import type { OrderedSummary } from './orderedSelectors'
import { STALE_ORDER_DAYS } from './orderedSelectors'
import { fmtMoney, fmtPct } from '../../components/portfolio/format'
import { signClass } from '../../components/portfolio/signClass'
import styles from '../../components/portfolio/PortfolioCard.module.css'

interface Metric {
  label: string
  value: string
  cls?: string
  hint?: string
}

export function OrderedSummaryCard({
  summary,
  ccy,
}: {
  summary: OrderedSummary
  ccy: string
}) {
  const metrics: Metric[] = [
    { label: 'Orders', value: String(summary.count) },
    { label: 'Committed', value: fmtMoney(summary.totalCommitted, ccy) },
    {
      label: 'Avg position %',
      value: summary.avgPositionPct === null ? '—' : fmtPct(summary.avgPositionPct),
      cls: summary.avgPositionPct === null ? '' : signClass(summary.avgPositionPct),
      hint: 'Mean signed distance from current price to planned entry.',
    },
    {
      label: 'Avg order age',
      value:
        summary.avgOrderAgeDays === null
          ? '—'
          : `${summary.avgOrderAgeDays.toFixed(1)}d`,
    },
    {
      label: 'Closest to fill',
      value: summary.closestToFill
        ? `${summary.closestToFill.ticker} · ${fmtPct(summary.closestToFill.positionPct)}`
        : '—',
    },
    {
      label: 'Furthest from fill',
      value: summary.furthestFromFill
        ? `${summary.furthestFromFill.ticker} · ${fmtPct(summary.furthestFromFill.positionPct)}`
        : '—',
    },
    {
      label: `Stale (>${STALE_ORDER_DAYS}d)`,
      value: String(summary.staleCount),
      hint: `Orders older than ${STALE_ORDER_DAYS} days — candidates to refresh or cancel.`,
    },
  ]

  if (summary.hasDriftData) {
    metrics.push(
      {
        label: 'Drifting away',
        value: String(summary.driftingAwayCount),
        hint: 'Orders whose price is moving away from the planned entry vs. the at-plan baseline.',
      },
      {
        label: 'Trend-aligned',
        value: String(summary.trendAlignedCount),
        hint: 'Bullish SMA stack for longs / bearish for shorts (bullishScore ≥7 or ≤3).',
      },
    )
  }

  return (
    <div className={styles.card}>
      {metrics.map((m) => (
        <div key={m.label} className={styles.metric} title={m.hint}>
          <span className={styles.metricLabel}>{m.label}</span>
          <span className={`${styles.metricValue} ${m.cls ?? ''}`}>{m.value}</span>
        </div>
      ))}
    </div>
  )
}
