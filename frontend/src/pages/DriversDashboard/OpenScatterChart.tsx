import type { TooltipRow } from '../../components/charts/ChartTooltip'
import { fmtPct } from '../../components/portfolio/format'
import type { SignFilter } from './orderedSelectors'
import type { OpenRow } from './openSelectors'
import {
  PositionAgeChart,
  scoreColor,
  DOT_STRONG_POS,
  DOT_STRONG_NEG,
  DOT_NEUTRAL,
} from './PositionAgeChart'
import chartStyles from '../../components/charts/charts.module.css'

interface Props {
  rows: OpenRow[]
  highlightIds: Set<number>
  /** Whether the parent has an active search query — controls dimming of non-matches. */
  hasActiveQuery: boolean
  /** Active segment filter — drives the y-axis anchoring and empty copy. */
  signFilter: SignFilter
}

const num = (v: number | null) =>
  v === null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 4 })

function tooltipRows(r: OpenRow): TooltipRow[] {
  return [
    { label: 'PE', value: num(r.entryPrice) },
    { label: 'Current', value: num(r.currentPrice) },
    {
      label: 'P&L',
      value: r.unrealizedPnLPct === null ? '—' : fmtPct(r.unrealizedPnLPct),
      color:
        r.unrealizedPnLPct === null
          ? undefined
          : r.unrealizedPnLPct >= 0
            ? 'var(--color-success, #1a7f37)'
            : 'var(--color-error, #cf222e)',
    },
    { label: 'To TP', value: r.distanceToTP === null ? '—' : fmtPct(r.distanceToTP) },
    { label: 'To SL', value: r.distanceToSL === null ? '—' : fmtPct(r.distanceToSL) },
    { label: 'Holding', value: r.holdingDays === null ? '—' : `${r.holdingDays}d` },
    ...(r.tpEta?.badge ? [{ label: 'TP ETA', value: r.tpEta.badge }] : []),
    ...(r.slEta?.badge ? [{ label: 'SL ETA', value: r.slEta.badge }] : []),
    ...(r.health
      ? [
          {
            label: 'Health',
            value: (r.health.score > 0 ? '+' : '') + Math.round(r.health.score).toString(),
            color: scoreColor(r.health.score),
          },
        ]
      : []),
  ]
}

const LEGEND = (
  <>
    <span className={chartStyles.legendItem}>
      <span className={chartStyles.swatch} style={{ background: 'var(--color-success, #1a7f37)' }} />
      Toward TP (profit)
    </span>
    <span className={chartStyles.legendItem}>
      <span className={chartStyles.swatch} style={{ background: 'var(--color-error, #cf222e)' }} />
      Toward SL (loss)
    </span>
    <span className={chartStyles.legendItem}>
      Holding dots (coloured by health):
      <span
        className={chartStyles.swatch}
        style={{ background: DOT_STRONG_NEG, borderRadius: '50%', width: 8, height: 8, marginLeft: 6 }}
      />
      heading to SL
      <span
        className={chartStyles.swatch}
        style={{ background: DOT_NEUTRAL, borderRadius: '50%', width: 8, height: 8 }}
      />
      neutral
      <span
        className={chartStyles.swatch}
        style={{ background: DOT_STRONG_POS, borderRadius: '50%', width: 8, height: 8 }}
      />
      heading to TP
    </span>
  </>
)

const emptyText = (filter: SignFilter) => {
  if (filter === 'positive') return 'No open positions on the take-profit side.'
  if (filter === 'negative') return 'No open positions on the stop-loss side.'
  return 'No live position data yet — waiting for prices to load.'
}

export function OpenScatterChart({ rows, highlightIds, hasActiveQuery, signFilter }: Props) {
  return (
    <PositionAgeChart
      rows={rows}
      highlightIds={highlightIds}
      hasActiveQuery={hasActiveQuery}
      signFilter={signFilter}
      id={(r) => r.tradeId}
      label={(r) => r.ticker}
      position={(r) => r.positionToTarget}
      age={(r) => r.holdingDays}
      score={(r) => r.health?.score ?? null}
      title={(r) => `${r.ticker} · #${r.tradeNumber ?? r.tradeId}`}
      tooltipRows={tooltipRows}
      positionAxisLabel="To target"
      ageAxisLabel="Holding (days)"
      positionFormat={(v) => `${(v * 100).toFixed(0)}%`}
      ageFormat={(v) => `${v.toFixed(0)}d`}
      ariaLabel="Open trades: progress to target and holding age"
      emptyText={emptyText}
      legend={LEGEND}
    />
  )
}
