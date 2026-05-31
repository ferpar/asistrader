import { useMemo, useState } from 'react'
import { curveMonotoneX, line, scaleBand, scaleLinear } from 'd3'
import { YAxis } from '../../components/charts/Axes'
import { ChartTooltip, useTooltip } from '../../components/charts/ChartTooltip'
import type { OrderedRow } from './orderedSelectors'
import { computeFit, type FitMode } from './orderedFits'
import { fmtPct } from './format'
import { Toggle } from './Toggle'
import chartStyles from '../../components/charts/charts.module.css'
import styles from './OrderedSection.module.css'

// Diverging palette for the score-coloured age dots. Magnitude controls
// opacity so a near-zero score reads as muted/uncertain rather than committing
// to a strong red or green. The opacity floor keeps even weak signals visible.
const DOT_STRONG_POS = '#3fb950'
const DOT_STRONG_NEG = '#f85149'
const DOT_NEUTRAL = '#8c959f'
const DOT_MIN_ALPHA = 0.55

function scoreColor(score: number): string {
  if (Math.abs(score) < 5) return DOT_NEUTRAL
  // Saturate by |score| = 40 so mid-strength signals already look fully on.
  const mag = Math.min(1, Math.abs(score) / 40)
  const alpha = DOT_MIN_ALPHA + (1 - DOT_MIN_ALPHA) * mag
  const base = score > 0 ? DOT_STRONG_POS : DOT_STRONG_NEG
  return base + Math.round(alpha * 255).toString(16).padStart(2, '0')
}

const FIT_OPTIONS: { id: FitMode; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'linear', label: 'Linear' },
  { id: 'quadratic', label: 'Quadratic' },
  { id: 'local', label: 'Local avg (±5)' },
]

const W = 720
const H = 280
const M = { top: 16, right: 56, bottom: 56, left: 52 }

/** Truncate a ticker for the x-axis when there are too many bars to label fully. */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

interface Props {
  rows: OrderedRow[]
  highlightIds: Set<number>
  /** Whether the parent has an active search query — controls dimming of non-matches. */
  hasActiveQuery: boolean
}

export function OrderedScatterChart({ rows, highlightIds, hasActiveQuery }: Props) {
  const { tooltip, show, hide } = useTooltip()
  const [fitMode, setFitMode] = useState<FitMode>('local')

  const sorted = useMemo(() => {
    // Drop rows with no position % — they can't be placed against the right axis.
    return rows
      .filter((r): r is OrderedRow & { positionPct: number } => r.positionPct !== null)
      .sort((a, b) => b.positionPct - a.positionPct)
  }, [rows])

  const fittedAges = useMemo(
    () => computeFit(sorted.map((r) => r.orderAgeDays ?? 0), fitMode),
    [sorted, fitMode],
  )

  if (sorted.length === 0) {
    return (
      <p className={chartStyles.empty}>
        No live position data yet — waiting for prices to load.
      </p>
    )
  }

  const xLabels = sorted.map((r) => String(r.tradeId))
  const labelByKey = new Map(sorted.map((r) => [String(r.tradeId), r] as const))

  const xScale = scaleBand<string>()
    .domain(xLabels)
    .range([M.left, W - M.right])
    .padding(0.2)

  const positions = sorted.map((r) => r.positionPct)
  const ages = sorted.map((r) => r.orderAgeDays ?? 0)
  const posMax = Math.max(...positions.map(Math.abs), 0.01)
  const ageMax = Math.max(...ages, 1)

  // Position % axis is symmetric around zero so bars read naturally as
  // "above PE" / "below PE" regardless of which side dominates the orders.
  const yPos = scaleLinear()
    .domain([-posMax, posMax])
    .nice()
    .range([H - M.bottom, M.top])

  const yAge = scaleLinear().domain([0, ageMax]).nice().range([H - M.bottom, M.top])

  const bandwidth = xScale.bandwidth()
  const zeroY = yPos(0)

  // Truncation kicks in once labels start to overlap; band width is a good proxy.
  const labelMax = bandwidth < 28 ? 4 : bandwidth < 48 ? 8 : 12

  const fitPath =
    fittedAges === null
      ? null
      : line<number>()
          .x((_, i) => (xScale(String(sorted[i].tradeId)) ?? 0) + bandwidth / 2)
          .y((v) => yAge(v))
          .curve(curveMonotoneX)(fittedAges) ?? null

  return (
    <figure className={chartStyles.figure} style={{ marginTop: '1rem' }}>
      <div className={styles.chartToolbar}>
        <span className={styles.chartToolbarLabel}>Age trend</span>
        <Toggle options={FIT_OPTIONS} value={fitMode} onChange={setFitMode} />
      </div>
      <div className={chartStyles.chartFrame}>
        <svg
          className={chartStyles.chart}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Ordered trades: position % and age"
        >
          {/* Zero baseline for the position axis */}
          <line
            x1={M.left}
            x2={W - M.right}
            y1={zeroY}
            y2={zeroY}
            className={chartStyles.gridLine}
          />

          {/* Bars: position % — sign-coded red/green per existing semantics. */}
          {sorted.map((r) => {
            const key = String(r.tradeId)
            const x = xScale(key) ?? 0
            const y = r.positionPct >= 0 ? yPos(r.positionPct) : zeroY
            const height = Math.abs(yPos(r.positionPct) - zeroY)
            const isHighlight = highlightIds.has(r.tradeId)
            const dimmed = hasActiveQuery && !isHighlight
            return (
              <rect
                key={`bar-${r.tradeId}`}
                x={x}
                y={y}
                width={bandwidth}
                height={Math.max(1, height)}
                className={`${styles.posBar} ${r.positionPct >= 0 ? styles.posBarPositive : styles.posBarNegative} ${dimmed ? styles.dimmed : ''} ${isHighlight ? styles.highlight : ''}`}
              />
            )
          })}

          {/* Trend line through the age dots — drawn before the dots so the
              points stay legible on top of the fit. */}
          {fitPath && <path className={styles.fitLine} d={fitPath} />}

          {/* Dots: order age (left axis), coloured by convergence score so the
              "act vs leave alone" signal sits alongside age. Dots without a
              score fall back to the original neutral info colour. */}
          {sorted.map((r) => {
            const key = String(r.tradeId)
            const x = (xScale(key) ?? 0) + bandwidth / 2
            const y = yAge(r.orderAgeDays ?? 0)
            const isHighlight = highlightIds.has(r.tradeId)
            const dimmed = hasActiveQuery && !isHighlight
            const fill = r.convergence ? scoreColor(r.convergence.score) : null
            return (
              <circle
                key={`age-${r.tradeId}`}
                cx={x}
                cy={y}
                r={isHighlight ? 5 : 3.5}
                className={`${styles.ageDot} ${dimmed ? styles.dimmed : ''} ${isHighlight ? styles.highlight : ''}`}
                style={fill ? { fill } : undefined}
              />
            )
          })}

          {/* Transparent hit areas — one per x-band — drive the tooltip. */}
          {sorted.map((r) => {
            const key = String(r.tradeId)
            const x = xScale(key) ?? 0
            return (
              <rect
                key={`hit-${r.tradeId}`}
                x={x}
                y={M.top}
                width={bandwidth}
                height={H - M.bottom - M.top}
                className={chartStyles.hitArea}
                onMouseEnter={() => {
                  const row = labelByKey.get(key)
                  if (!row) return
                  show({
                    xPct: ((x + bandwidth / 2) / W) * 100,
                    yPct: (M.top / H) * 100,
                    title: `${row.ticker} · #${row.tradeNumber ?? row.tradeId}`,
                    rows: [
                      { label: 'PE', value: row.entryPrice.toLocaleString('en-US', { maximumFractionDigits: 4 }) },
                      {
                        label: 'Current',
                        value:
                          row.currentPrice === null
                            ? '—'
                            : row.currentPrice.toLocaleString('en-US', { maximumFractionDigits: 4 }),
                      },
                      {
                        label: 'Position',
                        value: fmtPct(row.positionPct ?? 0),
                        color:
                          row.positionPct === null
                            ? undefined
                            : row.positionPct >= 0
                              ? 'var(--color-success, #1a7f37)'
                              : 'var(--color-error, #cf222e)',
                      },
                      {
                        label: 'Order age',
                        value: row.orderAgeDays === null ? '—' : `${row.orderAgeDays}d`,
                      },
                      ...(row.driftBadge
                        ? [{ label: 'Drift', value: row.driftBadge }]
                        : []),
                      ...(row.convergence
                        ? [
                            {
                              label: 'Convergence',
                              value:
                                (row.convergence.score > 0 ? '+' : '') +
                                Math.round(row.convergence.score).toString(),
                              color: scoreColor(row.convergence.score),
                            },
                          ]
                        : []),
                    ],
                  })
                }}
                onMouseLeave={hide}
              />
            )
          })}

          {/* X-axis: ticker labels, rotated 45°. Alternating labels are
              shifted along the (+1, +1) diagonal — perpendicular to the
              text's reading direction — so odd labels sit on a parallel row
              further from the axis instead of colliding with their neighbours
              along the rotated bodies. */}
          <g transform={`translate(0, ${H - M.bottom})`} className={chartStyles.axis}>
            <line x1={M.left} x2={W - M.right} y1={0} y2={0} />
            {sorted.map((r, i) => {
              const key = String(r.tradeId)
              const xCenter = (xScale(key) ?? 0) + bandwidth / 2
              const isHighlight = highlightIds.has(r.tradeId)
              const diag = i % 2 === 0 ? 0 : 10
              const x = xCenter + diag
              const y = 12 + diag
              return (
                <text
                  key={`xlab-${r.tradeId}`}
                  x={x}
                  y={y}
                  textAnchor="end"
                  transform={`rotate(-45, ${x}, ${y})`}
                  fontSize="0.6rem"
                  fontWeight={isHighlight ? 700 : 400}
                >
                  {truncate(r.ticker, labelMax)}
                </text>
              )
            })}
          </g>

          <YAxis
            scale={yAge}
            left={M.left}
            ticks={5}
            tickPadding={7}
            format={(v) => `${(v as number).toFixed(0)}d`}
          />
          <YAxis
            scale={yPos}
            left={W - M.right}
            orient="right"
            ticks={5}
            tickPadding={7}
            format={(v) => `${((v as number) * 100).toFixed(0)}%`}
          />

          {/* Axis labels */}
          <text
            x={M.left - 36}
            y={M.top - 4}
            className={chartStyles.axisLabel}
          >
            Age (days)
          </text>
          <text
            x={W - M.right + 6}
            y={M.top - 4}
            className={chartStyles.axisLabel}
          >
            Position %
          </text>
        </svg>
        <ChartTooltip tooltip={tooltip} />
      </div>
      <div className={chartStyles.legend}>
        <span className={chartStyles.legendItem}>
          <span
            className={chartStyles.swatch}
            style={{ background: 'var(--color-success, #1a7f37)' }}
          />
          Position % (above PE)
        </span>
        <span className={chartStyles.legendItem}>
          <span
            className={chartStyles.swatch}
            style={{ background: 'var(--color-error, #cf222e)' }}
          />
          Position % (below PE)
        </span>
        <span className={chartStyles.legendItem}>
          Order age dots (coloured by convergence):
          <span
            className={chartStyles.swatch}
            style={{ background: DOT_STRONG_NEG, borderRadius: '50%', width: 8, height: 8, marginLeft: 6 }}
          />
          drifting away
          <span
            className={chartStyles.swatch}
            style={{ background: DOT_NEUTRAL, borderRadius: '50%', width: 8, height: 8 }}
          />
          neutral
          <span
            className={chartStyles.swatch}
            style={{ background: DOT_STRONG_POS, borderRadius: '50%', width: 8, height: 8 }}
          />
          converging
        </span>
        {fitPath && (
          <span className={chartStyles.legendItem}>
            <span className={`${chartStyles.swatch} ${styles.fitSwatch}`} />
            Age trend ({FIT_OPTIONS.find((o) => o.id === fitMode)?.label.toLowerCase()})
          </span>
        )}
      </div>
    </figure>
  )
}
